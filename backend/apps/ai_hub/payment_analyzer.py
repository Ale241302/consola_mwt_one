"""
=====================================================================
MWT.ONE · apps.ai_hub.payment_analyzer
Agente responsable: [AG-BACKEND]

AIPaymentAnalyzer · valida el comprobante de un Payment v2.0 con
Claude (Anthropic Messages API) usando el system prompt definido en
`apps/ai_hub/skills/SKILL_PAGOS_AI_ANALYZER.md`.

Flujo end-to-end (Fase 3):

    1. apps.finance.tasks.ai_analyzer_task lo invoca con un payment_id.
    2. Cargamos el comprobante desde MinIO (`apps.storage.get_object_stream`)
       y lo codificamos en base64 para mandarlo como bloque image/document
       en `messages.create()`.
    3. Construimos el JSON con los campos declarados por el usuario.
    4. Llamamos a Claude con el system prompt extraído del SKILL.md.
    5. Parseamos la respuesta esperando JSON estricto. Si el modelo
       envuelve en code fences ```json ... ```, los stripeamos.
    6. Devolvemos un AIVerdictResult tipado para que el caller persista
       en `finance.payment_ai_verdict` y transicione el estado del
       Payment.

Errores que NO crashean el task (van a verdict UNREADABLE):
  · API key vacía / DRY_RUN → verdict canned con error_code=DRY_RUN
  · MinIO no disponible    → error_code=EVIDENCE_UNAVAILABLE
  · JSON parse error        → error_code=PARSE_ERROR
  · Schema violation         → error_code=SCHEMA_ERROR
  · Anthropic 4xx no-retry   → error_code=ANTHROPIC_<class>

Errores que SÍ crashean (Celery los re-encola):
  · HTTP 429 / 5xx / timeouts después de agotar `max_retries` internos.
=====================================================================
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone as _tz
from pathlib import Path
from typing import Any, Dict, List, Optional

from django.conf import settings

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# Configuración (sobrescribible vía AI_HUB / env)
# ════════════════════════════════════════════════════════════
def _cfg(name: str, default=None):
    """Lee primero settings.AI_HUB[name], luego env, luego default."""
    pool = getattr(settings, "AI_HUB", {}) or {}
    if name in pool:
        return pool[name]
    return os.environ.get(name, default)


SKILL_PATH = Path(settings.BASE_DIR) / "apps" / "ai_hub" / "skills" / "SKILL_PAGOS_AI_ANALYZER.md"
SKILL_VERSION = "1.1"  # bump cuando cambie el schema del verdict
# Sprint 2026-05-26 (CEO) - migracion Claude -> OpenAI gpt-5-nano.
# DEFAULT_MODEL define el modelo "reportado" en model_version. El
# modelo real usado en analyze_bytes() se toma de
# OPENAI_PAYMENT_ANALYZER_MODEL (linea 414) y se devuelve en el dict.
DEFAULT_MODEL = (os.environ.get("OPENAI_PAYMENT_ANALYZER_MODEL")
                 or os.environ.get("FINANCE_AI_MODEL")
                 or _cfg("DEFAULT_MODEL")
                 or "gpt-5-nano")
MAX_TOKENS    = 2000
TEMPERATURE   = 0.0           # determinismo · estamos validando datos, no escribiendo prosa
MAX_RETRIES   = int(_cfg("MAX_RETRIES", 5))
RETRY_BASE_S  = float(_cfg("RETRY_BASE_SECONDS", 1.0))
RETRY_CAP_S   = float(_cfg("RETRY_CAP_SECONDS", 30.0))
BENEFICIARIOS = "MWT / Rana Walk / Muito Work / MWT SAS / MUITOWORK"


# ════════════════════════════════════════════════════════════
# Resultado del analyzer (lo persiste finance.tasks.ai_analyzer_task)
# ════════════════════════════════════════════════════════════
@dataclass
class AIVerdictResult:
    status: str                                          # MATCH / PARTIAL / MISMATCH / UNREADABLE / SUSPICIOUS
    confianza: float
    razon_humana: str
    monto_extraido: Optional[str]              = None
    moneda_extraida: Optional[str]             = None
    fecha_extraida: Optional[str]              = None    # ISO YYYY-MM-DD
    referencia_extraida: Optional[str]         = None
    beneficiario_extraido: Optional[str]       = None
    ordenante_extraido: Optional[str]          = None
    banco_emisor: Optional[str]                = None
    banco_receptor: Optional[str]              = None
    concepto: str                              = ""
    mismatch_fields: List[str]                 = field(default_factory=list)
    alertas_fraude: List[str]                  = field(default_factory=list)
    raw_claude_response: Dict[str, Any]        = field(default_factory=dict)
    model_version: str                         = DEFAULT_MODEL
    skill_version: str                         = SKILL_VERSION
    duration_ms: Optional[int]                 = None
    tokens_input: Optional[int]                = None
    tokens_output: Optional[int]               = None
    cost_usd: Optional[float]                  = None
    error_code: Optional[str]                  = None
    error_message: Optional[str]               = None

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ════════════════════════════════════════════════════════════
# AIPaymentAnalyzer
# ════════════════════════════════════════════════════════════
class AIPaymentAnalyzer:
    """Carga el SKILL una sola vez por proceso (clase atributo)."""

    _system_prompt_cache: Optional[str] = None

    # ── System prompt extraction ─────────────────────────────
    @classmethod
    def system_prompt(cls) -> str:
        if cls._system_prompt_cache is not None:
            return cls._system_prompt_cache
        if not SKILL_PATH.exists():
            raise RuntimeError(
                f"SKILL no encontrado en {SKILL_PATH}. "
                f"Asegúrate que apps/ai_hub/skills/SKILL_PAGOS_AI_ANALYZER.md está commiteado."
            )
        content = SKILL_PATH.read_text(encoding="utf-8")
        # Extraemos el bloque blockquote dentro de "## 1. SYSTEM PROMPT".
        # Aceptamos tanto "## 1. SYSTEM PROMPT" como "## 1. SYSTEM PROMPT (..."
        match = re.search(
            r"##\s*1\.\s*SYSTEM\s*PROMPT[^\n]*\n+((?:>.*\n?)+)",
            content,
            flags=re.IGNORECASE,
        )
        if not match:
            # Fallback: si el formato cambia, mandamos el SKILL completo
            log.warning("SKILL: no se encontró blockquote de system prompt; uso archivo completo")
            cls._system_prompt_cache = content
            return cls._system_prompt_cache

        # Limpia los `> ` del blockquote (mantiene líneas vacías como `>`)
        lines = []
        for line in match.group(1).splitlines():
            if line.startswith("> "):
                lines.append(line[2:])
            elif line.startswith(">"):
                lines.append(line[1:])
            else:
                lines.append(line)
        cls._system_prompt_cache = "\n".join(lines).strip()
        return cls._system_prompt_cache

    # ── Public entry point ───────────────────────────────────
    def analyze(self, payment, evidence) -> AIVerdictResult:
        """
        Args:
            payment   → instancia finance.models.Payment
            evidence  → instancia finance.models.PaymentEvidence

        El task de Celery los pasa hidratados desde la DB. Si por
        alguna razón no hay evidencia, devolvemos verdict UNREADABLE
        en lugar de crashear.
        """
        t0 = time.time()
        if not evidence:
            return self._verdict_error(
                error_code="EVIDENCE_MISSING",
                msg="No se encontró el comprobante asociado al pago.",
                duration_ms=int((time.time() - t0) * 1000),
            )

        # 1. Cargar el binario desde MinIO
        try:
            file_bytes, mime = self._load_evidence_bytes(evidence)
        except Exception as e:
            log.exception("AIPaymentAnalyzer · load evidence failed: %s", e)
            return self._verdict_error(
                error_code="EVIDENCE_UNAVAILABLE",
                msg=f"No se pudo descargar el comprobante: {type(e).__name__}",
                duration_ms=int((time.time() - t0) * 1000),
            )

        # 2. Construir el message
        attachment_block = self._build_attachment_block(file_bytes, mime)
        declared_block   = self._build_declared_block(payment)

        # 3. Cliente Anthropic (manejo idéntico al de ai_hub.services)
        api_key = _cfg("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key or _cfg("DRY_RUN", False):
            return self._verdict_dry_run(
                payment, duration_ms=int((time.time() - t0) * 1000)
            )

        try:
            import anthropic  # type: ignore
        except ImportError as e:
            log.error("anthropic SDK no disponible: %s", e)
            return self._verdict_dry_run(
                payment, duration_ms=int((time.time() - t0) * 1000)
            )

        # Sprint 2026-05-26 - el SDK viejo de anthropic pasa
        # kwargs 'proxies' al constructor de httpx.Client, y
        # httpx>=0.28 los removio causando TypeError. Pasamos un
        # http_client explicito sin proxies para bypassear esa ruta.
        try:
            import httpx
            _http = httpx.Client(timeout=60.0)
            client = anthropic.Anthropic(api_key=api_key, http_client=_http)
        except Exception as exc_init:
            log.warning("[payment_analyzer] httpx custom fallo (%s); fallback default", exc_init)
            client = anthropic.Anthropic(api_key=api_key)

        # 4. Llamada con retry/backoff
        text, tokens_in, tokens_out, err_code, err_msg = self._call_with_retry(
            client,
            system   = self.system_prompt(),
            messages = [{
                "role": "user",
                "content": [attachment_block, declared_block],
            }],
        )

        duration_ms = int((time.time() - t0) * 1000)

        if err_code:
            return self._verdict_error(
                error_code=err_code, msg=err_msg or "",
                duration_ms=duration_ms,
                tokens_input=tokens_in, tokens_output=tokens_out,
            )

        # 5. Parse JSON estricto
        try:
            parsed = self._parse_verdict_json(text)
        except ValueError as e:
            log.error("AIPaymentAnalyzer · parse error: %s | text=%r", e, text[:300])
            return self._verdict_error(
                error_code="PARSE_ERROR",
                msg=f"Respuesta no parseable como JSON: {e}",
                duration_ms=duration_ms,
                tokens_input=tokens_in, tokens_output=tokens_out,
                raw={"text": text[:5000]},
            )

        # 6. Validar campos mínimos del schema
        try:
            self._validate_schema(parsed)
        except ValueError as e:
            return self._verdict_error(
                error_code="SCHEMA_ERROR", msg=str(e),
                duration_ms=duration_ms,
                tokens_input=tokens_in, tokens_output=tokens_out,
                raw=parsed,
            )

        return AIVerdictResult(
            status                = parsed["status"],
            confianza             = float(parsed["confianza"]),
            razon_humana          = parsed.get("razon_humana") or "",
            monto_extraido        = self._stringify(parsed.get("monto_extraido")),
            moneda_extraida       = parsed.get("moneda_extraida") or None,
            fecha_extraida        = parsed.get("fecha_extraida") or None,
            referencia_extraida   = parsed.get("referencia_extraida") or None,
            beneficiario_extraido = parsed.get("beneficiario_extraido") or None,
            ordenante_extraido    = parsed.get("ordenante_extraido") or None,
            banco_emisor          = parsed.get("banco_emisor") or None,
            banco_receptor        = parsed.get("banco_receptor") or None,
            concepto              = parsed.get("concepto") or "",
            mismatch_fields       = list(parsed.get("mismatch_fields") or []),
            alertas_fraude        = list(parsed.get("alertas_fraude") or []),
            raw_claude_response   = parsed,
            model_version         = DEFAULT_MODEL,
            skill_version         = SKILL_VERSION,
            duration_ms           = duration_ms,
            tokens_input          = tokens_in,
            tokens_output         = tokens_out,
            cost_usd              = self._estimate_cost(tokens_in, tokens_out),
        )


    @staticmethod
    def analyze_bytes(
        file_bytes: bytes,
        mime: str,
        declared: "dict | None" = None,
    ) -> "dict":
        """Analiza un comprobante SIN persistir Payment ni Verdict.

        Útil como endpoint de pre-análisis antes de crear el Payment
        (wizard paso 1: el usuario sube el comprobante y el sistema
        intenta auto-rellenar monto/fecha/referencia).

        Args:
            file_bytes: bytes crudos del PDF o imagen.
            mime:       MIME type — debe ser uno de EVIDENCE_ALLOWED_MIMES.
            declared:   dict opcional con campos que el usuario ya declaró
                        para que la IA los compare.
                        Ejemplo: {"monto": "3407.40", "moneda": "USD",
                                  "fecha": "2026-05-26",
                                  "referencia": "714226364",
                                  "metodo": "TRANSFERENCIA_BANCARIA"}

        Returns:
            dict con shape:
            {
              "status":              "MATCH"|"PARTIAL"|"MISMATCH"|"UNREADABLE"|"SUSPICIOUS",
              "confianza":           0..100,
              "monto_extraido":      float|null,
              "moneda_extraida":     str|null,
              "fecha_extraida":      "YYYY-MM-DD"|null,
              "referencia_extraida": str|null,
              "beneficiario_extraido": str|null,
              "ordenante_extraido":  str|null,
              "banco_emisor":        str|null,
              "banco_receptor":      str|null,
              "concepto":            str|null,
              "metodo_sugerido":     "TRANSFERENCIA_BANCARIA"|"NOTA_CREDITO"|null,
              "razon_humana":        str,
              "alertas_fraude":      [],
              "mismatch_fields":     [],
              "duration_ms":         int,
              "model_version":       str,
              "error_code":          str|null,
              "error_message":       str|null
            }

        Nunca lanza excepciones: ante cualquier error devuelve un dict
        con status=UNREADABLE y los campos de error poblados.
        """
        import time as _time

        t0 = _time.time()
        instance = AIPaymentAnalyzer()

        # Sprint 2026-05-26 (CEO) - reporta el modelo objetivo real,
        # no el DEFAULT_MODEL del modulo (puede estar contaminado por
        # FINANCE_AI_MODEL legacy con valor de Claude).
        _target_model = (os.environ.get("OPENAI_PAYMENT_ANALYZER_MODEL")
                         or "gpt-5-nano")

        def _err_dict(code: str, msg: str) -> dict:
            return {
                "status":               "UNREADABLE",
                "confianza":            0,
                "monto_extraido":       None,
                "moneda_extraida":      None,
                "fecha_extraida":       None,
                "referencia_extraida":  None,
                "beneficiario_extraido": None,
                "ordenante_extraido":   None,
                "banco_emisor":         None,
                "banco_receptor":       None,
                "concepto":             None,
                "metodo_sugerido":      None,
                "razon_humana": (
                    f"No se pudo analizar el comprobante ({code}). "
                    f"Verifica el archivo e intenta de nuevo."
                ),
                "alertas_fraude":  [],
                "mismatch_fields": [],
                "duration_ms":     int((_time.time() - t0) * 1000),
                "model_version":   _target_model,
                "skill_version":   SKILL_VERSION,
                "error_code":      code,
                "error_message":   msg[:1000] if msg else "",
            }

        # ── 1. Construir attachment block ─────────────────────────
        try:
            attachment_block = instance._build_attachment_block(file_bytes, mime)
        except Exception as exc:  # noqa: BLE001
            return _err_dict("BUILD_ATTACHMENT_ERROR", str(exc))

        # ── 2. Construir declared block (dict-based, no Payment ORM) ─
        declared_block = None
        if declared:
            declared_payload = {
                "monto_declarado":      str(declared.get("monto") or ""),
                "moneda":               declared.get("moneda") or "",
                "fecha_declarada":      declared.get("fecha") or "",
                "referencia_declarada": declared.get("referencia") or "",
                "metodo":               declared.get("metodo") or "",
                "beneficiario_esperado": BENEFICIARIOS,
            }
            declared_block = {
                "type": "text",
                "text": json.dumps(declared_payload, ensure_ascii=False),
            }
        else:
            # Sin datos declarados: pedimos sólo extracción cruda
            declared_block = {
                "type": "text",
                "text": json.dumps({
                    "instruccion": "Extrae toda la información del comprobante sin comparar.",
                    "beneficiario_esperado": BENEFICIARIOS,
                }, ensure_ascii=False),
            }

        # ── 3. Cliente OpenAI (gpt-5-nano, mismo patron que ocr_customs)
        # Sprint 2026-05-26 (CEO) - migracion Anthropic -> OpenAI.
        # El skill PAGOS_AI_ANALYZER ahora corre en gpt-5-nano via
        # Responses API (mismo modelo y client que ocr_customs.py).
        api_key = (_cfg("OPENAI_API_KEY")
                   or os.environ.get("OPENAI_API_KEY")
                   or _cfg("ANTHROPIC_API_KEY")  # legacy compat
                   or os.environ.get("ANTHROPIC_API_KEY"))
        if not api_key or _cfg("DRY_RUN", False):
            return _err_dict("DRY_RUN", "OPENAI_API_KEY no configurada.")

        try:
            from openai import OpenAI
        except ImportError as e:
            return _err_dict("SDK_MISSING", f"openai SDK no instalado: {e}")

        try:
            system_prompt = instance.system_prompt()
        except Exception as exc:  # noqa: BLE001
            return _err_dict("SKILL_LOAD_ERROR", str(exc))

        model_name = os.environ.get("OPENAI_PAYMENT_ANALYZER_MODEL", "gpt-5-nano")
        client = OpenAI(api_key=api_key, timeout=60.0)

        # Sprint 2026-05-26 (CEO) - replicamos el patron de
        # document_matchmaker.py upload-match que funciona en
        # produccion para PDFs OC/proformas:
        #   1. Si es PDF: extraer texto con pypdf y mandarlo como
        #      string a chat.completions (5-10s, robusto).
        #   2. Si es imagen: mandar como image_url a vision.
        #   3. Si pypdf no extrae nada (PDF escaneado/OCR-only):
        #      fallback a convertir con PyMuPDF a PNG y vision.
        # Esto evita el bug "Invalid MIME type" que ocurre al
        # mandar PDF como image_url, y Responses API que no esta
        # bien soportada en el SDK del container.
        text = None
        tokens_in = 0
        tokens_out = 0
        err_code = None
        err_msg = None
        text_payload = None  # texto extraido del PDF si pypdf funciona
        try:
            import base64 as _b64
            user_text = declared_block.get("text", "") if isinstance(declared_block, dict) else ""
            is_image_mime = (mime or "").startswith("image/")
            is_pdf = (mime == "application/pdf") or (
                isinstance(mime, str) and mime.lower().endswith("pdf")
            )

            # ─── PDF: extraer texto con pypdf ────────────────────
            if is_pdf:
                try:
                    from pypdf import PdfReader
                    import io as _io
                    reader = PdfReader(_io.BytesIO(file_bytes))
                    pages = []
                    for page in reader.pages:
                        t = (page.extract_text() or "").strip()
                        if t:
                            pages.append(t)
                    if pages:
                        text_payload = "\n\n--- PAGE BREAK ---\n\n".join(pages)[:18000]
                        log.info(
                            "[payment_analyzer] pypdf extrajo %d paginas (%d chars)",
                            len(pages), len(text_payload),
                        )
                except Exception as exc_pdf_text:
                    log.warning(
                        "[payment_analyzer] pypdf extraccion fallo: %s; intentare vision",
                        exc_pdf_text,
                    )

            # ─── Construir el llamado ────────────────────────────
            try:
                if text_payload is not None:
                    # Path TEXT - chat.completions con string puro
                    chat = client.chat.completions.create(
                        model    = model_name,
                        messages = [
                            {"role": "system", "content": system_prompt},
                            {"role": "user",   "content":
                                user_text + "\n\n"
                                "Analiza el siguiente comprobante de pago y "
                                "devuelve solo JSON segun el schema:\n\n"
                                + text_payload},
                        ],
                        response_format = {"type": "json_object"},
                    )
                    text = chat.choices[0].message.content
                    try:
                        tokens_in  = int(chat.usage.prompt_tokens or 0)
                        tokens_out = int(chat.usage.completion_tokens or 0)
                    except Exception:
                        pass
                elif is_image_mime:
                    # Path VISION (imagen) - chat.completions con image_url
                    b64 = _b64.b64encode(file_bytes).decode("ascii")
                    data_url = f"data:{mime};base64,{b64}"
                    chat = client.chat.completions.create(
                        model    = model_name,
                        messages = [
                            {"role": "system", "content": system_prompt},
                            {"role": "user",   "content": [
                                {"type": "text",      "text": user_text},
                                {"type": "image_url", "image_url": {"url": data_url}},
                            ]},
                        ],
                        response_format = {"type": "json_object"},
                    )
                    text = chat.choices[0].message.content
                    try:
                        tokens_in  = int(chat.usage.prompt_tokens or 0)
                        tokens_out = int(chat.usage.completion_tokens or 0)
                    except Exception:
                        pass
                else:
                    # Path VISION fallback (PDF escaneado): pypdf no
                    # extrajo nada -> convertir pagina 1 a PNG con
                    # PyMuPDF y mandar como image.
                    try:
                        import fitz
                        pdf_doc = fitz.open(stream=file_bytes, filetype="pdf")
                        if pdf_doc.page_count == 0:
                            raise RuntimeError("PDF sin paginas")
                        page = pdf_doc.load_page(0)
                        mat = fitz.Matrix(2.0, 2.0)
                        pix = page.get_pixmap(matrix=mat, alpha=False)
                        png_bytes = pix.tobytes("png")
                        pdf_doc.close()
                        log.info(
                            "[payment_analyzer] PDF->PNG fallback ok (%d bytes png)",
                            len(png_bytes),
                        )
                        b64 = _b64.b64encode(png_bytes).decode("ascii")
                        data_url = f"data:image/png;base64,{b64}"
                        chat = client.chat.completions.create(
                            model    = model_name,
                            messages = [
                                {"role": "system", "content": system_prompt},
                                {"role": "user",   "content": [
                                    {"type": "text",      "text": user_text},
                                    {"type": "image_url", "image_url": {"url": data_url}},
                                ]},
                            ],
                            response_format = {"type": "json_object"},
                        )
                        text = chat.choices[0].message.content
                        try:
                            tokens_in  = int(chat.usage.prompt_tokens or 0)
                            tokens_out = int(chat.usage.completion_tokens or 0)
                        except Exception:
                            pass
                    except Exception as exc_conv:
                        err_code = f"PDF_CONVERT_{type(exc_conv).__name__}"
                        err_msg  = (f"PDF no pudo extraerse con pypdf ni "
                                    f"convertirse a imagen: {exc_conv}")
            except Exception as exc_chat:
                err_code = f"OPENAI_{type(exc_chat).__name__}"
                err_msg  = str(exc_chat)
        except Exception as exc_outer:  # noqa: BLE001
            err_code = f"OPENAI_{type(exc_outer).__name__}"
            err_msg  = str(exc_outer)
            text = None

        duration_ms = int((_time.time() - t0) * 1000)

        if err_code:
            result = _err_dict(err_code, err_msg or "")
            result["duration_ms"] = duration_ms
            return result

        # ── 5. Parse JSON ─────────────────────────────────────────
        try:
            parsed = instance._parse_verdict_json(text)
        except ValueError as exc:
            result = _err_dict("PARSE_ERROR", str(exc))
            result["duration_ms"] = duration_ms
            return result

        # ── 6. Validar schema mínimo ──────────────────────────────
        try:
            instance._validate_schema(parsed)
        except ValueError as exc:
            result = _err_dict("SCHEMA_ERROR", str(exc))
            result["duration_ms"] = duration_ms
            return result

        # ── 7. Inferir metodo_sugerido desde los datos extraídos ─
        metodo_sugerido = None
        raw_metodo = str(parsed.get("metodo_extraido") or "").upper()
        if "NOTA" in raw_metodo or "CREDIT" in raw_metodo:
            metodo_sugerido = "NOTA_CREDITO"
        elif raw_metodo or parsed.get("banco_emisor"):
            metodo_sugerido = "TRANSFERENCIA_BANCARIA"

        # ── 8. Normalizar monto_extraido a float|null ─────────────
        monto_raw = parsed.get("monto_extraido")
        monto_float = None
        if monto_raw is not None:
            try:
                monto_float = float(str(monto_raw).replace(",", "").strip())
            except (ValueError, TypeError):
                monto_float = None

        return {
            "status":               parsed.get("status", "UNREADABLE"),
            "confianza":            float(parsed.get("confianza", 0)),
            "monto_extraido":       monto_float,
            "moneda_extraida":      parsed.get("moneda_extraida") or None,
            "fecha_extraida":       parsed.get("fecha_extraida") or None,
            "referencia_extraida":  parsed.get("referencia_extraida") or None,
            "beneficiario_extraido": parsed.get("beneficiario_extraido") or None,
            "ordenante_extraido":   parsed.get("ordenante_extraido") or None,
            "banco_emisor":         parsed.get("banco_emisor") or None,
            "banco_receptor":       parsed.get("banco_receptor") or None,
            "concepto":             parsed.get("concepto") or None,
            "metodo_sugerido":      metodo_sugerido,
            "razon_humana":         parsed.get("razon_humana") or "",
            "alertas_fraude":       list(parsed.get("alertas_fraude") or []),
            "mismatch_fields":      list(parsed.get("mismatch_fields") or []),
            "duration_ms":          duration_ms,
            # Sprint 2026-05-26 (CEO) - reportar modelo REAL usado, no
            # el DEFAULT_MODEL del modulo (que podia venir cacheado del
            # legacy FINANCE_AI_MODEL=claude-... en el env del VPS).
            "model_version":        model_name,
            "skill_version":        SKILL_VERSION,
            "error_code":           None,
            "error_message":        None,
        }


    # ════════════════════════════════════════════════════════
    # Helpers privados
    # ════════════════════════════════════════════════════════
    def _load_evidence_bytes(self, evidence) -> tuple[bytes, str]:
        """Devuelve (bytes, mime) desde MinIO."""
        from apps.storage.services import get_object_stream
        resp = get_object_stream(evidence.object_key, bucket=evidence.bucket)
        if resp is None:
            raise RuntimeError("MinIO no disponible")
        try:
            buf = io.BytesIO()
            for chunk in resp.stream(64 * 1024):
                buf.write(chunk)
            return buf.getvalue(), evidence.mime_type or "application/octet-stream"
        finally:
            try:
                resp.close()
                resp.release_conn()
            except Exception:
                pass

    def _build_attachment_block(self, file_bytes: bytes, mime: str) -> Dict[str, Any]:
        b64 = base64.b64encode(file_bytes).decode("utf-8")
        if mime == "application/pdf":
            return {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": b64,
                },
            }
        # imagen
        media = mime if mime in {"image/png", "image/jpeg", "image/webp"} else "image/png"
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media,
                "data": b64,
            },
        }

    def _build_declared_block(self, payment) -> Dict[str, Any]:
        declared = {
            "monto_declarado":     str(payment.monto),
            "moneda":              payment.moneda,
            "fecha_declarada":     payment.fecha.isoformat() if payment.fecha else None,
            "referencia_declarada": payment.referencia,
            "metodo":              payment.metodo,
            "beneficiario_esperado": BENEFICIARIOS,
        }
        return {
            "type": "text",
            "text": json.dumps(declared, ensure_ascii=False),
        }

    def _call_with_retry(self, client, *, system: str, messages: list[dict]):
        """Devuelve (text, tokens_in, tokens_out, error_code, error_msg)."""
        last_err_code = None
        last_err_msg  = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = client.messages.create(
                    model       = DEFAULT_MODEL,
                    max_tokens  = MAX_TOKENS,
                    temperature = TEMPERATURE,
                    system      = system,
                    messages    = messages,
                )
                # Extracción de texto (puede haber múltiples bloques)
                text = ""
                for block in (resp.content or []):
                    if getattr(block, "type", None) == "text":
                        text += getattr(block, "text", "") or ""

                usage = getattr(resp, "usage", None)
                tokens_in  = getattr(usage, "input_tokens",  None) if usage else None
                tokens_out = getattr(usage, "output_tokens", None) if usage else None
                return text, tokens_in, tokens_out, None, None
            except Exception as e:
                code = e.__class__.__name__
                msg  = str(e)[:500]
                last_err_code = f"ANTHROPIC_{code}"
                last_err_msg  = msg
                # Errores no-retryables (4xx semánticos): no insistir
                if any(x in code for x in (
                    "BadRequestError", "AuthenticationError", "PermissionDeniedError",
                    "NotFoundError", "UnprocessableEntityError",
                )):
                    log.error("AIPaymentAnalyzer · non-retryable %s: %s", code, msg)
                    break
                # Retryable: backoff exponencial con jitter
                if attempt < MAX_RETRIES:
                    delay = min(RETRY_BASE_S * (2 ** attempt), RETRY_CAP_S)
                    log.warning("AIPaymentAnalyzer · retry %d/%d after %s (%.2fs)",
                                attempt + 1, MAX_RETRIES, code, delay)
                    time.sleep(delay)
                    continue
                log.error("AIPaymentAnalyzer · agotó retries: %s", code)
        return "", None, None, last_err_code or "UNKNOWN", last_err_msg or "unknown"

    def _parse_verdict_json(self, text: str) -> Dict[str, Any]:
        """Parsea texto del modelo a dict. Defensivo contra code fences."""
        if not text or not text.strip():
            raise ValueError("respuesta vacía")
        s = text.strip()
        # Strip ```json ... ``` o ``` ... ```
        if s.startswith("```"):
            # toma el contenido entre los primeros y últimos triple-backticks
            parts = s.split("```")
            if len(parts) >= 3:
                inner = parts[1]
                if inner.lstrip().lower().startswith("json"):
                    inner = inner.split("\n", 1)[1] if "\n" in inner else ""
                s = inner.strip()
        # A veces el modelo devuelve un objeto envuelto en texto previo;
        # buscamos la primera "{" y el último "}" emparejados.
        first = s.find("{")
        last  = s.rfind("}")
        if first == -1 or last == -1 or last <= first:
            raise ValueError("no se encontró objeto JSON")
        candidate = s[first:last + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON inválido: {e}")

    def _validate_schema(self, obj: Dict[str, Any]) -> None:
        if not isinstance(obj, dict):
            raise ValueError("respuesta no es objeto")
        status = obj.get("status")
        if status not in {"MATCH", "PARTIAL", "MISMATCH", "UNREADABLE", "SUSPICIOUS"}:
            raise ValueError(f"status inválido: {status!r}")
        try:
            confianza = float(obj.get("confianza"))
        except (TypeError, ValueError):
            raise ValueError("confianza no es numérico")
        if not (0 <= confianza <= 100):
            raise ValueError(f"confianza fuera de [0,100]: {confianza}")
        if not isinstance(obj.get("razon_humana", ""), str):
            raise ValueError("razon_humana no es string")

    def _stringify(self, v) -> Optional[str]:
        if v is None:
            return None
        s = str(v).strip()
        return s or None

    def _estimate_cost(self, tokens_in: Optional[int],
                       tokens_out: Optional[int]) -> Optional[float]:
        """
        Pricing aproximado de claude-opus-4 (USD por 1M tokens):
            input  ≈ $15.00
            output ≈ $75.00
        Si los tokens son None, devolvemos None.
        """
        if tokens_in is None or tokens_out is None:
            return None
        return round(tokens_in * 15 / 1_000_000 + tokens_out * 75 / 1_000_000, 6)

    # ── Verdicts canónicos para fallos / dry-run ─────────────
    def _verdict_error(
        self, *,
        error_code: str,
        msg: str,
        duration_ms: Optional[int] = None,
        tokens_input: Optional[int] = None,
        tokens_output: Optional[int] = None,
        raw: Optional[Dict[str, Any]] = None,
    ) -> AIVerdictResult:
        # Cuando el analyzer no puede emitir un verdict real, devolvemos
        # UNREADABLE confianza 0 — el caller transiciona a NEEDS_REVIEW.
        return AIVerdictResult(
            status              = "UNREADABLE",
            confianza           = 0.0,
            razon_humana        = (
                f"No se pudo analizar el comprobante automáticamente "
                f"({error_code}). Requiere revisión humana."
            ),
            mismatch_fields     = [],
            alertas_fraude      = [],
            raw_claude_response = raw or {"error": error_code, "message": msg},
            model_version       = DEFAULT_MODEL,
            skill_version       = SKILL_VERSION,
            duration_ms         = duration_ms,
            tokens_input        = tokens_input,
            tokens_output       = tokens_output,
            error_code          = error_code,
            error_message       = msg[:1000],
        )

    def _verdict_dry_run(self, payment, *, duration_ms: int) -> AIVerdictResult:
        """
        Dry-run determinístico para entornos sin ANTHROPIC_API_KEY:
        marca como NEEDS_REVIEW para que la cadena downstream se siga
        ejecutando sin riesgo de auto-confirmar pagos sin verificar.
        """
        return AIVerdictResult(
            status              = "UNREADABLE",
            confianza           = 0.0,
            razon_humana        = (
                "DRY_RUN: ANTHROPIC_API_KEY no configurada. "
                "Pago marcado para revisión humana sin análisis IA."
            ),
            raw_claude_response = {"dry_run": True, "model": DEFAULT_MODEL},
            model_version       = DEFAULT_MODEL,
            skill_version       = SKILL_VERSION,
            duration_ms         = duration_ms,
            error_code          = "DRY_RUN",
            error_message       = "ANTHROPIC_API_KEY vacía o DRY_RUN=True",
        )
