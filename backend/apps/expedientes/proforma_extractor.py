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

Estrategia técnica (cascada de 2 niveles):

  1) PARSER DETERMINÍSTICO (PyMuPDF + coordenadas X,Y reales)
     · Lee la matriz por posiciones espaciales — sin AI, sin alucinación.
     · Si la suma de qty extraída == "Total de Pares" declarado → OK.
     · Si no matchea → fallback al nivel 2.

  2) AI CON PDF NATIVO + CONTEXTO DEL EXPEDIENTE (gpt-4o)
     · Sprint 2026-05-02 (AG-03): mandamos el PDF TAL CUAL al modelo
       (content type "file", base64) — NO renderizamos a PNG porque
       eso degrada la calidad de la matriz horizontal de tallas.
       gpt-4o soporta PDF nativo desde el SDK 1.54+.
     · Si recibimos `expediente_id`, también le pasamos la lista de
       productos del expediente (sku, talla, qty) como anclaje
       semántico — el modelo lee el PDF en alta fidelidad pero sabe
       qué tallas/qtys debería ver, lo que reduce drásticamente la
       alucinación de columnas/qtys.
     · El AI debe devolver la distribución TAL CUAL aparece en el
       PDF (no la del expediente) — la BD es solo anclaje.

Output shape: idéntico al original (groups[].lines[]) → consumido por
`cross_match` sin cambios. cross_match hace el diff final
(MISSING_IN_EXPEDIENTE, QTY_DIFF, etc.).
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


def _pdf_to_data_url(file_bytes: bytes) -> str:
    """Sprint 2026-05-02 (AG-03): prepara el PDF como data URL base64
    para mandarlo TAL CUAL a OpenAI (content type "file"). NO renderiza
    a PNG — gpt-4o soporta PDF nativo desde el SDK 1.54+ y preserva la
    calidad/organización de la matriz de tallas que el render PNG perdía.
    """
    b64 = base64.b64encode(file_bytes).decode("ascii")
    return f"data:application/pdf;base64,{b64}"


def _extract_pdf_text(file_bytes: bytes, max_chars: int = 20000) -> str:
    """Sprint 2026-05-02 (AG-03): extrae el texto del PDF con pypdf como
    PAYLOAD ADICIONAL para el modelo. No reemplaza el PDF nativo — lo
    complementa: el PDF preserva la posición espacial, el texto extraído
    le da al modelo una segunda fuente para verificar SKU/REF/cantidades.
    """
    try:
        from pypdf import PdfReader
        import io as _io
        reader = PdfReader(_io.BytesIO(file_bytes))
        pages = []
        for page in reader.pages:
            t = (page.extract_text() or "").strip()
            if t:
                pages.append(t)
        return "\n\n--- PAGE BREAK ---\n\n".join(pages)[:max_chars]
    except Exception as e:
        log.warning("[proforma_extractor] pypdf falló: %s", e)
        return ""


def _safe_float(v) -> Optional[float]:
    try: return float(v) if v not in (None, "") else None
    except (TypeError, ValueError): return None


def _load_expediente_context(expediente_id) -> list[dict]:
    """Sprint 2026-05-02 (AG-03): carga las líneas del expediente para
    pasárselas al AI como contexto de anclaje semántico.

    Devuelve una lista de dicts con sku, talla, qty, nombre del producto.
    Si la query falla devuelve [] (silenciosamente — el caller cae al
    path de AI sin contexto, no rompemos por esto).
    """
    if not expediente_id:
        return []
    try:
        from django.db import connection
        with connection.cursor() as c:
            c.execute("""
                SELECT
                    COALESCE(l.sku, '')               AS sku,
                    COALESCE(l.size, '')              AS talla,
                    COALESCE(l.qty, 0)::int           AS qty,
                    COALESCE(p.nombre, l.sku, '')     AS nombre
                  FROM expedientes.linea l
                  LEFT JOIN productos.producto p ON p.id = l.producto_id
                 WHERE l.expediente_id = %s::uuid
                   AND COALESCE(l.is_active, TRUE) = TRUE
                 ORDER BY l.sku, l.size
            """, [str(expediente_id)])
            cols = [d[0] for d in c.description]
            rows = [dict(zip(cols, r)) for r in c.fetchall()]
            log.info("[proforma_extractor] contexto BD: %d líneas del expediente",
                     len(rows))
            return rows
    except Exception as e:
        log.warning("[proforma_extractor] no pude cargar contexto BD: %s", e)
        return []


def _format_bd_context_for_prompt(bd_lines: list[dict]) -> str:
    """Formatea las líneas del expediente como bloque de texto para el
    prompt del AI. Agrupa por SKU para que sea legible.
    """
    if not bd_lines:
        return ""
    # Agrupar por SKU
    by_sku: dict[str, dict] = {}
    for ln in bd_lines:
        sku = (ln.get("sku") or "").upper().strip()
        if not sku:
            continue
        if sku not in by_sku:
            by_sku[sku] = {"nombre": ln.get("nombre") or sku, "tallas": []}
        by_sku[sku]["tallas"].append({
            "talla": (ln.get("talla") or "").upper().strip(),
            "qty":   int(ln.get("qty") or 0),
        })
    # Formatear como texto
    blocks = []
    for sku, info in by_sku.items():
        tallas_str = ", ".join(
            f"talla {t['talla']}={t['qty']}" for t in info["tallas"]
        )
        total = sum(t["qty"] for t in info["tallas"])
        blocks.append(
            f"  · SKU {sku} ({info['nombre']}): {tallas_str}  [Total BD: {total}]"
        )
    return "\n".join(blocks)


