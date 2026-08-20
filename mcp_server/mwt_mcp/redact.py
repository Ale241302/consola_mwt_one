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
    # ── Credenciales OAuth de la app MCP del cliente (POL_DATA_CLASSIFICATION):
    #    el Client Secret es secreto; no fluye por el canal del agente. Si el
    #    Operador necesita rotarlo, lo pide por un flujo dedicado, no en cada
    #    respuesta de cliente_crear/cliente_obtener.
    "oauth_client_secret", "client_secret", "client_credentials",
})

# Claves que además de CEO_ONLY tampoco ve un client_b2b:
#   · proveedores / fábrica (relación interna)
#   · PII del cliente (otra entidad) y de la operación
#   · decisión operativa interna (ruteo, bandas, bloqueos, semáforos)
#   · totales financieros internos: un client_b2b NO ve balance/total_cost/
#     total_invoiced/total_paid/márgenes — solo ve `monto_cliente_usd` que el
#     MCP server calcula como Σ(qty × unit_price_client) de sus líneas activas.
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
    # ── Totales financieros internos (B2B ve solo monto_cliente_usd) ─────────
    "balance", "total_invoiced", "total_paid", "total_paid_usd",
    "projected_margin", "real_margin", "margin_drift",
    "total_value", "unit_price", "unit_price_legacy",
    # ── Proforma interna MWT (el B2B no la ve; usa OC/SAP) ───────────────────
    "proforma", "proforma_codigo", "proforma_codigos",
})

_CEO_ADMIN_ROLES = {"superadmin", "admin", "ceo"}


def is_ceo_or_admin(role: str) -> bool:
    """True para roles con acceso total (superadmin/admin/ceo)."""
    return (role or "").strip().lower() in _CEO_ADMIN_ROLES


def is_client(role: str) -> bool:
    """True para roles del Portal B2B (client_b2b, client, cliente...)."""
    r = (role or "").strip().lower()
    return r.startswith("client_") or r in ("cliente", "client")


# ─────────────────────────────────────────────────────────────────────── #
# Ola 3.8 · Filtro sistémico de identificadores internos para client_b2b.
#
# El backend devuelve en TODOS los endpoints UUIDs de usuarios internos
# (created_by, approved_by, uploaded_by...), operating_company_id,
# proveedor_id, storage_url, object_key, sha256, scope_json, etc. Eso filtra
# la estructura interna de MWT al cliente. Aquí definimos:
#   · B2B_CHAINING_KEYS  -> UUIDs que el agente SÍ necesita para encadenar
#                           tools (expediente_obtener(expediente_id), ...).
#   · B2B_INTERNAL_ID_KEYS -> UUIDs internos puros que NUNCA debe ver el B2B.
#
# Regla sistémica en _strip: para client_b2b, cualquier clave que termine en
# "_id" y NO esté en la allowlist de encadenamiento se oscurece. Así un campo
# futuro (ej. "audit_actor_id") queda tapado automáticamente sin parche.
# ─────────────────────────────────────────────────────────────────────── #
B2B_CHAINING_KEYS: frozenset[str] = frozenset({
    # Identificadores que el agente necesita para llamar la siguiente tool.
    "id", "expediente_id", "oc_id", "client_id", "producto_id", "nodo_id",
    "marca_id", "brand_id", "legal_entity_id", "legal_entity_ids", "origen_id",
    "destino_id", "transferencia_id", "payment_id", "pago_id",
    "documento_id", "talla_id", "size_id", "stock_id", "applicable_code",
    "sap_id", "linea_id", "event_id", "template_id", "artifact_id",
})

