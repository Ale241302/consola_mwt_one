"""
=====================================================================
MWT.ONE · apps.expedientes.proforma_extractor
Agente responsable: [AG-BACKEND]

Sprint 2026-05-02 (AG-03): extractor DEDICADO Y AISLADO para
Proformas MWT (document_type=ART-02_PROFORMA). Completamente separado
del extractor general (`document_matchmaker.extract_document`) para
que cualquier cambio aquí NO PUEDA afectar el path de OC del cliente.

Por qué un módulo aparte:
  · La proforma tiene matriz horizontal de 15 columnas BR/EU/US/Qty
    con qty solo en celdas no-cero. La extracción de texto pierde la
    posición espacial → el AI no puede alinear qty con tallas.
  · Los demás documentos (OC, Factura, Otros) tienen tablas verticales
    simples y andan perfecto con extracción de texto vía pypdf.
  · Mezclarlos en un solo path causaba que un fix de proforma tuviera
    efectos colaterales en la OC. Aislamiento físico = no más sustos.

Estrategia técnica:
  · Renderizar el PDF a PNG con PyMuPDF (`fitz`) — pure Python, sin
    dependencias del sistema.
  · Mandar las imágenes a `gpt-4o-mini` con `chat.completions` y
    `detail='high'`. El modelo VE la cuadrícula visualmente y alinea
    qty con las tallas correctas por proximidad espacial.

Output shape: idéntico al que devolvía `extract_document` para
PROFORMA antes (groups[].lines[]) → consumido por `cross_match`
sin cambios.
=====================================================================
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

# Modelo dedicado para proforma. Default gpt-4o-mini (más barato), pero
# podés override a gpt-4o (más caro pero MUCHO mejor leyendo tablas
# visuales como la matriz horizontal de tallas) seteando en el .env:
#   OPENAI_PROFORMA_MODEL=gpt-4o
# La OC sigue usando OPENAI_OCR_MODEL (no se ve afectada).
OCR_MODEL = (
    os.environ.get("OPENAI_PROFORMA_MODEL")
    or os.environ.get("OPENAI_OCR_MODEL")
    or "gpt-4o-mini"
)


# ─────────────────────────────────────────────────────────────────────
# Prompt dedicado para vision API
# ─────────────────────────────────────────────────────────────────────
PROFORMA_VISION_PROMPT = """Eres un extractor de Proformas comerciales MWT.
Recibes la(s) IMAGEN(es) de las páginas de una proforma. Devuelves
un JSON ESTRICTO con la lista de productos y la distribución por talla.

═══════════════════════════════════════════════════════════════════════
                          REGLA #1 — LA MÁS IMPORTANTE
═══════════════════════════════════════════════════════════════════════

LA TALLA QUE DEVOLVÉS DEBE SER EL VALOR DE LA FILA "Referencia BRA".

NO USAR la fila "Referencia EU".
NO USAR la fila "Referencia USA".
NO USAR la fila "Referencia USA Women".
SOLAMENTE LA FILA "Referencia BRA".

Los valores válidos de talla son: 33, 34, 35, 36, 37, 38, 39, 40, 41,
42, 43, 44, 45, 46, 47.

NUNCA devuelvas talla = 49 ni 48 ni 4.5 ni 5.5 — esos son de las
filas EU/USA y están PROHIBIDOS.

═══════════════════════════════════════════════════════════════════════

