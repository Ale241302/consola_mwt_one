#!/usr/bin/env python3
"""
Skills-MCP · armador (generador) de SKILL.md por rol · módulo · permiso.

Fuentes de verdad:
  1. core.roles.permissions (matriz exacta role -> module -> action) — volcada abajo.
  2. mcp_server/mwt_mcp/tool_rbac.py  (tool -> (module, action)).
  3. server.py (docstrings de cada @mcp.tool()).

Genera:
  Skills-MCP/
    README.md
    _contratos/<modulo>.md
    <rol>/<modulo>/<accion>/SKILL.md

Ejecución:  python generar.py
(se ejecuta desde la raíz del repo; el script localiza server.py relativo a sí mismo)
"""
from __future__ import annotations

import os
import re
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SERVER_PY = REPO / "mcp_server" / "mwt_mcp" / "server.py"
OUT = Path(__file__).resolve().parent

# --------------------------------------------------------------------------- #
# Roles (slug -> nombre legible + descripción corta)
# --------------------------------------------------------------------------- #
ROLES = {
    "superadmin": "Super Admin",
    "admin": "Admin (CEO)",
    "manager": "Manager",
    "operator": "Operador",
    "finance": "Finance",
    "compras": "Compras",
    "viewer": "Viewer (solo lectura)",
    "client_b2b": "Cliente B2B",
}

# --------------------------------------------------------------------------- #
# Acciones (permiso) -> carpeta + verbo + descripción
# --------------------------------------------------------------------------- #
ACTIONS = {
    "create":       ("crear",              "crear"),
    "view":         ("leer",               "consultar/listar"),
    "update":       ("editar",             "actualizar/modificar"),
    "delete":       ("eliminar",           "eliminar/borrar"),
    "upload_doc":   ("subir-documento",    "subir un archivo/documento"),
    "download_doc": ("descargar-documento","descargar un archivo/documento"),
    "view_doc":     ("ver-documento",      "ver/listar documentos"),
}

