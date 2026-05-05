-- =====================================================================
-- MWT.ONE · B5_ticket_email_extras.sql
-- Agente responsable: [AG-01 · AG-DATABASE]
--
-- Sembra 2 plantillas Jinja2 extra para el modulo de tickets:
--   · ticket_new_message      → cada mensaje nuevo en el hilo
--   · ticket_status_changed   → cada cambio de estado del ticket
--
-- Las dos se mandan EN PARALELO a info@mwt.one Y al usuario propietario
-- del ticket (apps.tickets.tasks._send_pair).
--
-- Reglas:
--   · Idempotente — INSERT WHERE NOT EXISTS sobre template_key + is_active.
--   · Falla silenciosa si el schema email_templates no esta inicializado.
-- =====================================================================

DO $$
DECLARE
    has_email_templates BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'email_templates' AND table_name = 'template'
    ) INTO has_email_templates;

    IF NOT has_email_templates THEN
        RAISE NOTICE 'email_templates no esta inicializado, skip seed';
        RETURN;
    END IF;

    -- ── 1) ticket_new_message ──────────────────────────
    INSERT INTO email_templates.template (
        id, name, template_key, language, brand,
        subject_template, body_template, variables_meta,
        status, is_active
    )
    SELECT
        gen_random_uuid(),
        'Nuevo mensaje en ticket',
        'ticket_new_message',
        'ES',
        'GLOBAL',
        '[Tickets MWT] Nuevo mensaje en ticket #{{ ticket_id_short }}',
        $body$
<!doctype html>
<html><head><meta charset="utf-8"><title>Nuevo mensaje</title></head>
<body style="font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#0F1B3D;background:#F8FAFC;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px;">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#64748B;margin-bottom:6px;">CONSOLA · TICKETS</div>
    <h1 style="font-family:'General Sans','Plus Jakarta Sans',Arial,sans-serif;font-size:22px;color:#0B1E3A;margin:0 0 12px;">
      Nuevo mensaje en ticket #{{ ticket_id_short }}
    </h1>
    <div style="font-size:13px;color:#64748B;margin-bottom:14px;">
      Estado actual: <strong style="color:#0B1E3A;">{{ status_label }}</strong>
      &nbsp;·&nbsp; Motivo: <strong style="color:#0B1E3A;">{{ reason_label }}</strong>
    </div>
    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;margin-bottom:8px;">
      <tr><td style="color:#64748B;padding:4px 0;width:140px;">De</td>
          <td style="font-weight:600;">{{ message_sender }}{% if message_role %} <span style="color:#94A3B8;font-weight:400;">({{ message_role }})</span>{% endif %}</td></tr>
      <tr><td style="color:#64748B;padding:4px 0;">Cuando</td>
          <td>{{ message_time }}</td></tr>
    </table>
    <div style="margin-top:8px;padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;line-height:1.5;white-space:pre-wrap;">{{ message_content }}</div>
    <a href="{{ ticket_admin_url }}" style="display:inline-block;margin-top:18px;padding:10px 18px;background:#0B1E3A;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">Abrir ticket</a>
  </div>
  <div style="text-align:center;color:#94A3B8;font-size:11px;margin-top:14px;">consola.mwt.one · Tickets MWT</div>
</body></html>
$body$,
        '[{"name":"ticket_id_short"},{"name":"reason_label"},{"name":"status_label"},{"name":"message_sender"},{"name":"message_role"},{"name":"message_time"},{"name":"message_content"},{"name":"ticket_admin_url"}]'::jsonb,
        'PUBLISHED',
        TRUE
    WHERE NOT EXISTS (
        SELECT 1 FROM email_templates.template
        WHERE template_key = 'ticket_new_message' AND is_active = TRUE
    );

    -- ── 2) ticket_status_changed ──────────────────────
    INSERT INTO email_templates.template (
        id, name, template_key, language, brand,
        subject_template, body_template, variables_meta,
        status, is_active
    )
    SELECT
        gen_random_uuid(),
        'Cambio de estado en ticket',
        'ticket_status_changed',
        'ES',
        'GLOBAL',
        '[Tickets MWT] Ticket #{{ ticket_id_short }} ahora esta {{ new_status_label }}',
        $body$
<!doctype html>
<html><head><meta charset="utf-8"><title>Cambio de estado</title></head>
<body style="font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#0F1B3D;background:#F8FAFC;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px;">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#64748B;margin-bottom:6px;">CONSOLA · TICKETS</div>
    <h1 style="font-family:'General Sans','Plus Jakarta Sans',Arial,sans-serif;font-size:22px;color:#0B1E3A;margin:0 0 12px;">
      Ticket #{{ ticket_id_short }} · cambio de estado
    </h1>
    <div style="display:inline-flex;align-items:center;gap:10px;padding:8px 14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:999px;font-size:13px;margin-bottom:18px;">
      <span style="color:#94A3B8;text-decoration:line-through;">{{ old_status_label }}</span>
      <span style="color:#94A3B8;">→</span>
      <strong style="color:#00B286;">{{ new_status_label }}</strong>
    </div>
    <div style="font-size:13px;line-height:1.5;color:#0F1B3D;margin-bottom:8px;">
      Hola {{ user_full_name }},<br/>
      el ticket que abriste sobre <strong>{{ reason_label }}</strong> cambio de estado.
    </div>
    <div style="margin:14px 0;padding:14px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;font-size:13px;">
      <div style="color:#64748B;font-size:11px;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;">Mensaje original</div>
      <div style="white-space:pre-wrap;">{{ description }}</div>
    </div>
    <a href="{{ ticket_user_url }}" style="display:inline-block;padding:10px 18px;background:#00B286;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;">Ver ticket</a>
  </div>
  <div style="text-align:center;color:#94A3B8;font-size:11px;margin-top:14px;">© Muito Work Trading · consola.mwt.one</div>
</body></html>
$body$,
        '[{"name":"ticket_id_short"},{"name":"old_status_label"},{"name":"new_status_label"},{"name":"reason_label"},{"name":"user_full_name"},{"name":"description"},{"name":"ticket_user_url"}]'::jsonb,
        'PUBLISHED',
        TRUE
    WHERE NOT EXISTS (
        SELECT 1 FROM email_templates.template
        WHERE template_key = 'ticket_status_changed' AND is_active = TRUE
    );
END $$;

-- =====================================================================
-- FIN B5_ticket_email_extras.sql
-- =====================================================================
