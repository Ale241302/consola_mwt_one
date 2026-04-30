"""
=====================================================================
MWT.ONE · apps.expedientes.document_matchmaker
Agente responsable: [AG-BACKEND]

Sprint Document Matchmaker · 2026-04-29.

Servicio que toma un documento (OC del cliente, Proforma MWT,
Confirmación SAP) y lo cruza contra las líneas del expediente en BD.

Salida estructurada GARANTIZADA: si la IA falla o devuelve algo raro,
caemos a un payload determinístico vacío con `error` poblado para que
el frontend nunca colapse.

Document types canónicos:
  · ART-01_OC        → Orden de Compra del cliente
  · ART-02_PROFORMA  → Proforma MWT
  · ART-04_SAP       → Confirmación SAP del proveedor

Modelo: gpt-5-nano vía OpenAI Responses API (con fallback a chat).
=====================================================================
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Optional

from django.db import connection

log = logging.getLogger(__name__)

OCR_MODEL = os.environ.get("OPENAI_OCR_MODEL", "gpt-5-nano")


# ─────────────────────────────────────────────────────────────────────
# System prompts — uno por tipo de documento, todos exigen JSON estricto.
# ─────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT_OC = """Eres un extractor de Órdenes de Compra (OC) del cliente.
Lees el documento y devuelves un JSON ESTRICTO con la lista de líneas.

Esquema obligatorio:
{
  "document_kind": "OC",
  "client_po_number": "<si aparece>",
  "client_name":      "<si aparece>",
  "issued_date":      "YYYY-MM-DD",
  "currency":         "USD",
  "lines": [
    {
      "sku":           "<código del producto>",
      "product_label": "<descripción si aparece>",
      "talla":         "<talla / size si aparece>",
      "qty":           <entero>,
      "unit_price":    <decimal o null>,
      "confidence":    0..100
    }, ...
  ],
  "raw_text": "<transcripción literal, max 2000 chars>"
}

Reglas duras:
  1. CERO INVENTOS. Si un campo no aparece en el documento, omitirlo.
  2. Si NO hay tabla de productos, devolver lines=[].
  3. SKU / talla en MAYÚSCULAS sin espacios.
  4. Devolver SOLO el JSON, sin texto adicional, sin markdown.
"""


SYSTEM_PROMPT_PROFORMA = """Eres un extractor de Proformas MWT (documento comercial interno).
Lees el documento y devuelves un JSON ESTRICTO.

Particularidad: una Proforma puede contener MÚLTIPLES órdenes SAP del proveedor
agrupadas. Detectalas y agrupalas con sap_number distintos.

Esquema obligatorio:
{
  "document_kind": "PROFORMA",
  "proforma_number":  "<código MWT>",
  "issued_date":      "YYYY-MM-DD",
  "currency":         "USD",
  "groups": [
    {
      "sap_number":   "<número SAP del proveedor>",
      "lines": [
        {"sku":"...", "product_label":"...", "talla":"...", "qty":N,
         "unit_price":<decimal o null>, "confidence":0..100}, ...
      ]
    }, ...
  ],
  "raw_text": "<transcripción literal, max 2000 chars>"
}

Reglas:
  1. CERO INVENTOS. Si no hay SAPs, usar un solo grupo con sap_number = null.
  2. Cada línea pertenece a un solo grupo (no duplicar).
  3. SKU / talla en MAYÚSCULAS sin espacios.
  4. Devolver SOLO el JSON.
"""


SYSTEM_PROMPT_SAP = """Eres un extractor de Confirmaciones SAP del proveedor.
Lees el documento y devuelves un JSON ESTRICTO.

Una confirmación SAP puede traer una o varias órdenes. Cada orden tiene
un sap_number (también llamado "Sales Order" o "Auftrag") y una lista
de líneas con material, talla y cantidad confirmada.