# Claves que terminan en _id pero que NO son UUID de encadenamiento:
# UUIDs de usuario/auditoría, operador, proveedor, infraestructura.
B2B_INTERNAL_ID_SUFFIXES: tuple[str, ...] = (
    "_by", "_by_id", "_actor", "_operator", "_owner", "_assignee",
)
B2B_INTERNAL_ID_KEYS: frozenset[str] = frozenset({
    "created_by", "created_by_id", "updated_by_id", "approved_by_id",
    "received_by_id", "reconciled_by_id", "liquidated_by_id",
    "confirmed_by", "reverted_by", "actor_id", "uploaded_by",
    "uploaded_by_id", "responsable_id", "submitted_by", "submitted_by_user",
    "submitted_by_name", "operating_company_id", "proveedor_id",
    "proveedor_principal_id", "supplier_id", "nodo_asignado_id",
    "legal_entity_owner_id", "operator_id", "parent_id", "event_id",
    "linea_id_expediente", "document_id", "transferencia_id_nested",
    "bucket", "object_key", "file_key", "sha256", "storage_url",
    "archivo_url", "scope_json", "context_data", "ocr_payload_json",
    "idempotence_token", "visibility_tier", "codigo_marluvas", "hs_code",
})


def forbidden_keys_for_role(role: str) -> frozenset[str] | None:
    """Devuelve el set de claves a redactar para el rol, o None si acceso total."""
    if is_ceo_or_admin(role):
        return None
    if is_client(role):
        return B2B_FORBIDDEN_KEYS
    return CEO_ONLY_KEYS


def _is_internal_id_key(key: str) -> bool:
    """True si una clave de identificación interna (no encadenable) debe ocultarse.

    Se aplica a TODOS los roles (Ola 3.8): ni el client_b2b ni el admin/CEO
    deben recibir UUIDs internos de auditoría/operador/proveedor/infraestructura.
    Solo se conservan los IDs de encadenamiento (B2B_CHAINING_KEYS) que el
    agente necesita para llamar la siguiente tool.
    """
    k = (key or "").strip().lower()
    if k in B2B_CHAINING_KEYS:
        return False
    if k in B2B_INTERNAL_ID_KEYS:
        return True
    # Cualquier "*_id" futuro que no esté en la allowlist -> interno.
    if k.endswith("_id"):
        return True
    return False


def _is_exp_codigo(key: str, value) -> bool:
    """True si la clave es un código interno EXP- (número que solo usa el
    sistema). Cubre `codigo`, `codigo_interno`, `expediente_codigo` y cualquier
    clave que termine en `codigo`. Se elimina para TODOS los roles; el
    identificador presentable es `codigos_presentacion`."""
    kl = (key or "").lower()
    if not (kl == "codigo" or kl == "codigo_interno" or kl.endswith("_codigo")):
        return False
    if isinstance(value, list):
        return any(str(v).startswith("EXP-") for v in value)
    return isinstance(value, str) and value.startswith("EXP-")


def _strip(value, forbidden: frozenset[str], filter_internal_ids: bool = True):
    """Recursivo: oscurece con '***' las claves prohibidas en dicts y listas.

    `forbidden`: catálogo financiero del rol (vacío para admin/CEO, que sí ven
    costos/márgenes, pero NO UUIDs internos).
    `filter_internal_ids=True`: además se ocultan los identificadores internos
    (cualquier `*_id` fuera de la allowlist de encadenamiento). Es el filtro
    sistémico Ola 3.8 y aplica a TODOS los roles.
    """
    if isinstance(value, dict):
        out: dict = {}
        for k, v in value.items():
            kl = (k or "").lower()
            if kl in forbidden:
                out[k] = "***"
            elif _is_exp_codigo(k, v):
                continue  # EXP- interno: se elimina para todos los roles
            elif filter_internal_ids and _is_internal_id_key(kl):
                out[k] = "***"
            else:
                out[k] = _strip(v, forbidden, filter_internal_ids)
        return out
    if isinstance(value, list):
        return [_strip(v, forbidden, filter_internal_ids) for v in value]
    return value


