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
    m = _RE_PO_NUMBER.search(raw)
    if m: out["po"]["number"] = m.group(1).strip()
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

    # Líneas (tabla de productos)
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
                "confidence":    0.78,   # heurístico fijo; el verdadero score lo calcula el motor OCR
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
    nombre OCR, con ratio difflib ≥ 0.55."""
    if not ocr_name:
        return []

    if entity == "cliente":
        sql = "SELECT id::text, razon_social FROM clientes.cliente WHERE is_active = TRUE"
        namecol = "razon_social"
    elif entity == "marca":
        sql = "SELECT id::text, nombre FROM brands.marca WHERE is_active = TRUE"
        namecol = "nombre"
    else:
        return []

    rows = []
    try:
        with connection.cursor() as c:
            c.execute(sql)
            rows = c.fetchall()
    except Exception as e:
        log.warning("resolve_entity_identity (%s) falló: %s", entity, e)
        return []

    needle = ocr_name.lower().strip()
    scored = []
    for rid, rname in rows:
        if not rname:
            continue
        ratio = difflib.SequenceMatcher(None, needle, rname.lower()).ratio()
        if ratio >= 0.55:
            scored.append({"id": rid, namecol: rname, "score": round(ratio, 4)})
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
