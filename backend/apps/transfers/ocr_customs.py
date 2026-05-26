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
Tu tarea: leer un Documento Único Aduanero (DUA), una liquidación aduanera, una
"Consulta de Impuestos para el DUA" o factura de agente de aduana y devolver
un JSON ESTRICTO con las líneas de costo que aparecen.

Categorías canónicas (kind) — usa SIEMPRE una de estas, en MAYÚSCULAS:

  CORE (cualquier país):
  · DAI                → Aranceles / Derechos arancelarios a la importación
                         Aliases: "DAI", "ARANCELES", "DERECHOS ARANCELARIOS",
                         "DUTY", "IMPORT DUTY"
  · IVA                → IVA, IGV, ITBIS, ISV, ICMS o equivalente local
                         Aliases: "IVA", "IGV", "VAT", "IMPUESTO AL VALOR AGREGADO",
                         "IMPUESTO SOBRE EL VALOR AGREGADO", "LEY 9635"
  · ALMACENAJE         → Bodegaje zona primaria / depósito fiscal
  · AGENCIAMIENTO      → Honorarios del agente de aduana
  · MANIPULEO          → Carga, descarga, paletizado, fumigación, handling
  · FLETE              → Flete (interno / internacional)
  · SEGURO             → Cobertura de transporte
  · CONSOLIDACION      → Consolidación LCL / LTL

  COSTA RICA (DUA CR · tributos típicos):
  · PROCOMER           → "PROCOMER", "$3 PROCOMER", "TASA PROCOMER" (0.25% s/CIF)
  · LEY_6946           → "LEY 6946", "SEGURIDAD CIUDADANA" (1% s/CIF)
  · TIMBRE_ARCHIVO     → "TIMBRE ARCHIVO NACIONAL", "ARCHIVO NACIONAL"
  · TIMBRE_AGENTES     → "TIMBRE ASOCIACION AGENTES DE ADUANA",
                         "TIMBRE AGENTES ADUANA", "LEY 7017"
  · TIMBRE_CONTADORES  → "TIMBRE CONTADORES PRIVADOS", "COLEGIO DE CONTADORES"

  FALLBACK:
  · OTRO               → cualquier costo que NO encaje arriba

REGLAS DURAS:
  1. CERO INVENTOS. Si una categoría no aparece en el documento, NO la incluyas.
  2. Para CADA línea devuelve, en la medida de lo posible, los DOS montos:
       · amount      = número en la moneda LOCAL del documento (NO convertir)
       · currency    = código ISO-4217 LOCAL detectado (CRC, USD, PEN, MXN, COP, …)
       · amount_usd  = el mismo valor expresado en USD si el documento lo trae
                       en una columna paralela ("Valor en Dólares" en el DUA CR);
                       si NO viene, omitir.
       · percent     = porcentaje aplicado si aparece (ej. 14.00 para DAI 14%);
                       si NO viene, omitir.
  3. Cada línea trae confidence (0..100) según la claridad del dato.
  4. Si ves múltiples líneas de la misma categoría (ej. dos almacenajes),
     listalas separadas con label distinto.
  5. label = texto corto humano EN ESPAÑOL tal como aparece en el documento.
     Ejemplos: "Derechos arancelarios a la importación", "IVA Ley 9635",
     "$3 PROCOMER", "Timbre archivo nacional", "Ley 6946".
  6. metadata.dua_number (ej. "005-2026-307232"), metadata.issued_date
     (YYYY-MM-DD) y metadata.country (ISO-2) se extraen si aparecen; si no,
     omitirlos.
  7. raw_text = transcripción literal del documento (max 3000 chars).
  8. summary.total_local  = total en moneda local del documento si aparece
                            (ej. "Total moneda nacional: 1,422,888.96").
     summary.total_amount_usd = suma de amount_usd de todas las líneas si
                            están disponibles; si no, omitir.
     summary.currency_seen = código ISO-4217 de la moneda local dominante.

