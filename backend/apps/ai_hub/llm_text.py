"""
apps.ai_hub · llm_text (helper compartido)
Llama a un LLM para texto plano con degradación en cascada:
  1) OpenAI (chat.completions) si hay OPENAI_API_KEY válida.
  2) Anthropic (Messages API por httpx directo; evita el desajuste del SDK).
Devuelve el texto o None si ningún proveedor responde.
"""
from __future__ import annotations

import logging
import os

from django.conf import settings

log = logging.getLogger(__name__)


def _ai_cfg():
    return getattr(settings, "AI_HUB", {}) or {}


def llm_text(system: str, user: str, *, max_tokens: int = 2000, temperature: float | None = None) -> str | None:
    ai = _ai_cfg()

    # 0) DeepSeek (OpenAI-compatible) — proveedor preferido
    dkey = os.environ.get("DEEPSEEK_API_KEY") or getattr(settings, "DEEPSEEK_API_KEY", "")
    if dkey:
        try:
            from openai import OpenAI
            ds = OpenAI(api_key=dkey,
                        base_url=os.environ.get("DEEPSEEK_BASE_URL") or getattr(settings, "DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
                        timeout=90, max_retries=1)
            kwargs = {"model": os.environ.get("DEEPSEEK_MODEL") or getattr(settings, "DEEPSEEK_MODEL", "deepseek-chat"),
                      "messages": [{"role": "system", "content": system},
                                   {"role": "user", "content": user}],
                      "max_tokens": max_tokens}
            if temperature is not None:
                kwargs["temperature"] = temperature
            resp = ds.chat.completions.create(**kwargs)
            out = (resp.choices[0].message.content or "").strip()
            if out:
                return out
        except Exception as exc:
            log.warning("[llm_text] deepseek fallo: %s", exc)

    # 1) OpenAI
    key = os.environ.get("OPENAI_API_KEY") or ai.get("OPENAI_API_KEY")
    if key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=key, timeout=90, max_retries=1)
            kwargs = {"model": os.environ.get("OPENAI_OCR_MODEL") or os.environ.get("OPENAI_PROFORMA_MODEL") or "gpt-4o-mini",
                      "messages": [{"role": "system", "content": system},
                                   {"role": "user", "content": user}],
                      "max_tokens": max_tokens}
            if temperature is not None:
                kwargs["temperature"] = temperature
            resp = client.chat.completions.create(**kwargs)
            out = (resp.choices[0].message.content or "").strip()
            if out:
                return out
        except Exception as exc:
            log.warning("[llm_text] openai fallo: %s", exc)

    # 2) Anthropic por HTTP directo
    akey = os.environ.get("ANTHROPIC_API_KEY") or ai.get("ANTHROPIC_API_KEY")
    if akey:
        try:
            import httpx
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": akey, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json={"model": ai.get("DEFAULT_MODEL") or "claude-sonnet-4-6",
                      "max_tokens": max_tokens, "system": system,
                      "messages": [{"role": "user", "content": user}]},
                timeout=90,
            )
            r.raise_for_status()
            data = r.json()
            parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
            out = "\n".join(parts).strip()
            if out:
                return out
        except Exception as exc:
            log.warning("[llm_text] anthropic fallo: %s", exc)
    return None
