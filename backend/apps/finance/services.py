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


# ════════════════════════════════════════════════════════════════════════
# Sprint Registrar Pago (Fase 1) — Servicios para wizard de 4 pasos
# Ref: §6 Delta Document sobre apps/finance
# ════════════════════════════════════════════════════════════════════════
from django.conf import settings  # noqa: E402

from .enums import (
    PaymentCounterpartyType, PaymentDirection,
    PaymentRejectionReason, PaymentErrorCode,
    PAYMENT_STATES_RELEASABLE, PAYMENT_STATES_REJECTABLE,
)


# UUID hardcoded de MWT como operating company. El brief sugiere env var;
# leemos `MWT_OPERATING_COMPANY_ID` con default a la constante existente
# en apps.core.constants para backward-compat.
def _mwt_operating_company_id() -> str:
    env_val = getattr(settings, "MWT_OPERATING_COMPANY_ID", None)
    if env_val:
        return str(env_val).strip().lower()
    try:
        from apps.core.constants import MWT_OPERATING_CLIENT_ID
        return str(MWT_OPERATING_CLIENT_ID).strip().lower()
    except Exception:  # noqa: BLE001 — fail-safe: sin MWT id, todo es CLIENT-op
        return ""


def _is_operated_by_mwt(operating_company_id) -> bool:
    if not operating_company_id:
        return False
    return str(operating_company_id).strip().lower() == _mwt_operating_company_id()


# ── CounterpartyValidator ───────────────────────────────────────────────
class CounterpartyMismatchError(Exception):
    """Raised cuando las PaymentApplications apuntan a obligaciones de
    contrapartes distintas a la del Payment. Code: COUNTERPARTY_MISMATCH."""
    def __init__(self, message: str = "Aplicaciones inconsistentes con la contraparte del pago"):
        super().__init__(message)
        self.code = PaymentErrorCode.COUNTERPARTY_MISMATCH


class CounterpartyValidator:
    """Validador para asegurar que todas las PaymentApplications de un
    Payment apunten a obligaciones de la MISMA contraparte declarada
    en el header del pago.

    Implementacion Fase 1: en este sprint, los applicables (PROFORMA,
    FACTURA, COSTO, PRODUCTO) NO tienen un campo `counterparty_id`
    canonico. La validacion delega al expediente del pago y al
    counterparty_type declarado. Cuando el modelo de counterparties se
    formalice, este validator hara las queries reales.
    """
    @classmethod
    def assert_consistent(cls, payment_payload: Dict[str, Any],
                          applications: List[Dict[str, Any]]) -> None:
        ct = payment_payload.get("counterparty_type")
        cid = payment_payload.get("counterparty_id")
        if not applications:
            return
        if ct and ct not in PaymentCounterpartyType.values:
            raise CounterpartyMismatchError(
                f"counterparty_type='{ct}' no valido. Permitidos: "
                f"{list(PaymentCounterpartyType.values)}"
            )
        # En Fase 1 aceptamos cualquier set de aplicaciones siempre que
        # exista un counterparty_id valido. Validaciones cross-contraparte
        # se agregan cuando el modulo counterparties este definido.
        if ct and not cid:
            raise CounterpartyMismatchError(
                "counterparty_id requerido cuando counterparty_type esta presente"
            )


# ── CreditEffectService ─────────────────────────────────────────────────
@dataclass(frozen=True)
class CreditEffectPreview:
    """Preview del impacto que tendra un Payment sobre el credito al ser
    liberado por CEO. Devuelto por CreditEffectService.dry_run() y
    consumido por el Paso 4 del wizard."""
    will_affect_credit: bool
    target_client_id: Optional[str]
    target_client_name: Optional[str]
    delta_usd: Decimal              # positivo = "liberara X de credito"
    reason: str                     # explicacion human-readable
    blocking_error: Optional[str]   # None | 'EXPEDIENTE_TERMS_UNDEFINED'


class ExpedienteTermsUndefinedError(Exception):
    code = PaymentErrorCode.EXPEDIENTE_TERMS_UNDEFINED