# --------------------------------------------------------------------------- #
# Módulos -> contrato (label, categoría, descripción, frontend, backend, notas)
# --------------------------------------------------------------------------- #
MODULES = {
    "dashboard": {
        "label": "Dashboard", "categoria": "CORE",
        "desc": "Vista ejecutiva de rentabilidad, cash flow y logística en vivo.",
        "frontend": ["frontend/src/pages/Dashboard.jsx", "frontend/src/components/dashboard/"],
        "backend": ["backend/apps/analytics/", "backend/apps/core/"],
        "notas": [
            "Métricas de resumen vía tools analytics/dashboard (dashboard_resumen, cashflow_chart, etc.).",
            "Herramientas genéricas de presentación (render_tabla, exportar_csv/xlsx, generar_grafico) caen en módulo dashboard.",
        ],
    },
    "analytics": {
        "label": "Analytics", "categoria": "DASHBOARD",
        "desc": "KPIs, cash flow, margen por marca, aging y exposición de clientes.",
        "frontend": ["frontend/src/pages/Finanzas.jsx", "frontend/src/pages/Pipeline.jsx"],
        "backend": ["backend/apps/analytics/"],
        "notas": [
            "En su mayoría SOLO LECTURA (analytics.view).",
            "margen_marcas_chart y finanzas_* son CEO/Admin (módulo finanzas).",
            "El enforcement del backend valida analytics.view para /api/analytics/*.",
        ],
    },
    "expedientes": {
        "label": "Expedientes", "categoria": "CORE",
        "desc": "Núcleo operativo: expedientes, OCs, proformas, líneas, SAP, documentos, fusiones y estados.",
        "frontend": ["frontend/src/pages/Expedientes.jsx", "frontend/src/pages/ExpedienteDetail.jsx",
                     "frontend/src/pages/OCDetail.jsx", "frontend/src/pages/FusionDetail.jsx",
                     "frontend/src/pages/CreateExpedienteWizardLite.jsx"],
        "backend": ["backend/apps/expedientes/"],
        "notas": [
            "Es el módulo con más tools MCP (expediente_*, oc_*, proforma_*, sap_*, match_*, documento_*).",
            "documento_subir/descargar/ver/listar se rigen por upload_doc/download_doc/view_doc.",
            "sap_confirmar por sku+size sin linea_id devuelve 400 (defecto 2 corregido).",
            "dispatch_mode solo FCL/LCL/CONSOLIDADO (defecto 1 corregido).",
            "El tracking/packing list/AWB/BL son ARTEFACTOS del Builder (no `documentos`): solo visibles al cliente si publicado=True (artefacto_publicar).",
        ],
    },
    "portal": {
        "label": "Portal", "categoria": "CORE",
        "desc": "Portal B2B: catálogo, precios y documentos visibles al cliente final.",
        "frontend": ["frontend/src/pages/Portal.jsx", "frontend/src/pages/PortalProductDetail.jsx"],
        "backend": ["backend/apps/portal/"],
        "notas": [
            "client_b2b tiene scope estricto a su legal_entity_id.",
            "El detalle de producto en portal filtra precios por rol.",
        ],
    },
    "clientes": {
        "label": "Clientes", "categoria": "COMERCIAL",
        "desc": "Alta/edición de clientes, crédito, subsidiarias y KPIs de pool.",
        "frontend": ["frontend/src/pages/Clientes.jsx", "frontend/src/pages/ClienteDetail.jsx", "frontend/src/pages/ClienteFormView.jsx"],
        "backend": ["backend/apps/clientes/"],
        "notas": [
            "codigo_marluvas: exactamente 10 dígitos y único entre clientes ACTIVOS (defecto 3 corregido).",
            "credito_limit_usd / comision_pct son CEO-only.",
        ],
    },
    "finanzas": {
        "label": "Finanzas", "categoria": "FINANCIERO",
        "desc": "Rentabilidad interna, comisiones, margen y devengo. SOLO CEO/Admin.",
        "frontend": ["frontend/src/pages/Finanzas.jsx"],
        "backend": ["backend/apps/finanzas/", "backend/apps/finance/"],
        "notas": [
            "Solo admin/superadmin tienen finanzas.view (ver costos y márgenes).",
            "Tools finanzas_* son de solo lectura.",
        ],
    },
    "marcas": {
        "label": "Marcas", "categoria": "COMERCIAL",
        "desc": "Marcas, pricing por marca/cliente y bandas de precio.",
        "frontend": ["frontend/src/pages/Brands.jsx", "frontend/src/pages/BrandDetail.jsx", "frontend/src/pages/BrandClientPricingForm.jsx"],
        "backend": ["backend/apps/brands/"],
        "notas": [
            "Tool marca_listar es de solo lectura (marcas.view).",
        ],
    },
    "productos": {
        "label": "Productos", "categoria": "COMERCIAL",
        "desc": "Catálogo de productos, SKUs, NCM, precios y fichas técnicas.",
        "frontend": ["frontend/src/pages/Productos.jsx", "frontend/src/pages/ProductFormView.jsx", "frontend/src/pages/NcmEngine.jsx"],
        "backend": ["backend/apps/productos/"],
        "notas": [
            "ncm_listar y tallas_listar caen en productos.view / sizing.view.",
            "producto_precio_cliente y producto_ficha_tecnica son de consulta.",
        ],
    },
    "sizing": {
        "label": "Motor de Tallas", "categoria": "CATALOGOS",
        "desc": "Matriz de tallas, equivalencias y corridas por familia/marca.",
        "frontend": ["frontend/src/pages/SizingEngine.jsx", "frontend/src/components/marluvas/"],
        "backend": ["backend/apps/sizing/"],
        "notas": [
            "tallas_listar usa sizing.view.",
            "Soporta tallas dobles (33/34, 35/36, 45/46) en ops.tallas.",
        ],
    },
    "historial-precios": {
        "label": "Historial de precios", "categoria": "COMERCIAL",
        "desc": "Histórico de precios de productos por banda/cliente.",
        "frontend": ["frontend/src/pages/PriceHistory.jsx"],
        "backend": ["backend/apps/commercial/", "backend/apps/productos/"],
        "notas": [
            "lineas_actualizar_precios mapea a expedientes.update (no a este módulo).",
        ],
    },
    "transferencias": {
        "label": "Transferencias", "categoria": "ALMACEN",
        "desc": "Transferencias entre nodos, costos y liquidación landed cost.",
        "frontend": ["frontend/src/pages/Transfers.jsx", "frontend/src/pages/TransferDetail.jsx", "frontend/src/pages/CreateTransferWizard.jsx"],
        "backend": ["backend/apps/transfers/"],
        "notas": [
            "transfer_liquidar EXCLUYE IVA del landed cost (P0 corregido).",
            "transfer_costo_* gestionan costos extra (DAI por NCM, etc.).",
        ],
    },
    "nodos": {
        "label": "Nodos", "categoria": "ALMACEN",
        "desc": "Nodos/almacenes y artefactos del Builder (AWB/BL, guías).",
        "frontend": ["frontend/src/pages/Nodos.jsx", "frontend/src/pages/NodoDetail.jsx"],
        "backend": ["backend/apps/nodos/"],
        "notas": [
            "El artefacto de envío del nodo es fuente de verdad de tracking/carrier/ETD/ETA.",
            "builder_template_* y artefacto_* caen en nodos.*.",
            "artefacto_publicar(publicado=True) hace visible el artefacto (tracking/packing list) al client_b2b.",
        ],
    },
    "builder": {
        "label": "MWT Builder", "categoria": "CORE",
        "desc": "Gobernanza de plantillas del Builder externo (builder.muito.work). Solo operadores MWT.",
        "frontend": ["frontend/src/pages/AIGovernance.jsx", "frontend/src/pages/AIHub.jsx"],
        "backend": ["backend/apps/ai_hub/", "mcp_server/mwt_mcp/builder_client.py"],
        "notas": [
            "Solo admin/superadmin (module builder).",
            "tools builder_* hablan con el Builder externo, no con la BD.",
        ],
    },
    "inventario": {
        "label": "Inventario", "categoria": "ALMACEN",
        "desc": "Stock, recepción, saldos por expediente y asignaciones de inventario.",
        "frontend": ["frontend/src/pages/Inventario.jsx", "frontend/src/pages/InboundReceptionWizard.jsx", "frontend/src/components/inventario/"],
        "backend": ["backend/apps/inventario/"],
        "notas": [
            "recepcion_crear (inventario.create) confirma líneas con nodo_id dentro de cada item.",
            "stock_listar / inventario_* son de consulta (inventario.view).",
        ],
    },
    "storage": {
        "label": "Storage", "categoria": "ALMACEN",
        "desc": "Subida/descarga de archivos a MinIO (artefactos y documentos).",
        "frontend": ["frontend/src/components/", "frontend/src/pages/"],
        "backend": ["backend/apps/storage/"],
        "notas": [
            "storage_subir_archivo (storage.create) devuelve la key MinIO.",
            "artefacto_archivo_descargar usa storage.download_doc.",
        ],
    },
    "notificaciones": {
        "label": "Notificaciones", "categoria": "COMUNICACIONES",
        "desc": "Notificaciones internas y reglas de aviso.",
        "frontend": ["frontend/src/pages/Notificaciones.jsx"],
        "backend": ["backend/apps/notifications/"],
        "notas": [],
    },
    "cartera": {
        "label": "Cartera", "categoria": "COMUNICACIONES",
        "desc": "Cobranza, saldos por cobrar y deudas por cliente.",
        "frontend": ["frontend/src/pages/Cobros.jsx", "frontend/src/components/cobros/"],
        "backend": ["backend/apps/cobros/"],
        "notas": [
            "reporte_cobranza lee analytics/aging (analytics.view).",
        ],
    },
    "pagos": {
        "label": "Pagos", "categoria": "FINANCIERO",
        "desc": "Registro y conciliación de pagos, liberación de crédito.",
        "frontend": ["frontend/src/pages/Pagos.jsx"],
        "backend": ["backend/apps/finanzas/", "backend/apps/finance/"],
        "notas": [
            "pago_registrar / pago_dry_run = pagos.create; pago_conciliar/rechazar/liberar = pagos.update.",
        ],
    },
    "tickets": {
        "label": "Tickets", "categoria": "SOPORTE",
        "desc": "Tickets de soporte y seguimiento.",
        "frontend": ["frontend/src/pages/Tickets.jsx", "frontend/src/pages/TicketDetail.jsx"],
        "backend": ["backend/apps/tickets/"],
        "notas": [],
    },
    "usuarios": {
        "label": "Usuarios", "categoria": "ADMINISTRACION",
        "desc": "Gestión de usuarios, empresas y credenciales MCP.",
        "frontend": ["frontend/src/pages/Users.jsx", "frontend/src/pages/UserFormView.jsx", "frontend/src/pages/RegistroSolicitudes.jsx"],
        "backend": ["backend/apps/users/", "backend/apps/core/"],
        "notas": [
            "Onboarding MCP (registro/reactivación/aprobación) vive en core + users.",
        ],
    },
    "roles": {
        "label": "Roles y Permisos", "categoria": "ADMINISTRACION",
        "desc": "Matriz de roles y permisos (RBAC).",
        "frontend": ["frontend/src/pages/RolesPermissions.jsx"],
        "backend": ["backend/apps/roles/", "backend/apps/core/permissions.py"],
        "notas": [
            "mwt_diag_scope mapea a roles.view (diagnóstico de usuarios/permisos).",
        ],
    },
}

