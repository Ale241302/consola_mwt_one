"""Ola 2 · filtrado de tools por rol del usuario conectado (RBAC).

El MCP monolito (mwt-one) sigue exponiendo las 105 tools. En lugar de partir
el servidor en 3 dominios, cada usuario conectado vía el gateway (ContextForge
→ Authentik) ve SOLO las tools cuyo (módulo, acción) su rol permite, según la
matriz `core.roles.permissions` (modules[] + actions["modulo.accion"]) que el
backend devuelve en `POST /api/auth/mcp-token/`.

Reglas:
  - Sin identidad propagada (acceso directo por ServiceToken, stdio, o
    registro del server en ContextForge) → se listan TODAS las tools.
  - Con identidad: se filtran por (module, action) del mapa TOOL_MODULES.
  - Los roles admin/superadmin (o modules=["*"]) ven todas.
  - Fail-closed: si hay identidad pero el backend no emite JWT (usuario
    inactivo/borrado) → lista de tools VACÍA (el usuario no puede usar nada).
"""
from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP
from mcp.types import Tool as MCPTool

from .config import settings
from .jwt_minter import IdentityMintingError, get_identity_user

log = logging.getLogger("mwt_mcp.rbac")

# Roles que siempre ven todas las tools (espejo de BYPASS_ROLES del backend).
_WILDCARD_ROLES = {"superadmin", "admin", "ceo"}

# Tool name -> (module_slug, action). El action usa el formato de
# core.roles.permissions: module.action (create/view/update/delete/
# upload_doc/download_doc/view_doc). Las tools de introspección/salud y
# utilidades puras no requieren módulo (siempre disponibles).
_ALWAYS = None  # marcador: tool siempre visible

# Ola 2 · 2.5 — tools de introspección GLOBAL (operador MWT) que se ocultan en
# una app de cliente (tenant resuelto). Un usuario de mcp-sondel no debe ver
# diagnóstico de usuarios/permisos ni el registry global de escrituras.
_GLOBAL_ONLY_TOOLS = frozenset({
    "mwt_diag_scope",
    "mwt_audit_write_registry",
})

