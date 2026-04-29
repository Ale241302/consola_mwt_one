"""
=====================================================================
MWT.ONE · apps.transfers.ocr_customs
Agente responsable: [AG-BACKEND]

Servicio de OCR aduanal para el Motor de Transferencias.

Toma un documento (PDF o imagen) — típicamente un DUA o liquidación
aduanera — lo manda a OpenAI gpt-5-nano con un system prompt
estructurado y devuelve un JSON con líneas de costo sugeridas:

  {
    "lines": [
      {"kind": "DAI",        "label": "...", "amount": 0.00, "currency": "USD", "confidence": 0..100},
      {"kind": "IVA",        "label": "...", "amount": 0.00, "currency": "USD", "confidence": 0..100},
      {"kind": "ALMACENAJE", "label": "...", "amount": 0.00, "currency": "USD", "confidence": 0..100}
    ],
    "raw_text":  "...",         # texto crudo del documento (auditoría)
    "metadata":  {              # info adicional detectada
      "dua_number":   "...",
      "issued_date":  "YYYY-MM-DD",
      "country":      "PE"
    },
    "summary": {
      "total_amount_usd": 0.00,
      "currency_seen":    "USD"
    }
  }

Reglas:
  · CERO inventos: si el DAI no aparece, lines no incluye DAI.
  · Confidence < 60 ⇒ el FE marca el chip ⚠️ amarillo.
  · Si OPENAI_API_KEY no está seteada, el servicio devuelve un
    payload determinístico de FALLBACK (vacío) con error documentado.
=====================================================================
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

# Modelo canónico para OCR de transfers (sprint v2 · 2026-04-29).
# Si OpenAI cambia el nombre, sobreescribir vía env var.
OCR_MODEL = os.environ.get("OPENAI_OCR_MODEL", "gpt-5-nano")

SYSTEM_PROMPT = """Eres un extractor de datos aduanales de precisión quirúrgica.
Tu tarea: leer un Documento Único Aduanero (DUA), una liquidación aduanera o
una factura de agente de aduana y devolver un JSON ESTRICTO con las líneas
de costo que aparecen.

Categorías canónicas (kind) — usa SIEMPRE una de estas:
  · DAI            → aranceles / derechos arancelarios a la importación
  · IVA            → IVA, IGV, ITBIS, ISV o equivalente local
  · ALMACENAJE     → bodegaje en zona primaria / depósito fiscal
  · AGENCIAMIENTO  → honorarios del agente de aduana
  · MANIPULEO      → carga, descarga, paletizado, fumigación
  · FLETE          → flete (interno / internacional)
  · SEGURO         → cobertura de transporte
  · CONSOLIDACION  → consolidación LCL / LTL
  · OTRO           → cualquier costo que no encaje arriba

REGLAS DURAS:
  1. CERO INVENTOS. Si una categoría no aparece en el documento, NO la incluyas.
  2. amount = número en la moneda del documento (no convertir).
     currency = código ISO-4217 detectado (USD, PEN, MXN, COP, EUR, etc.).
  3. Cada línea trae confidence (0..100) según la claridad del dato.
  4. Si ves múltiples líneas de la misma categoría (ej. dos almacenajes),
     listalas separadas con label distinto.
  5. label = texto corto humano: "DAI subpartida 6403.99", "IVA 18% s/CIF", etc.
  6. metadata.dua_number, metadata.issued_date (YYYY-MM-DD) y metadata.country
     (ISO-2) se extraen si aparecen; si no, omitirlos.
  7. raw_text = transcripción literal del documento (max 3000 chars).
  8. summary.total_amount_usd = suma aproximada CONVERTIDA a USD si conoces
     el FX; si no, omitirlo.