# --------------------------------------------------------------------------- #
# Flujos operativos por módulo (secuencias reales + anti-patrones)
# Fuente: harness/canonical/skills/mwt-operations/SKILL.md
# --------------------------------------------------------------------------- #
FLOWS: dict[str, list[dict]] = {
    "clientes": [
        {"nombre": "Alta de cliente",
         "pasos": ["cliente_listar(q=razon_social) → ¿existe? → cliente_obtener(id)",
                   "cliente_crear({razon_social, tax_id, pais_iso2, tipo, …})",
                   "[CEO] agrega credito_limit_usd / comision_pct",
                   "cliente_editar(id, {estado:'ACTIVO'|…}) para ajustes"],
         "anti": ["codigo_marluvas: 10 dígitos y único entre ACTIVOS (si no → 400).",
                  "credito_limit_usd/comision_pct son CEO-only; un operador no los setea."]},
    ],
    "productos": [
        {"nombre": "Alta de producto (catálogo)",
         "pasos": ["producto_listar(q=sku) → producto_obtener(id)",
                   "producto_crear({sku, nombre, marca_id, tallas:[uuids], especificaciones:{sizes:[uuids], ncm}})",
                   "producto_alias_crear(producto_id, cliente_id, alias='70B22-CPAP')",
                   "ncm_listar() / marca_listar() / tallas_listar() para catálogos"],
         "anti": ["NO inventar SKUs ni tallas: los UUIDs salen de producto_*/tallas_listar.",
                  "Producto sin tallas/especificaciones.sizes → el matching de líneas falla después.",
                  "producto_crear con 'SIN-SKU'/'PENDING' en tallas → rechazado."]},
    ],
    "expedientes": [
        {"nombre": "Crear expediente desde OC (anti-duplicado)",
         "pasos": ["expediente_buscar(oc_number|proforma|sap)  ← SIEMPRE primero",
                   "existe=true → expediente_obtener(match) y EDITAR (no crear)",
                   "existe=false → expediente_resolve_oc_preview(client_id, lines)",
                   "expediente_crear(client_id, ocr_payload={lines}, file_path='OC.pdf', operating_company_id, brand_id, forma_pago, credit_days_*, po_number)",
                   "expediente_apply_pronto_pago(id, plazo_days) [si aplica]",
                   "expediente_lineas(id) + lineas_actualizar_precios({linea_id, unit_price_mwt, unit_price_client})"],
         "anti": ["expediente_crear sin file_path → OC sin binario.",
                  "po_number='SIN-PO' se ignora (omitir).",
                  "Duplicar expediente sin pasar por expediente_buscar.",
                  "dispatch_mode solo FCL/LCL/CONSOLIDADO."]},
        {"nombre": "Documentos, SAP y proformas",
         "pasos": ["documento_subir(expediente_id, file_path, kind:'PROFORMA'|'OC'|'SAP', codigo)",
                   "documento_listar(expediente_id) → documento_descargar(id) [URL firmada]",
                   "sap_analizar(expediente_id, file_path) → sap_obtener → sap_confirmar (o match_subir → match_resolver)",
                   "proforma_generar(expediente_id, audience='CLIENT') [DESPUÉS de cargar líneas]",
                   "proforma_html(expediente_id, codigo) [previsualizar sin persistir]"],
         "anti": ["sap_confirmar por sku+size sin linea_id → 400 (no transiciona en vacío).",
                  "sap_confirmar sin fecha_fabricacion real → rechazado.",
                  "Proforma antes de cargar líneas y precios → sale en 0 pares / $0.",
                  "Subir OC nuevo cuando ya hay un registro OC con oc_id → se anexa al existente."]},
        {"nombre": "Fusionar y avanzar estados",
         "pasos": ["expediente_fusionar(expediente_ids=[...], label='SAP X + Y')",
                   "expediente_avanzar_estado(expediente_id, action) [transición válida]",
                   "expediente_phase_durations_set(id, phase_durations={...})",
                   "expediente_eventos(id) [historial]"],
         "anti": ["Saltarse transiciones ilegales → 409.",
                  "expediente_avanzar_estado con UUID abreviado → 404 (resuelve el id completo)."]},
    ],
    "inventario": [
        {"nombre": "Recepción e inventario",
         "pasos": ["nodo_listar → nodo_obtener(id) [destino]",
                   "recepcion_crear(expediente_id, nodo_id, lines=[{producto_id, size, qty, unit_cost_usd}], cost_lines=[{kind, amount, currency, fx_to_usd}])",
                   "stock_listar(nodo, producto) [verificar saldos]",
                   "inventario_saldos_por_expediente(expediente_ids=[...])",
                   "inventario_transferir_asignaciones(...) [reasignar]"],
         "anti": ["Recepción con unit_cost_usd=0 en líneas CERRADAS → rechazado.",
                  "kind de costo DEBE estar en el catálogo válido.",
                  "El nodo_id vive DENTRO de cada item de lines (no como arg suelto)."]},
    ],
    "transferencias": [
        {"nombre": "Transferencias entre nodos",
         "pasos": ["transferencia_listar(origen, destino, estado) → transferencia_obtener(id)",
                   "transferencia_crear({origen, destino, lineas:[{producto_id, size, qty}], ...})",
                   "transferencia_aprobar(id) → transferencia_despachar(id) → transferencia_recibir(id, lineas)",
                   "transferencia_conciliar(id) → transferencia_cerrar(id)",
                   "transfer_notas_listar(id) / transfer_nota_crear(id, text)"],
         "anti": ["Saltarse aprobar→despachar→recibir → 409 (transición ilegal)."]},
        {"nombre": "Costos y liquidación landed",
         "pasos": ["transfer_costos_listar(transferencia_id)",
                   "transfer_costo_agregar(id, kind, amount, currency, fx_to_usd, scope_json={expediente_ids:[...]} o {lines:[...]})",
                   "transfer_artefacto_crear(id, ...) [AWB/BL]",
                   "transfer_liquidacion_preview(id) → transfer_liquidar(id, method='BY_VALUE')",
                   "transfer_factura_payload(id)"],
         "anti": ["El motor EXCLUYE el IVA del landed (va en summary.extra_costs_iva_usd).",
                  "scope_json: usa expediente_ids o lines, NO ambos a la vez.",
                  "transfer_costo_agregar usa `label` como parámetro nombrado."]},
    ],
    "pagos": [
        {"nombre": "Pagos (entrante/saliente)",
         "pasos": ["pago_applicables(expediente_id|client_id)",
                   "pago_dry_run(...) [simular]",
                   "pago_registrar({direction:'IN'|'OUT', monto, aplicaciones:[{applicable_type, applicable_id, monto_aplicado}]})",
                   "pago_obtener(id) → pago_conciliar(id, bank_reference) [impacta saldo/crédito]",
                   "pago_liberar_credito(id) / pago_rechazar(id, body)"],
         "anti": ["Registrar un pago y no conciliarlo → no impacta saldos.",
                  "applicable_type debe ser COSTO|PRODUCTO|PROFORMA|FACTURA."]},
    ],
    "nodos": [
        {"nombre": "Nodos y artefactos de envío",
         "pasos": ["nodo_listar → nodo_obtener(id)",
                   "nodo_crear({tipo, nombre, pais_iso2, ...})",
                   "nodo_artefacto_crear(nodo_id, {tipo:'AWB'|'BL', nombre, data}) [fuente de tracking/carrier/ETD/ETA]",
                   "builder_templates_listar() / builder_template_obtener(id)"],
         "anti": ["El artefacto de envío del nodo es la fuente de verdad de tracking/carrier.",
                  "expediente_envio_backfill lee ese artefacto (no inventes tracking a mano)."]},
    ],
    "dashboard": [
        {"nombre": "Presentación (gráficos/tablas/reportes/exportación)",
         "pasos": ["dashboard_resumen(periodo) [panorama completo]",
                   "generar_grafico(tipo, data, opciones) / render_tabla(columnas, filas)",
                   "generar_reporte(titulo, secciones, formato) → URL TTL 15min",
                   "exportar_xlsx(nombre, hojas) / exportar_csv(...)"],
         "anti": ["Imágenes/tablas: URL firmada TTL 5min; reportes/export: TTL 15min.",
                  "Los datos se redactan por rol ANTES de renderizar (nada filtra costo/margen no visible)."]},
    ],
    "analytics": [
        {"nombre": "Analytics (KPIs, cashflow, margen, aging, exposición)",
         "pasos": ["cashflow_chart(semanas)",
                   "aging_chart() / exposicion_chart() / reporte_cobranza(mes)",
                   "reporte_expedientes(periodo) / dashboard_resumen(periodo)",
                   "margen_marcas_chart() [CEO-only]"],
         "anti": ["margen_marcas_chart → 403 para roles no-CEO.",
                  "aging/exposicion/cobranza requieren analytics.view; genéricas requieren dashboard.view."]},
    ],
    "finanzas": [
        {"nombre": "Finanzas (solo lectura, CEO/Admin)",
         "pasos": ["finanzas_overview()",
                   "finanzas_comisiones() / finanzas_commission_by_month()",
                   "finanzas_margin_scatter() / finanzas_cliente(id)"],
         "anti": ["Solo admin/superadmin ven finanzas.view (costos y márgenes)."]},
    ],
    "sizing": [
        {"nombre": "Motor de tallas",
         "pasos": ["tallas_listar() → UUIDs de tallas para productos",
                   "sizing.create/update para mantener el catálogo"],
         "anti": ["Tallas dobles (33/34, 35/36, 45/46) existen en ops.tallas.",
                  "No inventes tallas: referenciá por UUID."]},
    ],
    "storage": [
        {"nombre": "Storage (MinIO)",
         "pasos": ["storage_subir_archivo(...) → key MinIO",
                   "artefacto_archivo_descargar(key) [URL firmada]"],
         "anti": ["La key devuelta es la que persiste en storage_url del documento."]},
    ],
    "portal": [
        {"nombre": "Portal B2B",
         "pasos": ["Listar catálogo/precios con scope a legal_entity_id del cliente.",
                   "Descargar documentos del expediente con audience=CLIENT."],
         "anti": ["client_b2b SOLO ve audience=CLIENT y su tenant (R3)."]},
    ],
    "cartera": [
        {"nombre": "Cartera / cobranza",
         "pasos": ["reporte_cobranza(mes) [aging]",
                   "exposicion_chart() / aging_chart()"],
         "anti": ["cartera.view es de lectura; las mutaciones de cobro viven en pagos/cobros."]},
    ],
    "marcas": [
        {"nombre": "Marcas",
         "pasos": ["marca_listar() → marca_id para productos/pricing"],
         "anti": ["marca_listar es solo lectura (marcas.view)."]},
    ],
    "historial-precios": [
        {"nombre": "Historial de precios",
         "pasos": ["Consultar PriceHistory por producto/banda.",
                   "lineas_actualizar_precios actualiza precios de líneas (expedientes.update)."],
         "anti": ["El precio MWT vs precio cliente se leen por separado (unit_price_mwt / unit_price_client)."]},
    ],
    "builder": [
        {"nombre": "MWT Builder (externo)",
         "pasos": ["builder_structure_construir(...)",
                   "builder_artefacto_crear/editar/eliminar(...)"],
         "anti": ["Habla con builder.muito.work, NO con la BD; solo operadores MWT (admin/superadmin)."]},
    ],
    "notificaciones": [
        {"nombre": "Notificaciones",
         "pasos": ["Gestionar reglas de aviso internas."],
         "anti": []},
    ],
    "tickets": [
        {"nombre": "Tickets de soporte",
         "pasos": ["Crear/seguir tickets de soporte."],
         "anti": []},
    ],
    "usuarios": [
        {"nombre": "Usuarios y onboarding MCP",
         "pasos": ["Registro/reactivación/aprobación de usuarios.",
                   "Emitir credenciales MCP (emit-grant)."],
         "anti": ["get_object sin filtro is_active permite gestionar inactivos."]},
    ],
    "roles": [
        {"nombre": "Roles y permisos (RBAC)",
         "pasos": ["mwt_diag_scope(email) [diagnóstico CEO-only]",
                   "Mantener la matriz core.roles.permissions."],
         "anti": ["El filtrado de tools MCP respeta la matriz REAL (sin wildcard automático)."]},
    ],
}

