"""
=====================================================================
MWT.ONE · apps.expedientes.validators
Ola 1 — F5: validaciones de coherencia backend.

Reglas:
  · error   → inconsistencias que afectan pipeline, liquidación o visibilidad.
  · warning → descuadres monetarios o datos incompletos que deben auditarse.

Las validaciones son puras sobre instancias/modelos y no dependen del
request. El endpoint /api/expedientes/{id}/coherence-check/ las expone
como respuesta JSON; los serializers pueden invocarlas en validate() para
loguear/retornar warnings sin bloquear flujos legacy.
=====================================================================
"""
from decimal import Decimal, InvalidOperation

from django.db import connection

from .models import EventLog, Expediente, Linea, Oc


def _as_decimal(value):
    try:
        return Decimal(str(value or 0))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def _safe_uuid(obj_id):
    try:
        import uuid as _u
        return str(_u.UUID(str(obj_id)))
    except (ValueError, TypeError):
        return None


def _last_expediente_event(expediente_id):
    try:
        return (
            EventLog.objects.filter(
                aggregate_type="expediente",
                aggregate_id=expediente_id,
                is_active=True,
            )
            .order_by("-created_at")
            .first()
        )
    except Exception:
        return None


def _has_iva_cost_line(expediente_id):
    eid = _safe_uuid(expediente_id)
    if not eid:
        return False
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT 1
                FROM transfers.cost_line cl
                JOIN inventario.expediente_nodo_assignment a
                  ON a.transferencia_id = cl.transferencia_id
                WHERE a.expediente_id = %s::uuid
                  AND a.is_active = TRUE
                  AND cl.is_active = TRUE
                  AND cl.kind = 'IVA'
                LIMIT 1
                """,
                [eid],
            )
            return c.fetchone() is not None
    except Exception:
        return False


def _expediente_line_total(expediente_id):
    """Suma qty * unit_price_client (fallback unit_price) de líneas activas."""
    total = Decimal("0")
    try:
        rows = Linea.objects.filter(
            expediente_id=expediente_id, is_active=True
        ).values_list("qty", "unit_price_client", "unit_price")
        for qty, up_cli, up_leg in rows:
            price = _as_decimal(up_cli) if _as_decimal(up_cli) > 0 else _as_decimal(up_leg)
            total += _as_decimal(qty) * price
    except Exception:
        pass
    return total


def _split_issues(issues):
    return {
        "ok": not any(i.get("level") == "error" for i in issues),
        "errors": [i for i in issues if i.get("level") == "error"],
        "warnings": [i for i in issues if i.get("level") == "warning"],
    }


def check_expediente_coherence(expediente):
    """
    Valida coherencia de un expediente.
    Retorna dict: {ok: bool, errors: [...], warnings: [...]}
    """
    issues = []
    eid = getattr(expediente, "id", None)
    estado = (getattr(expediente, "estado", "") or "").upper()

    last_event = _last_expediente_event(eid)
    if last_event:
        phase_to = (last_event.phase_to or "").upper()

        # Error: transición sin fase destino.
        if not phase_to:
            issues.append(
                {
                    "level": "error",
                    "code": "transition_without_phase",
                    "message": "Última transición del expediente no tiene fase destino.",
                }
            )

        # Error: fases solapadas DESPACHO / TRANSITO.
        if estado == "DESPACHO" and phase_to == "TRANSITO":
            issues.append(
                {
                    "level": "error",
                    "code": "overlapping_phases",
                    "message": "Estado DESPACHO pero el último evento indica TRANSITO.",
                }
            )
        elif estado == "TRANSITO" and phase_to == "DESPACHO":
            issues.append(
                {
                    "level": "error",
                    "code": "overlapping_phases",
                    "message": "Estado TRANSITO pero el último evento indica DESPACHO.",
                }
            )

    # Error: IVA incluido en costo capitalizable (landed cost).
    total_cost = _as_decimal(getattr(expediente, "total_cost", 0))
    iva_amount = _as_decimal(getattr(expediente, "iva_amount", 0))
    if total_cost > 0 and iva_amount > 0 and _has_iva_cost_line(eid):
        issues.append(
            {
                "level": "error",
                "code": "iva_in_landed_cost",
                "message": "IVA detectado dentro del costo capitalizable (landed cost).",
            }
        )

    # Warning: total_invoiced descuadrado >5% respecto a líneas.
    line_total = _expediente_line_total(eid)
    total_invoiced = _as_decimal(getattr(expediente, "total_invoiced", 0))
    if line_total > 0 and total_invoiced > 0:
        diff = abs(total_invoiced - line_total)
        if diff / line_total > Decimal("0.05"):
            issues.append(
                {
                    "level": "warning",
                    "code": "invoiced_mismatch",
                    "message": (
                        f"total_invoiced ({total_invoiced}) difiere >5% de la "
                        f"suma de líneas ({line_total:.2f})."
                    ),
                }
            )

    # Warning: balance negativo.
    balance = _as_decimal(getattr(expediente, "balance", 0))
    if balance < 0:
        issues.append(
            {
                "level": "warning",
                "code": "negative_balance",
                "message": f"balance negativo: {balance}.",
            }
        )

    # Warning: líneas con unit_cost=0 en expediente cerrado.
    if estado == "CERRADO":
        try:
            zero_cost_count = Linea.objects.filter(
                expediente_id=eid, is_active=True, unit_cost=Decimal("0")
            ).count()
        except Exception:
            zero_cost_count = 0
        if zero_cost_count:
            issues.append(
                {
                    "level": "warning",
                    "code": "zero_cost_closed",
                    "message": (
                        f"{zero_cost_count} líneas con unit_cost=0 en expediente CERRADO."
                    ),
                }
            )

    # Warning: unit_price_client < unit_cost.
    below_cost_count = 0
    try:
        for ln in Linea.objects.filter(expediente_id=eid, is_active=True):
            up_cli = _as_decimal(ln.unit_price_client)
            uc = _as_decimal(ln.unit_cost)
            qty = _as_decimal(ln.qty)
            if qty > 0 and up_cli > 0 and uc > 0 and up_cli < uc:
                below_cost_count += 1
    except Exception:
        pass
    if below_cost_count:
        issues.append(
            {
                "level": "warning",
                "code": "client_price_below_cost",
                "message": (
                    f"{below_cost_count} líneas con unit_price_client < unit_cost."
                ),
            }
        )

    return _split_issues(issues)


def check_oc_coherence(oc):
    """Valida coherencia de una OC."""
    issues = []
    total_value = _as_decimal(getattr(oc, "total_value", 0))
    total_invoiced = _as_decimal(getattr(oc, "total_invoiced", 0))
    total_paid = _as_decimal(getattr(oc, "total_paid", 0))
    balance = _as_decimal(getattr(oc, "balance", 0))

    if total_value > 0 and total_invoiced > 0:
        diff = abs(total_invoiced - total_value)
        if diff / total_value > Decimal("0.05"):
            issues.append(
                {
                    "level": "warning",
                    "code": "invoiced_vs_value_mismatch",
                    "message": (
                        f"total_invoiced ({total_invoiced}) difiere >5% de "
                        f"total_value ({total_value})."
                    ),
                }
            )

    if balance < 0:
        issues.append(
            {
                "level": "warning",
                "code": "negative_balance",
                "message": f"balance negativo: {balance}.",
            }
        )

    if total_paid > total_invoiced:
        issues.append(
            {
                "level": "warning",
                "code": "paid_over_invoiced",
                "message": (
                    f"total_paid ({total_paid}) supera total_invoiced ({total_invoiced})."
                ),
            }
        )

    return _split_issues(issues)


def check_linea_coherence(linea):
    """Valida coherencia de una línea de OC/expediente."""
    issues = []
    qty = _as_decimal(getattr(linea, "qty", 0))
    unit_cost = _as_decimal(getattr(linea, "unit_cost", 0))
    up_cli = _as_decimal(getattr(linea, "unit_price_client", 0))
    up_leg = _as_decimal(getattr(linea, "unit_price", 0))
    up_mwt = _as_decimal(getattr(linea, "unit_price_mwt", 0))
    expediente_id = getattr(linea, "expediente_id", None)

    if qty < 0:
        issues.append(
            {
                "level": "error",
                "code": "negative_qty",
                "message": f"qty negativa: {qty}.",
            }
        )

    # Warning: unit_cost=0 en expediente cerrado.
    if expediente_id and unit_cost == 0:
        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
            if (exp.estado or "").upper() == "CERRADO":
                issues.append(
                    {
                        "level": "warning",
                        "code": "zero_cost_closed",
                        "message": "unit_cost=0 en línea de expediente CERRADO.",
                    }
                )
        except Exception:
            pass

    # Warning: precio cliente por debajo del costo.
    price_cli = up_cli if up_cli > 0 else up_leg
    if qty > 0 and price_cli > 0 and unit_cost > 0 and price_cli < unit_cost:
        issues.append(
            {
                "level": "warning",
                "code": "client_price_below_cost",
                "message": (
                    f"unit_price_client ({price_cli}) < unit_cost ({unit_cost})."
                ),
            }
        )

    # Warning: snapshot dual inconsistente (precio MWT > precio cliente sin justificación).
    if up_mwt > 0 and up_cli > 0 and up_cli < up_mwt:
        issues.append(
            {
                "level": "warning",
                "code": "client_price_below_mwt",
                "message": (
                    f"unit_price_client ({up_cli}) < unit_price_mwt ({up_mwt})."
                ),
            }
        )

    return _split_issues(issues)
