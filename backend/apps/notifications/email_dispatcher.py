"""
=====================================================================
MWT.ONE · apps.notifications.email_dispatcher
Agente responsable: [AG-BACKEND]

EmailDispatcher.send_payment_notification(payment_id) — Fase 4.

Renderiza `templates/emails/pago_registrado.html` (HTML) y
`pago_registrado.txt` (fallback plano), descarga el comprobante de
MinIO, envía a info@mwt.one con `EmailMultiAlternatives` y registra
la auditoría en `notifications.notification_log`.

El task de Celery `notifications.send_payment_email` (en
apps.notifications.tasks) lo llama tras cada verdict del
AIPaymentAnalyzer (Fase 3 → Fase 4 chain).

Resiliente:
  · MinIO down → enviamos sin adjunto + warning visible al lector.
  · SMTP down → propagamos excepción para que Celery reintente.
  · Fila de NotificationLog se crea siempre (status SENT/FAILED).

Variables que recibe el template (ver pago_registrado.html):
  payment, cliente, expediente, verdict, aplicaciones, consola_url,
  registrado_por, emoji_estado, estado_human, support_email, year,
  preheader.
=====================================================================
"""
from __future__ import annotations

import io
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone as _tz
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import connection
from django.template.loader import render_to_string

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# Constants
# ════════════════════════════════════════════════════════════
INFO_INBOX        = "info@mwt.one"
SUPPORT_INBOX     = "soporte@mwt.one"
TEMPLATE_HTML     = "emails/pago_registrado.html"
TEMPLATE_TXT      = "emails/pago_registrado.txt"
TEMPLATE_KEY      = "pago_registrado"           # canónico para NotificationLog.template_key
TRIGGER_KEY       = "payment.verdict"           # NotificationLog.trigger
SUBJECT_TEMPLATE  = "[MWT] Pago {estado_human} · {ref} · {cliente}"

# ── Sprint 2026-05-06: SAP extras notice ──────────────────────────
SAP_EXTRA_TEMPLATE_HTML = "emails/sap_extra_unit_notice.html"
SAP_EXTRA_TEMPLATE_KEY  = "sap_extra_unit_notice"
SAP_EXTRA_TRIGGER_KEY   = "expediente.sap_extra_unit"
SAP_EXTRA_SUBJECT       = "[MWT] Confirmación SAP {sap_number} · {n_extras} línea{plural} adicional{plural_es} · {ref}"

# Mapeo verdict → emoji / estado human / preheader. El template HTML
# heredó el estilo del email de password_reset, así que el header
# siempre tiene el gradiente azul→verde (no hace falta `color_estado`).
_STATE_VISUALS = {
    # status del Payment (no del verdict)
    "PENDIENTE_AI":      ("⏳", "En análisis IA"),
    "CONFIRMADO_AI":     ("✅", "Confirmado por IA"),
    "CONFIRMADO_HUMANO": ("✅", "Confirmado por revisor"),
    "NEEDS_REVIEW":      ("⚠️", "Requiere revisión humana"),
    "RECHAZADO":         ("❌", "Rechazado"),
    "REVERTIDO":         ("↺",  "Revertido"),
}


# ════════════════════════════════════════════════════════════
# Resultado del envío
# ════════════════════════════════════════════════════════════
@dataclass
class DispatchResult:
    ok: bool
    notification_log_id: uuid.UUID
    recipient: str
    subject: str
    sent_messages: int
    error: Optional[str] = None