class CreditEffectService:
    """Aplica la matriz §2 del brief usando el credit clock existente.
    NO duplica el calculo de saldo — solo decide A QUIEN y CUANTO afectar.

    Matriz §2:
        target=COST     -> nunca afecta credito.
        target=PRODUCT + is_operated_by_mwt=True + forma_pago=CREDITO
                        -> libera credito al cliente MWT.
        target=PRODUCT + is_operated_by_mwt=True + forma_pago=CONTADO
                        -> no afecta credito.
        target=PRODUCT + is_operated_by_mwt=False + forma_pago=CREDITO
                        -> libera credito al cliente final del expediente.
        target=PRODUCT + is_operated_by_mwt=False + forma_pago=CONTADO
                        -> no afecta credito.

    Si forma_pago IS NULL al evaluar -> ExpedienteTermsUndefinedError (409).
    """

    @classmethod
    def _load_expediente_info(cls, expediente_id) -> Dict[str, Any]:
        """Lee operating_company_id + forma_pago del expediente.
        Si no existe el expediente devuelve {} (las validaciones de
        existencia ocurren upstream en el serializer)."""
        if not expediente_id:
            return {}
        with connection.cursor() as c:
            c.execute("""
                SELECT id, codigo, operating_company_id, forma_pago, client_id
                  FROM expedientes.expediente
                 WHERE id = %s::uuid
                 LIMIT 1
            """, [str(expediente_id)])
            row = c.fetchone()
        if not row:
            return {}
        return {
            "id":                   str(row[0]),
            "codigo":               row[1],
            "operating_company_id": str(row[2]) if row[2] else None,
            "forma_pago":           row[3],
            "client_id":            str(row[4]) if row[4] else None,
        }

    @classmethod
    def _resolve_target_client(cls, exp: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Resuelve a quien afecta el credito segun matriz §2.
        Devuelve {id, name} o None si NO debe afectar."""
        if not exp:
            return None
        target_id = (_mwt_operating_company_id()
                     if _is_operated_by_mwt(exp.get("operating_company_id"))
                     else exp.get("client_id"))
        if not target_id:
            return None
        # Buscar nombre legible (best-effort).
        with connection.cursor() as c:
            c.execute("""
                SELECT id, razon_social, nombre
                  FROM clientes.cliente
                 WHERE id = %s::uuid
                 LIMIT 1
            """, [str(target_id)])
            row = c.fetchone()
        if not row:
            return {"id": str(target_id), "name": None}
        return {"id": str(row[0]), "name": row[1] or row[2]}

    @classmethod
    def _payment_target_type(cls, applications: List[Dict[str, Any]]) -> str:
        """Devuelve 'PRODUCT' si todas las apps son PRODUCTO/PROFORMA/FACTURA,
        'COST' si todas son COSTO, o 'MIXED' si hay mezcla.
        En Fase 1 el wizard solo permite uniformidad; aqui solo decidimos
        el efecto si todas son del mismo tipo."""
        if not applications:
            return "EMPTY"
        types = {a.get("applicable_type") for a in applications}
        if types == {"COSTO"}:
            return "COST"
        if "COSTO" not in types:
            return "PRODUCT"
        return "MIXED"

    @classmethod
    def dry_run(cls, payment_payload: Dict[str, Any],
                applications: List[Dict[str, Any]]) -> CreditEffectPreview:
        """Calcula el impacto sin persistir. Alimenta Paso 4 del wizard.

        Reglas:
          · Si target=COST -> no afecta credito (nunca).
          · Si target=PRODUCT y forma_pago NULL -> blocking_error.
          · Si target=PRODUCT y forma_pago=CONTADO -> no afecta.
          · Si target=PRODUCT y forma_pago=CREDITO -> libera al target client.
        """
        try:
            monto = Decimal(str(payment_payload.get("monto") or 0))
        except (TypeError, ValueError):
            monto = Decimal("0")

        target_type = cls._payment_target_type(applications)
        if target_type == "COST":
            return CreditEffectPreview(
                will_affect_credit=False,
                target_client_id=None, target_client_name=None,
                delta_usd=Decimal("0"),
                reason="Pago de COSTO — nunca afecta credito de ningun cliente.",
                blocking_error=None,
            )
        if target_type == "MIXED":
            return CreditEffectPreview(
                will_affect_credit=False,
                target_client_id=None, target_client_name=None,
                delta_usd=Decimal("0"),
                reason=("Aplicaciones mezclan COSTO y PRODUCTO — el wizard "
                        "requiere uniformidad por session."),
                blocking_error="MIXED_APPLICATION_TYPES",
            )
        if target_type == "EMPTY":
            return CreditEffectPreview(
                will_affect_credit=False,
                target_client_id=None, target_client_name=None,
                delta_usd=Decimal("0"),
                reason="Sin aplicaciones — agregue al menos una en el Paso 2.",
                blocking_error=None,
            )

        # target_type == "PRODUCT"
        exp = cls._load_expediente_info(payment_payload.get("expediente_id"))
        if not exp:
            return CreditEffectPreview(
                will_affect_credit=False,
                target_client_id=None, target_client_name=None,
                delta_usd=Decimal("0"),
                reason="Expediente no encontrado.",
                blocking_error="EXPEDIENTE_NOT_FOUND",
            )
        forma_pago = exp.get("forma_pago")
        if not forma_pago:
            return CreditEffectPreview(
                will_affect_credit=False,
                target_client_id=None, target_client_name=None,
                delta_usd=Decimal("0"),
                reason=f"Expediente {exp.get('codigo')} sin forma_pago definida. "
                       f"Definir antes de liberar.",
                blocking_error=PaymentErrorCode.EXPEDIENTE_TERMS_UNDEFINED,
            )
        if forma_pago == "CONTADO":
            return CreditEffectPreview(
                will_affect_credit=False,
                target_client_id=None, target_client_name=None,
                delta_usd=Decimal("0"),
                reason=f"Expediente {exp.get('codigo')} es CONTADO — no afecta credito.",
                blocking_error=None,
            )
        # CREDITO -> libera al target client.
        target = cls._resolve_target_client(exp)
        if not target:
            return CreditEffectPreview(
                will_affect_credit=False,
                target_client_id=None, target_client_name=None,
                delta_usd=Decimal("0"),
                reason="No se pudo resolver el cliente objetivo del credito.",
                blocking_error="TARGET_CLIENT_UNRESOLVED",
            )
        op_label = ("Muito Work Limitada (operador MWT)"
                    if _is_operated_by_mwt(exp.get("operating_company_id"))
                    else f"cliente final del expediente {exp.get('codigo')}")
        return CreditEffectPreview(
            will_affect_credit=True,
            target_client_id=target["id"],
            target_client_name=target.get("name"),
            delta_usd=monto,
            reason=(f"Al liberar, decrementara ~${monto} de credito utilizado de "
                    f"{target.get('name') or target['id']} ({op_label})."),
            blocking_error=None,
        )

    @classmethod
    def apply(cls, payment: Payment, actor_id=None) -> None:
        """Invocado en transicion a CONFIRMADO_HUMANO (CREDIT_RELEASED).
        Delega a CreditClockProjector.recompute() del cliente target.

        Si forma_pago IS NULL -> ExpedienteTermsUndefinedError (409 upstream).
        """
        exp = cls._load_expediente_info(getattr(payment, "expediente_id", None))
        if not exp:
            log.warning("[CreditEffectService.apply] payment=%s sin expediente",
                        getattr(payment, "id", None))
            return
        forma_pago = exp.get("forma_pago")
        # Si target=COST, no hay nada que hacer.
        # En Fase 1 el target_type esta en PaymentApplication, no en Payment.
        # Cargamos las applications del pago para decidir.
        with connection.cursor() as c:
            c.execute("""
                SELECT DISTINCT applicable_type
                  FROM finance.payment_application
                 WHERE payment_id = %s::uuid
            """, [str(payment.id)])
            types = {r[0] for r in c.fetchall()}
        if types == {"COSTO"}:
            return  # COST — nunca afecta credito.
        if not types or "COSTO" in types:
            return  # MIXED o vacio — no aplicar (el dry_run debe haber bloqueado)
        # PRODUCT path:
        if not forma_pago:
            raise ExpedienteTermsUndefinedError(
                f"Expediente {exp.get('codigo')} sin forma_pago — no se puede liberar."
            )
        if forma_pago == "CONTADO":
            return  # CONTADO no afecta credito.
        # CREDITO -> recompute el credit clock del target.
        target = cls._resolve_target_client(exp)
        if not target:
            log.warning("[CreditEffectService.apply] no target client for payment=%s",
                        payment.id)
            return
        try:
            from .tasks import enqueue_credit_clock_recompute
            enqueue_credit_clock_recompute(target["id"], last_payment_id=str(payment.id))
            log.info("[CreditEffectService.apply] credit recompute encolado "
                     "payment=%s target_client=%s", payment.id, target["id"])
        except Exception as exc:  # noqa: BLE001 — fail-soft, no romper el release
            log.exception("[CreditEffectService.apply] error encolando recompute: %s", exc)

    @classmethod
    def revert(cls, payment: Payment, actor_id=None) -> None:
        """Invocado en CONFIRMADO_HUMANO -> RECHAZADO. Mismo path que
        apply(): recomputa el clock del target client (que ahora vera el
        pago en estado RECHAZADO y lo excluira de la suma)."""
        cls.apply(payment, actor_id=actor_id)


__all__ = [
    "PaymentService",  # ya existia
    "ActivityLogger",  # ya existia
    "CreditEffectService",
    "CreditEffectPreview",
    "CounterpartyValidator",
    "CounterpartyMismatchError",
    "ExpedienteTermsUndefinedError",
]