Esquema obligatorio:
{
  "document_kind": "SAP",
  "supplier_name": "<si aparece>",
  "issued_date":   "YYYY-MM-DD",
  "groups": [
    {
      "sap_number":   "<código SAP / SO #>",
      "po_reference": "<MWT PO si aparece>",
      "delivery_date":"YYYY-MM-DD",
      "lines": [
        {"sku":"...", "product_label":"...", "talla":"...",
         "qty_confirmed":N, "qty_open":N, "confidence":0..100}, ...
      ]
    }, ...
  ],
  "raw_text": "<transcripción literal, max 2000 chars>"
}

Reglas:
  1. CERO INVENTOS.
  2. SKU / talla en MAYÚSCULAS sin espacios.
  3. Si no hay sap_number, usar null y agrupar todas las líneas ahí.
  4. Devolver SOLO el JSON.
"""


PROMPT_BY_TYPE = {
    "ART-01_OC":       SYSTEM_PROMPT_OC,
    "ART-02_PROFORMA": SYSTEM_PROMPT_PROFORMA,
    "ART-04_SAP":      SYSTEM_PROMPT_SAP,
}


# ─────────────────────────────────────────────────────────────────────
# Llamada IA
# ─────────────────────────────────────────────────────────────────────
def _empty_result(document_kind, error=None):
    out = {
        "document_kind": document_kind,
        "lines":         [],
        "groups":        [],
        "raw_text":      "",
        "error":         error,
        "model":         OCR_MODEL,
    }
    return out


def extract_document(file_bytes: bytes, filename: str, content_type: str,
                     document_type: str) -> dict:
    """Punto de entrada del extractor."""
    api_key = os.environ.get("OPENAI_API_KEY")
    kind_map = {
        "ART-01_OC": "OC", "ART-02_PROFORMA": "PROFORMA", "ART-04_SAP": "SAP",
    }
    document_kind = kind_map.get(document_type, "OTHER")

    if not api_key:
        return _empty_result(document_kind, "OPENAI_API_KEY no configurada en el servidor.")

    is_pdf   = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    is_image = content_type.startswith("image/") or any(
        filename.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")
    )
    is_excel = filename.lower().endswith((".xlsx", ".xlsm", ".xls"))
    is_csv   = filename.lower().endswith(".csv")

    if not (is_pdf or is_image or is_excel or is_csv):
        return _empty_result(document_kind, f"Tipo de archivo no soportado: {content_type}")

    # Excel/CSV → convertimos a texto plano antes de mandar a la IA
    text_payload = None
    if is_excel:
        try:
            from openpyxl import load_workbook
            import io as _io
            wb = load_workbook(_io.BytesIO(file_bytes), data_only=True, read_only=True)
            ws = wb.active
            rows = []
            for row in ws.iter_rows(values_only=True):
                rows.append("\t".join(str(c) if c is not None else "" for c in row))
            text_payload = "\n".join(rows)[:18000]
        except Exception as e:
            return _empty_result(document_kind, f"No pude leer el Excel: {e}")
    elif is_csv:
        for enc in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                text_payload = file_bytes.decode(enc)[:18000]
                break
            except UnicodeDecodeError:
                continue
        if text_payload is None:
            return _empty_result(document_kind, "No pude decodificar el CSV.")

    try:
        from openai import OpenAI
    except ImportError:
        return _empty_result(document_kind, "Paquete `openai` no instalado en el backend.")

    client = OpenAI(api_key=api_key, timeout=60.0)
    system_prompt = PROMPT_BY_TYPE.get(document_type, SYSTEM_PROMPT_OC)

    raw_text = None
    try:
        if text_payload is not None:
            # Excel/CSV → mandamos texto plano (chat.completions)
            chat = client.chat.completions.create(
                model = OCR_MODEL,
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content":
                        "Analiza el siguiente documento (Excel/CSV) y devuelve solo JSON:\n\n"
                        + text_payload},
                ],
                response_format = {"type": "json_object"},
            )
            raw_text = chat.choices[0].message.content
        else:
            # PDF/Imagen → multimodal
            b64 = base64.b64encode(file_bytes).decode("ascii")
            data_url = f"data:{content_type};base64,{b64}"
            user_prompt = "Analiza el siguiente documento y devuelve solo JSON."
            try:
                resp = client.responses.create(
                    model        = OCR_MODEL,
                    instructions = system_prompt,
                    input=[{
                        "role": "user",
                        "content": [
                            {"type": "input_text",  "text": user_prompt},
                            {"type": "input_image", "image_url": data_url}
                                if is_image else
                            {"type": "input_file",  "filename": filename, "file_data": data_url},
                        ],
                    }],
                    response_format={"type": "json_object"},
                )
                raw_text = resp.output_text
            except Exception:
                content_parts = [{"type": "text", "text": user_prompt},
                                 {"type": "image_url", "image_url": {"url": data_url}}]
                chat = client.chat.completions.create(
                    model    = OCR_MODEL,
                    messages = [{"role": "system", "content": system_prompt},
                                {"role": "user",   "content": content_parts}],
                    response_format = {"type": "json_object"},
                )
                raw_text = chat.choices[0].message.content
    except Exception as e:
        log.exception("[matchmaker] OpenAI call failed")
        return _empty_result(document_kind, f"OpenAI API error: {type(e).__name__}: {e}")

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        return _empty_result(document_kind, f"JSON inválido del modelo: {e}")

    # Normalización defensiva
    out = {
        "document_kind": data.get("document_kind") or document_kind,
        "raw_text":      (data.get("raw_text") or "")[:2000] if isinstance(data.get("raw_text"), str) else "",
        "model":         OCR_MODEL,
        "error":         None,
    }
    # Pasar también campos top-level extra
    for k in ("client_po_number", "client_name", "issued_date", "currency",
              "proforma_number", "supplier_name"):
        if data.get(k) is not None:
            out[k] = data.get(k)

    if document_kind == "OC":
        out["lines"]  = _normalize_lines(data.get("lines"))
        out["groups"] = []
    else:
        # Proforma/SAP → groups
        groups = []
        for g in (data.get("groups") or []):
            sap = g.get("sap_number") or None
            lines = _normalize_lines(g.get("lines"), is_sap=(document_kind == "SAP"))
            groups.append({
                "sap_number":    sap,
                "po_reference":  g.get("po_reference") or None,
                "delivery_date": g.get("delivery_date") or None,
                "lines":         lines,
            })
        # Si la IA olvidó groups pero puso lines top-level, reagrupar
        if not groups and data.get("lines"):
            groups = [{
                "sap_number":    None,
                "po_reference":  None,
                "delivery_date": None,
                "lines":         _normalize_lines(data["lines"], is_sap=(document_kind == "SAP")),
            }]
        out["groups"] = groups
        out["lines"]  = []
    return out


def _normalize_lines(rows, is_sap=False):
    """Aplica defensa contra shapes raros en las líneas."""
    out = []
    for ln in (rows or []):
        if not isinstance(ln, dict):
            continue
        sku = str(ln.get("sku") or "").strip().upper()[:64]
        if not sku:
            continue
        try:
            qty_field = "qty_confirmed" if is_sap else "qty"
            qty = int(ln.get(qty_field) or ln.get("qty") or 0)
        except (TypeError, ValueError):
            qty = 0
        out.append({
            "sku":            sku,
            "product_label":  str(ln.get("product_label") or "")[:255],
            "talla":          str(ln.get("talla") or "").strip().upper()[:16],
            "qty":            qty,
            "qty_confirmed":  qty if is_sap else None,
            "qty_open":       _safe_int(ln.get("qty_open")) if is_sap else None,
            "unit_price":     _safe_float(ln.get("unit_price")),
            "confidence":     round(max(0.0, min(100.0, float(ln.get("confidence") or 80))), 2),
        })
    return out


def _safe_int(v):
    try: return int(v) if v not in (None, "") else None
    except (TypeError, ValueError): return None
def _safe_float(v):
    try: return float(v) if v not in (None, "") else None
    except (TypeError, ValueError): return None


# ─────────────────────────────────────────────────────────────────────
# Matchmaker — cruce IA vs líneas del expediente
# ─────────────────────────────────────────────────────────────────────
def cross_match(ai_payload: dict, expediente_id) -> dict:
    """Cruza el payload de la IA contra expedientes.linea del expediente.

    Devuelve mismatch_payload con shape canónico.
    """
    kind = (ai_payload.get("document_kind") or "OC").upper()

    # Cargar líneas del expediente desde BD
    db_lines = _load_expediente_lines(expediente_id)
    db_index = {}  # (sku,talla) -> {qty, sap, line_id}
    for l in db_lines:
        key = (l["sku"].upper(), (l["talla"] or "").upper())
        if key in db_index:
            db_index[key]["qty"] += l["qty"]
        else:
            db_index[key] = dict(l)

    discrepancies = []
    matched_keys = set()

    # ── OC ──────────────────────────────────────
    if kind == "OC":
        for ln in (ai_payload.get("lines") or []):
            key = (ln["sku"].upper(), (ln["talla"] or "").upper())
            db = db_index.get(key)
            if not db:
                discrepancies.append({
                    "kind":             "MISSING_IN_EXPEDIENTE",
                    "sku":              ln["sku"],
                    "talla":            ln["talla"] or None,
                    "qty_doc":          ln["qty"],
                    "qty_exp":          0,
                    "sap_doc":          None,
                    "sap_exp":          None,
                    "severity":         "WARN",
                    "suggested_action": "ADD_LINE",
                    "product_label":    ln.get("product_label"),
                    "confidence":       ln.get("confidence"),
                })
            else:
                matched_keys.add(key)
                if int(db["qty"]) != int(ln["qty"]):
                    discrepancies.append({
                        "kind":             "QTY_DIFF",
                        "sku":              ln["sku"],
                        "talla":            ln["talla"] or None,
                        "qty_doc":          ln["qty"],
                        "qty_exp":          int(db["qty"]),
                        "sap_doc":          None,
                        "sap_exp":          db.get("sap"),
                        "severity":         "WARN",
                        "suggested_action": "UPDATE_QTY",
                        "product_label":    ln.get("product_label") or db.get("product_label"),
                        "line_id":          db.get("line_id"),
                    })
        # Líneas en expediente que NO están en el doc
        for key, db in db_index.items():
            if key in matched_keys:
                continue
            discrepancies.append({
                "kind":             "MISSING_IN_DOC",
                "sku":              db["sku"],
                "talla":            db["talla"] or None,
                "qty_doc":          0,
                "qty_exp":          int(db["qty"]),
                "severity":         "INFO",
                "suggested_action": "MANUAL",
                "product_label":    db.get("product_label"),
                "line_id":          db.get("line_id"),
            })
        groups_out = []

    # ── Proforma / SAP ──────────────────────────
    else:
        groups_out = []
        for g in (ai_payload.get("groups") or []):
            sap = g.get("sap_number")
            g_disc = []
            for ln in g.get("lines") or []:
                key = (ln["sku"].upper(), (ln["talla"] or "").upper())
                db = db_index.get(key)
                qty_doc = int(ln.get("qty_confirmed") or ln.get("qty") or 0)
                if not db:
                    item = {
                        "kind":             "MISSING_IN_EXPEDIENTE",
                        "sku":              ln["sku"],
                        "talla":            ln["talla"] or None,
                        "qty_doc":          qty_doc,
                        "qty_exp":          0,
                        "sap_doc":          sap,
                        "sap_exp":          None,
                        "severity":         "WARN",
                        "suggested_action": "ADD_LINE",
                        "product_label":    ln.get("product_label"),
                        "confidence":       ln.get("confidence"),
                    }
                    g_disc.append(item); discrepancies.append(item)
                else:
                    matched_keys.add(key)
                    delta_qty = int(db["qty"]) != qty_doc
                    sap_diff  = db.get("sap") and sap and (str(db["sap"]).strip() != str(sap).strip())
                    if delta_qty or sap_diff:
                        item = {
                            "kind":             "SAP_MISMATCH" if sap_diff else "QTY_DIFF",
                            "sku":              ln["sku"],
                            "talla":            ln["talla"] or None,
                            "qty_doc":          qty_doc,
                            "qty_exp":          int(db["qty"]),
                            "sap_doc":          sap,
                            "sap_exp":          db.get("sap"),
                            "severity":         "ERROR" if sap_diff else "WARN",
                            "suggested_action": "ATTACH_SAP" if sap_diff else "UPDATE_QTY",
                            "product_label":    ln.get("product_label") or db.get("product_label"),
                            "line_id":          db.get("line_id"),
                        }
                        g_disc.append(item); discrepancies.append(item)
            groups_out.append({
                "sap_number":     sap,
                "po_reference":   g.get("po_reference"),
                "delivery_date":  g.get("delivery_date"),
                "lines_count":    len(g.get("lines") or []),
                "discrepancies":  g_disc,
            })
        # Líneas en BD que NO están en el documento
        for key, db in db_index.items():
            if key in matched_keys:
                continue
            discrepancies.append({
                "kind":             "MISSING_IN_DOC",
                "sku":              db["sku"],
                "talla":            db["talla"] or None,
                "qty_doc":          0,
                "qty_exp":          int(db["qty"]),
                "sap_doc":          None,
                "sap_exp":          db.get("sap"),
                "severity":         "INFO",
                "suggested_action": "MANUAL",
                "product_label":    db.get("product_label"),
                "line_id":          db.get("line_id"),
            })

    # Métricas
    lines_in_doc = (
        len(ai_payload.get("lines") or [])
        if kind == "OC"
        else sum(len(g.get("lines") or []) for g in (ai_payload.get("groups") or []))
    )
    lines_in_exp   = len(db_lines)
    matched        = len(matched_keys)
    discrepancies_count = len(discrepancies)
    coverage = round((matched / lines_in_exp) * 100, 2) if lines_in_exp > 0 else (
        100.0 if lines_in_doc == 0 else 0.0
    )
    perfect = (discrepancies_count == 0 and lines_in_doc > 0)

    return {
        "summary": {
            "perfect_match":       perfect,
            "coverage_pct":        coverage,
            "lines_in_doc":        lines_in_doc,
            "lines_in_expediente": lines_in_exp,
            "lines_matched":       matched,
            "discrepancies_count": discrepancies_count,
        },
        "discrepancies": discrepancies,
        "groups":        groups_out,
    }


def _load_expediente_lines(expediente_id) -> list[dict]:
    """Carga líneas del expediente (sku, talla, qty, sap) — defensivo si la
    estructura varía entre entornos. Usa raw SQL para no acoplarnos al ORM."""
    rows = []
    # Schema real (70_expedientes.sql):
    #   columns = id, oc_id, expediente_id, producto_id, sku, size, qty,
    #             unit_cost, unit_price, total_price, sap, transport_mode,
    #             production_date, estado, deferred_*, is_active, ...
    # NO existen `talla`, `cantidad`, `quantity`, `qty_transfer`,
    # `sap_number`, `product_label` — referenciarlas dispara
    # "column does not exist" y nada se puede leer.
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT
                    l.id::text                        AS line_id,
                    COALESCE(l.sku, '')               AS sku,
                    COALESCE(l.size, '')              AS talla,
                    COALESCE(l.qty, 0)                AS qty,
                    COALESCE(l.sap, '')               AS sap,
                    COALESCE(p.nombre, l.sku, '')     AS product_label
                FROM   expedientes.linea l
                LEFT JOIN productos.producto p ON p.id = l.producto_id
                WHERE  l.expediente_id = %s
                  AND  COALESCE(l.is_active, TRUE) = TRUE
            """, [str(expediente_id)])
            cols = [c.description[i][0] for i in range(len(c.description))]
            for r in c.fetchall():
                rows.append(dict(zip(cols, r)))
    except Exception as e:
        log.warning("[matchmaker] no pude leer expedientes.linea: %s", e)
    return rows