# ════════════════════════════════════════════════════════════
# EmailDispatcher
# ════════════════════════════════════════════════════════════
class EmailDispatcher:
    """
    Stateless. Cada método es un punto de entrada autónomo. Crear una
    instancia es opcional: `EmailDispatcher().send_payment_notification(...)`
    o llamar como classmethod si prefieres `EmailDispatcher.send(...)`.
    """

    # ── Public entry point ──────────────────────────────────
    def send_payment_notification(self, payment_id: uuid.UUID) -> DispatchResult:
        """
        Carga Payment + verdict + relacionados, renderiza el email y lo
        envía a info@mwt.one. Devuelve `DispatchResult` (no lanza salvo
        que `send()` falle — ese error sí se propaga para que Celery
        reintente).
        """
        from apps.finance.models import (
            Payment, PaymentApplication, PaymentEvidence, PaymentAIVerdict,
        )

        # ── 1. Cargar el Payment ────────────────────────────
        try:
            payment = Payment.objects.get(pk=payment_id)
        except Payment.DoesNotExist:
            log.error("EmailDispatcher: Payment %s no existe", payment_id)
            return DispatchResult(
                ok=False, notification_log_id=uuid.uuid4(),
                recipient=INFO_INBOX, subject="(no payment)", sent_messages=0,
                error="payment_not_found",
            )

        verdict      = self._load_current_verdict(payment.id)
        evidence     = PaymentEvidence.objects.filter(payment_id=payment.id).first()
        applications = list(PaymentApplication.objects.filter(payment_id=payment.id)
                                              .order_by("created_at"))

        # ── 2. Construir el contexto ─────────────────────────
        cliente        = self._load_cliente(payment.client_id)
        expediente     = self._load_expediente(payment.expediente_id)
        registrado_por = self._load_user(payment.created_by)

        emoji, estado_human = _STATE_VISUALS.get(
            payment.estado, ("•", payment.estado.replace("_", " ").title())
        )
        preheader = (
            f"{estado_human} · {payment.codigo} · "
            f"{payment.monto} {payment.moneda} · {cliente['nombre']}"
        )

        # `payment.evidencia.tamaño_bytes` es como lo lee el template.
        # Inyectamos un proxy con esos atributos sobre el modelo real.
        evidencia_proxy = _EvidenceTemplateProxy(evidence) if evidence else None

        ctx: Dict[str, Any] = {
            "payment":        _PaymentTemplateProxy(payment, evidencia_proxy),
            "cliente":        cliente,
            "expediente":     expediente,
            "registrado_por": registrado_por,
            "verdict":        verdict or _empty_verdict_proxy(payment),
            "aplicaciones":   self._serialize_applications(applications),
            "consola_url":    self._consola_url(payment),
            "emoji_estado":   emoji,
            "estado_human":   estado_human,
            "support_email":  SUPPORT_INBOX,
            "year":           datetime.now(tz=_tz.utc).year,
            "preheader":      preheader,
        }

        subject = SUBJECT_TEMPLATE.format(
            estado_human=estado_human,
            ref=expediente.get("ref", "—"),
            cliente=cliente.get("nombre", "—"),
        )

        # ── 3. Renderizar templates ──────────────────────────
        html_body = render_to_string(TEMPLATE_HTML, ctx)
        try:
            text_body = render_to_string(TEMPLATE_TXT, ctx)
        except Exception as e:
            # Si falla el TXT, generamos uno mínimo en línea.
            log.warning("Render TXT falló (%s) — usando fallback inline", e)
            text_body = (
                f"Pago {estado_human} · {payment.codigo}\n"
                f"Cliente: {cliente.get('nombre', '—')}\n"
                f"Monto: {payment.monto} {payment.moneda}\n"
                f"Verdict IA: {ctx['verdict'].status} ({ctx['verdict'].confianza}%)\n"
                f"\n{ctx['verdict'].razon_humana}\n"
                f"\nVer en consola: {ctx['consola_url']}\n"
            )

        # ── 4. Crear NotificationLog (status PENDING) ────────
        log_id = self._create_notification_log(
            payment=payment, expediente=expediente,
            recipient=INFO_INBOX, subject=subject,
            body_preview=text_body[:500],
        )

        # ── 5. Construir el mensaje ─────────────────────────
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or "info@mwt.one"
        reply_to   = [registrado_por["email"]] if registrado_por.get("email") else None

        msg = EmailMultiAlternatives(
            subject     = subject,
            body        = text_body,
            from_email  = from_email,
            to          = [INFO_INBOX],
            reply_to    = reply_to,
        )
        msg.attach_alternative(html_body, "text/html")

        # ── 6. Adjuntar comprobante (best-effort) ────────────
        if evidence:
            attached = self._attach_evidence(msg, evidence)
            if not attached:
                log.warning(
                    "Comprobante no adjuntado al email · payment=%s · "
                    "key=%s — el email se manda sin attach",
                    payment.id, evidence.object_key,
                )

        # ── 7. Enviar (puede levantar — Celery hace retry) ──
        try:
            sent = msg.send(fail_silently=False)
            self._update_notification_log(log_id, status="SENT", error=None)
            log.info(
                "EmailDispatcher: enviado · payment=%s · subject=%r · sent=%d",
                payment.id, subject, sent,
            )
            return DispatchResult(
                ok=True, notification_log_id=log_id,
                recipient=INFO_INBOX, subject=subject, sent_messages=sent,
            )
        except Exception as e:
            log.exception("EmailDispatcher: send falló · payment=%s · err=%s",
                          payment.id, e)
            self._update_notification_log(
                log_id, status="FAILED", error=f"{type(e).__name__}: {e}"[:512],
            )
            # Re-raise para que el task de Celery aplique retry exponencial.
            raise

    # ════════════════════════════════════════════════════════
    # Helpers privados
    # ════════════════════════════════════════════════════════
    def _load_current_verdict(self, payment_id: uuid.UUID):
        from apps.finance.models import PaymentAIVerdict
        return (PaymentAIVerdict.objects
                .filter(payment_id=payment_id, is_current=True)
                .order_by("-analyzed_at")
                .first())

    def _load_cliente(self, client_id) -> Dict[str, Any]:
        """Lee cliente desde `clientes.cliente`. Best-effort."""
        if not client_id:
            return {"id": None, "nombre": "(cliente desconocido)"}
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, COALESCE(nombre_comercial, razon_social) AS nombre
                      FROM clientes.cliente
                     WHERE id = %s LIMIT 1
                    """,
                    [str(client_id)],
                )
                row = cur.fetchone()
            if row:
                return {"id": str(row[0]), "nombre": row[1] or "(sin nombre)"}
        except Exception as e:
            log.warning("Lookup cliente %s falló: %s", client_id, e)
        return {"id": str(client_id), "nombre": "(cliente)"}

    def _load_expediente(self, expediente_id) -> Dict[str, Any]:
        """Lee expediente desde expedientes.files. Best-effort."""
        if not expediente_id:
            return {"id": None, "ref": "(expediente desconocido)", "estado": "—"}
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, code, status, title
                      FROM expedientes.files
                     WHERE id = %s LIMIT 1
                    """,
                    [str(expediente_id)],
                )
                row = cur.fetchone()
            if row:
                return {
                    "id":     str(row[0]),
                    "ref":    row[1] or "(sin código)",
                    "estado": row[2] or "—",
                    "title":  row[3] or "",
                }
        except Exception as e:
            log.warning("Lookup expediente %s falló: %s", expediente_id, e)
        return {"id": str(expediente_id), "ref": "(expediente)", "estado": "—"}

    def _load_user(self, user_id) -> Dict[str, Any]:
        """Lee user desde core.users. Best-effort."""
        if not user_id:
            return {"id": None, "email": "(sistema)", "get_full_name": "Sistema"}
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, email, full_name
                      FROM core.users
                     WHERE id = %s LIMIT 1
                    """,
                    [str(user_id)],
                )
                row = cur.fetchone()
            if row:
                full = row[2] or row[1]
                return {
                    "id":            str(row[0]),
                    "email":         row[1] or "",
                    "get_full_name": full,
                }
        except Exception as e:
            log.warning("Lookup user %s falló: %s", user_id, e)
        return {"id": str(user_id), "email": "(usuario)", "get_full_name": "Usuario"}

    def _serialize_applications(self, applications) -> List[Dict[str, Any]]:
        from apps.finance.enums import PaymentApplicableType
        type_label = {
            PaymentApplicableType.COSTO:    "COSTO",
            PaymentApplicableType.PRODUCTO: "PRODUCTO",
            PaymentApplicableType.PROFORMA: "PROFORMA",
            PaymentApplicableType.FACTURA:  "FACTURA",
        }
        out: List[Dict[str, Any]] = []
        for a in applications:
            tipo = a.applicable_type
            label = a.applicable_code or "—"
            if a.cantidad_producto:
                label = f"{label} · {a.cantidad_producto}u"
            out.append({
                "tipo":  type_label.get(tipo, tipo),
                "label": label,
                "monto": a.monto_aplicado,
            })
        return out

    def _consola_url(self, payment) -> str:
        base = (
            getattr(settings, "CONSOLA_PUBLIC_URL", None)
            or getattr(settings, "FRONTEND_BASE_URL", None)
            or "https://consola.mwt.one"
        ).rstrip("/")
        if not payment.expediente_id:
            return f"{base}/financiero"
        # No conocemos el OC parent aquí; dejamos un deep-link neutro.
        return f"{base}/expedientes?expediente={payment.expediente_id}"

    def _attach_evidence(self, msg: EmailMultiAlternatives, evidence) -> bool:
        """Descarga el binario de MinIO y lo adjunta al EmailMessage."""
        try:
            from apps.storage.services import get_object_stream
            resp = get_object_stream(evidence.object_key, bucket=evidence.bucket)
            if resp is None:
                return False
            try:
                buf = io.BytesIO()
                for chunk in resp.stream(64 * 1024):
                    buf.write(chunk)
                msg.attach(
                    evidence.original_name or "comprobante",
                    buf.getvalue(),
                    evidence.mime_type or "application/octet-stream",
                )
                return True
            finally:
                try:
                    resp.close()
                    resp.release_conn()
                except Exception:
                    pass
        except Exception as e:
            log.warning("Attach evidence falló: %s", e)
            return False

    def _create_notification_log(self, *, payment, expediente,
                                  recipient: str, subject: str,
                                  body_preview: str) -> uuid.UUID:
        log_id = uuid.uuid4()
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO notifications.notification_log (
                        id, ts, expediente_id, template_key, recipient_email,
                        subject, body_preview, trigger, status,
                        retries, attempt_count, is_active,
                        idempotence_token,
                        created_at, updated_at
                    ) VALUES (
                        %s, now(), %s, %s, %s,
                        %s, %s, %s, %s,
                        0, 1, TRUE,
                        %s,
                        now(), now()
                    )
                    """,
                    [
                        str(log_id),
                        str(expediente["id"]) if expediente.get("id") else None,
                        TEMPLATE_KEY, recipient,
                        subject[:512], body_preview[:1000], TRIGGER_KEY, "PENDING",
                        f"payment:{payment.id}:{payment.estado}",
                    ],
                )
        except Exception as e:
            log.warning("Create NotificationLog falló (continuamos): %s", e)
        return log_id

    def _update_notification_log(self, log_id: uuid.UUID, *,
                                  status: str, error: Optional[str]):
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE notifications.notification_log
                       SET status        = %s,
                           error         = %s,
                           completed_at  = CASE WHEN %s = 'SENT' THEN now() ELSE completed_at END,
                           updated_at    = now()
                     WHERE id = %s
                    """,
                    [status, (error or "")[:512], status, str(log_id)],
                )
        except Exception as e:
            log.warning("Update NotificationLog falló: %s", e)

    # ════════════════════════════════════════════════════════════
    # Sprint 2026-05-06 (AG-03): notificar al cliente cuando la
    # confirmación SAP de Marluvas trae líneas que NO estaban en su
    # OC original. El SAP se persiste, pero esas líneas extra NO se
    # insertan en `expedientes.linea` — al cliente le llega un email
    # informativo con el detalle (SKU, nombre, talla, qty extra) y un
    # botón "Ver Expediente" para que decida si las quiere incorporar.
    # ════════════════════════════════════════════════════════════
    def send_sap_extra_unit_notice(
        self,
        *,
        expediente_id,
        sap_number: str,
        extras: List[Dict[str, Any]],
        registrado_por_user_id=None,
    ) -> DispatchResult:
        """
        Envía el correo de "extras detectados en SAP" al cliente del
        expediente con CC a info@mwt.one.

        Args:
            expediente_id: UUID del expediente.
            sap_number:    Número SAP de Marluvas (ej. "263360").
            extras:        Lista de dicts {sku, nombre_producto, talla, qty}.
            registrado_por_user_id: usuario que confirmó producción (opcional).
        """
        if not extras:
            log.warning("send_sap_extra_unit_notice: extras vacío · exp=%s", expediente_id)
            return DispatchResult(
                ok=False, notification_log_id=uuid.uuid4(),
                recipient="—", subject="(no extras)", sent_messages=0,
                error="no_extras",
            )

        # ── 1. Cargar expediente + cliente ──────────────────
        expediente = self._load_expediente_for_sap(expediente_id)
        if not expediente:
            return DispatchResult(
                ok=False, notification_log_id=uuid.uuid4(),
                recipient="—", subject="(no expediente)", sent_messages=0,
                error="expediente_not_found",
            )
        cliente = self._load_cliente_full(expediente["client_id"])
        registrado_por = (
            self._load_user(registrado_por_user_id) if registrado_por_user_id else None
        )

        # ── 2. Resolver destinatarios ───────────────────────
        client_email = (cliente.get("email") or "").strip()
        if not client_email:
            log.warning(
                "send_sap_extra_unit_notice: cliente %s sin email — "
                "fallback a info@mwt.one solamente",
                cliente.get("id"),
            )
            to_list = [INFO_INBOX]
            cc_list: List[str] = []
        else:
            to_list = [client_email]
            cc_list = [INFO_INBOX]

        # ── 3. Contexto del template ────────────────────────
        n_extras = len(extras)
        plural   = "s" if n_extras != 1 else ""
        plural_es = "es" if n_extras != 1 else ""

        ctx: Dict[str, Any] = {
            "cliente":         cliente,
            "cliente_nombre":  cliente.get("nombre") or "",
            "expediente":      _DictAsObj(expediente),
            "expediente_url":  self._consola_expediente_url(expediente),
            "sap_number":      sap_number,
            "extras":          extras,
            "registrado_por":  _DictAsObj(registrado_por) if registrado_por else None,
            "support_email":   INFO_INBOX,
            "year":            datetime.now(tz=_tz.utc).year,
            "preheader":       (
                f"SAP {sap_number} · {n_extras} línea{plural} adicional{plural_es} "
                f"confirmada por la fábrica"
            ),
        }

        subject = SAP_EXTRA_SUBJECT.format(
            sap_number=sap_number,
            n_extras=n_extras,
            plural=plural,
            plural_es=plural_es,
            ref=expediente.get("codigo") or expediente.get("id") or "—",
        )

        # ── 4. Renderizar template HTML + TXT fallback ──────
        html_body = render_to_string(SAP_EXTRA_TEMPLATE_HTML, ctx)
        text_body = self._build_sap_extra_text_fallback(ctx)

        # ── 5. NotificationLog ──────────────────────────────
        log_id = self._create_sap_extra_notification_log(
            expediente=expediente, sap_number=sap_number,
            recipient=to_list[0], subject=subject,
            body_preview=text_body[:1000],
        )

        # ── 6. Construir + enviar ───────────────────────────
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or INFO_INBOX
        msg = EmailMultiAlternatives(
            subject     = subject,
            body        = text_body,
            from_email  = from_email,
            to          = to_list,
            cc          = cc_list,
            reply_to    = [INFO_INBOX],
        )
        msg.attach_alternative(html_body, "text/html")

        try:
            sent = msg.send(fail_silently=False)
            self._update_notification_log(log_id, status="SENT", error=None)
            log.info(
                "send_sap_extra_unit_notice: enviado · exp=%s · sap=%s · "
                "to=%s · cc=%s · n_extras=%d · sent=%d",
                expediente_id, sap_number, to_list, cc_list, n_extras, sent,
            )
            return DispatchResult(
                ok=True, notification_log_id=log_id,
                recipient=to_list[0], subject=subject, sent_messages=sent,
            )
        except Exception as e:
            log.exception(
                "send_sap_extra_unit_notice: send falló · exp=%s · sap=%s · err=%s",
                expediente_id, sap_number, e,
            )
            self._update_notification_log(
                log_id, status="FAILED", error=f"{type(e).__name__}: {e}"[:512],
            )
            raise

    # ── Helpers para SAP-extra notice ─────────────────────
    def _load_expediente_for_sap(self, expediente_id) -> Optional[Dict[str, Any]]:
        """Lee el expediente con su client_id desde expedientes.expediente.
        Schema canónico: id, codigo, client_id, oc_id, estado."""
        if not expediente_id:
            return None
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT id::text,
                           codigo,
                           client_id::text,
                           oc_id::text,
                           estado
                      FROM expedientes.expediente
                     WHERE id = %s::uuid LIMIT 1
                    """,
                    [str(expediente_id)],
                )
                row = cur.fetchone()
            if not row:
                return None
            return {
                "id":        row[0],
                "codigo":    row[1] or "",
                "client_id": row[2],
                "oc_id":     row[3],
                "estado":    row[4] or "—",
            }
        except Exception as e:
            log.warning("Lookup expediente %s para SAP-extra falló: %s", expediente_id, e)
            return None

    def _load_cliente_full(self, client_id) -> Dict[str, Any]:
        """Lee cliente con email de contacto desde clientes.cliente.
        Schema canónico (30_clientes.sql): `contacto_email VARCHAR(160)`.
        Si está vacío, el caller deberá fallback a info@mwt.one."""
        if not client_id:
            return {"id": None, "nombre": "(cliente desconocido)", "email": ""}
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT id::text,
                           COALESCE(nombre_comercial, razon_social, '(sin nombre)') AS nombre,
                           COALESCE(contacto_email, '')                              AS email
                      FROM clientes.cliente
                     WHERE id = %s::uuid LIMIT 1
                    """,
                    [str(client_id)],
                )
                row = cur.fetchone()
            if row:
                return {
                    "id":     row[0],
                    "nombre": row[1] or "(sin nombre)",
                    "email":  (row[2] or "").strip(),
                }
        except Exception as e:
            log.warning("Lookup cliente %s (full) falló: %s", client_id, e)
        return {"id": str(client_id), "nombre": "(cliente)", "email": ""}

    def _consola_expediente_url(self, expediente: Dict[str, Any]) -> str:
        base = (
            getattr(settings, "CONSOLA_PUBLIC_URL", None)
            or getattr(settings, "FRONTEND_BASE_URL", None)
            or "https://consola.mwt.one"
        ).rstrip("/")
        if expediente.get("oc_id") and expediente.get("id"):
            return f"{base}/expedientes/{expediente['oc_id']}/exp/{expediente['id']}"
        if expediente.get("id"):
            return f"{base}/expedientes/{expediente['id']}"
        return f"{base}/expedientes"

    def _build_sap_extra_text_fallback(self, ctx: Dict[str, Any]) -> str:
        lines = [
            f"Hola {ctx.get('cliente_nombre') or ''},",
            "",
            f"Marluvas confirmó tu orden bajo el SAP {ctx['sap_number']} e incluyó",
            f"{len(ctx['extras'])} línea(s) adicional(es) que no figuraban en tu OC original.",
            "",
            "Detalle de las unidades adicionales:",
        ]
        for x in ctx["extras"]:
            lines.append(
                f"  · {x.get('sku', '—')}  "
                f"{x.get('nombre_producto') or ''}  "
                f"talla {x.get('talla', '—')}  "
                f"+{x.get('qty', 0)} u."
            )
        lines += [
            "",
            "Estas unidades quedaron registradas en el SAP pero NO se sumaron",
            "automáticamente a tu OC. Si querés incorporarlas, respondé este correo",
            "o entrá al expediente:",
            "",
            ctx.get("expediente_url", ""),
            "",
            "El equipo de MWT ONE",
        ]
        return "\n".join(lines)

    def _create_sap_extra_notification_log(self, *, expediente, sap_number,
                                           recipient: str, subject: str,
                                           body_preview: str) -> uuid.UUID:
        log_id = uuid.uuid4()
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO notifications.notification_log (
                        id, ts, expediente_id, template_key, recipient_email,
                        subject, body_preview, trigger, status,
                        retries, attempt_count, is_active,
                        idempotence_token,
                        created_at, updated_at
                    ) VALUES (
                        %s, now(), %s, %s, %s,
                        %s, %s, %s, %s,
                        0, 1, TRUE,
                        %s,
                        now(), now()
                    )
                    """,
                    [
                        str(log_id),
                        expediente.get("id"),
                        SAP_EXTRA_TEMPLATE_KEY, recipient,
                        subject[:512], body_preview[:1000],
                        SAP_EXTRA_TRIGGER_KEY, "PENDING",
                        f"sap_extra:{expediente.get('id')}:{sap_number}",
                    ],
                )
        except Exception as e:
            log.warning("Create NotificationLog (sap_extra) falló: %s", e)
        return log_id