TOOL_MODULES: dict[str, tuple[str, str] | None] = {
    # ── Introspección / salud / utilidades (siempre visibles) ──────────────
    "mwt_whoami": _ALWAYS,
    "mwt_health": _ALWAYS,
    "mwt_audit_write_registry": _ALWAYS,
    "tipo_cambio": _ALWAYS,
    # mwt_diag_scope es CEO-only (diagnóstico de usuarios/permisos). Se mapea
    # a "roles.view" para que SOLO roles con acceso a la matriz de roles (admin/
    # superadmin) la vean en el listado; un client_b2b no la tiene.
    "mwt_diag_scope": ("roles", "view"),
    # ── Clientes ───────────────────────────────────────────────────────────
    "cliente_listar": ("clientes", "view"),
    "cliente_obtener": ("clientes", "view"),
    "cliente_crear": ("clientes", "create"),
    "cliente_editar": ("clientes", "update"),
    "cliente_subsidiarias": ("clientes", "view"),
    "cliente_kpis_pool": ("clientes", "view"),
    # ── Productos / NCM / tallas / marcas ──────────────────────────────────
    "producto_listar": ("productos", "view"),
    "producto_obtener": ("productos", "view"),
    "producto_buscar": ("productos", "view"),
    "producto_precio_cliente": ("productos", "view"),
    "producto_ficha_tecnica": ("productos", "view"),
    "producto_crear": ("productos", "create"),
    "producto_editar": ("productos", "update"),
    "producto_alias_crear": ("productos", "create"),
    "ncm_listar": ("productos", "view"),
    "tallas_listar": ("sizing", "view"),
    "marca_listar": ("marcas", "view"),
    # ── OCs / proformas ────────────────────────────────────────────────────
    "oc_listar": ("expedientes", "view"),
    "oc_obtener": ("expedientes", "view"),
    "oc_editar": ("expedientes", "update"),
    "proforma_generar": ("expedientes", "create"),
    "proforma_html": ("expedientes", "view"),
    "factura_payload": ("expedientes", "view"),
    # ── Expedientes ────────────────────────────────────────────────────────
    "expediente_listar": ("expedientes", "view"),
    "expediente_obtener": ("expedientes", "view"),
    "expediente_buscar": ("expedientes", "view"),
    "expediente_lineas": ("expedientes", "view"),
    "expediente_documentos_completos": ("expedientes", "view"),
    "expediente_buscar_por_producto": ("expedientes", "view"),
    "expediente_resolve_oc_preview": ("expedientes", "create"),
    "expediente_crear": ("expedientes", "create"),
    "expedientes_crear_lote": ("expedientes", "create"),
    "lineas_actualizar_precios": ("expedientes", "update"),
    "expediente_apply_pronto_pago": ("expedientes", "update"),
    "expediente_editar": ("expedientes", "update"),
    "expediente_eliminar": ("expedientes", "delete"),
    "expediente_edit_full_get": ("expedientes", "view"),
    "expediente_edit_full_patch": ("expedientes", "update"),
    "expediente_avanzar_estado": ("expedientes", "update"),
    "expediente_phase_durations_get": ("expedientes", "view"),
    "expediente_tiempos": ("expedientes", "view"),
    "expediente_phase_durations_set": ("expedientes", "update"),
    "expediente_eventos": ("expedientes", "view"),
    "expediente_fusionar": ("expedientes", "update"),
    "expediente_fusion_label": ("expedientes", "update"),
    "expediente_desfusionar": ("expedientes", "update"),
    # ── Documentos ─────────────────────────────────────────────────────────
    "documento_subir": ("expedientes", "upload_doc"),
    "documento_listar": ("expedientes", "view_doc"),
    "documento_eliminar": ("expedientes", "delete"),
    "documento_descargar": ("expedientes", "download_doc"),
    "documento_editar": ("expedientes", "update"),
    # ── SAP / matchmaker ───────────────────────────────────────────────────
    "sap_analizar": ("expedientes", "view"),
    "sap_confirmar": ("expedientes", "update"),
    "sap_upsert": ("expedientes", "create"),
    "sap_obtener": ("expedientes", "view"),
    "sap_editar": ("expedientes", "update"),
    "sap_sincronizar_discrepancias": ("expedientes", "update"),
    "match_subir": ("expedientes", "upload_doc"),
    "match_resolver": ("expedientes", "update"),
    # ── Nodos + artefactos Builder ─────────────────────────────────────────
    "nodo_listar": ("nodos", "view"),
    "nodo_obtener": ("nodos", "view"),
    "nodo_crear": ("nodos", "create"),
    "nodo_editar": ("nodos", "update"),
    "nodo_artefactos_listar": ("nodos", "view"),
    "nodo_artefacto_crear": ("nodos", "create"),
    "artefacto_editar": ("nodos", "update"),
    "artefacto_publicar": ("nodos", "update"),
    "builder_templates_listar": ("nodos", "view"),
    "builder_template_obtener": ("nodos", "view"),
    # ── Inventario / recepción ─────────────────────────────────────────────
    "stock_listar": ("inventario", "view"),
    "inventario_saldos_por_expediente": ("inventario", "view"),
    "inventario_expedientes_con_pendiente": ("inventario", "view"),
    "inventario_lineas_en_nodo": ("inventario", "view"),
    "recepcion_crear": ("inventario", "create"),
    "inventario_transferir_asignaciones": ("inventario", "update"),
    "inventario_artefactos_expediente": ("inventario", "view"),
    # ── Transferencias ─────────────────────────────────────────────────────
    "transferencia_listar": ("transferencias", "view"),
    "transferencia_obtener": ("transferencias", "view"),
    "transferencia_crear": ("transferencias", "create"),
    "transferencia_avanzar": ("transferencias", "update"),
    "transferencia_aprobar": ("transferencias", "update"),
    "transferencia_despachar": ("transferencias", "update"),
    "transferencia_editar": ("transferencias", "update"),
    "transferencia_recibir": ("transferencias", "update"),
    "transferencia_conciliar": ("transferencias", "update"),
    "transferencia_cerrar": ("transferencias", "update"),
    "transferencia_cancelar": ("transferencias", "update"),
    "transfer_artefacto_crear": ("transferencias", "create"),
    "transfer_notas_listar": ("transferencias", "view"),
    "transfer_nota_crear": ("transferencias", "create"),
    "transfer_costos_listar": ("transferencias", "view"),
    "transfer_costo_agregar": ("transferencias", "create"),
    "transfer_costo_editar": ("transferencias", "update"),
    "transfer_costo_eliminar": ("transferencias", "delete"),
    "transfer_liquidacion_preview": ("transferencias", "view"),
    "transfer_liquidar": ("transferencias", "update"),
    "transfer_factura_payload": ("transferencias", "view"),
    # ── Pagos ──────────────────────────────────────────────────────────────
    "pago_applicables": ("pagos", "view"),
    "pago_listar": ("pagos", "view"),
    "pago_obtener": ("pagos", "view"),
    "pago_dry_run": ("pagos", "create"),
    "pago_registrar": ("pagos", "create"),
    "pago_conciliar": ("pagos", "update"),
    "pago_liberar_credito": ("pagos", "update"),
    "pago_rechazar": ("pagos", "update"),
    # ── Storage ────────────────────────────────────────────────────────────
    "storage_subir_archivo": ("storage", "create"),
    "artefacto_archivo_descargar": ("storage", "download_doc"),
    # ── Presentación (Ola 3.10 ampliada · 5 categorías, solo lectura) ──────
    # Dos grupos:
    #   · De datos (leen analytics/*)  → `analytics` (el enforcement del
    #     backend valida analytics.view para /api/analytics/*).
    #   · Genéricas (solo envían datos al motor presentation/render que
    #     valida `dashboard`) → `dashboard` (presente en todas las matrices,
    #     incl. client_b2b).
    "generar_grafico": ("dashboard", "view"),      # genérica
    "cashflow_chart": ("analytics", "view"),       # lee analytics/cashflow
    "margen_marcas_chart": ("analytics", "view"),  # lee analytics/margen_marcas (CEO-only backend)
    "aging_chart": ("analytics", "view"),          # lee analytics/aging
    "exposicion_chart": ("analytics", "view"),     # lee analytics/exposicion_clientes
    "render_tabla": ("dashboard", "view"),         # genérica
    "generar_reporte": ("dashboard", "view"),      # genérica
    "reporte_cobranza": ("analytics", "view"),     # lee analytics/aging
    "reporte_expedientes": ("analytics", "view"),  # lee analytics/by_status
    "dashboard_resumen": ("analytics", "view"),    # lee analytics/*
    "comparar": ("dashboard", "view"),             # genérica
    "exportar_xlsx": ("dashboard", "view"),        # genérica
    "exportar_csv": ("dashboard", "view"),         # genérica
}


