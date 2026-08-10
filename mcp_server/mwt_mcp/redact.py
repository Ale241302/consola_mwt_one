"""Redacción de campos sensibles por rol en la frontera del MCP (Ola 3.5 · Eje B).

Política (fail-safe, alineada con POL_VISIBILIDAD del portal B2B y con la
matriz `core.roles.permissions` del backend):
  superadmin / admin / ceo  -> acceso total (sin redacción).
  client_b2b               -> NUNCA costos, márgenes, comisiones, límites de
                              crédito, precios internos MWT, proveedores ni PII.
  manager / operator /
  finance / compras / viewer -> se redacta el catálogo CEO_ONLY (costos,
                              márgenes, comisiones, crédito, precio MWT,
                              notas internas).

Dónde se aplica: en `server.py` el wrapper `_safe_role` envuelve la frontera de
cada tool de negocio (reemplaza `_safe`). Es la red de seguridad definitiva:
aunque una tool devuelva TODO lo que trae el backend, aquí se recorta lo que el
rol no debe ver. Los valores se oscurecen con `"***"` (no se elimina la clave)
para preservar el shape de la respuesta y no romper al agente que espera el campo.

Este módulo NO importa nada pesado (solo `copy`) para poder testearlo aislado.
"""
from __future__ import annotations

import copy

# --------------------------------------------------------------------------- #
# Catálogo de claves sensibles — ALINEADO con el backend real
# (apps/portal/serializers.py · POL_VISIBILIDAD + serializers de expedientes,
#  transfers, clientes, commercial, inventario).
#
# Nombres tal como los devuelve la API del backend. El `_strip` compara en
# minúsculas, así que una clave aquí (ej. "unit_cost") tapa "unit_cost" y
# "UNIT_COST" pero NO "unit_cost_usd" si esa clave no está listada.
# --------------------------------------------------------------------------- #
CEO_ONLY_KEYS: frozenset[str] = frozenset({
    # ── Costos internos (expedientes, transfers, inventario, proformas) ─────
    "unit_cost", "unit_cost_usd", "unit_value_usd", "unit_fob_usd",
    "costo_estandar", "costo_operativo", "costo_operativo_unitario_usd",
    "cost_share_usd", "landed_cost_usd", "landed_unit_usd", "landed_total_usd",
    "total_cost", "total_cost_usd", "cost_breakdown", "cost_lines",
    "snapshot_unit_cost", "snapshot_cost_share",
    # ── Precio interno MWT (el cliente ve unit_price_client, nunca el MWT) ───
    "unit_price_mwt", "price_view_mwt", "price_view", "unit_price",
    "total_mwt", "sobreprecio", "diferencial",
    # ── Rentabilidad / márgenes ──────────────────────────────────────────────
    "margen", "margen_usd", "margen_pct", "margin", "real_margin",
    "projected_margin", "margin_drift", "margins",
    # ── Comisiones (MWT) ─────────────────────────────────────────────────────
    "comision_pct", "commission_pct", "commission_amount",
    "commission_factor", "commission_base",
    # ── Crédito interno / bandas de riesgo ───────────────────────────────────
    "credito_limit_usd", "credito_aprobado", "credito_usado_interno",
    "credito_usado", "credit_band",
    # ── Notas y campos internos ──────────────────────────────────────────────
    "internal_notes", "notas_internas",
})

# Claves que además de CEO_ONLY tampoco ve un client_b2b:
#   · proveedores / fábrica (relación interna)
#   · PII del cliente (otra entidad) y de la operación
#   · decisión operativa interna (ruteo, bandas, bloqueos, semáforos)
B2B_FORBIDDEN_KEYS: frozenset[str] = CEO_ONLY_KEYS | frozenset({
    "supplier_id", "proveedor_id", "supplier_name", "proveedor_nombre",
    "proveedor", "supplier", "fabricante",
    "contact_email", "phone", "celular", "cedula", "tax_id", "ruc", "cuit",
    "modo_operacion", "freight_mode", "transport_mode", "dispatch_mode",
    "price_basis", "credit_days", "credit_days_mwt", "credit_days_cliente",
    "credit_clock_start_rule", "factory_delay", "is_blocked", "block_reason",
    "block_cause", "phase_signal", "phase_ratio", "available_transitions",
    "submitted_by", "submitted_by_user", "submitted_by_name",
    "pipeline_internal_filters", "view_pipeline_money",
})

_CEO_ADMIN_ROLES = {"superadmin", "admin", "ceo"}


def is_ceo_or_admin(role: str) -> bool:
    """True para roles con acceso total (superadmin/admin/ceo)."""
    return (role or "").strip().lower() in _CEO_ADMIN_ROLES


def is_client(role: str) -> bool:
    """True para roles del Portal B2B (client_b2b, client, cliente...)."""
    r = (role or "").strip().lower()
    return r.startswith("client_") or r in ("cliente", "client")


def forbidden_keys_for_role(role: str) -> frozenset[str] | None:
    """Devuelve el set de claves a redactar para el rol, o None si acceso total."""
    if is_ceo_or_admin(role):
        return None
    if is_client(role):
        return B2B_FORBIDDEN_KEYS
    return CEO_ONLY_KEYS


def _strip(value, forbidden: frozenset[str]):
    """Recursivo: oscurece con '***' las claves prohibidas en dicts y listas."""
    if isinstance(value, dict):
        return {
            k: "***" if (k or "").lower() in forbidden else _strip(v, forbidden)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_strip(v, forbidden) for v in value]
    return value


def redact_for_role(payload, role: str):
    """Devuelve el payload redactado según el rol.

    CEO/Admin -> devuelve el MISMO objeto (sin copiar: cero costo).
    Cualquier otro rol -> deep-copy + oscurecimiento de claves sensibles.
    """
    forbidden = forbidden_keys_for_role(role)
    if forbidden is None:
        return payload
    return _strip(copy.deepcopy(payload), forbidden)


def redact_for_user(payload, user: dict | None):
    """Redacta usando un dict de perfil de usuario (`get_identity_user()`).

    Si `user` es None (sin identidad → ServiceToken puro / stdio) NO redacta
    (comportamiento anterior, acorde al plan §5.4). El rol se resuelve de
    `role` o `role_slug`.
    """
    if not user:
        return payload
    role = user.get("role") or user.get("role_slug") or ""
    return redact_for_role(payload, role)