def redact_for_role(payload, role: str):
    """Devuelve el payload redactado según el rol.

    Admin/CEO -> copia con TODOS los datos financieros visibles, pero SIN los
    UUIDs internos (auditoría/operador/proveedor/infraestructura). Se conservan
    solo los IDs de encadenamiento.
    Cualquier otro rol -> deep-copy + oscurecimiento financiero + sin UUIDs internos.
    """
    forbidden = forbidden_keys_for_role(role)
    if forbidden is None:
        forbidden = frozenset()  # admin/CEO: sin redacción financiera
    return _strip(copy.deepcopy(payload), forbidden, filter_internal_ids=True)


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


# ─────────────────────────────────────────────────────────────────────── #
# Ola 3.8 · Visibilidad de DOCUMENTOS y ARTEFACTOS para client_b2b.
#
# Reglas del negocio (verificado con el CEO):
#   · Documentos: un client_b2b SOLO ve audience="CLIENT" y kind OC/PROFORMA
#     de su cliente. NO ve FABRICA / MWT_INTERNAL / ADMIN_ONLY ni los
#     kind SAP (ART-04 / Confirmación SAP). Admin/CEO ven todo.
#   · Artefactos Builder (BL, packing list, factura, certificado...): un
#     client_b2b SOLO ve los que tienen `publicado=True`. Admin/CEO ven todos.
# ─────────────────────────────────────────────────────────────────────── #
# Audience del documento que un client_b2b SÍ puede ver.
B2B_VISIBLE_AUDIENCES: frozenset[str] = frozenset({"CLIENT", "CLIENTE"})
# Kind de documento que un client_b2b SÍ puede ver (regla CEO 2026-08-19:
# PROFORMA, OC y FACTURA — siempre con audience CLIENT).
B2B_VISIBLE_KINDS: frozenset[str] = frozenset({"OC", "PROFORMA", "FACTURA"})
# Kinds internos (SAP/confirmación y artefactos de proceso) ocultos al B2B.
B2B_HIDDEN_KIND_PREFIXES: tuple[str, ...] = ("ART-", "SAP", "PF_FABRICA", "FABRICA")


def _client_can_see_documento(doc: dict) -> bool:
    """Un client_b2b ve el documento solo si audience=CLIENT y kind visible."""
    audience = (doc.get("audience") or "").strip().upper()
    kind = (doc.get("kind") or "").strip().upper()
    if audience not in B2B_VISIBLE_AUDIENCES:
        return False
    if kind and kind not in B2B_VISIBLE_KINDS:
        return False
    return True


def _client_can_see_artefacto(art: dict) -> bool:
    """Un client_b2b ve el artefacto Builder solo si publicado=True."""
    return bool(art.get("publicado"))


def filter_documentos_for_role(payload, role: str):
    """Filtra la lista de documentos según el rol.

    Admin/CEO: sin cambios. client_b2b: solo audience=CLIENT y kind OC/PROFORMA.
    Aplica sobre listas o {results:[...]}. Fail-safe: devuelve el payload tal cual."""
    if is_ceo_or_admin(role) or not is_client(role):
        return payload

    def _keep(row):
        return _client_can_see_documento(row) if isinstance(row, dict) else True

    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        out = dict(payload)
        out["results"] = [r for r in out["results"] if _keep(r)]
        return out
    if isinstance(payload, list):
        return [r for r in payload if _keep(r)]
    return payload


def filter_artefactos_for_role(payload, role: str):
    """Filtra la lista de artefactos Builder según el rol.

    Admin/CEO: sin cambios. client_b2b: solo publicado=True.
    Aplica sobre listas o {results:[...]}. Fail-safe: devuelve el payload tal cual."""
    if is_ceo_or_admin(role) or not is_client(role):
        return payload

    def _keep(row):
        return _client_can_see_artefacto(row) if isinstance(row, dict) else True

    def _sane(row):
        if not isinstance(row, dict):
            return row
        out = dict(row)
        # Email interno del autor no se expone al cliente.
        out.pop("created_by_name", None)
        out.pop("updated_by_name", None)
        return out

    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        out = dict(payload)
        out["results"] = [_sane(r) for r in out["results"] if _keep(r)]
        return out
    if isinstance(payload, list):
        return [_sane(r) for r in payload if _keep(r)]
    return payload
