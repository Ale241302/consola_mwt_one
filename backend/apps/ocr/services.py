"""
=====================================================================
MWT.ONE · apps.ocr.services
Agente responsable: [AG-BACKEND]

Capa de servicios pura (sin request) para el flujo OCR del wizard
de Expedientes:

  1. parse_oc_pdf(file_bytes, filename)
     → Envía el PDF a Paperless-ngx, lee el texto OCRizado y lo
       parsea en un payload estructurado:
       {
         client: {name, tax_id, codigo_marluvas?},
         brand:  {name, brand_code?},
         po:     {number, date, currency, incoterm?, total?},
         lines:  [{sku, size, qty, unit_price, ocr_raw_line, confidence}],
         confidence, ocr_engine, paperless_task_id, raw_text_preview
       }

  2. resolve_client_price(client_id, sku, qty, unit_price)
     → Compara el precio OCR contra el canónico en
       productos.pricing_cliente (o precio_distribuidor fallback),
       valida MOQ del cliente, y devuelve:
       {
         system_unit_price, price_delta_pct, price_verdict, moq_client,
         moq_violated, notes
       }

  3. resolve_entity_identity(ocr_field, candidates)
     → Fuzzy-match (difflib) del nombre OCR contra catálogos
       clientes.cliente y brands.marca.

Este módulo NO toca la DB directamente para escritura — solo lectura.
La escritura la hace el orchestrator `create_from_oc` dentro de un
transaction.atomic().
=====================================================================
"""
from __future__ import annotations

import difflib
import io
import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Optional

from django.db import connection

log = logging.getLogger(__name__)


