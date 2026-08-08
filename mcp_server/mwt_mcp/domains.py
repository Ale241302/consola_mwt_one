"""Ola 2 · 2.14 — Registro de dominios para partir el MCP monolito.

El objetivo del split es reducir el costo fijo de contexto por conversación:
un agente comercial no necesita cargar veinte tools de logística/finanzas.

Estrategia (bajo riesgo, sin duplicar lógica): las funciones-tool viven en
`server.py` (fuente única de verdad). `@FastMCP.tool()` devuelve la función
inalterada, así que `domains.build(domain)` crea una instancia `FastMCP` nueva
y re-registra (add_tool) SOLO las tools del dominio pedido. El monolito
`server.py :: mcp` queda intacto y funcional (compatibilidad hacia atrás).

Dominios (definición del plan 2.14):
  - comercial : clientes, productos, OCs, proformas, marcas, tipo de cambio.
  - logistica : expedientes, documentos, SAP, match, fusión, nodos, inventario,
                transferencias, artefactos del Builder.
  - finanzas  : pagos, costos, liquidación landed, facturas, notas.

Shared (todas): introspección (whoami, health, audit registry) + storage
(subir/descargar binarios).
"""
from __future__ import annotations

from typing import Iterable

from mcp.server.fastmcp import FastMCP

# --------------------------------------------------------------------------- #
# Dominio -> tools (nombre final tal como se registra).
# --------------------------------------------------------------------------- #

# Introspección + storage compartidos (en TODOS los servidores de dominio).
SHARED_TOOLS = {
    "mwt_whoami",
    "mwt_health",
    "mwt_audit_write_registry",
    "storage_subir_archivo",
    "artefacto_archivo_descargar",
}

COMERCIAL = {
    # clientes
    "cliente_listar", "cliente_obtener", "cliente_crear", "cliente_editar",
    "cliente_subsidiarias", "cliente_kpis_pool",
    # productos / NCM / tallas / alias
    "producto_listar", "producto_obtener", "producto_crear", "producto_editar",
    "ncm_listar", "tallas_listar", "producto_alias_crear",
    # OCs / proformas / marcas / tipo de cambio
    "oc_listar", "oc_obtener", "oc_editar",
    "marca_listar", "tipo_cambio",
    "proforma_generar", "proforma_html",
}

LOGISTICA = {
    # expedientes
    "expediente_listar", "expediente_obtener", "expediente_buscar",
    "expediente_lineas", "expediente_crear", "expedientes_crear_lote",
    "lineas_actualizar_precios", "expediente_apply_pronto_pago",
    "expediente_editar", "expediente_eliminar",
    "expediente_edit_full_get", "expediente_edit_full_patch",
    "expediente_resolve_oc_preview",
    # documentos
    "documento_subir", "documento_listar", "documento_eliminar",
    "documento_descargar", "documento_editar",
    # SAP / matchmaker
    "sap_analizar", "sap_confirmar", "sap_upsert", "sap_obtener",
    "sap_editar", "sap_sincronizar_discrepancias",
    "match_subir", "match_resolver",
    # fusión
    "expediente_fusionar", "expediente_fusion_label", "expediente_desfusionar",
    # pipeline / fases
    "expediente_avanzar_estado", "expediente_phase_durations_get",
    "expediente_phase_durations_set", "expediente_eventos",
    # nodos / inventario
    "nodo_listar", "nodo_obtener", "nodo_crear", "nodo_editar",
    "nodo_artefactos_listar", "nodo_artefacto_crear",
    "stock_listar", "inventario_saldos_por_expediente",
    "inventario_expedientes_con_pendiente", "inventario_lineas_en_nodo",
    "recepcion_crear", "inventario_transferir_asignaciones",
    "inventario_artefactos_expediente",
    # transferencias (movimiento/estado/notas) + artefactos asociados
    "transferencia_listar", "transferencia_obtener", "transferencia_crear",
    "transferencia_avanzar", "transferencia_aprobar", "transferencia_despachar",
    "transferencia_editar", "transferencia_recibir", "transferencia_conciliar",
    "transferencia_cerrar", "transferencia_cancelar",
    "transfer_artefacto_crear", "transfer_notas_listar", "transfer_nota_crear",
    # artefactos Builder (editar/publicar)
    "artefacto_editar", "artefacto_publicar",
    "builder_templates_listar", "builder_template_obtener",
}

FINANZAS = {
    # pagos
    "pago_applicables", "pago_listar", "pago_obtener", "pago_dry_run",
    "pago_registrar", "pago_conciliar", "pago_liberar_credito", "pago_rechazar",
    # costos incrementales
    "transfer_costos_listar", "transfer_costo_agregar", "transfer_costo_editar",
    "transfer_costo_eliminar",
    # liquidación landed
    "transfer_liquidacion_preview", "transfer_liquidar",
    # facturas
    "factura_payload", "transfer_factura_payload",
}

DOMAIN_NAMES = {"comercial", "logistica", "finanzas"}

DOMAINS = {
    "comercial": COMERCIAL,
    "logistica": LOGISTICA,
    "finanzas": FINANZAS,
}

SERVER_LABELS = {
    "comercial": "mwt-comercial",
    "logistica": "mwt-logistica",
    "finanzas": "mwt-finanzas",
}

BRIEF_DESC = {
    "comercial": "MWT ONE · Comercial: clientes, productos, OCs, proformas, marcas y tipo de cambio.",
    "logistica": "MWT ONE · Logística: expedientes, documentos, SAP, nodos, inventario, transferencias y artefactos.",
    "finanzas": "MWT ONE · Finanzas: pagos, costos incrementales, liquidación landed y facturas.",
}


# --------------------------------------------------------------------------- #
# Construcción de un servidor de dominio
# --------------------------------------------------------------------------- #
def _tool_fns(names: Iterable[str]) -> dict:
    """Importa de server.py las funciones-tool por nombre.

    Importamos en caliente (dentro de la función) para evitar ciclos; el costo de
    definir el módulo monolito es de arranque, no por conversación.
    """
    from . import server as _server

    out = {}
    for n in names:
        fn = getattr(_server, n, None)
        if fn is None:
            raise NameError(f"Tool de dominio no encontrada en server.py: {n}")
        out[n] = fn
    return out


def build(domain: str) -> FastMCP:
    """Devuelve una instancia FastMCP de dominio con SOLO sus tools (+shared).

    Si `domain` no está en DOMAINS, lanza ValueError. El nombre del servidor es
    el rótulo de dominio (ej. 'mwt-comercial') para montarlos por separado en
    ContextForge.
    """
    if domain not in DOMAINS:
        raise ValueError(f"Dominio desconocido: {domain!r}. Válidos: {sorted(DOMAIN_NAMES)}.")

    mcp = FastMCP(SERVER_LABELS[domain])
    try:
        mcp.description = BRIEF_DESC[domain]
    except Exception:  # noqa: BLE001 - ajuste de metadato opcional
        pass

    names = SHARED_TOOLS | DOMAINS[domain]
    for name, fn in _tool_fns(names).items():
        mcp.add_tool(fn, name=name)
    return mcp


def list_domains() -> list[str]:
    """Lista ordenada de los dominios disponibles."""
    return sorted(DOMAINS)