# Notas específicas por rol (qué ve / qué no)
ROLE_NOTES = {
    "superadmin": "Acceso total (incluye gobernanza y Kill-Switch). Ve finanzas, builder y roles.",
    "admin": "Acceso operativo y comercial total. Ve costos y márgenes (finanzas).",
    "manager": "Orquesta expedientes y equipo. NO ve rentabilidad interna (finanzas/analytics de margen).",
    "operator": "Gestión diaria de OCs, documentos y líneas. Sin finanzas; mayoría de módulos en lectura.",
    "finance": "Cobros, pagos y conciliación. Ve límites de crédito. Escritura solo en pagos; resto lectura.",
    "compras": "Proveedores + productos + marcas + sizing (create/update). Resto en lectura.",
    "viewer": "Solo lectura (view/download_doc/view_doc) en todos sus módulos.",
    "client_b2b": "Portal B2B: scope estricto a legal_entity_id; solo ve audience=CLIENT (kind OC/PROFORMA/FACTURA) y artefactos con publicado=True.",
}

ANTES = [
    "`mwt_whoami` → confirma token/identidad y rol.",
    "`mwt_health` → si sospechás lentitud o token expirado.",
    "`mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.",
]

TRANSVERSAL = [
    "Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.",
    "NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.",
    "`campos` en tools de detalle/listado ahorra contexto.",
    "Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.",
]

