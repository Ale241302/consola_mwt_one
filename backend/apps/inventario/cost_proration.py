"""
=====================================================================
MWT.ONE · apps.inventario.cost_proration
Sprint 2026-06-02 · Prorrateo de costos operativos de recepción.

Cada línea de costo (cost_line) puede tener un `scope`:
    None / {"applies_to_all": true}            → aplica a TODO el lote
    {"applies_to_all": false, "lines":[...]}   → solo esas líneas
    {"applies_to_all": false, "expediente_ids":[...]}  → todas las líneas
                                                          de esos expedientes

Cada costo (en USD) se prorratea por unidad SOLO sobre las unidades de su
alcance. El costo operativo por unidad resultante de cada línea del lote es
la suma de los aportes de todas las cost_lines que la incluyen.

Compartido por:
    · views.ExpedienteNodoAssignmentViewSet.bulk_create  (flow assign)
    · inbound_views.InboundReceiveView                   (flow legacy)
=====================================================================
"""
from __future__ import annotations


def _line_usd(cl) -> float:
    try:
        return float(cl.get("amount") or 0) * float(cl.get("fx_to_usd") or 1)
    except (TypeError, ValueError):
        return 0.0


def _unit_key(u) -> tuple:
    return (
        str(u.get("expediente_id") or ""),
        str(u.get("producto_id") or ""),
        (u.get("talla") or ""),
    )


def _scope_units(scope, units):
    """Devuelve la sublista de `units` que cae dentro de `scope`."""
    if not scope or scope.get("applies_to_all", True) is True:
        return units
    lines = scope.get("lines") or []
    if lines:
        keyset = {(
            str(l.get("expediente_id") or ""),
            str(l.get("producto_id") or ""),
            (l.get("talla") or ""),
        ) for l in lines}
        return [u for u in units if _unit_key(u) in keyset]
    exp_ids = {str(x) for x in (scope.get("expediente_ids") or [])}
    if exp_ids:
        return [u for u in units if str(u.get("expediente_id") or "") in exp_ids]
    return units


def operative_per_unit_map(cost_lines, units):
    """Calcula el costo operativo por unidad de cada `unit`, honrando scope.

    Args:
        cost_lines: [{amount, fx_to_usd, scope|scope_json}]
        units:      [{idx, qty, expediente_id, producto_id, talla}]
    Returns:
        dict {idx -> costo_operativo_unitario_usd (float, 4 decimales)}
    """
    cost_total = {u["idx"]: 0.0 for u in units}
    for cl in (cost_lines or []):
        usd = _line_usd(cl)
        if not usd:
            continue
        scope = cl.get("scope") or cl.get("scope_json")
        scoped = _scope_units(scope, units)
        base = sum(float(u.get("qty") or 0) for u in scoped)
        if base <= 0:
            continue
        for u in scoped:
            cost_total[u["idx"]] += usd * (float(u.get("qty") or 0) / base)
    out = {}
    for u in units:
        q = float(u.get("qty") or 0)
        out[u["idx"]] = round(cost_total[u["idx"]] / q, 4) if q else 0
    return out