Devuelve ÚNICAMENTE el JSON. Sin texto adicional, sin markdown, sin comentarios.
"""


def extract_customs_costs(
    file_bytes: bytes,
    filename: str,
    content_type: str,
) -> dict:
    """Punto de entrada del servicio.

    Args:
        file_bytes: contenido binario del archivo (PDF/JPG/PNG).
        filename:   nombre original (para hint de tipo si content_type es genérico).
        content_type: MIME type del archivo (application/pdf, image/jpeg, etc.).

    Returns:
        dict con shape documentado en la docstring del módulo.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        log.warning("[ocr_customs] OPENAI_API_KEY no seteada — fallback vacío.")
        return {
            "lines":    [],
            "raw_text": "",
            "metadata": {},
            "summary":  {"total_amount_usd": 0.0, "currency_seen": None},
            "error":    "OPENAI_API_KEY no configurada en el servidor.",
            "model":    OCR_MODEL,
        }

    is_pdf   = content_type == "application/pdf" or filename.lower().endswith(".pdf")
    is_image = content_type.startswith("image/") or any(
        filename.lower().endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")
    )

    if not (is_pdf or is_image):
        return {
            "lines":    [],
            "raw_text": "",
            "metadata": {},
            "summary":  {"total_amount_usd": 0.0, "currency_seen": None},
            "error":    f"Tipo de archivo no soportado: {content_type}",
            "model":    OCR_MODEL,
        }

    try:
        from openai import OpenAI
    except ImportError:
        log.exception("[ocr_customs] paquete openai no instalado.")
        return {
            "lines":    [],
            "raw_text": "",
            "metadata": {},
            "summary":  {"total_amount_usd": 0.0, "currency_seen": None},
            "error":    "Paquete `openai` no instalado en el backend (pip install openai).",
            "model":    OCR_MODEL,
        }

    client = OpenAI(api_key=api_key, timeout=60.0)

    # Para imágenes mandamos data URL inline (vision API).
    # Para PDF: el SDK 1.x de openai admite "input_file" en Responses API,
    # pero por compatibilidad vintage usamos data URL para PDFs también
    # (gpt-5-nano lo soporta como input multimodal).
    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{content_type};base64,{b64}"

    user_prompt = (
        "Analiza el siguiente documento aduanal y extrae todas las líneas "
        "de costo siguiendo las reglas del system prompt. Devuelve solo JSON."
    )

    try:
        # API Responses (gpt-5-nano y siguientes) — formato canónico.
        response = client.responses.create(
            model       = OCR_MODEL,
            instructions= SYSTEM_PROMPT,
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text",  "text": user_prompt},
                        {"type": "input_image", "image_url": data_url}
                            if is_image else
                        {"type": "input_file",  "filename": filename, "file_data": data_url},
                    ],
                }
            ],
            response_format={"type": "json_object"},
        )
        raw = response.output_text  # SDK normaliza
    except Exception as e:
        # Fallback: si responses.create no existe en el SDK instalado,
        # caemos a chat.completions con visión (compat 1.x clásico).
        log.warning("[ocr_customs] responses.create falló (%s) · fallback chat.completions", e)
        try:
            content_parts = [{"type": "text", "text": user_prompt}]
            if is_image:
                content_parts.append({"type": "image_url", "image_url": {"url": data_url}})
            else:
                # PDF en chat.completions no es soportado nativo — pasamos
                # solo el data_url y dejamos que el modelo nos diga si no
                # puede leerlo. (Recomendación: usar Responses API.)
                content_parts.append({"type": "image_url", "image_url": {"url": data_url}})
            chat = client.chat.completions.create(
                model       = OCR_MODEL,
                messages    = [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": content_parts},
                ],
                response_format = {"type": "json_object"},
            )
            raw = chat.choices[0].message.content
        except Exception as e2:
            log.exception("[ocr_customs] OpenAI call failed completamente")
            return {
                "lines":    [],
                "raw_text": "",
                "metadata": {},
                "summary":  {"total_amount_usd": 0.0, "currency_seen": None},
                "error":    f"OpenAI API error: {type(e2).__name__}: {e2}",
                "model":    OCR_MODEL,
            }

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("[ocr_customs] JSON inválido del modelo: %s", raw[:200])
        return {
            "lines":    [],
            "raw_text": raw[:3000] if isinstance(raw, str) else "",
            "metadata": {},
            "summary":  {"total_amount_usd": 0.0, "currency_seen": None},
            "error":    f"JSON inválido del modelo: {e}",
            "model":    OCR_MODEL,
        }

    # Normalización defensiva — el modelo a veces invierte llaves o usa nombres legacy.
    out = {
        "lines":    [],
        "raw_text": data.get("raw_text", "")[:3000] if isinstance(data.get("raw_text"), str) else "",
        "metadata": data.get("metadata") or {},
        "summary":  data.get("summary")  or {},
        "error":    None,
        "model":    OCR_MODEL,
    }
    for line in (data.get("lines") or []):
        try:
            kind = str(line.get("kind") or "OTRO").upper()
            if kind not in ("DAI","IVA","ALMACENAJE","AGENCIAMIENTO","MANIPULEO",
                            "FLETE","SEGURO","CONSOLIDACION","OTRO"):
                kind = "OTRO"
            amount = float(line.get("amount") or 0)
            currency = str(line.get("currency") or "USD").upper()[:3]
            confidence = float(line.get("confidence") or 80)
            out["lines"].append({
                "kind":       kind,
                "label":      str(line.get("label") or "")[:160],
                "amount":     round(amount, 2),
                "currency":   currency,
                "confidence": round(max(0.0, min(100.0, confidence)), 2),
            })
        except Exception:
            log.warning("[ocr_customs] skipping malformed line: %s", line)
            continue

    return out
