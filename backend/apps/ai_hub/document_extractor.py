"""
apps.ai_hub.document_extractor
==============================

Sprint 2026-05-11 · Fase 7 — Extracción genérica de campos desde un
documento usando IA.

Caso de uso (CEO): en `ArtifactFillModal` el operador sube un PDF/Excel/
Word/txt y la IA llena automáticamente los campos del template del
Builder (label, tipo, opciones de select/radio). El operador revisa,
corrige y guarda.

Este módulo es **agnóstico al dominio** — recibe:
  - bytes del archivo + mime_type + filename
  - el `structure_json` del template del Builder (sections → columns →
    fields). Cada field tiene `id`, `type`, `label`, `options[]?`.

y devuelve un dict `{ field_id: value, ... }` con los valores que la IA
extrajo del documento. Si un campo no aparece en el documento, se omite
del dict (el FE mantiene el valor previo).

A diferencia de:
  · `apps.inventario.inbound_ocr` (hardcodeado a packing list/factura)
  · `apps.expedientes.document_matchmaker` (980 LoC, resuelve contra BD)
  · `apps.transfers.ocr_customs` (DAI/IVA/aduanal)

este extractor es **genérico** — el schema se pasa en tiempo de llamada,
no hardcodeado. Heredamos pricing/timeouts de AI_HUB settings.

Uso típico (desde una APIView):
    extracted = extract_fields_from_document(
        file_bytes=request.FILES["file"].read(),
        mime_type=request.FILES["file"].content_type,
        filename=request.FILES["file"].name,
        structure_json=payload["structure"],
    )
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
from typing import Any

from django.conf import settings


log = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────
# Helpers de configuración (reusa AI_HUB de settings.py)
# ────────────────────────────────────────────────────────────
def _cfg(key: str, default: Any = None) -> Any:
    return getattr(settings, "AI_HUB", {}).get(key, default)


# Modelo por defecto para extracción — Claude Sonnet 4.6 es fuerte en
# tareas de extracción estructurada con razonamiento sobre layouts.
EXTRACT_MODEL    = os.environ.get("AI_DOCEXTRACT_MODEL")  \
                   or _cfg("DEFAULT_MODEL", "claude-sonnet-4-6")
EXTRACT_TIMEOUT  = int(os.environ.get("AI_DOCEXTRACT_TIMEOUT", "90"))
EXTRACT_MAXTOK   = int(os.environ.get("AI_DOCEXTRACT_MAX_TOKENS",
                                       str(_cfg("MAX_TOKENS", 4096))))
ANTHROPIC_KEY    = (_cfg("ANTHROPIC_API_KEY")
                    or os.environ.get("ANTHROPIC_API_KEY", ""))


# ────────────────────────────────────────────────────────────
# Extractores de texto por tipo de archivo
# ────────────────────────────────────────────────────────────
def _extract_text_pdf(file_bytes: bytes) -> str:
    """Intenta extraer texto plano de un PDF text-native con pypdf.
    Si el PDF es solo imagen (escaneado), devuelve ''."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        chunks = []
        # Cap a 30 páginas — más allá explota el contexto.
        for i, page in enumerate(reader.pages):
            if i >= 30:
                chunks.append(f"\n[... truncado: {len(reader.pages) - 30} páginas más ...]")
                break
            try:
                chunks.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n".join(c for c in chunks if c.strip())
    except Exception as exc:
        log.warning("pypdf failed: %s", exc)
        return ""


def _extract_text_xlsx(file_bytes: bytes) -> str:
    """Extrae celdas de un xlsx/xlsm como TSV (una hoja por sección)."""
    try:
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
        out = []
        for sh in wb.worksheets:
            out.append(f"### Hoja: {sh.title}")
            for row in sh.iter_rows(values_only=True):
                line = "\t".join("" if v is None else str(v) for v in row).rstrip()
                if line:
                    out.append(line)
        return "\n".join(out)[:50000]  # cap defensive
    except Exception as exc:
        log.warning("openpyxl failed: %s", exc)
        return ""


