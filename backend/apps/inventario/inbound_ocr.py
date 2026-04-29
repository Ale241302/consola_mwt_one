"""
=====================================================================
MWT.ONE · apps.inventario.inbound_ocr
Agente responsable: [AG-BACKEND]

OCR de Packing List / Factura Comercial vía OpenAI gpt-5-nano.

Devuelve JSON estructurado con líneas detectadas:
  {
    "lines": [
      {"product_sku":"...", "product_label":"...", "talla":"...",
       "lote_code":"...", "expiration_date":"YYYY-MM-DD",
       "expected_qty":12, "unit_cost_usd":42.50,
       "confidence":0..100},
      ...
    ],
    "metadata": {"document_type":"PACKING_LIST"|"INVOICE"|"OTHER",
                 "supplier":"...", "po_number":"...", "issued_date":"..."},
    "summary":  {"lines_count":10, "units_total":120, "currency":"USD"},
    "raw_text": "...",
    "error":    null,
    "model":    "gpt-5-nano"
  }

POL_VISIBILIDAD: la respuesta INCLUYE unit_cost_usd. El serializer
del endpoint en inbound_views.py decide si lo enmascara según el rol
del caller (defensa en dos capas).
=====================================================================
"""
from __future__ import annotations

import base64
import json
import logging
import os

log = logging.getLogger(__name__)

OCR_MODEL = os.environ.get("OPENAI_OCR_MODEL", "gpt-5-nano")

SYSTEM_PROMPT = """Eres un extractor de datos de Packing Lists y Facturas
Comerciales con precisión quirúrgica. Tu tarea: leer el documento y
devolver un JSON ESTRICTO con la tabla de productos.

Por cada línea identificada en la tabla:
  · product_sku        → código SAP / SKU canónico (string corto).
  · product_label      → descripción comercial (texto libre).
  · talla              → talla / size si aparece (37, 38, M, L, XL, etc.).
  · lote_code          → código de lote / batch / serial. Vacío si no.
  · expiration_date    → vencimiento en formato YYYY-MM-DD si aparece. Sino omitir.
  · expected_qty       → cantidad documentada (entero).
  · unit_cost_usd      → costo unitario USD si aparece (decimal). Sino omitir.
  · currency           → ISO-4217 detectada en el documento.
  · confidence         → 0..100, qué tan claros estaban los datos.

Reglas duras:
  1. CERO INVENTOS. Si el dato no aparece, omite el campo.
  2. Si el documento no tiene tabla de productos, devuelve lines=[].
  3. metadata.document_type = "PACKING_LIST" | "INVOICE" | "DELIVERY_NOTE" | "OTHER".
  4. metadata.supplier = nombre de proveedor / vendedor si aparece.
  5. metadata.po_number = número de OC asociado si aparece.
  6. metadata.issued_date = fecha del documento (YYYY-MM-DD).
  7. summary.units_total = suma de expected_qty.
  8. raw_text = transcripción literal (max 3000 chars).

Devuelve ÚNICAMENTE el JSON. Sin texto adicional, sin markdown.
"""


def extract_packing_list(file_bytes: bytes, filename: str, content_type: str) -> dict:
    """Punto de entrada del servicio OCR de inbound."""
    api_key = os.environ.get("OPENAI_API_KEY")
    fallback = {
        "lines":    [],
        "metadata": {},
        "summary":  {"lines_count": 0, "units_total": 0, "currency": None},
        "raw_text": "",
        "error":    None,
        "model":    OCR_MODEL,
    }
    if not api_key:
        fallback["error"] = "OPENAI_API_KEY no configurada en el servidor."
        return fallback

    is_pdf   = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    is_image = content_type.startswith("image/") or any(
        filename.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")
    )
    if not (is_pdf or is_image):
        fallback["error"] = f"Tipo de archivo no soportado: {content_type}"
        return fallback

    try:
        from openai import OpenAI
    except ImportError:
        fallback["error"] = "Paquete `openai` no instalado en el backend."
        return fallback

    client = OpenAI(api_key=api_key, timeout=60.0)
    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{content_type};base64,{b64}"
    user_prompt = (
        "Analiza el siguiente Packing List / Factura Comercial y extrae "
        "todas las líneas de productos. Devuelve solo JSON."
    )

    raw_text = None
    try:
        resp = client.responses.create(
            model       = OCR_MODEL,
            instructions= SYSTEM_PROMPT,
            input=[{
                "role": "user",
                "content": [
                    {"type": "input_text", "text": user_prompt},
                    {"type": "input_image", "image_url": data_url}
                        if is_image else
                    {"type": "input_file", "filename": filename, "file_data": data_url},
                ],
            }],
            response_format={"type": "json_object"},
        )
        raw_text = resp.output_text
    except Exception as e:
        log.warning("[inbound_ocr] responses.create falló (%s) → chat.completions", e)
        try:
            content = [{"type": "text", "text": user_prompt},
                       {"type": "image_url", "image_url": {"url": data_url}}]
            chat = client.chat.completions.create(
                model    = OCR_MODEL,
                messages = [{"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user",   "content": content}],
                response_format = {"type": "json_object"},
            )
            raw_text = chat.choices[0].message.content
        except Exception as e2:
            log.exception("[inbound_ocr] OpenAI call failed")
            fallback["error"] = f"OpenAI API error: {type(e2).__name__}: {e2}"
            return fallback

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as e:
        fallback["error"]    = f"JSON inválido del modelo: {e}"
        fallback["raw_text"] = (raw_text or "")[:3000]
        return fallback

    out = {
        "lines":    [],
        "metadata": data.get("metadata") or {},
        "summary":  data.get("summary")  or {},
        "raw_text": (data.get("raw_text") or "")[:3000] if isinstance(data.get("raw_text"), str) else "",
        "error":    None,
        "model":    OCR_MODEL,
    }
    confidences = []
    for line in (data.get("lines") or []):
        try:
            sku = str(line.get("product_sku") or "").strip()[:64]
            if not sku:
                continue
            qty = int(line.get("expected_qty") or 0)
            unit_cost = line.get("unit_cost_usd")
            if unit_cost in (None, ""):
                unit_cost = None
            else:
                unit_cost = round(float(unit_cost), 4)
            conf = float(line.get("confidence") or 80)
            confidences.append(conf)
            out["lines"].append({
                "product_sku":     sku,
                "product_label":   str(line.get("product_label") or "")[:255],
                "talla":           str(line.get("talla") or "")[:16],
                "lote_code":       str(line.get("lote_code") or "")[:64],
                "expiration_date": line.get("expiration_date") or None,
                "expected_qty":    qty,
                "unit_cost_usd":   unit_cost,
                "currency":        str(line.get("currency") or "USD")[:3].upper(),
                "confidence":      round(max(0.0, min(100.0, conf)), 2),
            })
        except Exception:
            log.warning("[inbound_ocr] skip malformed line: %s", line)
            continue
    out["summary"]["lines_count"] = len(out["lines"])
    if confidences:
        out["summary"]["confidence_avg"] = round(sum(confidences) / len(confidences), 2)
    return out