# ════════════════════════════════════════════════════════════
# Template proxies — adaptan los modelos Django al shape que el
# template HTML/TXT espera. Evitan tocar los models reales.
# ════════════════════════════════════════════════════════════
class _PaymentTemplateProxy:
    """
    Wrapper sobre el Payment que añade `.evidencia` (proxy) y los
    métodos `get_metodo_display` / `get_tipo_pago_display` que el
    template usa via `{{ payment.get_metodo_display }}`.
    """
    def __init__(self, payment, evidencia):
        self._p = payment
        self.evidencia = evidencia

    def __getattr__(self, name):
        return getattr(self._p, name)

    def get_metodo_display(self):
        from apps.finance.enums import PaymentMethod
        try:
            return PaymentMethod(self._p.metodo).label
        except ValueError:
            return self._p.metodo

    def get_tipo_pago_display(self):
        from apps.finance.enums import PaymentType
        try:
            return PaymentType(self._p.tipo_pago).label
        except ValueError:
            return self._p.tipo_pago


class _EvidenceTemplateProxy:
    """`payment.evidencia.tamaño_bytes` con tilde · no podemos exponer
    eso como atributo Python, pero el template Django lo busca con
    getattr y si no existe usa el __getitem__ → mock con dict-like."""
    def __init__(self, evidence):
        self.mime_type     = evidence.mime_type
        # ñ + tilde no son válidos como nombres Python; el template
        # usa `payment.evidencia.tamaño_bytes` → Django intenta
        # getattr → __getitem__ → dict → fallback a método. Le damos
        # lo necesario:
        self.size_bytes    = evidence.size_bytes
        # Y un atributo con el nombre correcto vía setattr (Django
        # template resolver respeta setattr aunque el identificador
        # tenga caracteres no-ASCII).
        setattr(self, "tamaño_bytes", evidence.size_bytes)