def _extract_text_docx(file_bytes: bytes) -> str:
    """Word .docx → texto. Sin python-docx instalado, parseamos el XML
    interno del zip — los párrafos están en word/document.xml dentro
    de elementos <w:t>. Es defensivo: si falla, devuelve ''."""
    try:
        import zipfile
        import re
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
        # Concatena el contenido de los <w:t> (texto runs).
        parts = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml)
        return "\n".join(parts)[:50000]
    except Exception as exc:
        log.warning("docx parse failed: %s", exc)
        return ""


def _extract_text_plain(file_bytes: bytes) -> str:
    """Texto plano (txt/csv) — decodifica utf-8 best-effort."""
    try:
        return file_bytes.decode("utf-8", errors="ignore")[:50000]
    except Exception:
        return ""


def _to_text_payload(file_bytes: bytes, mime: str, filename: str) -> tuple[str, str]:
    """Devuelve (text_extracted, kind_label). Si el archivo es una imagen
    o un PDF escaneado, kind='image' y el texto será ''."""
    m = (mime or "").lower()
    name = (filename or "").lower()

    if m == "application/pdf" or name.endswith(".pdf"):
        text = _extract_text_pdf(file_bytes)
        # Si el PDF text-extracted es muy corto, probablemente es scan.
        return (text, "pdf-text" if len(text) > 100 else "pdf-image")
    if "spreadsheetml" in m or name.endswith((".xlsx", ".xlsm")):
        return (_extract_text_xlsx(file_bytes), "xlsx")
    if "wordprocessingml" in m or name.endswith(".docx"):
        return (_extract_text_docx(file_bytes), "docx")
    if m.startswith("text/") or name.endswith((".txt", ".csv", ".tsv")):
        return (_extract_text_plain(file_bytes), "plain")
    if m.startswith("image/") or name.endswith((".png", ".jpg", ".jpeg", ".webp")):
        return ("", "image")
    # Fallback: tratamos como texto.
    return (_extract_text_plain(file_bytes), "unknown")


# ────────────────────────────────────────────────────────────
# Construcción del prompt
# ────────────────────────────────────────────────────────────
def _flatten_fields(structure_json: dict) -> list[dict]:
    """Devuelve [{id, label, type, options, required, helpText}] de cada
    field del structure, en orden de aparición (sections → columns →
    fields)."""
    out = []
    for sec in (structure_json.get("sections") or []):
        for col in (sec.get("columns") or []):
            for f in (col.get("fields") or []):
                out.append({
                    "id":        f.get("id"),
                    "label":     f.get("label") or f.get("id"),
                    "type":      f.get("type") or "text",
                    "options":   f.get("options") or [],
                    "required":  bool(f.get("required")),
                    "helpText":  f.get("helpText") or "",
                })
    return out


def _build_schema_brief(fields: list[dict]) -> str:
    """Construye una descripción tipo-LLM del esquema que la IA debe llenar."""
    lines = ["FIELDS (id · type · label · valid options if applicable):"]
    for f in fields:
        opts = ""
        if f["type"] in ("select", "radio", "checkbox") and f["options"]:
            opt_labels = []
            for o in f["options"]:
                if isinstance(o, dict):
                    opt_labels.append(o.get("label") or o.get("id") or "")
                else:
                    opt_labels.append(str(o))
            opts = f"  · options=[{', '.join(repr(x) for x in opt_labels if x)}]"
        helptxt = f"  · hint={f['helpText'][:80]!r}" if f["helpText"] else ""
        req = " (required)" if f["required"] else ""
        lines.append(f"  - {f['id']} · {f['type']} · {f['label']!r}{req}{opts}{helptxt}")
    return "\n".join(lines)