ERRORES = [
    "400 → payload inválido (campos/tipos en `detail`).",
    "403 → rol sin permiso para esa tool/acción (matriz /roles).",
    "404 → UUID mal o recurso fuera de scope.",
    "409 → transición ilegal o duplicado.",
    "429 → rate limit; esperá y reintentá.",
    "500 → error interno; revisá logs de django.",
]

# Regla de visibilidad por rol (redact.py · Ola 3.8 — la conoce el MCP server)
VISIBILIDAD = [
    "Dos capas distintas: **documentos** (`documento_*`: OC, PROFORMA, FACTURA, SAP) y **artefactos del Builder** (tracking/AWB, BL, Packing List, Factura Comercial, Certificado de Origen).",
    "`documento_listar` (ver-documento) SOLO trae DOCUMENTOS; NO incluye artefactos.",
    "El tracking/packing list/AWB/BL se consulta con `expediente_documentos_completos` (permiso **leer**), `nodo_artefactos_listar` o `inventario_artefactos_expediente`.",
    "Restricción de visibilidad: solo el rol `client_b2b` se filtra → ve documentos `audience=CLIENT` (kind OC/PROFORMA/FACTURA) y artefactos SOLO con `publicado=True`. Admin/CEO y roles internos (operator/manager/viewer/finance/compras) ven TODOS los artefactos.",
    "Para exponer un artefacto al cliente: `artefacto_publicar(nodo_id, artifact_id, publicado=True)` (nodos.update).",
]

# Módulos donde aplica la visibilidad de documentos/artefactos
VISIBLE_MODULES = {"expedientes", "nodos", "inventario", "portal"}

# Cross-references: (module, action) → dónde vive la tool real (cuando la acción
# no tiene tools directas o el binario/artefacto vive en otra tool/módulo).
CROSSREF = {
    ("nodos", "view_doc"): "Los documentos de los artefactos NO se listan aquí: usá `nodo_artefactos_listar` (permiso `nodos.view` → carpeta **leer**).",
    ("nodos", "download_doc"): "El binario de un artefacto se descarga con `artefacto_archivo_descargar` (permiso `storage.download_doc`).",
    ("nodos", "upload_doc"): "Para subir el archivo de un artefacto usá `storage_subir_archivo` (`storage.create`) o `nodo_artefacto_crear` (`nodos.create`).",
    ("expedientes", "download_doc"): "`documento_descargar` descarga DOCUMENTOS; el binario de un artefacto (tracking/packing list) se descarga con `artefacto_archivo_descargar` (`storage.download_doc`).",
    ("storage", "view_doc"): "No hay listado de 'documentos' en storage: los artefactos se ven con `nodo_artefactos_listar` o `inventario_artefactos_expediente`.",
    ("storage", "upload_doc"): "Para subir un archivo a MinIO usá `storage_subir_archivo` (`storage.create`).",
}

# --------------------------------------------------------------------------- #
# Matriz EXACTA core.roles.permissions (role -> module -> set(actions))
# --------------------------------------------------------------------------- #
MATRIX = {
    "superadmin": {
        "analytics": ["view"], "builder": ["create", "delete", "update", "view"],
        "cartera": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "clientes": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "dashboard": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "expedientes": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "finanzas": ["view"],
        "historial-precios": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "inventario": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "marcas": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "nodos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "notificaciones": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "pagos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "portal": ["create", "delete", "download_doc", "update", "upload_doc", "view_doc"],
        "productos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "roles": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "sizing": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "storage": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "tickets": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "transferencias": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "usuarios": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
    },
    "admin": {
        "analytics": ["view"], "builder": ["create", "delete", "update", "view"],
        "cartera": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "clientes": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "dashboard": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "expedientes": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "finanzas": ["view"],
        "historial-precios": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "inventario": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "marcas": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "nodos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "notificaciones": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "pagos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "portal": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "productos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "roles": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "sizing": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "storage": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "tickets": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "transferencias": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "usuarios": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
    },
    "manager": {
        "analytics": ["view"],
        "cartera": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "clientes": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "dashboard": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "expedientes": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "historial-precios": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "inventario": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "marcas": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "nodos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "notificaciones": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "pagos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "portal": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "productos": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "roles": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "sizing": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "storage": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "tickets": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "transferencias": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "usuarios": ["create", "delete", "download_doc", "update", "upload_doc", "view", "view_doc"],
    },
    "operator": {
        "analytics": ["view"],
        "cartera": ["download_doc", "view", "view_doc"],
        "clientes": ["download_doc", "view", "view_doc"],
        "dashboard": ["download_doc", "view", "view_doc"],
        "expedientes": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "historial-precios": ["download_doc", "view", "view_doc"],
        "inventario": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "marcas": ["download_doc", "view", "view_doc"],
        "nodos": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "notificaciones": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "pagos": ["download_doc", "view", "view_doc"],
        "productos": ["download_doc", "view", "view_doc"],
        "roles": ["download_doc", "view", "view_doc"],
        "sizing": ["download_doc", "view", "view_doc"],
        "storage": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "tickets": ["download_doc", "view", "view_doc"],
        "transferencias": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "usuarios": ["download_doc", "view", "view_doc"],
    },
    "finance": {
        "analytics": ["view"],
        "cartera": ["view", "view_doc"],
        "clientes": ["download_doc", "view", "view_doc"],
        "dashboard": ["download_doc", "view", "view_doc"],
        "expedientes": ["download_doc", "view", "view_doc"],
        "historial-precios": ["view", "view_doc"],
        "inventario": ["download_doc", "view", "view_doc"],
        "marcas": ["download_doc", "view", "view_doc"],
        "nodos": ["download_doc", "view", "view_doc"],
        "notificaciones": ["download_doc", "view", "view_doc"],
        "pagos": ["create", "download_doc", "update", "view", "view_doc"],
        "productos": ["download_doc", "view", "view_doc"],
        "roles": ["download_doc", "view", "view_doc"],
        "sizing": ["download_doc", "view", "view_doc"],
        "storage": ["download_doc", "view", "view_doc"],
        "tickets": ["view", "view_doc"],
        "transferencias": ["download_doc", "view", "view_doc"],
        "usuarios": ["download_doc", "view", "view_doc"],
    },
    "compras": {
        "analytics": ["view"],
        "cartera": ["download_doc", "view", "view_doc"],
        "clientes": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "dashboard": ["download_doc", "view", "view_doc"],
        "expedientes": ["download_doc", "view", "view_doc"],
        "historial-precios": ["create", "download_doc", "update", "view", "view_doc"],
        "inventario": ["download_doc", "view", "view_doc"],
        "marcas": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "nodos": ["download_doc", "view", "view_doc"],
        "notificaciones": ["download_doc", "view", "view_doc"],
        "pagos": ["download_doc", "view", "view_doc"],
        "productos": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "roles": ["download_doc", "view", "view_doc"],
        "sizing": ["create", "download_doc", "update", "upload_doc", "view", "view_doc"],
        "storage": ["download_doc", "view", "view_doc"],
        "tickets": ["download_doc", "view", "view_doc"],
        "transferencias": ["download_doc", "view", "view_doc"],
        "usuarios": ["download_doc", "view", "view_doc"],
    },
    "viewer": {
        "analytics": ["view"],
        "cartera": ["download_doc", "view", "view_doc"],
        "clientes": ["download_doc", "view", "view_doc"],
        "dashboard": ["download_doc", "view", "view_doc"],
        "expedientes": ["download_doc", "view", "view_doc"],
        "historial-precios": ["download_doc", "view", "view_doc"],
        "inventario": ["download_doc", "view", "view_doc"],
        "marcas": ["download_doc", "view", "view_doc"],
        "nodos": ["download_doc", "view", "view_doc"],
        "notificaciones": ["download_doc", "view", "view_doc"],
        "pagos": ["download_doc", "view", "view_doc"],
        "productos": ["download_doc", "view", "view_doc"],
        "roles": ["download_doc", "view", "view_doc"],
        "sizing": ["download_doc", "view", "view_doc"],
        "storage": ["download_doc", "view", "view_doc"],
        "tickets": ["download_doc", "view", "view_doc"],
        "transferencias": ["download_doc", "view", "view_doc"],
        "usuarios": ["download_doc", "view", "view_doc"],
    },
    "client_b2b": {
        "cartera": ["download_doc", "view", "view_doc"],
        "dashboard": ["download_doc", "view", "view_doc"],
        "expedientes": ["download_doc", "view", "view_doc"],
        "inventario": ["download_doc", "view", "view_doc"],
        "pagos": ["download_doc", "view", "view_doc"],
        "portal": ["download_doc", "view", "view_doc"],
        "productos": ["view"],
        "sizing": ["view"],
        "storage": ["download_doc", "view", "view_doc"],
    },
}