class _DictAsObj:
    """Adapter que expone un dict como objeto con atributos.
    Sprint 2026-05-06 (AG-03): el template `sap_extra_unit_notice.html`
    usa `{{ expediente.codigo }}` y `{{ registrado_por.full_name }}` —
    Django template pide getattr antes que __getitem__, así que envolvemos
    el dict para que ambos accesos funcionen."""
    def __init__(self, d: Dict[str, Any]):
        self._d = d or {}
        for k, v in (d or {}).items():
            setattr(self, k, v)
    def __getattr__(self, name):
        return self._d.get(name)
    def __getitem__(self, key):
        return self._d.get(key)


def _empty_verdict_proxy(payment):
    """
    Cuando se envía el email ANTES de que el AIPaymentAnalyzer haya
    corrido (caso edge, p.ej. broker caído + sync fallback que falla
    middway), generamos un verdict-proxy mínimo para que el template
    no lance KeyError.
    """
    class _NullVerdict:
        status               = "PENDIENTE"
        confianza            = 0
        razon_humana         = "Análisis IA aún no completado."
        mismatch_fields: list = []
        alertas_fraude:  list = []
        monto_extraido       = None
        moneda_extraida      = None
        ordenante_extraido   = None
        beneficiario_extraido = None
        banco_emisor         = None
        banco_receptor       = None
        model_version        = "—"
        analyzed_at          = payment.created_at
    return _NullVerdict()