def _normalize_permissions(user: dict) -> dict:
    perms = (user or {}).get("permissions") or {}
    if isinstance(perms, dict):
        return perms
    if isinstance(perms, str):
        import json

        try:
            parsed = json.loads(perms)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:  # noqa: BLE001
            return {}
    if isinstance(perms, list):
        return {"modules": perms}
    return {}


def allowed_tool_names(user: dict) -> set[str] | None:
    """Devuelve el set de tools permitidas para el usuario, o None si todas.

    None significa "sin restricción" (sin identidad, o modules=["*"] explícito
    en la matriz). Admin/superadmin NO reciben wildcard automático: se respeta
    la matriz real de core.roles.permissions que configura el CEO en /roles
    (si deshabilitó clientes.create para admin, la tool cliente_crear no
    aparece).

    Las tools son dinámicas según la matriz de permisos del rol: una tool se
    muestra solo si su (módulo, acción) tiene permiso (can_* = true). En una
    app de cliente se ocultan además las tools de gobernanza interna MWT
    (_GLOBAL_ONLY_TOOLS); el aislamiento de datos vive en el backend.
    """
    if not user:
        return None

    perms = _normalize_permissions(user)
    modules = perms.get("modules") or []
    actions = perms.get("actions") or []

    if "*" in modules:
        return None
    if not modules:
        # Rol sin matriz materializada: solo tools de introspección (seguro).
        return {name for name, req in TOOL_MODULES.items() if req is None}

    allowed: set[str] = set()
    for name, req in TOOL_MODULES.items():
        if req is None:
            allowed.add(name)
            continue
        module, action = req
        if module not in modules:
            continue
        if actions and "*" not in actions and f"{module}.{action}" not in actions:
            continue
        allowed.add(name)

    # Ola 2 · 2.5 — guard anti-bypass: en una app de cliente (tenant resuelto),
    # las tools globales de introspección interna NO se listan aunque el rol
    # sea admin/superadmin. Un admin conectado a mcp-sondel opera como Sondel,
    # no como operador MWT global.
    from .identity import current_tenant

    if current_tenant().is_scoped:
        allowed -= _GLOBAL_ONLY_TOOLS

    return allowed


class RbacFastMCP(FastMCP):
    """FastMCP que filtra `list_tools` por el rol del usuario conectado.

    Sin identidad (ServiceToken / registro) → todas. Con identidad → solo las
    tools del rol. Fail-closed: identidad inválida → lista vacía.
    """

    async def list_tools(self) -> list[MCPTool]:
        tools = await super().list_tools()
        if not settings.rbac_filter:
            return tools
        try:
            user = get_identity_user()
        except IdentityMintingError as exc:
            # Fail-closed: identidad propagada pero sin JWT válido. El usuario
            # (inactivo/borrado) no debe ver ninguna tool.
            log.warning("list_tools fail-closed: %s", exc)
            return []
        except Exception as exc:  # noqa: BLE001
            # Error inesperado al resolver identidad → fail-closed (vacío).
            log.warning("list_tools: no se pudo resolver identidad: %s", exc)
            return []

        if user is None:
            return tools

        allowed = allowed_tool_names(user)
        if allowed is None:
            return tools

        filtered = [t for t in tools if t.name in allowed]
        log.info(
            "list_tools RBAC: %d/%d tools para %s (rol=%s)",
            len(filtered), len(tools),
            (user.get("email") or user.get("id") or "?"),
            (user.get("role") or user.get("role_slug") or "?"),
        )
        return filtered