# --------------------------------------------------------------------------- #
# Tool -> (module, action)  (copia fiel de tool_rbac.TOOL_MODULES)
# --------------------------------------------------------------------------- #
TOOLS = {
    "mwt_whoami": None, "mwt_health": None, "mwt_audit_write_registry": None, "tipo_cambio": None,
    "mwt_diag_scope": ("roles", "view"),
    "cliente_listar": ("clientes", "view"), "cliente_obtener": ("clientes", "view"),
    "cliente_crear": ("clientes", "create"), "cliente_editar": ("clientes", "update"),
    "cliente_subsidiarias": ("clientes", "view"), "cliente_kpis_pool": ("clientes", "view"),
    "producto_listar": ("productos", "view"), "producto_obtener": ("productos", "view"),
    "producto_buscar": ("productos", "view"), "producto_precio_cliente": ("productos", "view"),
    "producto_ficha_tecnica": ("productos", "view"), "producto_crear": ("productos", "create"),
    "producto_editar": ("productos", "update"), "producto_alias_crear": ("productos", "create"),
    "ncm_listar": ("productos", "view"), "tallas_listar": ("sizing", "view"), "marca_listar": ("marcas", "view"),
    "oc_listar": ("expedientes", "view"), "oc_obtener": ("expedientes", "view"),
    "oc_editar": ("expedientes", "update"), "proforma_generar": ("expedientes", "create"),
    "proforma_html": ("expedientes", "view"), "proforma_documento": ("expedientes", "view"),
    "factura_payload": ("expedientes", "view"),
    "expediente_listar": ("expedientes", "view"), "expediente_obtener": ("expedientes", "view"),
    "expediente_buscar": ("expedientes", "view"), "expediente_lineas": ("expedientes", "view"),
    "expediente_documentos_completos": ("expedientes", "view"),
    "expediente_buscar_por_producto": ("expedientes", "view"),
    "expediente_resolve_oc_preview": ("expedientes", "create"),
    "expediente_crear": ("expedientes", "create"), "expedientes_crear_lote": ("expedientes", "create"),
    "lineas_actualizar_precios": ("expedientes", "update"),
    "expediente_apply_pronto_pago": ("expedientes", "update"), "expediente_editar": ("expedientes", "update"),
    "expediente_eliminar": ("expedientes", "delete"),
    "expediente_edit_full_get": ("expedientes", "view"), "expediente_edit_full_patch": ("expedientes", "update"),
    "expediente_avanzar_estado": ("expedientes", "update"), "expediente_envio_backfill": ("expedientes", "update"),
    "expediente_phase_durations_get": ("expedientes", "view"), "expediente_tiempos": ("expedientes", "view"),
    "expediente_phase_durations_set": ("expedientes", "update"), "expediente_eventos": ("expedientes", "view"),
    "expediente_fusionar": ("expedientes", "update"), "expediente_fusion_label": ("expedientes", "update"),
    "expediente_desfusionar": ("expedientes", "update"),
    "documento_subir": ("expedientes", "upload_doc"), "documento_listar": ("expedientes", "view_doc"),
    "documento_eliminar": ("expedientes", "delete"), "documento_descargar": ("expedientes", "download_doc"),
    "documento_editar": ("expedientes", "update"),
    "sap_analizar": ("expedientes", "view"), "sap_confirmar": ("expedientes", "update"),
    "sap_upsert": ("expedientes", "create"), "sap_obtener": ("expedientes", "view"),
    "sap_editar": ("expedientes", "update"), "sap_sincronizar_discrepancias": ("expedientes", "update"),
    "match_subir": ("expedientes", "upload_doc"), "match_resolver": ("expedientes", "update"),
    "nodo_listar": ("nodos", "view"), "nodo_obtener": ("nodos", "view"),
    "nodo_crear": ("nodos", "create"), "nodo_editar": ("nodos", "update"),
    "nodo_artefactos_listar": ("nodos", "view"), "nodo_artefacto_crear": ("nodos", "create"),
    "artefacto_editar": ("nodos", "update"), "artefacto_publicar": ("nodos", "update"),
    "builder_templates_listar": ("nodos", "view"), "builder_template_obtener": ("nodos", "view"),
    "builder_structure_construir": ("builder", "view"), "builder_artefacto_listar": ("builder", "view"),
    "builder_artefacto_obtener": ("builder", "view"), "builder_artefacto_crear": ("builder", "create"),
    "builder_artefacto_editar": ("builder", "update"), "builder_artefacto_eliminar": ("builder", "delete"),
    "stock_listar": ("inventario", "view"), "inventario_saldos_por_expediente": ("inventario", "view"),
    "inventario_expedientes_con_pendiente": ("inventario", "view"), "inventario_lineas_en_nodo": ("inventario", "view"),
    "recepcion_crear": ("inventario", "create"), "inventario_transferir_asignaciones": ("inventario", "update"),
    "inventario_artefactos_expediente": ("inventario", "view"),
    "transferencia_listar": ("transferencias", "view"), "transferencia_obtener": ("transferencias", "view"),
    "transferencia_crear": ("transferencias", "create"), "transferencia_avanzar": ("transferencias", "update"),
    "transferencia_aprobar": ("transferencias", "update"), "transferencia_despachar": ("transferencias", "update"),
    "transferencia_editar": ("transferencias", "update"), "transferencia_recibir": ("transferencias", "update"),
    "transferencia_conciliar": ("transferencias", "update"), "transferencia_cerrar": ("transferencias", "update"),
    "transferencia_cancelar": ("transferencias", "update"), "transfer_artefacto_crear": ("transferencias", "create"),
    "transfer_notas_listar": ("transferencias", "view"), "transfer_nota_crear": ("transferencias", "create"),
    "transfer_costos_listar": ("transferencias", "view"), "transfer_costo_agregar": ("transferencias", "create"),
    "transfer_costo_editar": ("transferencias", "update"), "transfer_costo_eliminar": ("transferencias", "delete"),
    "transfer_liquidacion_preview": ("transferencias", "view"), "transfer_liquidar": ("transferencias", "update"),
    "transfer_factura_payload": ("transferencias", "view"),
    "pago_applicables": ("pagos", "view"), "pago_listar": ("pagos", "view"), "pago_obtener": ("pagos", "view"),
    "pago_dry_run": ("pagos", "create"), "pago_registrar": ("pagos", "create"),
    "pago_conciliar": ("pagos", "update"), "pago_liberar_credito": ("pagos", "update"), "pago_rechazar": ("pagos", "update"),
    "finanzas_overview": ("finanzas", "view"), "finanzas_comisiones": ("finanzas", "view"),
    "finanzas_commission_by_month": ("finanzas", "view"), "finanzas_margin_scatter": ("finanzas", "view"),
    "finanzas_cliente": ("finanzas", "view"),
    "storage_subir_archivo": ("storage", "create"), "artefacto_archivo_descargar": ("storage", "download_doc"),
    "generar_grafico": ("dashboard", "view"), "cashflow_chart": ("analytics", "view"),
    "margen_marcas_chart": ("analytics", "view"), "aging_chart": ("analytics", "view"),
    "exposicion_chart": ("analytics", "view"), "render_tabla": ("dashboard", "view"),
    "generar_reporte": ("dashboard", "view"), "reporte_cobranza": ("analytics", "view"),
    "reporte_expedientes": ("analytics", "view"), "dashboard_resumen": ("analytics", "view"),
    "comparar": ("dashboard", "view"), "exportar_xlsx": ("dashboard", "view"), "exportar_csv": ("dashboard", "view"),
}

