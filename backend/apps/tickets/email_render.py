"""
=====================================================================
MWT.ONE · apps.tickets.email_render
Agente responsable: [AG-02 · AG-BACKEND]

Render Jinja2 + envio SMTP a partir de email_templates.template.
Si el template no existe en BD usa fallback hardcoded (degradacion
defensiva: el sistema sigue mandando aunque el seed haya fallado).
=====================================================================
"""
from __future__ import annotations

import logging
from typing import Optional, Dict, Any

from django.conf import settings
from django.db import connection

from apps.storage.services import send_test_email

log = logging.getLogger(__name__)


# Fallbacks duros (mismo HTML que el seed B4_tickets.sql, version compacta).
_FALLBACK = {
    "ticket_admin_alert": {
        "subject": "[Tickets MWT] Nuevo ticket #{{ ticket_id_short }} - {{ reason_label }}",
        "body":    """<p><strong>Nuevo ticket #{{ ticket_id_short }}</strong></p>
<p>Usuario: {{ user_full_name }} ({{ user_email }})</p>
<p>Motivo: {{ reason_label }}</p>
<p>Vista: {{ context_url }}</p>
<p>Mensaje:</p><pre>{{ description }}</pre>""",
    },
    "ticket_user_confirmation": {
        "subject": "Hemos recibido tu ticket #{{ ticket_id_short }}",
        "body":    """<p>Hola {{ user_full_name }},</p>
<p>Recibimos tu ticket <strong>#{{ ticket_id_short }}</strong> y nuestro equipo lo esta revisando.</p>
<p>Motivo: {{ reason_label }}</p>
<pre>{{ description }}</pre>""",
    },
}


def _load_template(template_key: str) -> Dict[str, str]:
    """Lee subject/body de email_templates.template (PUBLISHED + activo).
    Cae al fallback in-memory si no esta seedeado."""
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT subject_template, body_template
                FROM email_templates.template
                WHERE template_key = %s
                  AND is_active = TRUE
                  AND status IN ('PUBLISHED','DRAFT')
                ORDER BY status DESC
                LIMIT 1
                """,
                [template_key],
            )
            row = c.fetchone()
            if row:
                return {"subject": row[0], "body": row[1]}
    except Exception as e:
        log.warning("ticket email: fallo al leer template %s (%s)", template_key, e)
    fb = _FALLBACK.get(template_key)
    if not fb:
        return {"subject": "(sin asunto)", "body": ""}
    return dict(fb)


def render_and_send(
    *,
    template_key: str,
    to: str,
    payload: Dict[str, Any],
    reply_to: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Renderiza un template Jinja2 con `payload` y lo envia por SMTP.
    Devuelve dict {ok, error, to, subject}. Nunca lanza.
    """
    tpl = _load_template(template_key)

    try:
        from jinja2 import Environment, BaseLoader, select_autoescape
        env = Environment(
            loader=BaseLoader(),
            autoescape=select_autoescape(["html", "xml"]),
        )
        subject = env.from_string(tpl["subject"] or "").render(**payload)
        body    = env.from_string(tpl["body"]    or "").render(**payload)
    except Exception as e:
        log.exception("render_and_send: render fallo (%s): %s", template_key, e)
        return {"ok": False, "to": to, "subject": "", "error": f"render:{e}"}

    return send_test_email(
        to       = to,
        subject  = subject,
        body     = "",            # plain-text body deliberadamente vacio
        html_body= body,
        reply_to = reply_to or "info@mwt.one",
    )
