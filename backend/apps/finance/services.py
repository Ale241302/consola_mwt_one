"""
=====================================================================
MWT.ONE · apps.finance.services
Agente responsable: [AG-BACKEND]

Lógica de negocio del módulo finance v2.0. Las views deben quedar
ligeras: validan input, llaman a `PaymentService.register(...)` y
devuelven el payload serializado.

Fase 2 implementa SOLO:
  · Subir evidencia a MinIO con key idempotente.
  · Crear Payment (estado=PENDIENTE_AI) + Applications + Evidence
    en una transacción atómica.
  · Emitir un FinanceActivityLog con action='payment.registered'.

Fase 3 enchufa el Celery task del AIPaymentAnalyzer al final de
`register()` (queue `ai_analyzer`). Fase 4 dispara el email.
=====================================================================
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone as _tz
from decimal import Decimal
from typing import Any, Dict, List, Optional

from django.db import connection, transaction

from apps.storage.services import put_object_stream

from .enums import PaymentStatus
from .fx_service import FXService
from .models import (
    Payment, PaymentApplication, PaymentEvidence, FinanceActivityLog,
)

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# Resultado de register() — wrapper simple para typing
# ════════════════════════════════════════════════════════════
@dataclass
class RegisterResult:
    payment: Payment
    applications: List[PaymentApplication]
    evidence: PaymentEvidence


# ════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════
def _next_codigo() -> str:
    """Llama a finance.next_payment_codigo() — wrapper año-prefixed."""
    with connection.cursor() as cur:
        cur.execute("SELECT finance.next_payment_codigo()")
        row = cur.fetchone()
    return row[0] if row and row[0] else f"PAY-NOSEQ-{uuid.uuid4().hex[:6].upper()}"


def _hash_file(file) -> str:
    """SHA-256 del contenido. Reposiciona el cursor al inicio."""
    h = hashlib.sha256()
    file.seek(0)
    for chunk in iter(lambda: file.read(64 * 1024), b""):
        h.update(chunk)
    file.seek(0)
    return h.hexdigest()


def _client_id_for_expediente(expediente_id: uuid.UUID) -> Optional[uuid.UUID]:
    """Best-effort lookup del client_id desde expedientes.files
    (denormalizado en Payment.client_id para queries rápidas).
    Si la tabla/columna no existe en el entorno, devolvemos None
    sin hacer fallar el registro del pago."""
    try:
        with connection.cursor() as cur:
            cur.execute(
                "SELECT client_account_uuid FROM expedientes.files WHERE id = %s",
                [str(expediente_id)],
            )
            row = cur.fetchone()
        return row[0] if row and row[0] else None
    except Exception as e:  # pragma: no cover — degradación silenciosa
        log.info("client_id lookup falló: %s", e)
        return None


# ════════════════════════════════════════════════════════════
# PaymentService.register()
# ════════════════════════════════════════════════════════════
class PaymentService:
    """Orquesta el alta atómica de un Payment v2.0."""

    @staticmethod
    @transaction.atomic
    def register(
        *,
        validated: Dict[str, Any],
        actor_id: Optional[uuid.UUID],
        actor_role: Optional[str] = None,
    ) -> RegisterResult:
        """
        Crea Payment + applications + evidence en una transacción.

        `validated` ya pasó por PaymentRegisterSerializer así que
        las llaves están saneadas:
          monto, moneda, fecha, metodo, tipo_pago, referencia,
          notas (opcional), expediente_id, aplicaciones (lista de
          dicts limpios), evidencia (UploadedFile), event_id (opt).
        """
        # ── 1. Idempotencia: si event_id ya existe, devolver el
        # Payment original sin recrear nada ────────────────────
        event_id = validated.get("event_id") or uuid.uuid4()
        existing = Payment.objects.filter(event_id=event_id).first()
        if existing:
            log.info("Payment idempotency hit · event_id=%s · payment=%s",
                     event_id, existing.id)
            return RegisterResult(
                payment      = existing,
                applications = list(PaymentApplication.objects.filter(
                    payment_id=existing.id)),
                evidence     = PaymentEvidence.objects.get(payment_id=existing.id),
            )

        # ── 2. Sembrar identidad del nuevo Payment ──────────────
        payment_id    = uuid.uuid4()
        codigo        = _next_codigo()
        expediente_id = validated["expediente_id"]
        client_id     = _client_id_for_expediente(expediente_id)
        now_utc       = datetime.now(tz=_tz.utc)

        # ── 3. Subir comprobante a MinIO ────────────────────────
        evidence_file = validated["evidencia"]
        sha256        = _hash_file(evidence_file)
        original_name = getattr(evidence_file, "name", "evidence")
        # Derivamos extensión segura desde el name (no del MIME) para
        # que el archivo descargado conserve algo legible.
        ext = ""
        if "." in original_name:
            ext = "." + original_name.rsplit(".", 1)[-1].lower()
        object_key = f"finance/payments/{payment_id}/{uuid.uuid4().hex[:8]}{ext}"

        upload = put_object_stream(
            object_key,
            evidence_file,
            content_type = (getattr(evidence_file, "content_type", None)
                            or "application/octet-stream"),
            length = getattr(evidence_file, "size", -1) or -1,
        )
        if not upload.get("ok"):
            # Si no podemos persistir el comprobante, abortamos toda la
            # transacción — un Payment sin evidencia es inválido por R8.
            raise RuntimeError(
                f"No se pudo guardar el comprobante en storage: "
                f"{upload.get('error') or 'unknown'}"
            )

        # ── 4. Crear Payment usando SQL crudo (managed=False) ──
        # Usamos cursor para tener control fino sobre los GENERATED
        # columns y los DEFAULTs de la DB (event_id, codigo, etc.).
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO finance.payment (
                    id, codigo, expediente_id, client_id,
                    monto, moneda, tasa_cambio_a_usd, fecha,
                    metodo, tipo_pago, referencia, estado, notas,
                    created_by, event_id, metadata,
                    is_active, created_at, updated_at
                )
                VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s::jsonb,
                    TRUE, %s, %s
                )
                RETURNING id
                """,
                [
                    str(payment_id), codigo,
                    str(expediente_id), str(client_id) if client_id else None,
                    Decimal(str(validated["monto"])),
                    validated["moneda"],
                    # Snapshot FX al momento del registro (Fase 5A · OXR).
                    # Si OXR no está configurado, FXService devuelve 1.0
                    # con warning (no bloquea el registro).
                    FXService.get_usd_rate(validated["moneda"], validated["fecha"]),
                    validated["fecha"],
                    validated["metodo"],
                    validated["tipo_pago"],
                    validated["referencia"],
                    PaymentStatus.PENDIENTE_AI,
                    validated.get("notas") or None,
                    str(actor_id) if actor_id else None,
                    str(event_id),
                    "{}",
                    now_utc, now_utc,
                ],
            )

        payment = Payment.objects.get(id=payment_id)

        # ── 5. Crear PaymentApplications ────────────────────────
        applications: List[PaymentApplication] = []
        for app in validated["aplicaciones"]:
            app_id = uuid.uuid4()
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO finance.payment_application (
                        id, payment_id, applicable_type, applicable_id,
                        applicable_code, cantidad_producto, monto_aplicado,
                        metadata, created_at
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        '{}'::jsonb, %s
                    )
                    """,
                    [
                        str(app_id), str(payment_id),
                        app["applicable_type"], str(app["applicable_id"]),
                        app.get("applicable_code") or None,
                        app.get("cantidad_producto"),
                        Decimal(str(app["monto_aplicado"])),
                        now_utc,
                    ],
                )
            applications.append(PaymentApplication.objects.get(id=app_id))

        # ── 6. Crear PaymentEvidence ────────────────────────────
        evidence_id = uuid.uuid4()
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO finance.payment_evidence (
                    id, payment_id, bucket, object_key,
                    mime_type, size_bytes, sha256, original_name,
                    uploaded_by, uploaded_at
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s
                )
                """,
                [
                    str(evidence_id), str(payment_id),
                    upload.get("bucket") or "mwt-one",
                    object_key,
                    getattr(evidence_file, "content_type", "application/octet-stream"),
                    int(getattr(evidence_file, "size", 0) or 0),
                    sha256,
                    original_name[:255] if original_name else None,
                    str(actor_id) if actor_id else None,
                    now_utc,
                ],
            )
        evidence = PaymentEvidence.objects.get(id=evidence_id)

        # ── 7. ActivityLog · payment.registered ─────────────────
        ActivityLogger.log(
            actor_id   = actor_id,
            actor_role = actor_role,
            action     = "payment.registered",
            target_id  = payment_id,
            target_type= "payment",
            payload_diff = {
                "monto": str(validated["monto"]),
                "moneda": validated["moneda"],
                "metodo": validated["metodo"],
                "tipo_pago": validated["tipo_pago"],
                "referencia": validated["referencia"],
                "estado": PaymentStatus.PENDIENTE_AI,
                "applications_count": len(applications),
                "evidence_size_bytes": int(getattr(evidence_file, "size", 0) or 0),
                "evidence_sha256": sha256,
            },
            metadata = {
                "codigo": codigo,
                "expediente_id": str(expediente_id),
                "phase": "fase-3 · ai-pending",
            },
        )

        # ── 8. Encolar el AIPaymentAnalyzer (Fase 3) ────────────
        # IMPORTANTE: lo hacemos en `transaction.on_commit()` para
        # garantizar que el worker no lea el Payment ANTES de que la
        # transacción esté visible en la DB. Sin esto, una race
        # condition haría que el task no encuentre la fila recién
        # creada (lectura previa al COMMIT).
        from django.db.transaction import on_commit
        from .tasks import enqueue_ai_analyzer
        on_commit(lambda: enqueue_ai_analyzer(payment_id))

        return RegisterResult(
            payment      = payment,
            applications = applications,
            evidence     = evidence,
        )


# ════════════════════════════════════════════════════════════
# ActivityLogger · escritura append-only
# ════════════════════════════════════════════════════════════
class ActivityLogger:
    """
    Escribe en finance.activity_log. Append-only: la DB bloquea
    UPDATE/DELETE por trigger (`finance_activity_log_immutable`),
    así que cualquier intento de mutación falla con SQL exception.
    """

    @staticmethod
    def log(
        *,
        actor_id: Optional[uuid.UUID],
        actor_role: Optional[str],
        action: str,
        target_type: str,
        target_id: uuid.UUID,
        payload_diff: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> uuid.UUID:
        import json as _json
        log_id = uuid.uuid4()
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO finance.activity_log (
                    id, actor_id, actor_role, action,
                    target_type, target_id,
                    payload_diff, metadata, created_at
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s,
                    %s::jsonb, %s::jsonb, now()
                )
                """,
                [
                    str(log_id),
                    str(actor_id) if actor_id else None,
                    actor_role,
                    action,
                    target_type, str(target_id),
                    _json.dumps(payload_diff or {}),
                    _json.dumps(metadata or {}),
                ],
            )
        return log_id