SYSTEM_PROMPT = """You are an expert document data extractor for a B2B logistics platform.

Your task: read a document (PDF / Excel / Word / plain text) and fill out
the fields of a target form. The form schema includes the field id, type,
label and (for select/radio/checkbox) the list of valid option labels.

Rules:
1. Return a JSON object {extracted: {field_id: value, ...}, confidence: {field_id: 0-100, ...}, notes: "..."}.
2. Only include fields whose value you can support with evidence from the document. Omit unknown fields entirely.
3. For "select" and "radio" fields, the value must be one of the option labels exactly (case-insensitive match, return the canonical label).
4. For "checkbox" fields, return true or false.
5. For "number" / "date" fields, return the value in canonical form (numbers as JSON numbers; dates as ISO YYYY-MM-DD).
6. For "text" / "textarea" / "code" fields, return a plain string.
7. NEVER invent data. If unsure, omit the field.
8. confidence: integer 0-100 per field (your subjective confidence).
9. notes: optional short string (≤200 chars) explaining caveats.

Output STRICT JSON. No markdown, no commentary outside the JSON object."""


# ────────────────────────────────────────────────────────────
# Llamada al LLM (Anthropic)
# ────────────────────────────────────────────────────────────
def _call_anthropic(*, system: str, user_blocks: list[dict],
                    model: str, max_tokens: int) -> str:
    """Llama a la API de Anthropic. Devuelve el texto del primer bloque
    de respuesta. Lanza RuntimeError en caso de error."""
    if not ANTHROPIC_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY no está configurado")
    try:
        from anthropic import Anthropic
    except ImportError as exc:
        raise RuntimeError(f"anthropic SDK no disponible: {exc}")

    client = Anthropic(api_key=ANTHROPIC_KEY, timeout=EXTRACT_TIMEOUT)
    resp = client.messages.create(
        model       = model,
        max_tokens  = max_tokens,
        temperature = 0.0,
        system      = system,
        messages    = [{"role": "user", "content": user_blocks}],
    )
    # Concatenamos todos los bloques de texto.
    text_parts = []
    for blk in (resp.content or []):
        if getattr(blk, "type", None) == "text":
            text_parts.append(blk.text or "")
        elif isinstance(blk, dict) and blk.get("type") == "text":
            text_parts.append(blk.get("text", ""))
    return "".join(text_parts).strip()


def _parse_strict_json(raw: str) -> dict:
    """Parsea JSON. Si la respuesta viene con backticks o prefijo, los
    elimina antes."""
    s = raw.strip()
    if s.startswith("```"):
        # ```json … ``` o ``` … ```
        s = s.lstrip("`")
        # quitar prefijo "json\n" si quedó
        if s.lower().startswith("json"):
            s = s[4:].lstrip()
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
    # Si el modelo devolvió algo antes/después del JSON, intentamos
    # quedarnos sólo con el primer objeto.
    if not s.startswith("{"):
        i = s.find("{")
        if i >= 0:
            s = s[i:]
    if not s.endswith("}"):
        j = s.rfind("}")
        if j >= 0:
            s = s[:j + 1]
    return json.loads(s)