CÓMO LEER LA MATRIZ — PASO A PASO:

  La matriz tiene 4 filas verticalmente alineadas en 15 columnas:

    Fila 1 — "Referencia BRA":  33  34  35  36  37  38  39  40  41  42  43  44  45  46  47
    Fila 2 — "Referencia EU":   35  36  37  38  39  40  41  42  43  44  45  46  47  48  49
    Fila 3 — "Referencia USA":          4.5 5.5 6.5  7   8   8.5 9.5 10  11  12  13  14  15
    Fila 4 — qty:                              10  10  10  10  30  30  10

  PROCEDIMIENTO:
  1. Identificá la columna donde la Fila 4 (qty) tiene un número > 0.
  2. Mirá VERTICALMENTE arriba en esa columna hasta la Fila 1 (BRA).
  3. Esa es la talla.

  EJEMPLO con la matriz de arriba:
    · Columna 5 → Qty=10. BRA[5]=37. → emitir {talla:"37", qty:10}
    · Columna 6 → Qty=10. BRA[6]=38. → emitir {talla:"38", qty:10}
    · Columna 7 → Qty=10. BRA[7]=39. → emitir {talla:"39", qty:10}
    · Columna 8 → Qty=10. BRA[8]=40. → emitir {talla:"40", qty:10}
    · Columna 9 → Qty=30. BRA[9]=41. → emitir {talla:"41", qty:30}
    · Columna 10 → Qty=30. BRA[10]=42. → emitir {talla:"42", qty:30}
    · Columna 11 → Qty=10. BRA[11]=43. → emitir {talla:"43", qty:10}

  RESULTADO ESPERADO: 7 líneas con tallas 37, 38, 39, 40, 41, 42, 43.
  Suma de qty = 10+10+10+10+30+30+10 = 110.

  ❌ ERROR COMÚN A EVITAR: NO devolver tallas 39, 40, 41, 42, 43, 44, 45.
     Esos son los valores EU. La talla SIEMPRE viene de la fila BRA.

═══════════════════════════════════════════════════════════════════════

OTROS CAMPOS DEL SLOT:
  · sku           = valor del campo "Código" (ej. "701935")
  · supplier_ref  = valor de "Referencia" SIN sufijo de talla (ej. "60B19M-CPAP-MIN-CP")
  · product_label = "Descripción"
  · unit_price    = "Precio $" (USD, decimal)

VALIDACIÓN DE SUMA:
  Suma todas las qty del slot. Debe coincidir con el campo "Cantidad
  total" o "Total de Pares" del slot. Si no coincide, releé.

SLOTS VACÍOS:
  La proforma tiene 11 slots, la mayoría vacíos (sin Código). IGNORÁ
  los slots sin Código — no los devuelvas.

═══════════════════════════════════════════════════════════════════════

ESQUEMA OBLIGATORIO DEL JSON:
{
  "document_kind":     "PROFORMA",
  "proforma_number":   "<código MWT, ej. 2414-2026>",
  "client_po_number":  "<si aparece, ej. 110022220>",
  "client_name":       "<si aparece>",
  "issued_date":       "YYYY-MM-DD",
  "currency":          "USD",
  "groups": [
    {
      "sap_number":  null,
      "lines": [
        {
          "sku":           "<código MWT canónico, ej. 701935>",
          "supplier_ref":  "<REF proveedor sin sufijo de talla, ej. 60B19M-CPAP-MIN-CP>",
          "product_label": "<descripción>",
          "talla":         "<valor BRA: 33-47 ÚNICAMENTE>",
          "qty":           <entero>,
          "unit_price":    <decimal o null>,
          "confidence":    0..100
        }, ...
      ]
    }
  ],
  "raw_text": "<resumen literal del slot, max 1500 chars>"
}

REGLAS DURAS:
  1. talla SIEMPRE viene de la fila "Referencia BRA". JAMÁS de EU o USA.
  2. CERO INVENTOS. Si un campo no aparece en la imagen, omitirlo.
  3. UNA línea por columna con qty>0.
  4. Suma de qtys del slot = "Cantidad total" del slot.
  5. SKU / supplier_ref / talla en MAYÚSCULAS sin espacios.
  6. Slots vacíos (sin Código) → ignorar.
  7. Devolver SOLO el JSON, sin markdown, sin texto extra.