Devuelve ÚNICAMENTE el JSON. Sin texto adicional, sin markdown, sin comentarios.
"""


# ── Re-clasificador de respaldo basado en el `label` ──────────────
# El modelo a veces devuelve kind="OTRO" para tributos CR pequeños
# (timbres, PROCOMER, Ley 6946) aunque el SYSTEM_PROMPT los menciona.
# Este post-proceso aplica una segunda capa de matching por palabras
# clave sobre el label/descripcion. Funciona como red de seguridad
# sin acoplarse a un modelo específico de OpenAI.
_LABEL_PATTERNS = (
    # (regex insensitive, kind canónico)
    (r"\bPROCOMER\b",                                            "PROCOMER"),
    (r"\bLEY\s*6946\b|SEGURIDAD\s+CIUDADANA",                   "LEY_6946"),
    (r"TIMBRE.*ARCHIVO\s+NACIONAL|ARCHIVO\s+NACIONAL",            "TIMBRE_ARCHIVO"),
    (r"TIMBRE.*AGENTE|AGENTES?\s+DE\s+ADUANA|LEY\s*7017",         "TIMBRE_AGENTES"),
    (r"TIMBRE.*CONTADOR|COLEGIO\s+DE\s+CONTADORES",                "TIMBRE_CONTADORES"),
    (r"\b(DAI|DERECHOS?\s+ARANCELARIOS?|IMPORT\s*DUTY)\b",       "DAI"),
    (r"\b(IVA|IGV|VAT|ITBIS|IMPUESTO\s+SOBRE\s+EL\s+VALOR|LEY\s*9635)\b", "IVA"),
    (r"\b(ALMACENAJE|BODEGAJE|DEP\.?\s*FISCAL)\b",               "ALMACENAJE"),
    (r"\b(AGENCIAMIENTO|HONORARIOS?\s+AGEN)",                     "AGENCIAMIENTO"),
    (r"\b(MANIPULEO|HANDLING|PALETIZ|FUMIG)",                      "MANIPULEO"),
    (r"\b(FLETE|FREIGHT)\b",                                       "FLETE"),
    (r"\b(SEGURO|INSURANCE)\b",                                    "SEGURO"),
    (r"\b(CONSOLIDACI[ÓO]N|LCL|LTL)\b",                            "CONSOLIDACION"),
)

import re as _re
_COMPILED_LABEL_PATTERNS = [(_re.compile(p, _re.IGNORECASE | _re.UNICODE), k)
                            for p, k in _LABEL_PATTERNS]


def _reclassify_kind(kind: str, label: str) -> str:
    """Si el kind es OTRO o desconocido, intenta deducirlo por el label.

    Si el modelo ya devolvió un kind válido distinto de OTRO, lo
    respetamos. Esto solo actúa como red de seguridad para los casos
    en que la IA fue conservadora.
    """
    if kind and kind != "OTRO":
        return kind
    if not label:
        return kind or "OTRO"
    for pattern, target_kind in _COMPILED_LABEL_PATTERNS:
        if pattern.search(label):
            return target_kind
    return kind or "OTRO"


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
    # Whitelist canónica (debe coincidir con transfers.cost_kind_cat).
    # Sprint 2026-05-25 · agregados los 5 tributos CR (PROCOMER,
    # LEY_6946, TIMBRE_*). Cualquier kind fuera de la lista cae a OTRO.
    _VALID_KINDS = (
        "DAI", "IVA", "ALMACENAJE", "AGENCIAMIENTO", "MANIPULEO",
        "FLETE", "SEGURO", "CONSOLIDACION",
        "PROCOMER", "LEY_6946",
        "TIMBRE_ARCHIVO", "TIMBRE_AGENTES", "TIMBRE_CONTADORES",
        "OTRO",
    )

    raw_lines = data.get("lines") or []

    # ── Pass 1: estimar FX implícito por moneda ───────────────────
    # El DUA CR trae las columnas "Valor en Dólares" y "Valor en MN"
    # paralelas: el modelo puede devolver amount_usd para los rubros
    # grandes (DAI, IVA) y dejar amount_usd=null para los pequeños
    # (timbres) porque la celda USD aparece como 0.00. Si NO derivamos
    # un FX único por moneda y lo propagamos, los timbres muestran
    # fx=1.0 → $20 USD en vez de $0.04 USD y el total se rompe.
    # Estrategia: tomamos el FX de las líneas con datos confiables
    # (amount_usd > 0 AND amount > 0) y lo usamos como FX dominante
    # por currency. Si hay varias, ganamos la del mayor monto local.
    fx_by_currency = {}      # {currency: fx_to_usd}
    best_anchor    = {}      # {currency: amount_local de la línea ancla}
    for line in raw_lines:
        try:
            ccy = str(line.get("currency") or "USD").upper()[:3]
            if ccy == "USD":
                continue
            amt = float(line.get("amount") or 0)
            au_raw = line.get("amount_usd")
            au = float(au_raw) if au_raw not in (None, "", 0, 0.0) else None
            if au is None or amt <= 0 or au <= 0:
                continue
            # Anclamos en la línea con mayor amount local de esa moneda
            if amt > best_anchor.get(ccy, 0):
                fx_by_currency[ccy] = round(au / amt, 6)
                best_anchor[ccy] = amt
        except (TypeError, ValueError):
            continue

    # ── Pass 2: armar la salida con FX propagado ──────────────────
    for line in raw_lines:
        try:
            kind = str(line.get("kind") or "OTRO").upper().replace(" ", "_")
            label = str(line.get("label") or "")
            # Reclasificación de respaldo: si la IA puso OTRO o un kind
            # desconocido pero el label matchea un patrón CR conocido,
            # lo promovemos al kind canónico (PROCOMER, TIMBRE_*, …).
            if kind not in _VALID_KINDS or kind == "OTRO":
                kind = _reclassify_kind(kind, label)
            if kind not in _VALID_KINDS:
                kind = "OTRO"
            amount = float(line.get("amount") or 0)
            currency = str(line.get("currency") or "USD").upper()[:3]
            confidence = float(line.get("confidence") or 80)

            amount_usd_raw = line.get("amount_usd")
            try:
                amount_usd = float(amount_usd_raw) if amount_usd_raw is not None else None
            except (TypeError, ValueError):
                amount_usd = None

            # FX en cascada:
            #   1) USD → 1.0
            #   2) la propia línea trae amount_usd > 0 → fx exacto
            #   3) hay otra línea de la misma moneda con FX detectado
            #      → usamos el FX ancla (caso típico: timbres CR)
            #   4) fallback 1.0 (warning implícito: total final saldrá mal,
            #      el CEO lo ajusta manualmente)
            if currency == "USD":
                fx_to_usd = 1.0
            elif amount_usd is not None and amount_usd > 0 and amount > 0:
                fx_to_usd = round(amount_usd / amount, 6)
            elif currency in fx_by_currency:
                fx_to_usd = fx_by_currency[currency]
                # Si no vino amount_usd, lo derivamos del FX ancla para
                # mantener la columna USD coherente en la UI.
                if amount_usd is None and amount > 0:
                    amount_usd = round(amount * fx_to_usd, 4)
            else:
                fx_to_usd = 1.0

            percent_raw = line.get("percent")
            try:
                percent = float(percent_raw) if percent_raw is not None else None
            except (TypeError, ValueError):
                percent = None

            out["lines"].append({
                "kind":       kind,
                "label":      str(line.get("label") or "")[:160],
                "amount":     round(amount, 2),
                "currency":   currency,
                "amount_usd": round(amount_usd, 2) if amount_usd is not None else None,
                "fx_to_usd":  fx_to_usd,
                "percent":    percent,
                "confidence": round(max(0.0, min(100.0, confidence)), 2),
            })
        except (TypeError, ValueError, KeyError):
            log.warning("[ocr_customs] skipping malformed line: %s", line)
            continue

    return out