# ────────────────────────────────────────────────────────────
# API pública del módulo
# ────────────────────────────────────────────────────────────
def extract_fields_from_document(*,
                                 file_bytes: bytes,
                                 mime_type: str,
                                 filename: str,
                                 structure_json: dict,
                                 model: str | None = None,
                                 max_tokens: int | None = None) -> dict:
    """Punto de entrada único.

    Returns
    -------
    {
      "extracted":  {field_id: value, ...},   # valores autocompletados
      "confidence": {field_id: int, ...},     # 0-100 por field
      "notes":      str,
      "_meta": {
        "model": str,
        "kind":  "pdf-text"|"pdf-image"|"xlsx"|"docx"|"plain"|"image"|"unknown",
        "fields_in_schema": int,
        "fields_extracted": int,
      },
    }

    Si la llamada falla (sin API key, sin SDK, timeout, JSON inválido),
    devuelve `{"extracted": {}, "confidence": {}, "notes": "...", "_meta": {"error": "..."}}` —
    el FE muestra el error pero no rompe el modal.
    """
    fields = _flatten_fields(structure_json or {})
    if not fields:
        return {
            "extracted": {}, "confidence": {}, "notes": "structure_json vacío",
            "_meta": {"error": "no fields in schema"},
        }

    text_payload, kind = _to_text_payload(file_bytes, mime_type, filename)

    schema_brief = _build_schema_brief(fields)
    used_model   = model or EXTRACT_MODEL
    used_maxtok  = max_tokens or EXTRACT_MAXTOK

    # Construir bloques user. Para PDF text-extracted y otros formatos
    # con texto disponible, mandamos `text` puro (mucho más barato y
    # confiable que vision). Para imágenes / PDF escaneados, mandamos
    # un bloque `image` o `document` base64.
    user_blocks: list[dict] = []

    if kind in ("pdf-text", "xlsx", "docx", "plain", "unknown") and text_payload:
        user_blocks.append({"type": "text", "text":
            f"DOCUMENT (filename={filename!r}, kind={kind}):\n\n{text_payload}\n\n---\n{schema_brief}\n\n"
            "Return strict JSON as instructed."
        })
    elif kind == "pdf-image" or kind == "image" or not text_payload:
        # Anthropic acepta PDFs nativos como `document` block.
        b64 = base64.standard_b64encode(file_bytes).decode("ascii")
        if kind in ("pdf-image",) or (mime_type or "").lower() == "application/pdf":
            user_blocks.append({
                "type":   "document",
                "source": {
                    "type":       "base64",
                    "media_type": "application/pdf",
                    "data":       b64,
                },
            })
        else:
            media = mime_type or "image/png"
            user_blocks.append({
                "type":   "image",
                "source": {"type": "base64", "media_type": media, "data": b64},
            })
        user_blocks.append({"type": "text", "text":
            f"Document attached above (filename={filename!r}).\n\n{schema_brief}\n\n"
            "Return strict JSON as instructed."
        })
    else:
        # Defensa: si llegamos aquí, no hay nada que mandar.
        return {
            "extracted": {}, "confidence": {}, "notes": "archivo sin texto extraíble",
            "_meta": {"error": "empty payload", "kind": kind},
        }

    # Llamada al LLM
    try:
        raw = _call_anthropic(
            system     = SYSTEM_PROMPT,
            user_blocks= user_blocks,
            model      = used_model,
            max_tokens = used_maxtok,
        )
    except Exception as exc:
        log.exception("extract_fields_from_document · LLM call failed")
        return {
            "extracted": {}, "confidence": {}, "notes": "",
            "_meta": {"error": f"LLM error: {exc}", "kind": kind, "model": used_model},
        }

    try:
        data = _parse_strict_json(raw)
    except Exception as exc:
        log.warning("extract_fields_from_document · JSON parse failed: %s | raw=%r",
                    exc, raw[:200])
        return {
            "extracted": {}, "confidence": {}, "notes": "",
            "_meta": {"error": f"JSON parse failed: {exc}", "raw_preview": raw[:200]},
        }

    extracted  = data.get("extracted") or {}
    confidence = data.get("confidence") or {}
    notes      = data.get("notes") or ""

    # Normalización defensiva: solo dejamos field_ids que existen en el schema.
    valid_ids = {f["id"] for f in fields}
    extracted  = {k: v for k, v in extracted.items()  if k in valid_ids}
    confidence = {k: v for k, v in confidence.items() if k in valid_ids}

    return {
        "extracted":  extracted,
        "confidence": confidence,
        "notes":      str(notes)[:500],
        "_meta": {
            "model":             used_model,
            "kind":              kind,
            "fields_in_schema":  len(fields),
            "fields_extracted":  len(extracted),
        },
    }