# --------------------------------------------------------------------
# 1. Paperless-ngx ingest + extract texto
# --------------------------------------------------------------------
def _extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extrae texto plano del PDF. Preferimos Paperless-ngx (mejor OCR
    para escaneos), pero si no está disponible caemos a `pdfminer.six`
    o `pypdf` para un best-effort local.
    Devuelve '' si todos los motores fallan."""
    # 1) pdfminer-six (text layer)
    try:
        from pdfminer.high_level import extract_text  # noqa: PLC0415
        text = extract_text(io.BytesIO(file_bytes))
        if text and text.strip():
            return text
    except Exception as e:
        log.debug("pdfminer no disponible o falló: %s", e)

    # 2) pypdf fallback
    try:
        from pypdf import PdfReader  # noqa: PLC0415
        reader = PdfReader(io.BytesIO(file_bytes))
        chunks = []
        for page in reader.pages:
            chunks.append(page.extract_text() or "")
        text = "\n".join(chunks)
        if text.strip():
            return text
    except Exception as e:
        log.debug("pypdf no disponible o falló: %s", e)

    return ""


def _paperless_then_text(file_bytes: bytes, filename: str) -> dict:
    """Sube el PDF a Paperless-ngx (para OCR + archivo inmutable) y
    paralelamente extrae el texto local. El task_id de Paperless se
    devuelve para auditar asincronamente."""
    task_id = None
    try:
        from apps.storage.services import paperless_ingest  # noqa: PLC0415
        result = paperless_ingest(
            file_bytes=file_bytes,
            filename=filename,
            title=f"OC · {filename}",
            document_type="OC Cliente",
            tags=["AC-01", "OC", "wizard"],
        )
        task_id = result.get("task_id")
    except Exception as e:
        log.warning("paperless_ingest falló (no crítico): %s", e)

    text = _extract_text_from_pdf(file_bytes)
    return {"text": text, "paperless_task_id": task_id}


# --------------------------------------------------------------------
# 2. Parseo heurístico del texto OCR
# --------------------------------------------------------------------
_RE_PO_NUMBER  = re.compile(r"(?:PO|P\.O\.|Orden(?:\s+de\s+Compra)?|Purchase\s+Order)[\s#:\-]*([A-Z0-9][A-Z0-9\-\/]{2,24})", re.I)
_RE_PO_DATE    = re.compile(r"(?:Fecha|Date|Issue\s*Date)[\s:\-]*([0-9]{1,2}[\-\/\.][0-9]{1,2}[\-\/\.][0-9]{2,4})", re.I)
_RE_CURRENCY   = re.compile(r"\b(USD|EUR|PEN|BRL|COP|MXN|CLP|ARS)\b")
_RE_INCOTERM   = re.compile(r"\b(FOB|CIF|EXW|DDP|DAP|CPT|FCA)\b(?:\s+[A-Z][\w\s,\-]{2,40})?", re.I)
_RE_TAX_ID     = re.compile(r"(?:RUC|CUIT|CNPJ|RFC|NIT|TAX\s*ID)[\s:\-]*([A-Z0-9][A-Z0-9\-\.\/]{8,20})", re.I)
_RE_LINE       = re.compile(
    r"^\s*(?P<sku>[A-Z0-9][A-Z0-9\-\_\.\/]{2,24})\s+"
    r"(?P<desc>.{3,80}?)\s+"
    r"(?P<size>\d{2,3}(?:[\.,]\d)?|XS|S|M|L|XL|XXL)?\s+"
    r"(?P<qty>\d{1,6})\s+"
    r"(?P<price>\d{1,6}[\.,]\d{2})\b",
    re.I | re.M,
)


# Layout "qty-first" (OC Marluvas/Sondel extraídas por pdfminer): el total
# queda PEGADO al part nº → "300 03/19/2026 19,96 5988,0050B22CPAP-40 ... Size 40".
#   qty · req.date · unit_price · total<pegado>part-<talla> · descripción
_RE_LINE_QTYFIRST = re.compile(
    r"^\s*(?P<qty>\d{1,6})\s+"
    r"\d{1,2}/\d{1,2}/\d{2,4}\s+"
    r"(?P<price>\d+[.,]\d{2})\s+"
    r"\d+[.,]\d{2}"
    r"(?P<part>[A-Z0-9][^\s]*?)-(?P<size>\d{2,3})(?=[^\d]|$)"
    r"(?P<desc>.*?)$",
    re.I | re.M,
)

# Layout FRAGMENTADO (Sprint 2026-07-16): línea de ítem partida por salto de
# página + pie (qty / SKU-talla / desc / fecha / precio / total en renglones
# separados). Se valida qty×precio≈total antes de aceptar (ver _parse_text).
_RE_LINE_FRAG = re.compile(
    r"(?P<qty>\d{1,6})\s*\n+\s*"
    r"(?P<part>[A-Z0-9][A-Z0-9\-\_\.\/]*?)-(?P<size>\d{2,3})\s*\n+"
    r"(?P<desc>.*?)\n+\s*"
    r"\d{1,2}/\d{1,2}/\d{2,4}\s*\n+\s*"
    r"(?P<price>\d+[.,]\d{2})\s*\n+\s*"
    r"(?P<total>\d[\d\s.]*[.,]\d{2})",
    re.I | re.S,
)


def _extract_po_number(raw: str) -> Optional[str]:
    """Número de OC robusto. Orden: prefijo explícito que contenga un
    dígito (evita capturar 'Date'/'Supplier') → patrón 'SI<item> <po>'
    de las OC Marluvas → primer número aislado de 6 dígitos."""
    if not raw:
        return None
    m = re.search(
        r"(?:P\.?O\.?|Orden(?:\s+de\s+Compra)?|Purchase\s+Order)[\s#:\-]*"
        r"((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{2,24})",
        raw, re.I,
    )
    if m:
        return m.group(1).strip()
    m = re.search(r"\bSI\d+\s+(\d{5,7})\b", raw, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"(?<![\d/\-])(\d{6})(?![\d/\-])", raw)
    if m:
        return m.group(1).strip()
    return None


def _safe_decimal(x: str | None) -> Optional[Decimal]:
    if not x:
        return None
    try:
        return Decimal(str(x).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


def _parse_text(raw: str) -> dict:
    """Aplica heurísticas regex al texto OCR para extraer cliente,
    marca, OC y líneas. El veredicto final de precio/MOQ lo hace
    `resolve_client_price` con la DB."""
    out = {
        "client": {"name": None, "tax_id": None, "codigo_marluvas": None},
        "brand":  {"name": None, "brand_code": None},
        "po":     {"number": None, "date": None, "currency": "USD",
                   "incoterm": None, "total": None},
        "lines":  [],
        "raw_text_preview": (raw[:800] + "…") if len(raw) > 800 else raw,
    }
    if not raw:
        return out

    # OC number / date / currency / incoterm / tax_id
    out["po"]["number"] = _extract_po_number(raw)
    m = _RE_PO_DATE.search(raw)
    if m: out["po"]["date"] = m.group(1).strip()
    m = _RE_CURRENCY.search(raw)
    if m: out["po"]["currency"] = m.group(1).upper()
    m = _RE_INCOTERM.search(raw)
    if m: out["po"]["incoterm"] = m.group(1).upper()
    m = _RE_TAX_ID.search(raw)
    if m: out["client"]["tax_id"] = m.group(1).strip()

    # Cliente: primera línea no vacía que contenga S.A. / SAC / SRL / LTDA / S.A.S
    for line in raw.splitlines()[:30]:
        ls = line.strip()
        if not ls:
            continue
        if re.search(r"\b(S\.?A\.?(?:C)?|S\.?R\.?L\.?|LTDA|S\.?A\.?S\.?|INC|CORP|CO\.?|LLC)\b", ls, re.I):
            out["client"]["name"] = ls[:128]
            break

    # Marca: primer "Brand|Marca" encontrado
    m = re.search(r"(?:Brand|Marca)[\s:\-]+([A-Z][\w\s\-]{2,32})", raw, re.I)
    if m:
        out["brand"]["name"] = m.group(1).strip()

    # Líneas (tabla de productos). Primero el layout "qty-first" típico de
    # las OC Marluvas/Sondel (pdfminer pega el total al part nº); si no hay
    # match, caemos al regex legacy SKU-first para otros formatos.
    qf = list(_RE_LINE_QTYFIRST.finditer(raw))
    if qf:
        for m in qf:
            qty   = _safe_decimal(m.group("qty"))
            price = _safe_decimal(m.group("price"))
            part  = (m.group("part") or "").strip()
            size  = (m.group("size") or "").strip() or None
            desc  = (m.group("desc") or "").strip()
            if part and qty and price:
                out["lines"].append({
                    "sku":           part,
                    "descripcion":   desc[:120],
                    "size":          size,
                    "qty":           float(qty),
                    "unit_price":    float(price),
                    "ocr_raw_line":  m.group(0).strip(),
                    "confidence":    0.82,
                })
    else:
        for m in _RE_LINE.finditer(raw):
            sku   = m.group("sku").strip()
            desc  = (m.group("desc") or "").strip()
            size  = (m.group("size") or "").strip() or None
            qty   = _safe_decimal(m.group("qty"))
            price = _safe_decimal(m.group("price"))
            if sku and qty and price:
                out["lines"].append({
                    "sku":           sku,
                    "descripcion":   desc,
                    "size":          size,
                    "qty":           float(qty),
                    "unit_price":    float(price),
                    "ocr_raw_line":  m.group(0).strip(),
                    "confidence":    0.78,
                })

    # ── Fallback fragmentado (Sprint 2026-07-16) ──────────────────────
    # En PDFs multi-página, pdfminer a veces PARTE una línea de ítem por el
    # salto de página + pie de página: qty, SKU, descripción, fecha, precio
    # y total quedan en renglones separados. El regex principal (una sola
    # línea) la pierde (ej. PO 505244: 50B22-EV-CPAP-CP-41 · 470 uds cae en
    # la pág. 2). Este pase rescata esos ítems, y SOLO los acepta si
    # qty × precio ≈ total (validación anti-desalineación de montos).
    _seen_ps = {
        (str(l.get("sku") or "").upper(), str(l.get("size") or ""))
        for l in out["lines"]
    }
    for m in _RE_LINE_FRAG.finditer(raw):
        part = (m.group("part") or "").strip()
        size = (m.group("size") or "").strip() or None
        if not part:
            continue
        if (part.upper(), str(size or "")) in _seen_ps:
            continue
        qty   = _safe_decimal(m.group("qty"))
        price = _safe_decimal(m.group("price"))
        total = _safe_decimal((m.group("total") or "").replace(" ", ""))
        if not (qty and price and total) or price <= 0 or total <= 0:
            continue
        expected = qty * price
        # Tolerancia 1%: solo aceptamos si qty×precio cuadra con el total.
        if expected <= 0 or abs(expected - total) / total > Decimal("0.01"):
            continue
        _seen_ps.add((part.upper(), str(size or "")))
        out["lines"].append({
            "sku":          part,
            "descripcion":  (m.group("desc") or "").strip().replace("\n", " ")[:120],
            "size":         size,
            "qty":          float(qty),
            "unit_price":   float(price),
            "ocr_raw_line": m.group(0).strip().replace("\n", " ")[:200],
            "confidence":   0.75,
        })

    # Total = sum(qty * unit_price) si no lo detectamos en texto
    if out["lines"]:
        out["po"]["total"] = round(
            sum(l["qty"] * l["unit_price"] for l in out["lines"]), 2
        )

    return out


def parse_oc_pdf(file_bytes: bytes, filename: str) -> dict:
    """Entrypoint público. Devuelve el payload estructurado listo
    para auto-llenar el Step 1 del wizard."""
    if not file_bytes:
        return {"ok": False, "error": "empty_file", "payload": None}

    ingest = _paperless_then_text(file_bytes, filename)
    payload = _parse_text(ingest["text"] or "")
    payload["paperless_task_id"] = ingest["paperless_task_id"]
    payload["ocr_engine"] = "paperless-ngx+pdfminer"

    # confidence global = media de confidences por línea, con piso
    if payload["lines"]:
        payload["confidence"] = round(
            sum(l["confidence"] for l in payload["lines"]) / len(payload["lines"]), 4
        )
    else:
        payload["confidence"] = 0.35 if payload["raw_text_preview"] else 0.0

    # Resolver identidad (cliente/marca) contra catálogos
    if payload["client"]["name"]:
        payload["client"]["_candidates"] = resolve_entity_identity(
            payload["client"]["name"], entity="cliente"
        )
    if payload["brand"]["name"]:
        payload["brand"]["_candidates"] = resolve_entity_identity(
            payload["brand"]["name"], entity="marca"
        )

    return {"ok": True, "error": None, "payload": payload}


# --------------------------------------------------------------------
# 3. resolve_entity_identity — fuzzy match nombre OCR → catálogo
# --------------------------------------------------------------------
def resolve_entity_identity(ocr_name: str, entity: str = "cliente", top_k: int = 3) -> list:
    """Devuelve top-k candidatos del catálogo que más se parezcan al
    nombre OCR, con ratio difflib ≥ 0.55.

    Para el caller `entity='cliente'`, cada candidato trae además
    `credit_days` y `credit_limit_usd` — el Wizard los muestra como chips
    en el Paso 1 ("cliente detectado con límite de $X"). Si la columna
    no existe en el schema (setup antiguo), la query hace fallback a lo
    mínimo y esos campos viajan como None.
    """
    if not ocr_name:
        return []

    if entity == "cliente":
        # Intentamos traer credit_days + credit_limit_usd. Si la columna
        # no existe (DB antigua), hacemos fallback a la query mínima.
        sql_full = """
            SELECT id::text,
                   razon_social,
                   COALESCE(credit_days, 0)       AS credit_days,
                   COALESCE(credit_limit_usd, 0)  AS credit_limit_usd
              FROM clientes.cliente
             WHERE is_active = TRUE
        """
        sql_min = "SELECT id::text, razon_social, NULL, NULL FROM clientes.cliente WHERE is_active = TRUE"
        namecol = "razon_social"
    elif entity == "marca":
        sql_full = "SELECT id::text, nombre, NULL, NULL FROM brands.marca WHERE is_active = TRUE"
        sql_min  = sql_full
        namecol  = "nombre"
    else:
        return []

    rows = []
    try:
        with connection.cursor() as c:
            try:
                c.execute(sql_full)
            except Exception:
                # Fallback si la columna credit_* no existe
                c.execute(sql_min)
            rows = c.fetchall()
    except Exception as e:
        log.warning("resolve_entity_identity (%s) falló: %s", entity, e)
        return []

    needle = ocr_name.lower().strip()
    scored = []
    for row in rows:
        rid, rname = row[0], row[1]
        if not rname:
            continue
        ratio = difflib.SequenceMatcher(None, needle, rname.lower()).ratio()
        if ratio < 0.55:
            continue
        item = {"id": rid, namecol: rname, "score": round(ratio, 4)}
        # Clientes: agregamos credit_days + credit_limit_usd si la fila
        # trae esas columnas.
        if entity == "cliente" and len(row) >= 4:
            try:
                item["credit_days"]      = int(row[2]) if row[2] is not None else None
            except (TypeError, ValueError):
                item["credit_days"] = None
            try:
                item["credit_limit_usd"] = float(row[3]) if row[3] is not None else None
            except (TypeError, ValueError):
                item["credit_limit_usd"] = None
        scored.append(item)
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


# --------------------------------------------------------------------
# 4. resolve_client_price — validación precio + MOQ por línea
# --------------------------------------------------------------------
def resolve_client_price(client_id: Optional[str], sku: Optional[str],
                         qty: float, unit_price: float) -> dict:
    """Compara el precio OCR contra el precio canónico MWT para
    (cliente, sku) y valida MOQ. Si no encontramos precio cliente,
    usamos productos.producto.precio_distribuidor como fallback.

    Veredictos:
      OK                 · delta en |±2%|
      WARN_BELOW_SYSTEM  · cliente puso precio MÁS BAJO (riesgo margen)
      WARN_ABOVE_SYSTEM  · cliente puso precio MÁS ALTO (cobrar extra ok)
      WARN_MOQ           · cantidad bajo MOQ del cliente
      ERROR              · falta catálogo o producto no existe
    """
    out = {
        "system_unit_price": None,
        "price_delta_pct":   None,
        "price_verdict":     "ERROR",
        "moq_client":        None,
        "moq_violated":      False,
        "notes":             None,
    }
    if not sku or unit_price is None:
        out["notes"] = "missing_sku_or_price"
        return out

    system_price = None
    moq = None
    producto_id = None

    try:
        with connection.cursor() as c:
            # A. Precio canónico: productos.pricing_cliente si existe (schema v4+)
            if client_id:
                try:
                    c.execute("""
                        SELECT pc.unit_price, pc.moq, p.id::text
                          FROM productos.pricing_cliente pc
                          JOIN productos.producto p ON p.sku = pc.sku OR p.id = pc.producto_id
                         WHERE pc.client_id = %s::uuid
                           AND pc.sku = %s
                           AND pc.is_active = TRUE
                         LIMIT 1
                    """, [client_id, sku])
                    row = c.fetchone()
                    if row:
                        system_price = float(row[0]) if row[0] is not None else None
                        moq          = float(row[1]) if row[1] is not None else None
                        producto_id  = row[2]
                except Exception:
                    pass  # tabla puede no existir en todos los entornos

            # B. Fallback: productos.producto.precio_distribuidor
            if system_price is None:
                c.execute("""
                    SELECT precio_distribuidor, precio_mwt, id::text
                      FROM productos.producto
                     WHERE sku = %s AND is_active = TRUE
                     LIMIT 1
                """, [sku])
                row = c.fetchone()
                if row:
                    system_price = float(row[0] or row[1] or 0) or None
                    producto_id  = row[2]
    except Exception as e:
        out["notes"] = f"db_error: {e}"
        return out

    if system_price is None:
        out["notes"] = "sku_not_found"
        return out

    # Delta en %
    delta = (float(unit_price) - system_price) / system_price if system_price else 0.0
    out["system_unit_price"] = round(system_price, 4)
    out["price_delta_pct"]   = round(delta, 4)
    out["moq_client"]        = moq

    # MOQ
    if moq and qty < moq:
        out["moq_violated"] = True
        out["price_verdict"] = "WARN_MOQ"
        out["notes"] = f"qty={qty} < moq_cliente={moq}"
        return out

    # Verdict por delta
    if abs(delta) <= 0.02:
        out["price_verdict"] = "OK"
    elif delta < 0:
        out["price_verdict"] = "WARN_BELOW_SYSTEM"
        out["notes"] = f"cliente_pagó_{abs(delta)*100:.2f}%_menos"
    else:
        out["price_verdict"] = "WARN_ABOVE_SYSTEM"
        out["notes"] = f"cliente_pagó_{delta*100:.2f}%_más"

    if producto_id:
        out["producto_id"] = producto_id
    return out


# --------------------------------------------------------------------
# 4. parse_oc_xlsx  — procesamiento nativo de OC en Excel
# --------------------------------------------------------------------
#
# Cuando el cliente sube un .xlsx (caso típico B2B: clientes que ya
# tienen su plantilla de compra en Excel), no tiene sentido pasar por
# Paperless-ngx / OCR — leemos las celdas directamente con pandas.
#
# Heurística de mapeo de columnas:
#   · Busca columnas case-insensitive que machéen alguno de estos alias:
#       sku            → sku, código, codigo, ref, item, part_number
#       descripcion    → descripción, descripcion, producto, name
#       size           → talla, size, nro
#       qty            → qty, cant, cantidad, quantity, units
#       unit_price     → precio, precio_unit, unit_price, price, pu
#   · El PO Number se busca en las primeras 10 filas (celda contiene
#     'OC', 'PO', 'ORDEN', 'ORDER').
#   · La moneda se detecta por símbolo en las celdas de precio ($ = USD).
#
# El payload devuelto tiene EXACTAMENTE el mismo shape que parse_oc_pdf:
#   {ok, error, payload: {client, brand, po, lines, confidence, …}}
# de modo que el orchestrator no necesita saber el origen.
# --------------------------------------------------------------------
_XLSX_COLUMN_ALIASES = {
    "sku":         ["sku", "código", "codigo", "ref", "item", "part_number",
                    "cod", "cód", "articulo", "artículo", "id_producto"],
    "descripcion": ["descripción", "descripcion", "desc", "producto",
                    "product", "name", "nombre", "detalle"],
    "size":        ["talla", "size", "nro", "num", "número", "numero"],
    "qty":         ["qty", "cant", "cantidad", "quantity", "units",
                    "unidades", "pares"],
    "unit_price":  ["precio", "precio_unit", "unit_price", "price",
                    "pu", "precio_unitario", "costo", "cost"],
}

_XLSX_PO_KEYWORDS = ("OC", "PO", "ORDEN", "ORDER", "PEDIDO",
                     "PURCHASE", "NRO. OC", "N° OC")


def _normalize_col(col: str) -> str:
    """lowercase + strip + saca acentos burdos para matching de columnas."""
    if col is None:
        return ""
    s = str(col).strip().lower()
    s = (s.replace("á", "a").replace("é", "e").replace("í", "i")
           .replace("ó", "o").replace("ú", "u").replace("ñ", "n"))
    return s


def _match_column(df_cols, aliases: list[str]) -> Optional[str]:
    """Devuelve el nombre original de la primera columna del DataFrame
    que matchee algún alias (comparación normalizada)."""
    norm_targets = {_normalize_col(a): a for a in aliases}
    for c in df_cols:
        nc = _normalize_col(c)
        for key in norm_targets:
            if key == nc or (len(key) >= 3 and key in nc):
                return c
    return None


def _detect_po_number(df) -> Optional[str]:
    """Busca el número de OC escaneando las primeras ~10 filas y celdas
    que contengan keywords PO/ORDEN/OC. Captura el token alfanumérico
    adyacente (o en la misma celda) con regex."""
    po_re = re.compile(
        r"(?:" + "|".join(_XLSX_PO_KEYWORDS) + r")"
        r"[\s:#·\-]*([A-Z0-9][A-Z0-9\-_/]{2,})",
        re.IGNORECASE,
    )
    try:
        head = df.head(10).astype(str)
        for _, row in head.iterrows():
            joined = " | ".join(row.tolist())
            m = po_re.search(joined)
            if m:
                return m.group(1).strip()
    except Exception as e:
        log.debug("_detect_po_number falló: %s", e)
    return None


def parse_oc_xlsx(file_bytes: bytes, filename: str) -> dict:
    """Entrypoint público paralelo a parse_oc_pdf. Lee un .xlsx con
    `pandas` y devuelve el mismo payload estructurado que el PDF.

    No persiste nada — sólo devuelve datos para que el front los muestre.
    """
    if not file_bytes:
        return {"ok": False, "error": "empty_file", "payload": None}

    try:
        import pandas as pd  # noqa: PLC0415
    except ImportError:
        return {
            "ok": False,
            "error": "pandas_missing",
            "payload": None,
            "hint": "pip install pandas openpyxl — requerido para procesar .xlsx",
        }

    # 1) Leer todas las hojas y elegir la que tenga más celdas con números
    try:
        sheets = pd.read_excel(io.BytesIO(file_bytes), sheet_name=None, header=None)
    except Exception as e:
        log.exception("pandas.read_excel falló: %s", e)
        return {"ok": False, "error": f"xlsx_read_failed: {e}", "payload": None}

    if not sheets:
        return {"ok": False, "error": "xlsx_empty", "payload": None}

    # Elegimos la hoja más "densa" (más celdas numéricas no vacías)
    best_name, best_df = None, None
    best_score = -1
    for name, df in sheets.items():
        numeric_cells = df.applymap(lambda v: isinstance(v, (int, float))).sum().sum()
        if numeric_cells > best_score:
            best_score = numeric_cells
            best_name, best_df = name, df

    df = best_df

    # 2) Detectar fila de headers: la primera fila que tenga >= 3 strings
    #    no vacías consecutivas (heurística barata pero efectiva para
    #    plantillas del cliente).
    header_row_idx = None
    for i in range(min(10, len(df))):
        row = df.iloc[i]
        non_null = sum(1 for v in row if isinstance(v, str) and v.strip())
        if non_null >= 3:
            header_row_idx = i
            break

    po_number = _detect_po_number(df)

    if header_row_idx is None:
        return {
            "ok": False,
            "error": "xlsx_no_header_detected",
            "payload": {
                "confidence": 0.0,
                "po": {"number": po_number, "date": None,
                       "currency": "USD", "total": None},
                "client": {"name": None, "tax_id": None},
                "brand":  {"name": None, "brand_code": None},
                "lines":  [],
                "raw_text_preview": None,
                "sheet_name": best_name,
            },
        }

    # 3) Re-parsear el DataFrame promoviendo esa fila a header
    try:
        df2 = df.iloc[header_row_idx + 1:].copy()
        df2.columns = [str(c) for c in df.iloc[header_row_idx].tolist()]
        df2 = df2.dropna(how="all")
    except Exception as e:
        log.exception("xlsx re-header falló: %s", e)
        return {"ok": False, "error": "xlsx_reheader_failed", "payload": None}

    cols = df2.columns.tolist()
    mapped = {
        "sku":         _match_column(cols, _XLSX_COLUMN_ALIASES["sku"]),
        "descripcion": _match_column(cols, _XLSX_COLUMN_ALIASES["descripcion"]),
        "size":        _match_column(cols, _XLSX_COLUMN_ALIASES["size"]),
        "qty":         _match_column(cols, _XLSX_COLUMN_ALIASES["qty"]),
        "unit_price":  _match_column(cols, _XLSX_COLUMN_ALIASES["unit_price"]),
    }

    # Si faltan las dos columnas críticas (sku + qty), damos por inválido
    if not mapped["sku"] or not mapped["qty"]:
        return {
            "ok": False,
            "error": "xlsx_missing_critical_columns",
            "payload": {
                "po":         {"number": po_number, "date": None,
                               "currency": "USD", "total": None},
                "client":     {"name": None, "tax_id": None},
                "brand":      {"name": None, "brand_code": None},
                "lines":      [],
                "confidence": 0.1,
                "mapped_columns": mapped,
                "sheet_name": best_name,
            },
            "hint": "No se encontraron columnas SKU y/o cantidad. Encabezados detectados: "
                    + ", ".join(str(c) for c in cols),
        }

    # 4) Extraer líneas
    lines = []
    total = Decimal("0")
    currency = "USD"

    for _, row in df2.iterrows():
        sku_val = row.get(mapped["sku"])
        qty_val = row.get(mapped["qty"])
        if sku_val is None or str(sku_val).strip() == "" or str(sku_val).lower() == "nan":
            continue

        qty_dec = _safe_decimal(str(qty_val)) or Decimal("0")
        if qty_dec <= 0:
            continue

        unit_price_dec = Decimal("0")
        if mapped["unit_price"] is not None:
            raw_price = row.get(mapped["unit_price"])
            if raw_price is not None:
                # Detectar símbolo de moneda en la misma celda
                raw_s = str(raw_price)
                if "$" in raw_s:
                    currency = "USD"
                elif "€" in raw_s:
                    currency = "EUR"
                elif "R$" in raw_s.upper():
                    currency = "BRL"
                unit_price_dec = _safe_decimal(raw_s) or Decimal("0")

        size_val = None
        if mapped["size"] is not None:
            raw_size = row.get(mapped["size"])
            if raw_size is not None and str(raw_size).strip() != "":
                size_val = str(raw_size).strip()

        desc_val = None
        if mapped["descripcion"] is not None:
            raw_desc = row.get(mapped["descripcion"])
            if raw_desc is not None and str(raw_desc).strip() != "":
                desc_val = str(raw_desc).strip()

        line_total = qty_dec * unit_price_dec
        total += line_total

        lines.append({
            "sku":           str(sku_val).strip(),
            "descripcion":   desc_val,
            "size":          size_val,
            "qty":           float(qty_dec),
            "unit_price":    float(unit_price_dec),
            "ocr_raw_line":  None,   # no aplica en xlsx
            "confidence":    0.98,    # datos estructurados → alta confianza
        })

    payload = {
        "client":     {"name": None, "tax_id": None, "_candidates": []},
        "brand":      {"name": None, "brand_code": None, "_candidates": []},
        "po": {
            "number":   po_number,
            "date":     None,
            "currency": currency,
            "incoterm": None,
            "total":    float(total) if total > 0 else None,
        },
        "lines":            lines,
        "confidence":       0.98 if lines else 0.2,
        "ocr_engine":       "pandas-xlsx",
        "paperless_task_id": None,
        "raw_text_preview": None,
        "sheet_name":       best_name,
        "mapped_columns":   mapped,
    }

    return {"ok": True, "error": None, "payload": payload}


# --------------------------------------------------------------------
# 5. parse_oc_auto — router por extensión (pdf / xlsx)
# --------------------------------------------------------------------
def parse_oc_auto(file_bytes: bytes, filename: str) -> dict:
    """Entrypoint unificado. Rutea a parse_oc_pdf o parse_oc_xlsx según
    la extensión del archivo (o su magic bytes en su defecto)."""
    fn = (filename or "").lower()

    if fn.endswith(".pdf") or file_bytes[:4] == b"%PDF":
        return parse_oc_pdf(file_bytes, filename)

    if fn.endswith(".xlsx") or fn.endswith(".xlsm") or file_bytes[:2] == b"PK":
        return parse_oc_xlsx(file_bytes, filename)

    return {
        "ok":    False,
        "error": "unsupported_format",
        "hint":  "Solo .pdf y .xlsx son soportados por el wizard.",
        "payload": None,
    }