GLOBAL_TOOLS = [name for name, req in TOOLS.items() if req is None]

# --------------------------------------------------------------------------- #
# Parseo de docstrings de server.py
# --------------------------------------------------------------------------- #
def _parse_server_docs() -> dict[str, dict]:
    docs: dict[str, dict] = {}
    if not SERVER_PY.exists():
        return docs
    lines = SERVER_PY.read_text(encoding="utf-8", errors="replace").splitlines()
    for i, line in enumerate(lines):
        m = re.match(r"^\s*def\s+([A-Za-z0-9_]+)\s*\(", line)
        if not m:
            continue
        name = m.group(1)
        # firma: capturar hasta que los paréntesis se balanceen y la línea cierre con ':'
        sig_parts = []
        depth = 0
        j = i
        while j < len(lines):
            lj = lines[j].strip()
            if not lj:
                j += 1
                continue
            sig_parts.append(lj)
            depth += lj.count("(") - lj.count(")")
            if depth <= 0 and lj.endswith(":"):
                break
            j += 1
        sig = " ".join(sig_parts)
        # docstring completa (dedent)
        doc = ""
        k = i + 1
        while k < len(lines) and '"""' not in lines[k]:
            if lines[k].strip().startswith(("def ", "@", "class ")):
                break
            k += 1
        if k < len(lines) and '"""' in lines[k]:
            if lines[k].count('"""') >= 2:
                doc = lines[k].split('"""')[1]
            else:
                body = []
                k += 1
                while k < len(lines) and '"""' not in lines[k]:
                    body.append(lines[k])
                    k += 1
                doc = "\n".join(body)
        docs[name] = {"sig": sig, "doc": textwrap.dedent(doc).strip()}
    return docs

# --------------------------------------------------------------------------- #
# Generación
# --------------------------------------------------------------------------- #
def slugify_action(a: str) -> str:
    return ACTIONS[a][0]

def tool_bullet(tool: str, docs: dict[str, dict]) -> str:
    d = docs.get(tool) or {}
    doc = (d.get("doc") or "").strip()
    first = doc.splitlines()[0] if doc else ""
    return f"`{tool}` — {first}" if first else f"`{tool}`"