def _parse_proforma_deterministic(file_bytes: bytes) -> Optional[dict]:
    """Sprint 2026-05-02 (AG-03): parser DETERMINÍSTICO de proforma MWT
    usando coordenadas reales (X, Y) de PyMuPDF.

    Sprint 2026-05-02 (AG-03) v2: la matriz de tallas de la proforma es
    VERTICAL, no horizontal. Cada fila tiene 4 columnas alineadas por X:

         BRA    EU    USA   QTY
        ─────  ─────  ─────  ─────
         43     45    11     10
         42     44    10     30
         41     43    9.5    30
         40     42    8.5    10
         39     41    8      10
         38     40    7      10
         37     39    6.5    10

    Algoritmo:
      1. Para cada SKU del documento (números de 5-7 dígitos):
         · La columna BRA del slot está en X ≈ SKU.X (offset ~2pt).
         · La columna QTY del slot está en X ≈ SKU.X + 48.
      2. Para cada SKU, junta los valores BRA (numéricos 30-50 en su
         X-bucket) y los valores QTY (numéricos > 0 en su X-bucket,
         dentro del rango Y de los BRA).
      3. Por cada QTY, encuentra el BRA en el mismo Y (tolerancia 3pt).
      4. Emite (sku, talla=BRA, qty). Valida suma vs Total de Pares.

    Returns: dict con shape igual a extract_proforma() o None si el
    parsing falla (en ese caso el caller cae al path de AI).
    """
    try:
        import fitz
        import re as _re
    except ImportError:
        return None

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        log.warning("[proforma_det] fitz open error: %s", e)
        return None

    re_sku    = _re.compile(r"^\d{5,7}$")
    re_int    = _re.compile(r"^\d{1,4}$")
    re_supref = _re.compile(r"^\d{2,3}[A-Z]\d{2,3}[A-Z]?-[A-Z]{2,5}-[A-Z]{2,5}-?[A-Z]*$")

    proforma_number = None
    total_pares     = None
    supplier_ref    = None
    flat_text_all   = ""
    slot_lines: list[dict] = []
    seen_sku_x: set[tuple[int, int]] = set()  # (page_idx, round(sku_x, 0))

    try:
        for page_idx, page in enumerate(doc):
            words = page.get_text("words")
            if not words:
                continue

            page_text = " ".join(w[4] for w in words)
            flat_text_all += page_text + "\n"

            # Extraer header solo de la primera página
            if page_idx == 0:
                m = _re.search(r"Proforma:\s*(\S+)", page_text)
                if m: proforma_number = m.group(1)
                m = _re.search(r"Total de Pares:\s*(\d+)", page_text)
                if m: total_pares = int(m.group(1))
                # supplier_ref puede estar en cualquier lugar de p.1
                for w in words:
                    if re_supref.match(w[4]):
                        supplier_ref = w[4]
                        break

            # ── Detectar slots poblados (SKUs en columnas de tallas) ──
            for sku_w in words:
                sku = sku_w[4]
                if not re_sku.match(sku):
                    continue
                sku_x = sku_w[0]
                sku_y = sku_w[1]

                # Dedup: si ya procesamos un slot con el mismo (página, X)
                # lo saltamos. Esto evita procesar el SKU del summary final
                # como si fuera un slot.
                key = (page_idx, round(sku_x, 0))
                if key in seen_sku_x:
                    continue

                # Los SKUs de slots están ARRIBA del centro de la página
                # (la matriz vertical va de Y≈40 a Y≈275 y el SKU label
                # del slot está a Y≈445 ó cerca del cuadrante). Excluimos
                # SKUs muy abajo (summary final tipo Y>600).
                # Pero el SKU del slot 1 de la página 1 está en Y≈649
                # también (es el ÚNICO SKU = 701935). Así que NO podemos
                # filtrar por Y. Usamos otra señal: que existan suficientes
                # BRA values en su X-bucket.

                # BRA values en el bucket X del SKU (±8pt)
                bra_words = [
                    w for w in words
                    if abs(w[0] - sku_x) < 8.0
                    and re_int.match(w[4])
                    and 30 <= int(w[4]) <= 50
                ]
                if len(bra_words) < 5:
                    # No es un slot de matriz: el summary tiene 1-3
                    # números en su X, no la columna completa BRA 33-47.
                    continue

                bra_y_min = min(w[1] for w in bra_words)
                bra_y_max = max(w[1] for w in bra_words)

                # QTY values: bucket X+48 (±6pt), Y dentro del rango BRA
                qty_x_target = sku_x + 48.0
                qty_words = [
                    w for w in words
                    if abs(w[0] - qty_x_target) < 6.0
                    and re_int.match(w[4])
                    and int(w[4]) > 0
                    and int(w[4]) < 1000  # excluir totales gigantes
                    and (bra_y_min - 3) <= w[1] <= (bra_y_max + 3)
                ]
                if not qty_words:
                    # Slot vacío (sin distribución de qty) — no emitir nada
                    seen_sku_x.add(key)
                    continue

                # Por cada QTY, encontrar BRA al mismo Y (tolerancia 3pt)
                emitted = 0
                for q in qty_words:
                    qty_int = int(q[4])
                    closest_bra = min(bra_words, key=lambda b: abs(b[1] - q[1]))
                    y_dist = abs(closest_bra[1] - q[1])
                    if y_dist >= 3.0:
                        continue
                    slot_lines.append({
                        "sku":            sku,
                        "supplier_ref":   None,  # se llena después
                        "talla":          closest_bra[4],
                        "qty":            qty_int,
                        "product_label":  "",
                        "unit_price":     None,
                        "confidence":     99.0,
                        "match_strategy": "DETERMINISTIC",
                        "match_score":    99,
                        "matched_producto_id": None,
                        "client_part_number":  None,
                        "base_code":      None,
                        "qty_confirmed":  None,
                        "qty_open":       None,
                    })
                    emitted += 1
                if emitted:
                    seen_sku_x.add(key)
    finally:
        doc.close()

    if not slot_lines:
        log.warning("[proforma_det] no extraje líneas — fallback a AI")
        return None

    # Enriquecer supplier_ref si lo encontramos
    if supplier_ref:
        for ln in slot_lines:
            ln["supplier_ref"] = supplier_ref

    # Validar suma vs total declarado — si no matchea, abortar y caer al AI
    total_extraido = sum(l["qty"] for l in slot_lines)
    if total_pares and total_extraido != total_pares:
        log.warning(
            "[proforma_det] suma extraída=%d != total declarado=%d → fallback a AI",
            total_extraido, total_pares,
        )
        return None

    log.info(
        "[proforma_det] extraje %d líneas (vertical-matrix), suma=%d (declarado=%s) ✓",
        len(slot_lines), total_extraido, total_pares,
    )

    return {
        "document_kind":   "PROFORMA",
        "proforma_number": proforma_number,
        "raw_text":        flat_text_all[:2000],
        "model":           "deterministic-pymupdf-v2",
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
    """Sprint 2026-05-03 · conversión segura talla → BR.

    PROBLEMA arreglado en este sprint:
      La versión anterior (Sprint 2026-05-02) buscaba por `eu = <input>`
      sin verificar primero si el input ya era un BR válido. Para tallas
      donde el VALOR coincide en ambas convenciones pero refiere a
      tallas distintas (ej. BR 37 ≠ EU 37: BR 37 = EU 39, EU 37 = BR 35),
      la función "convertía" un BR ya correcto a un BR equivocado:
        BR "37" (input)
          → busca eu='37' → encuentra fila (br=35, eu=37, …)
          → devuelve "35"  ❌ rompe el match contra la BD.

      El parser determinístico de proforma extrae directamente de la
      fila "Referencia BRA" del PDF, por lo que el input siempre es
      BR válido y NO debe convertirse.

    NUEVA estrategia:
      1. Si el input matchea la columna `br` de ops.tallas → ya es BR
         válido, devolver tal cual.
      2. Si NO matchea como BR pero SÍ como EU → convertir a BR (caso
         del AI vision que ocasionalmente devuelve EU).
      3. Caso ambigüo (no matchea en ninguna): devolver tal cual (alfa,
         o no está en el catálogo).
    """
    if not talla:
        return talla
    s = str(talla).upper().strip()
    try:
        from django.db import connection
        with connection.cursor() as c:
            # 1. ¿Ya es un BR válido? Devolver tal cual.
            c.execute("""
                SELECT 1
                  FROM ops.tallas
                 WHERE UPPER(br) = %s
                   AND tipo_producto = 'calzado'
                   AND COALESCE(is_active, TRUE) = TRUE
                 LIMIT 1
            """, [s])
            if c.fetchone():
                return s
            # 2. No es BR; si es EU válido, convertimos a BR.
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


def _parse_proforma_horizontal(file_bytes: bytes) -> Optional[dict]:
    """Sprint 2026-05-03 · Parser DETERMINÍSTICO para proformas con
    matriz HORIZONTAL (formato Marluvas exportado desde Excel).

    Layout esperado (orientación HORIZONTAL):

        Referencia BRA  | 33 | 34 | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 |
        Referencia EU   | 35 | 36 | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 |
        Referencia USA  |    |    | 4.5| 5.5| 6.5| 7  | 8  | 8.5| 9.5| 10 | 11 | 12 | 13 | 14 | 15 |
        Qty             |    |    |    |    | 10 | 10 | 10 | 10 | 30 | 30 | 10 |    |    |    |    |

    Algoritmo:
      1. Localizar la cadena "Referencia BRA" en el documento (page words).
      2. Recolectar TODOS los enteros 30..50 que aparezcan en la MISMA
         fila Y (±2pt) y a la DERECHA del label → fila BRA del slot.
      3. Encontrar el slot del SKU asociado: el SKU 5-7 dígitos cuya
         coordenada Y está cerca (≤ ~25pt arriba) de la fila BRA y X
         a su izquierda (es la celda "Código:" del slot).
      4. La fila QTY está 2-3 líneas debajo de la BRA en el mismo
         rango horizontal: enteros >0 cuya Y - bra_y ∈ (5, 50).
      5. Para cada qty, asociarlo con la columna BRA cuyo X esté más
         cerca (tolerancia ~6pt).
      6. Validar suma vs "Total de Pares" del header.

    Returns: dict con shape de extract_proforma() o None si falla.
    """
    try:
        import fitz
        import re as _re
    except ImportError:
        return None

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        log.warning("[proforma_horiz] fitz open error: %s", e)
        return None

    re_sku       = _re.compile(r"^\d{5,7}$")
    re_int_small = _re.compile(r"^\d{1,3}$")
    re_supref    = _re.compile(r"^\d{2,3}[A-Z]\d{2,3}[A-Z]?-[A-Z]{2,5}-[A-Z]{2,5}-?[A-Z]*$")

    proforma_number = None
    total_pares     = None
    supplier_ref    = None
    flat_text_all   = ""
    slot_lines: list[dict] = []
    seen_slot: set[tuple[int, int]] = set()

    try:
        for page_idx, page in enumerate(doc):
            words = page.get_text("words")  # list of (x0,y0,x1,y1,text,blk,line,word)
            if not words:
                continue

            page_text = " ".join(w[4] for w in words)
            flat_text_all += page_text + "\n"

            if page_idx == 0:
                m = _re.search(r"Proforma:\s*(\S+)", page_text)
                if m: proforma_number = m.group(1)
                m = _re.search(r"Total de Pares:\s*(\d+)", page_text)
                if m: total_pares = int(m.group(1))
                for w in words:
                    if re_supref.match(w[4]):
                        supplier_ref = w[4]
                        break

            # ── Buscar todas las apariciones del label "BRA" o "Referencia BRA"
            # En PDFs exportados desde Excel cada palabra es un word separado:
            # "Referencia" y "BRA" salen como 2 tokens; nos basta con localizar
            # los "BRA" alineados en filas separadas (uno por slot poblado).
            bra_labels = [w for w in words if w[4].upper() == "BRA"]
            for bra_w in bra_labels:
                bra_y = (bra_w[1] + bra_w[3]) / 2.0  # centro vertical
                bra_x_end = bra_w[2]                  # fin del label

                # Numeros 30..50 en misma fila Y (±2.5pt) a la derecha del label.
                row_bra = []
                for w in words:
                    txt = w[4]
                    if not re_int_small.match(txt):
                        continue
                    if not (30 <= int(txt) <= 50):
                        continue
                    wy = (w[1] + w[3]) / 2.0
                    if abs(wy - bra_y) > 2.5:
                        continue
                    if w[0] < bra_x_end:
                        continue
                    row_bra.append(w)
                if len(row_bra) < 5:
                    continue  # no es una fila BRA real (ej. label suelto)
                row_bra.sort(key=lambda w: w[0])

                # SKU del slot: 5-7 dígitos arriba a la izquierda del label BRA.
                # Tomamos el más cercano por distancia euclídea con preferencia
                # arriba (Y menor) y a la izquierda.
                slot_sku = None
                slot_sku_w = None
                best_d = 1e9
                for sku_w in words:
                    if not re_sku.match(sku_w[4]):
                        continue
                    sx = sku_w[0]
                    sy = (sku_w[1] + sku_w[3]) / 2.0
                    # Debe estar arriba o a la izquierda en el mismo cuadrante
                    if sy > bra_y + 4 or sx > bra_x_end + 60:
                        continue
                    dy = bra_y - sy
                    if dy < 0 or dy > 80:
                        continue
                    dx = abs(sx - bra_w[0])
                    d = dy * 1.0 + dx * 0.4
                    if d < best_d:
                        best_d = d
                        slot_sku   = sku_w[4]
                        slot_sku_w = sku_w
                if not slot_sku:
                    continue

                slot_key = (page_idx, round((slot_sku_w[1] + slot_sku_w[3]) / 2.0))
                if slot_key in seen_slot:
                    continue

                # Fila QTY: enteros >0 cuya Y − bra_y ∈ (5, 50) y X dentro del
                # rango de la fila BRA.
                row_x_min = row_bra[0][0] - 4
                row_x_max = row_bra[-1][2] + 4
                qty_words = []
                for w in words:
                    txt = w[4]
                    if not re_int_small.match(txt):
                        continue
                    qv = int(txt)
                    if qv <= 0 or qv >= 1000:
                        continue
                    wy = (w[1] + w[3]) / 2.0
                    dy = wy - bra_y
                    if dy < 5 or dy > 50:
                        continue
                    if w[0] < row_x_min or w[2] > row_x_max:
                        continue
                    # Excluir la fila EU (35..49) y USA (4.5..15) que están
                    # entre BRA y QTY: filtramos por "qty_y" más abajo.
                    qty_words.append(w)
                if not qty_words:
                    continue

                # Si hay múltiples filas con candidatos (EU, USA, QTY), elegimos
                # la fila más profunda (Y mayor) como QTY — filtramos las otras.
                if qty_words:
                    qty_y_max = max((w[1] + w[3]) / 2.0 for w in qty_words)
                    qty_words = [
                        w for w in qty_words
                        if abs(((w[1] + w[3]) / 2.0) - qty_y_max) < 3.0
                    ]

                emitted = 0
                for q in qty_words:
                    qty_int = int(q[4])
                    qx = (q[0] + q[2]) / 2.0
                    closest_bra = min(
                        row_bra,
                        key=lambda b: abs(((b[0] + b[2]) / 2.0) - qx),
                    )
                    cx = (closest_bra[0] + closest_bra[2]) / 2.0
                    if abs(cx - qx) > 8.0:
                        continue
                    slot_lines.append({
                        "sku":            slot_sku,
                        "supplier_ref":   None,
                        "talla":          closest_bra[4],
                        "qty":            qty_int,
                        "product_label":  "",
                        "unit_price":     None,
                        "confidence":     99.0,
                        "match_strategy": "DETERMINISTIC_HORIZONTAL",
                        "match_score":    99,
                        "matched_producto_id": None,
                        "client_part_number":  None,
                        "base_code":      None,
                        "qty_confirmed":  None,
                        "qty_open":       None,
                    })
                    emitted += 1
                if emitted:
                    seen_slot.add(slot_key)
    finally:
        doc.close()

    if not slot_lines:
        log.info("[proforma_horiz] no extraje líneas (layout no es horizontal)")
        return None

    # Enriquecer supplier_ref si lo encontramos
    if supplier_ref:
        for ln in slot_lines:
            ln["supplier_ref"] = supplier_ref

    total_extraido = sum(l["qty"] for l in slot_lines)
    if total_pares and total_extraido != total_pares:
        log.warning(
            "[proforma_horiz] suma extraída=%d != total declarado=%d → fallback",
            total_extraido, total_pares,
        )
        return None

    log.info(
        "[proforma_horiz] extraje %d líneas (horizontal-matrix), suma=%d (declarado=%s) ✓",
        len(slot_lines), total_extraido, total_pares,
    )

    return {
        "document_kind":   "PROFORMA",
        "proforma_number": proforma_number,
        "raw_text":        flat_text_all[:2000],
        "model":           "deterministic-pymupdf-horizontal-v1",
        "error":           None,
        "groups": [{
            "sap_number":    None,
            "po_reference":  None,
            "delivery_date": None,
            "lines":         slot_lines,
        }],
        "lines": [],
    }


# ─────────────────────────────────────────────────────────────────────
# Sprint 2026-05-10 · Detector de formato + parser Tipo B (MWT)
#
# Existen dos layouts radicalmente distintos de proforma en el flujo MWT:
#
#   · Tipo A "MARLUVAS" — proforma del proveedor Marluvas a Muito Work,
#     formato matriz horizontal (Referencia BRA / EU / USA + columnas
#     33-47 + fila qty). Los parsers `_parse_proforma_horizontal` y
#     `_parse_proforma_deterministic` lo cubren.
#
#   · Tipo B "MWT" — proforma generada por la consola MWT (template
#     consola.mwt.one) que MWT emite a sus clientes. NO tiene matriz
#     horizontal — usa una tabla compacta + bloque "DESGLOSE POR TALLA"
#     con chips visuales (talla arriba / qty abajo) por SKU. Los
#     parsers Tipo A devuelven None en este formato porque buscan
#     "Referencia BRA" que no existe.
#
# Estrategia: detectar formato por texto plano, rutear al parser
# correcto. Si Tipo B falla, NO caemos a Tipo A (devolverían None igual)
# — vamos directo a AI fallback.
# ─────────────────────────────────────────────────────────────────────

def _detect_proforma_format(file_bytes: bytes) -> str:
    """Devuelve 'MARLUVAS' (Tipo A), 'MWT' (Tipo B) o 'UNKNOWN'.

    Señales:
      · Tipo A → presencia de "Referencia BRA" o "Referencia EU"
        (etiquetas de la matriz horizontal de Marluvas).
      · Tipo B → presencia de "DESGLOSE POR TALLA", header
        "PF NNNN-YYYY" o "MUITO WORK ·" (template de la consola).
    """
    try:
        import fitz
        import re as _re
    except ImportError:
        return "UNKNOWN"
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        log.warning("[proforma_detect] fitz open error: %s", e)
        return "UNKNOWN"

    text = ""
    try:
        for page in doc:
            text += page.get_text("text") + "\n"
    finally:
        doc.close()

    # Tipo A primero: si el documento es claramente Marluvas no nos
    # confundimos aunque incluya el código "PF" en algún lado.
    if "Referencia BRA" in text or "Referencia EU" in text:
        return "MARLUVAS"

    # Tipo B
    if (
        "DESGLOSE POR TALLA" in text
        or _re.search(r"\bPF\s*\d{4}\s*-\s*\d{4}\b", text)
        or "MUITO WORK ·" in text
        or "MUITO WORK ·" in text  # middle dot literal
    ):
        return "MWT"

    return "UNKNOWN"


def _parse_proforma_mwt_format(file_bytes: bytes) -> Optional[dict]:
    """Parser DETERMINÍSTICO para proformas formato consola MWT (Tipo B).

    Layout esperado (ver PF 2453-2026 PO 504983 Sondel.pdf como ejemplo):

        MUITO WORK · PF 2453-2026
        Cliente: <RAZON_SOCIAL>
        Total pares: <N>

        LÍNEAS DE PRODUCTO — MARCA <BRAND>
        # CÓDIGO DESCRIPCIÓN COLOR CANTIDAD PRECIO USD TOTAL USD
        1 701809 50B22-V-E-CPAP-CP / Bota... Negro 280 $18.23 $5,104.40
        ...

        DESGLOSE POR TALLA
        701809 · 50B22-V-E-CPAP-CP · 280 PARES
        ┌──┐ ┌──┐ ┌──┐ ┌──┐
        │37│ │38│ │39│ │40│
        │40│ │50│ │80│ │110│
        └──┘ └──┘ └──┘ └──┘
        ...

    Algoritmo:
      1. Extraer texto plano para detectar header (PF nº, total pares,
         precios unitarios por SKU desde la tabla LÍNEAS DE PRODUCTO).
      2. Por página, localizar "DESGLOSE POR TALLA" → procesar todo lo
         que sigue como bloques de SKU.
      3. Cada bloque de SKU: header "<sku> · <ref> · <qty> PARES"
         seguido de chips visuales con talla arriba (Y bajo, fila 1)
         y qty abajo (Y mayor, fila 2). Agrupar por Y-bucket, parear
         talla-qty por proximidad X.
      4. Validar: suma de qty del bloque == qty declarado del header.
      5. Validar global: suma total == "Total pares" del documento.

    Returns: dict con shape igual a `extract_proforma()` o None si
    el parsing falla / formato no es Tipo B (caller cae a AI).
    """
    try:
        import fitz
        import re as _re
        from collections import defaultdict
    except ImportError:
        return None

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        log.warning("[proforma_mwt] fitz open error: %s", e)
        return None

    re_sku       = _re.compile(r"^\d{5,7}$")
    re_supref    = _re.compile(r"^[A-Z0-9][A-Z0-9\-]+$")
    re_int_small = _re.compile(r"^\d{1,4}$")

    # ── Texto plano para header + tabla de precios ─────────────────
    flat_text_all = ""
    try:
        for page in doc:
            flat_text_all += page.get_text("text") + "\n"
    except Exception as e:
        log.warning("[proforma_mwt] get_text error: %s", e)
        doc.close()
        return None

    if "DESGLOSE POR TALLA" not in flat_text_all:
        # No es Tipo B — caller decidirá qué hacer.
        doc.close()
        return None

    # Header: "PF NNNN-YYYY" — el código de proforma
    proforma_number = None
    m_pf = _re.search(r"PF\s*(\d{4}\s*-\s*\d{4})", flat_text_all)
    if m_pf:
        proforma_number = m_pf.group(1).replace(" ", "")

    # Total pares declarado
    total_pares = None
    m_tp = _re.search(r"Total\s*pares\s*[:\s]\s*(\d{1,5})", flat_text_all, _re.IGNORECASE)
    if m_tp:
        try:
            total_pares = int(m_tp.group(1))
        except ValueError:
            total_pares = None

    # Precio unitario por SKU desde la tabla de líneas. Layout en texto
    # plano: cada celda llega como token separado. Tomamos el primer
    # número con dos decimales que aparece después del SKU y antes del
    # siguiente SKU — ese es el precio unitario USD.
    sku_unit_price = {}
    tokens = flat_text_all.split()
    for idx, tok in enumerate(tokens):
        if not re_sku.match(tok):
            continue
        # Buscar precio dentro de los próximos ~20 tokens, hasta el
        # próximo SKU o el inicio de DESGLOSE.
        for j in range(idx + 1, min(idx + 25, len(tokens))):
            tt = tokens[j]
            if tt.upper().startswith("DESGLOSE"):
                break
            if re_sku.match(tt) and tt != tok:
                break
            m_price = _re.match(r"^\$?([\d,]+\.\d{2})$", tt)
            if m_price:
                try:
                    val = float(m_price.group(1).replace(",", ""))
                except ValueError:
                    continue
                # plausible unit price (no es total de línea)
                if 0.01 < val < 5000.0 and tok not in sku_unit_price:
                    sku_unit_price[tok] = val
                    break

    # ── Procesar DESGLOSE POR TALLA por página con coordenadas ─────
    slot_lines = []

    try:
        for page_idx, page in enumerate(doc):
            words = page.get_text("words")
            if not words:
                continue

            # Localizar la palabra "DESGLOSE" para acotar la sección
            desglose_y = None
            for w in words:
                if w[4].upper() == "DESGLOSE":
                    desglose_y = w[1]
                    break
            if desglose_y is None:
                continue

            section_words = [w for w in words if w[1] >= desglose_y]

            # ── Identificar bloques de SKU dentro de la sección ────
            # Header de bloque: <sku> · <ref> · <qty> PARES (4 tokens
            # útiles, separados por · que también vienen como tokens).
            sku_blocks = []
            si = 0
            while si < len(section_words):
                w = section_words[si]
                if not re_sku.match(w[4]):
                    si += 1
                    continue
                # Recolectar los próximos 4 tokens útiles (skip ·)
                useful = []
                jj = si
                while jj < len(section_words) and len(useful) < 4:
                    tt = section_words[jj][4]
                    if tt in ("·", "•", "-", "–", "—"):
                        jj += 1
                        continue
                    useful.append((jj, tt, section_words[jj]))
                    jj += 1
                if (len(useful) >= 4
                        and re_supref.match(useful[1][1])
                        and re_int_small.match(useful[2][1])
                        and useful[3][1].upper() == "PARES"):
                    try:
                        total_qty_block = int(useful[2][1])
                    except ValueError:
                        si += 1
                        continue
                    sku_blocks.append({
                        "sku":          useful[0][1],
                        "supplier_ref": useful[1][1],
                        "total_qty":    total_qty_block,
                        "header_y_top": w[1],
                        "header_y_bot": w[3],
                        "after_idx":    useful[3][0] + 1,
                    })
                    si = useful[3][0] + 1
                else:
                    si += 1

            # ── Parsear chips de cada bloque ───────────────────────
            for bi, block in enumerate(sku_blocks):
                next_y = (
                    sku_blocks[bi + 1]["header_y_top"] - 4
                    if bi + 1 < len(sku_blocks)
                    else 99999
                )
                # Palabras numéricas dentro del rango Y del bloque
                chip_words = [
                    w for w in section_words
                    if w[1] > block["header_y_bot"] + 0.5
                    and w[3] < next_y
                    and re_int_small.match(w[4])
                ]
                if not chip_words:
                    continue

                # Agrupar por filas (buckets de 5pt). Tolerante a
                # micro-desalineamientos del PDF generado por la consola.
                buckets = defaultdict(list)
                for w in chip_words:
                    cy = round((w[1] + w[3]) / 2.0 / 5.0) * 5
                    buckets[cy].append(w)

                sorted_rows = sorted(buckets.items(), key=lambda kv: kv[0])
                if len(sorted_rows) < 2:
                    continue

                # Fila superior = tallas (30-50). Fila siguiente = qtys.
                # Si la primera fila no son tallas válidas, intentamos
                # con la siguiente (PDFs con paddings raros).
                size_row, qty_row = None, None
                for ri in range(len(sorted_rows) - 1):
                    cand_sizes = [
                        w for w in sorted_rows[ri][1]
                        if 30 <= int(w[4]) <= 50
                    ]
                    if cand_sizes and len(cand_sizes) >= 1:
                        size_row = sorted(cand_sizes, key=lambda w: w[0])
                        qty_row = sorted(sorted_rows[ri + 1][1], key=lambda w: w[0])
                        break
                if not size_row or not qty_row:
                    continue

                block_lines = []
                for sw in size_row:
                    sx = (sw[0] + sw[2]) / 2.0
                    closest_q = min(
                        qty_row,
                        key=lambda w: abs(((w[0] + w[2]) / 2.0) - sx),
                    )
                    cx = (closest_q[0] + closest_q[2]) / 2.0
                    if abs(cx - sx) > 14.0:
                        continue
                    try:
                        qty_val = int(closest_q[4])
                    except ValueError:
                        continue
                    if qty_val < 1 or qty_val > 9999:
                        continue
                    block_lines.append({
                        "sku":            block["sku"],
                        "supplier_ref":   block["supplier_ref"],
                        "talla":          sw[4],
                        "qty":            qty_val,
                        "product_label":  "",
                        "unit_price":     sku_unit_price.get(block["sku"]),
                        "confidence":     99.0,
                        "match_strategy": "DETERMINISTIC_MWT_FORMAT",
                        "match_score":    99,
                        "matched_producto_id": None,
                        "client_part_number":  None,
                        "base_code":      None,
                        "qty_confirmed":  None,
                        "qty_open":       None,
                    })

                # Validar suma del bloque vs total declarado en el header.
                actual_block = sum(l["qty"] for l in block_lines)
                if abs(actual_block - block["total_qty"]) > 1:
                    log.warning(
                        "[proforma_mwt] SKU %s suma=%d != header=%d → descarto bloque",
                        block["sku"], actual_block, block["total_qty"],
                    )
                    continue
                slot_lines.extend(block_lines)
    finally:
        doc.close()

    if not slot_lines:
        log.info("[proforma_mwt] no extraje líneas (parser cayó)")
        return None

    # Validación global vs Total pares declarado en el header.
    if total_pares:
        total_extraido = sum(l["qty"] for l in slot_lines)
        if abs(total_extraido - total_pares) > 2:
            log.warning(
                "[proforma_mwt] suma global=%d != Total pares declarado=%d → descarto",
                total_extraido, total_pares,
            )
            return None

    log.info(
        "[proforma_mwt] extraje %d líneas (Tipo B), nº=%s, total_pares=%s ✓",
        len(slot_lines), proforma_number, total_pares,
    )

    return {
        "document_kind":   "PROFORMA",
        "proforma_number": proforma_number,
        "raw_text":        flat_text_all[:2000],
        "model":           "deterministic-pymupdf-mwt-v1",
        "error":           None,
        "groups": [{
            "sap_number":    None,
            "po_reference":  None,
            "delivery_date": None,
            "lines":         slot_lines,
        }],
        "lines": [],
    }


# ─────────────────────────────────────────────────────────────────────
# Punto de entrada
# ─────────────────────────────────────────────────────────────────────
def extract_proforma(file_bytes: bytes, filename: str, content_type: str,
                     expediente_id=None) -> dict:
    """Extrae datos de una Proforma MWT vía vision API.

    Args:
      file_bytes: bytes del PDF subido.
      filename: nombre del archivo (para validar extensión).
      content_type: MIME type del archivo.
      expediente_id: UUID del expediente al que pertenece la proforma.
        Si se proporciona, las líneas de BD del expediente se pasan al
        AI como contexto para anclar la lectura — reduce drásticamente
        la alucinación de columnas/qtys de la matriz horizontal de
        tallas. Sprint 2026-05-02 (AG-03).

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

    # ── PATH 0: detectar formato (MARLUVAS vs MWT vs UNKNOWN) ──────
    # Sprint 2026-05-10: existen dos layouts radicalmente distintos
    # de proforma. Si detectamos Tipo B (consola MWT), intentamos
    # el parser determinístico Tipo B. Si esa rama no aplica (Tipo A
    # o desconocido), seguimos el flujo legacy (horizontal → vertical
    # → AI).
    fmt = _detect_proforma_format(file_bytes)
    log.info("[proforma_extractor] formato detectado: %s", fmt)

    if fmt == "MWT":
        mwt_result = _parse_proforma_mwt_format(file_bytes)
        if mwt_result and mwt_result.get("groups") and any(
            g.get("lines") for g in mwt_result["groups"]
        ):
            log.info("[proforma_extractor] parser MWT (Tipo B) OK — saltando AI")
            for g in mwt_result["groups"]:
                for ln in g["lines"]:
                    if ln.get("talla"):
                        ln["talla"] = _convert_talla_to_br(ln["talla"])
            return mwt_result
        # Si el parser Tipo B falla, los parsers Tipo A van a fallar
        # también (buscan "Referencia BRA" que NO existe en Tipo B).
        # Saltamos directo al AI fallback con un tag visible en el log
        # para que sea fácil debuggear si vemos casos raros.
        log.info(
            "[proforma_extractor] parser MWT (Tipo B) falló — saltando parsers "
            "Tipo A y yendo directo al AI fallback (gpt-4o lee Tipo B nativamente)",
        )
        # No `return` aquí: dejamos que el flujo caiga al AI más abajo,
        # pero brincamos los parsers Tipo A.
        skip_type_a_parsers = True
    else:
        skip_type_a_parsers = False

    # ── PATH PRIMARIO-A: parser HORIZONTAL (Marluvas / Excel-export) ──
    # Sprint 2026-05-03: la matriz típica de Marluvas es HORIZONTAL
    # (BRA en una fila, EU debajo, USA debajo, QTY debajo). Si este
    # parser extrae líneas y la suma cuadra con "Total de Pares", lo
    # usamos directo. Cero llamadas a OpenAI.
    # Sprint 2026-05-10: si el detector identificó Tipo B y el parser
    # determinístico falló, saltamos los parsers Tipo A (van a fallar
    # también) y vamos directo al AI.
    if skip_type_a_parsers:
        det_result = None
    else:
        det_result = _parse_proforma_horizontal(file_bytes)
    if det_result and det_result.get("groups") and any(
        g.get("lines") for g in det_result["groups"]
    ):
        log.info("[proforma_extractor] parser horizontal OK — saltando AI")
        for g in det_result["groups"]:
            for ln in g["lines"]:
                if ln.get("talla"):
                    ln["talla"] = _convert_talla_to_br(ln["talla"])
        return det_result

    # ── PATH PRIMARIO-B: parser DETERMINÍSTICO VERTICAL (legacy) ──
    # Sprint 2026-05-02 (AG-03): el AI alucina qtys de la matriz horizontal.
    # Probamos primero un parser determinístico que lee posiciones (X,Y)
    # reales del PDF — sin AI, sin alucinación. Si funciona (devuelve
    # líneas), saltamos toda la llamada a OpenAI.
    # Sprint 2026-05-10: misma guardia que arriba — si era Tipo B, saltamos.
    if skip_type_a_parsers:
        det_result = None
    else:
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

    # ── PATH SECUNDARIO: AI con PDF NATIVO + contexto del expediente ─
    # Sprint 2026-05-02 (AG-03): mandamos el PDF SIN MODIFICAR al modelo
    # (content type "file", base64 nativo). NO se renderiza a PNG porque
    # eso degrada la calidad de la matriz horizontal y el modelo terminaba
    # alucinando columnas. gpt-4o soporta PDF nativo desde SDK 1.54+ y
    # preserva la organización espacial original del documento.
    bd_lines = _load_expediente_context(expediente_id)
    bd_context_text = _format_bd_context_for_prompt(bd_lines)

    pdf_data_url = _pdf_to_data_url(file_bytes)
    pdf_text     = _extract_pdf_text(file_bytes)

    try:
        from openai import OpenAI
    except ImportError:
        return _empty_result("Paquete `openai` no instalado en el backend.")

    client = OpenAI(api_key=api_key, timeout=90.0, max_retries=1)

    # ── Construir el mensaje user con contexto BD (si lo hay) ─────────
    user_text_parts = [
        "Te adjunto el PDF de una proforma comercial MWT (sin convertir a "
        "imagen — es el archivo original). Analizalo y devolvé el JSON "
        "estricto con todos los productos y su distribución por talla.",
        "Atención a la matriz horizontal — alineá las cantidades con la "
        "fila 'Referencia BRA' (NO con EU ni USA).",
    ]
    if bd_context_text:
        user_text_parts.append(
            "\n═══════════════════════════════════════════════════════════\n"
            "ANCLAJE DEL EXPEDIENTE (lo que la BD ya tiene registrado):\n"
            "═══════════════════════════════════════════════════════════\n"
            f"{bd_context_text}\n"
            "═══════════════════════════════════════════════════════════\n"
            "INSTRUCCIONES CON ESTE ANCLAJE:\n"
            "  · Devolvé la distribución TAL CUAL aparece en la PROFORMA "
            "(no la del expediente). El expediente es solo referencia.\n"
            "  · Si la proforma trae EXACTAMENTE las mismas tallas/qtys "
            "que la BD → devolvé esas mismas tallas/qtys.\n"
            "  · Si la proforma trae UNA TALLA EXTRA (ej. talla 43 qty 10 "
            "que la BD no tiene) → devolvé las tallas comunes con sus qtys "
            "EXACTAS de la BD + la nueva talla extra leída de la proforma.\n"
            "  · Si la proforma trae UNA QTY DIFERENTE (ej. talla 41 BD=30 "
            "pero proforma muestra 40) → devolvé la qty que LITERALMENTE "
            "ves en la proforma. NO inventes.\n"
            "  · Antes de devolver, verificá: la suma de qtys por SKU debe "
            "coincidir con el campo 'Total de Pares' del slot. Si no "
            "coincide, releé la matriz hasta que coincida.\n"
            "  · El SKU canónico de la BD es la columna 'Código' del slot "
            "de la proforma. Match exacto.\n"
        )
    else:
        user_text_parts.append(
            "(Sin contexto del expediente — extrae fielmente lo que ves.)"
        )

    if pdf_text:
        user_text_parts.append(
            "\nTexto extraído del PDF (referencia adicional, sin posición "
            "espacial — usá el PDF adjunto para alinear la matriz):\n"
            "─────────────────────────────────────────────────────\n"
            f"{pdf_text}\n"
            "─────────────────────────────────────────────────────"
        )

    user_content: list[dict] = [
        {"type": "text", "text": "\n".join(user_text_parts)},
        # PDF NATIVO — sin render, sin pérdida de calidad.
        {
            "type": "file",
            "file": {
                "filename":  filename or "proforma.pdf",
                "file_data": pdf_data_url,
            },
        },
    ]

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
        log.exception("[proforma_extractor] OpenAI native-PDF call failed")
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
        "model": (OCR_MODEL
                  + "+native-pdf"
                  + ("+bd-context" if bd_context_text else "")),
        "error": None,
        "bd_context_lines": len(bd_lines) if bd_lines else 0,
    }
    for k in ("proforma_number", "client_po_number", "client_name",
              "issued_date", "currency"):
        if data.get(k) is not None:
            out[k] = data.get(k)

    out["groups"] = _normalize_groups(data.get("groups"))
    out["lines"]  = []  # PROFORMA usa groups, no lines top-level

    log.info(
        "[proforma_extractor] OK model=%s bd_ctx=%d pdf_text_chars=%d groups=%d lines=%d",
        OCR_MODEL,
        len(bd_lines),
        len(pdf_text),
        len(out["groups"]),
        sum(len(g.get("lines") or []) for g in out["groups"]),
    )
    return out