"""


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _empty_result(error=None):
    return {
        "document_kind": "PROFORMA",
        "lines":         [],
        "groups":        [],
        "raw_text":      "",
        "error":         error,
        "model":         OCR_MODEL,
    }


def _pdf_to_png_data_urls(file_bytes: bytes, max_pages: int = 2,
                           dpi_scale: float = 3.0) -> list[str]:
    """Renderiza páginas del PDF a PNG (base64 data URLs) usando PyMuPDF.

    Sprint 2026-05-02 (AG-03): DPI 3.0 (antes 2.0) para que el texto
    fino de la matriz horizontal de tallas sea legible. max_pages=2
    porque típicamente la página 1 tiene la matriz y la página 3 el
    summary — la página 2 son solo slots vacíos que confunden al modelo.

    Retorna [] si pymupdf no está disponible o el render falla — en
    ese caso el caller devuelve error y el matchmaker reporta la falla
    sin afectar otros tipos de documento.
    """
    try:
        import fitz  # pymupdf
        urls: list[str] = []
        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            n_pages = min(len(doc), max_pages)
            for i in range(n_pages):
                page = doc.load_page(i)
                pix = page.get_pixmap(matrix=fitz.Matrix(dpi_scale, dpi_scale))
                png_bytes = pix.tobytes("png")
                b64 = base64.b64encode(png_bytes).decode("ascii")
                urls.append(f"data:image/png;base64,{b64}")
        log.info("[proforma_extractor] renderizadas %d páginas a %.1fx DPI",
                 len(urls), dpi_scale)
        return urls
    except ImportError:
        log.warning("[proforma_extractor] pymupdf no instalado")
        return []
    except Exception as e:
        log.warning("[proforma_extractor] PDF→PNG render falló: %s", e)
        return []


def _safe_float(v) -> Optional[float]:
    try: return float(v) if v not in (None, "") else None
    except (TypeError, ValueError): return None


def _parse_proforma_deterministic(file_bytes: bytes) -> Optional[dict]:
    """Sprint 2026-05-02 (AG-03): parser DETERMINÍSTICO de proforma MWT
    usando coordenadas reales (X, Y) de PyMuPDF.

    El AI (gpt-4o-mini, gpt-4o) alucina las cantidades de la matriz
    horizontal. Este parser NO usa AI — extrae la matriz leyendo las
    posiciones espaciales del PDF directamente:

      1. Lee las palabras con sus bounding boxes (x0,y0,x1,y1)
      2. Encuentra cada slot poblado (campo "Código" con número)
      3. Para cada slot, identifica las filas BRA / EU / USA / Cantidad
         por el Y-coordinate de sus labels
      4. Toma cada qty del slot por su X-coordinate
      5. Encuentra el BRA value en el mismo X (columna alineada)
      6. Emite (sku, talla=BRA, qty)

    Returns: dict con shape igual a extract_proforma() o None si el
    parsing falla (en ese caso el caller cae al path de AI).
    """
    try:
        import fitz
        import re as _re
    except ImportError:
        return None

    try:
        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            if not len(doc):
                return None
            page = doc.load_page(0)
            words = page.get_text("words")  # [(x0, y0, x1, y1, word, b_no, l_no, w_no), ...]
    except Exception as e:
        log.warning("[proforma_det] fitz error: %s", e)
        return None

    if not words:
        return None

    # Agrupar palabras por Y-coordinate (tolerancia 3pt para misma línea)
    rows: list[list] = []
    y_tolerance = 3.0
    for w in sorted(words, key=lambda x: (x[1], x[0])):
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4]
        placed = False
        for row in rows:
            if abs(row[0]["y_center"] - (y0 + y1) / 2) < y_tolerance:
                row.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1,
                            "x_center": (x0 + x1) / 2,
                            "y_center": (y0 + y1) / 2,
                            "text": text})
                placed = True
                break
        if not placed:
            rows.append([{"x0": x0, "y0": y0, "x1": x1, "y1": y1,
                          "x_center": (x0 + x1) / 2,
                          "y_center": (y0 + y1) / 2,
                          "text": text}])

    # Re-ordenar palabras dentro de cada row por X
    for row in rows:
        row.sort(key=lambda r: r["x0"])

    # Buscar header del documento: proforma_number, total
    proforma_number = None
    total_pares = None
    sku_global = None
    supplier_ref_global = None
    re_proforma_num = _re.compile(r"^\d{3,5}-20\d{2}$")
    re_int = _re.compile(r"^\d{1,4}$")

    flat_text = " ".join(w[4] for w in words)
    m = _re.search(r"Proforma:\s*(\S+)", flat_text)
    if m:
        proforma_number = m.group(1)
    m = _re.search(r"Total de Pares:\s*(\d+)", flat_text)
    if m:
        total_pares = int(m.group(1))

    # Buscar slots poblados — un slot está poblado cuando hay un valor
    # numérico (5-7 dígitos) cerca de un label "Código:".
    re_sku = _re.compile(r"^\d{5,7}$")
    slots = []
    for r_idx, row in enumerate(rows):
        # Buscar texto "Código" en la fila
        for w in row:
            if w["text"].strip().lower().startswith("código") or w["text"].strip().lower().startswith("codigo"):
                # El SKU está en la misma fila o adyacente, a la derecha del label
                sku = None
                # Buscar primer número 5-7 dígitos a la derecha
                for w2 in row:
                    if w2["x0"] > w["x1"] and re_sku.match(w2["text"]):
                        sku = w2["text"]
                        break
                if not sku:
                    # Probar fila siguiente
                    if r_idx + 1 < len(rows):
                        for w2 in rows[r_idx + 1]:
                            if re_sku.match(w2["text"]):
                                sku = w2["text"]
                                break
                if sku:
                    slots.append({"sku": sku, "row_idx": r_idx, "y_label": w["y_center"]})
                break

    if not slots:
        log.warning("[proforma_det] no encontré slots con Código populado")
        return None

    # Para cada slot poblado, encontrar las filas BRA/EU/USA/Cantidad
    # debajo del label "Código" hasta el siguiente slot
    slot_lines: list[dict] = []
    for s_idx, slot in enumerate(slots):
        next_y = slots[s_idx + 1]["y_label"] if s_idx + 1 < len(slots) else 9e9
        # Filas dentro del slot: y > slot.y_label y y < next_y
        slot_rows = [r for r in rows if slot["y_label"] < r[0]["y_center"] < next_y]

        # Identificar fila BRA por su label
        bra_row = None
        eu_row = None
        cant_row = None
        for row in slot_rows:
            row_text = " ".join(w["text"] for w in row).lower()
            if "referencia bra" in row_text or "ref bra" in row_text:
                # Los valores numéricos están en esta fila después del label
                bra_row = row
            elif "referencia eu" in row_text or "ref eu" in row_text:
                eu_row = row

        if not bra_row:
            log.warning("[proforma_det] slot SKU=%s sin fila BRA", slot["sku"])
            continue

        # Extraer los valores numéricos de la fila BRA (filtrar el label)
        bra_values = [
            w for w in bra_row
            if re_int.match(w["text"]) and 30 <= int(w["text"]) <= 50
        ]
        if not bra_values:
            log.warning("[proforma_det] BRA values vacíos para SKU=%s", slot["sku"])
            continue

        # La fila Cantidad: debe estar DEBAJO de USA, sin label de texto.
        # CRÍTICO: filtrar para que NO confunda con BRA/EU/USA (que también
        # son filas numéricas). Las filas de talla tienen valores en el
        # rango 30-50 (BR 33-47, EU 35-49). La fila qty tiene valores
        # arbitrarios (10, 30, 50, 100...) — saltamos cualquier fila
        # donde la mayoría de valores caen en el rango de talla.
        bra_y = bra_row[0]["y_center"]
        candidate_qty_rows = [
            r for r in slot_rows
            if r[0]["y_center"] > bra_y + 5  # debajo de BRA
        ]
        # Set de valores que parecen tallas (para filtrar)
        TALLA_RANGE = set(range(30, 51))
        qty_row = None
        for row in candidate_qty_rows:
            tokens = [w for w in row if re_int.match(w["text"])]
            if not tokens:
                continue
            int_vals = [int(t["text"]) for t in tokens]
            # Si la mayoría de valores están en el rango de talla,
            # esta es probablemente la fila EU/BRA/USA, NO la fila qty.
            in_talla_range = sum(1 for v in int_vals if v in TALLA_RANGE)
            if in_talla_range / len(int_vals) > 0.6:
                continue  # skip — es talla, no qty
            # Esta debe ser la fila qty real
            qty_row = tokens
            break

        if not qty_row:
            log.warning("[proforma_det] qty row vacía para SKU=%s", slot["sku"])
            continue

        # Mapear cada qty al BRA value más cercano por X
        for q in qty_row:
            qx = q["x_center"]
            qty_int = int(q["text"])
            if qty_int <= 0:
                continue
            # Encontrar BRA value con X-center más cercano
            closest = min(bra_values, key=lambda b: abs(b["x_center"] - qx))
            x_dist = abs(closest["x_center"] - qx)
            if x_dist > 25:  # demasiado lejos, descartar
                continue
            slot_lines.append({
                "sku":           slot["sku"],
                "supplier_ref":  None,
                "talla":         closest["text"],
                "qty":           qty_int,
                "product_label": "",
                "unit_price":    None,
                "confidence":    99.0,
                "match_strategy": "DETERMINISTIC",
                "match_score":    99,
                "matched_producto_id": None,
                "client_part_number": None,
                "base_code":     None,
                "qty_confirmed": None,
                "qty_open":      None,
            })

    if not slot_lines:
        log.warning("[proforma_det] no extraje líneas — fallback a AI")
        return None

    # Validar suma vs total declarado — si no matchea, abortar y caer al AI.
    # (mejor extracción incierta que extracción confiadamente errónea)
    total_extraido = sum(l["qty"] for l in slot_lines)
    if total_pares and total_extraido != total_pares:
        log.warning(
            "[proforma_det] suma extraída=%d != total declarado=%d → fallback a AI",
            total_extraido, total_pares,
        )
        return None  # fallback al AI — mejor que dar datos malos

    log.info("[proforma_det] extraje %d líneas, suma=%d (declarado=%s) ✓",
             len(slot_lines), total_extraido, total_pares)

    # Buscar supplier_ref y descripción para enriquecer
    re_supref = _re.compile(r"^\d{2,3}[A-Z]\d{2,3}[A-Z]?-[A-Z]{2,5}-[A-Z]{2,5}-?[A-Z]*$")
    for w in words:
        if re_supref.match(w[4]):
            supplier_ref_global = w[4]
            break
    if supplier_ref_global:
        for ln in slot_lines:
            ln["supplier_ref"] = supplier_ref_global

    return {
        "document_kind":   "PROFORMA",
        "proforma_number": proforma_number,
        "raw_text":        flat_text[:2000],
        "model":           "deterministic-pymupdf",
        "error":           None,
        "groups": [{
            "sap_number":    None,
            "po_reference":  None,
            "delivery_date": None,
            "lines":         slot_lines,
        }],
        "lines": [],
    }


def _convert_talla_to_br(talla: str) -> str:
    """Sprint 2026-05-02 (AG-03): conversión determinística talla → BR.

    El AI insiste en extraer las tallas en EU canónica aunque el prompt
    pida BR. En lugar de pelear con el modelo, post-procesamos: tomamos
    la talla que el AI devolvió y la convertimos a BR usando ops.tallas.

    Estrategia (silenciosa, no requiere equivalencia en cross_match):
      1. Si `talla` aparece en la columna `eu` de ops.tallas → devolver
         el `br` correspondiente. El AI extrajo en EU, lo convertimos.
      2. Si `talla` NO aparece como EU → devolver tal cual (ya está en
         BR, o es alfa tipo "M"/"L"/"UNICA", o no está en el catálogo).

    Esto permite que cross_match haga match LITERAL contra BD que está
    en convención BR (típico para expedientes de Sonepar OC porque el
    código MARLUVAS-37/-38/-43 usa BR).
    """
    if not talla:
        return talla
    s = str(talla).upper().strip()
    try:
        from django.db import connection
        with connection.cursor() as c:
            c.execute("""
                SELECT br
                  FROM ops.tallas
                 WHERE UPPER(eu) = %s
                   AND tipo_producto = 'calzado'
                   AND COALESCE(is_active, TRUE) = TRUE
                 LIMIT 1
            """, [s])
            row = c.fetchone()
            if row and row[0]:
                br_val = str(row[0]).upper().strip()
                if br_val and br_val != s:
                    log.info("[proforma_extractor] talla EU %s → BR %s", s, br_val)
                return br_val
    except Exception as e:
        log.warning("[proforma_extractor] convert talla a BR falló: %s", e)
    return s


def _normalize_groups(raw_groups) -> list[dict]:
    """Aplica defensa contra shapes raros que pueda devolver el AI."""
    groups: list[dict] = []
    for g in (raw_groups or []):
        if not isinstance(g, dict):
            continue
        lines: list[dict] = []
        for ln in (g.get("lines") or []):
            if not isinstance(ln, dict):
                continue
            sku          = str(ln.get("sku") or "").strip().upper()[:64]
            supplier_ref = str(ln.get("supplier_ref") or "").strip().upper()[:64]
            talla_raw    = str(ln.get("talla") or "").strip().upper()[:16]
            # Sprint 2026-05-02 (AG-03): convertir EU→BR si aplica.
            # El AI suele extraer en EU canónica pero la BD está en BR.
            # Este post-process le da al cross_match una talla que matchea
            # LITERAL contra la BD, sin equivalencias mágicas.
            talla = _convert_talla_to_br(talla_raw)
            try:
                qty = int(ln.get("qty") or 0)
            except (TypeError, ValueError):
                qty = 0
            # Aceptamos la línea si tiene CUALQUIER identificador
            if not (sku or supplier_ref):
                continue
            lines.append({
                "sku":                sku,
                "supplier_ref":       supplier_ref or None,
                "client_part_number": None,  # no aplica para proforma
                "base_code":          None,
                "talla":              talla,
                "qty":                qty,
                "qty_confirmed":      None,
                "qty_open":           None,
                "product_label":      str(ln.get("product_label") or "")[:255],
                "unit_price":         _safe_float(ln.get("unit_price")),
                "confidence":         round(max(0.0, min(100.0,
                                          float(ln.get("confidence") or 85))), 2),
                # Trazabilidad (la pobla el resolver del matchmaker)
                "match_strategy":     None,
                "match_score":        0,
                "matched_producto_id": None,
            })
        groups.append({
            "sap_number":    g.get("sap_number") or None,
            "po_reference":  g.get("po_reference") or None,
            "delivery_date": g.get("delivery_date") or None,
            "lines":         lines,
        })
    return groups


# ─────────────────────────────────────────────────────────────────────
# Punto de entrada
# ─────────────────────────────────────────────────────────────────────
def extract_proforma(file_bytes: bytes, filename: str, content_type: str) -> dict:
    """Extrae datos de una Proforma MWT vía vision API.

    Devuelve el mismo shape que el path PROFORMA original
    (groups[].lines[]) → consumido por cross_match sin cambios.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return _empty_result("OPENAI_API_KEY no configurada en el servidor.")

    is_pdf = (
        content_type == "application/pdf"
        or (filename or "").lower().endswith(".pdf")
    )
    if not is_pdf:
        return _empty_result(
            f"Proforma sólo soporta PDF (recibí: {content_type}). "
            "Si tu proforma es imagen o Excel, usá 'Otro documento'."
        )

    # ── PATH PRIMARIO: parser DETERMINÍSTICO (PyMuPDF + coordenadas) ──
    # Sprint 2026-05-02 (AG-03): el AI alucina qtys de la matriz horizontal.
    # Probamos primero un parser determinístico que lee posiciones (X,Y)
    # reales del PDF — sin AI, sin alucinación. Si funciona (devuelve
    # líneas), saltamos toda la llamada a OpenAI.
    det_result = _parse_proforma_deterministic(file_bytes)
    if det_result and det_result.get("groups") and any(
        g.get("lines") for g in det_result["groups"]
    ):
        log.info("[proforma_extractor] parser determinístico OK — saltando AI")
        # Aplicar conversión EU→BR como red de seguridad (debería ser no-op
        # porque el parser ya extrae de la fila BRA del PDF)
        for g in det_result["groups"]:
            for ln in g["lines"]:
                if ln.get("talla"):
                    ln["talla"] = _convert_talla_to_br(ln["talla"])
        return det_result

    log.info("[proforma_extractor] parser det. no encontró líneas, fallback a vision AI")

    # 1) Renderizar PDF a imágenes
    # max_pages=2: la página 1 trae header + slots 1-4 (con la matriz),
    # la página 2 son slots 5-11 (típicamente vacíos pero por si hay
    # más productos), la página 3 es summary final que confunde al
    # modelo (otra tabla con qty pero sin matriz). Quitamos pág 3.
    image_urls = _pdf_to_png_data_urls(file_bytes, max_pages=2)
    if not image_urls:
        return _empty_result(
            "No pude renderizar el PDF. Verificá que pymupdf esté instalado "
            "(pip install pymupdf) o el PDF no esté corrupto."
        )

    # 2) Llamar a vision API
    try:
        from openai import OpenAI
    except ImportError:
        return _empty_result("Paquete `openai` no instalado en el backend.")

    client = OpenAI(api_key=api_key, timeout=90.0, max_retries=1)
    user_content = [
        {"type": "text",
         "text": "Analizá la(s) imagen(es) de esta proforma y devolvé "
                 "el JSON estricto con todos los productos y su distribución "
                 "por talla. Atención a la matriz horizontal — alineá las "
                 "cantidades con las tallas EU correctas."},
    ]
    for url in image_urls:
        user_content.append({
            "type": "image_url",
            "image_url": {"url": url, "detail": "high"},
        })

    raw_text = None
    try:
        chat = client.chat.completions.create(
            model           = OCR_MODEL,
            messages        = [
                {"role": "system", "content": PROFORMA_VISION_PROMPT},
                {"role": "user",   "content": user_content},
            ],
            response_format = {"type": "json_object"},
        )
        raw_text = chat.choices[0].message.content
    except Exception as e:
        log.exception("[proforma_extractor] OpenAI vision call failed")
        return _empty_result(f"OpenAI API error: {type(e).__name__}: {e}")

    # 3) Parsear el JSON
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        out = _empty_result(f"JSON inválido del modelo: {e}")
        out["raw_text"] = (raw_text or "")[:2000]
        return out

    # 4) Normalizar y devolver
    out: dict = {
        "document_kind": "PROFORMA",
        "raw_text": (data.get("raw_text") or "")[:2000]
                     if isinstance(data.get("raw_text"), str) else "",
        "model": OCR_MODEL,
        "error": None,
    }
    for k in ("proforma_number", "client_po_number", "client_name",
              "issued_date", "currency"):
        if data.get(k) is not None:
            out[k] = data.get(k)

    out["groups"] = _normalize_groups(data.get("groups"))
    out["lines"]  = []  # PROFORMA usa groups, no lines top-level

    log.info(
        "[proforma_extractor] OK — model=%s pages=%d groups=%d total_lines=%d",
        OCR_MODEL, len(image_urls), len(out["groups"]),
        sum(len(g.get("lines") or []) for g in out["groups"]),
    )
    return out