def build_skill(role: str, module: str, action: str, tools: list[str], docs: dict[str, dict]) -> str:
    rol = ROLES[role]
    m = MODULES[module]
    acc, verbo = ACTIONS[action]
    name = f"mwt-{role}-{module}-{acc}"
    desc = (f"Rol {rol} · módulo {m['label']} ({module}) · permiso {acc} ({verbo}). "
            f"Herramientas MCP: {', '.join(tools) if tools else 'ninguna tool directa en esta acción'}. "
            f"Lee el contrato en _contratos/{module}.md antes de actuar.")

    tbullets = "\n".join(f"  - {tool_bullet(t, docs)}" for t in tools) if tools else "  - (sin tools MCP directas en esta acción)"

    # Firma de cada tool (para invocar correctamente)
    sigs = "\n".join(f"  - `{t}` → `{(docs.get(t) or {}).get('sig', '')}`" for t in tools) if tools else ""

    # Flujos del módulo
    flows_txt = ""
    for fl in FLOWS.get(module, []):
        steps = "\n".join(f"     {s}" for s in fl["pasos"])
        anti = "\n".join(f"     - {a}" for a in fl["anti"]) if fl["anti"] else "     - (sin anti-patrones)"
        flows_txt += f"\n### {fl['nombre']}\n```\n{steps}\n```\n> Anti-patrones:\n{anti}\n"

    antes = "\n".join(f"- {a}" for a in ANTES)
    trans = "\n".join(f"- {t}" for t in TRANSVERSAL)
    errores = "\n".join(f"- {e}" for e in ERRORES)
    notas = "\n".join(f"- {n}" for n in m["notas"]) if m["notas"] else "- (sin notas específicas)"
    fe = "\n".join(f"  - `{f}`" for f in m["frontend"])
    be = "\n".join(f"  - `{f}`" for f in m["backend"])
    rnote = ROLE_NOTES.get(role, "")

    vis_txt = ""
    if module in VISIBLE_MODULES:
        vis_txt = "## Visibilidad de documentos y artefactos (según rol)\n" + "\n".join(f"- {v}" for v in VISIBILIDAD) + "\n"

    cross = CROSSREF.get((module, action))
    cross_txt = f"## Referencia cruzada (dónde está la tool real)\n- {cross}\n" if cross else ""

    return f"""---
name: {name}
description: {desc}
role: {role}
module: {module}
action: {action}
---

# {name}

> Skill MCP enfocado: **{rol}** · **{m['label']}** · permiso **{acc}** ({verbo}).

## Propósito
Operar el módulo **{m['label']}** (`{module}`) con la acción **{acc}** ({verbo}) usando SOLO
las tools MCP que el rol **{rol}** tiene permitidas por RBAC.

## Antes de empezar
{antes}

## Contexto del rol
- Rol: **{rol}** → {rnote}

## Herramientas MCP para esta acción
{tbullets}

## Firmas (cómo invocar)
{sigs if sigs else '  - (sin tools en esta acción)'}

{cross_txt}
## Flujos del módulo
{flows_txt if flows_txt else '- (sin flujos documentados para este módulo)'}

## Reglas transversales
{trans}

## Anti-patrones y notas del módulo
{notas}

## Errores comunes (cómo leerlos)
{errores}

{vis_txt}
## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **{acc}** sobre **{m['label']}**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/{module}.md`.

## Frontend / Backend (referencia)
- Frontend:
{fe}
- Backend:
{be}

## Entrega
Cuando completes la operación, resume: qué recurso quedó {verbo} (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
"""

def build_contract(module: str, docs: dict[str, dict]) -> str:
    m = MODULES[module]
    tools = [(t, req) for t, req in TOOLS.items() if req and req[0] == module]
    if tools:
        tbullets = "\n".join(
            f"  - `{t}` — {req[1]}" for t, req in sorted(tools, key=lambda x: x[1][1])
        )
    else:
        tbullets = "  - (sin tools MCP directas en este módulo)"
    notas = "\n".join(f"- {n}" for n in m["notas"]) if m["notas"] else "- (sin notas)"
    fe = "\n".join(f"- `{f}`" for f in m["frontend"])
    be = "\n".join(f"- `{f}`" for f in m["backend"])

    # Flujos del módulo
    flows_txt = ""
    for fl in FLOWS.get(module, []):
        steps = "\n".join(f"    {s}" for s in fl["pasos"])
        anti = "\n".join(f"    - {a}" for a in fl["anti"]) if fl["anti"] else "    - (sin anti-patrones)"
        flows_txt += f"\n### {fl['nombre']}\n```\n{steps}\n```\n> Anti-patrones:\n{anti}\n"

    # Referencia completa de tools (docstrings)
    ref = ""
    for t, req in sorted(tools, key=lambda x: x[1][1]):
        d = docs.get(t) or {}
        sig = d.get("sig", "")
        doc = d.get("doc", "") or "(sin docstring)"
        ref += f"\n### `{t}` — {req[1]}\n`{sig}`\n\n{doc}\n"

    return f"""# Contrato · módulo `{module}` — {m['label']}

- **Categoría:** {m['categoria']}
- **Descripción:** {m['desc']}

## Frontend
{fe}

## Backend
{be}

## Tools MCP (tool → acción RBAC)
{tbullets}

## Flujos operativos
{flows_txt if flows_txt else '- (sin flujos documentados)'}

## Notas / anti-patrones
{notas}

## Referencia completa de tools (docstrings)
{ref if ref else '- (sin tools)'}
"""

def main() -> None:
    docs = _parse_server_docs()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "_contratos").mkdir(exist_ok=True)

    total = 0
    for module in MODULES:
        (OUT / "_contratos" / f"{module}.md").write_text(build_contract(module, docs), encoding="utf-8")

    for role, mods in MATRIX.items():
        for module, actions in mods.items():
            if module not in MODULES:
                continue
            for action in actions:
                if action not in ACTIONS:
                    continue
                tools = [t for t, req in TOOLS.items() if req == (module, action)]
                d = OUT / role / module / slugify_action(action)
                d.mkdir(parents=True, exist_ok=True)
                (d / "SKILL.md").write_text(build_skill(role, module, action, tools, docs), encoding="utf-8")
                total += 1

    # README
    lines = [
        "# Skills-MCP — skills del MCP server por rol · módulo · permiso",
        "",
        "Estructura generada a partir de la matriz real `core.roles.permissions` y el mapeo",
        "`tool_rbac.TOOL_MODULES` del MCP server.",
        "",
        "```",
        "Skills-MCP/",
        "  _contratos/<modulo>.md        # contrato por módulo (frontend+backend+tools)",
        "  <rol>/<modulo>/<accion>/SKILL.md",
        "  README.md",
        "```",
        "",
        "## Roles",
    ]
    for r, label in ROLES.items():
        n = sum(len(v) for v in MATRIX.get(r, {}).values())
        lines.append(f"- `{r}` — {label} ({n} skills)")
    lines += [
        "",
        "## Acciones (permiso → carpeta)",
    ]
    for a, (folder, verb) in ACTIONS.items():
        lines.append(f"- `{a}` → `{folder}/` ({verb})")
    lines += [
        "",
        "## Herramientas globales (sin módulo, siempre visibles)",
    ]
    for t in GLOBAL_TOOLS:
        lines.append(f"- `{t}`")
    lines += [
        "",
        "## Regenerar",
        "",
        "```bash",
        "python Skills-MCP/generar.py",
        "```",
        "",
        f"Total de SKILL.md generados: **{total}**.",
    ]
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"OK · {total} SKILL.md + {len(MODULES)} contratos + README en {OUT}")

if __name__ == "__main__":
    main()
