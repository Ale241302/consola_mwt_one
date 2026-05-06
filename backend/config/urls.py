"""MWT.ONE · config.urls — entry point del router DRF."""
from django.urls import path, include


urlpatterns = [
    path("api/auth/",      include("apps.core.auth_urls")),
    path("api/",           include("apps.nodos.urls")),       # /api/nodos/
    path("api/",           include("apps.brands.urls")),      # /api/marcas/
    path("api/",           include("apps.clientes.urls")),    # /api/clientes/
    path("api/",           include("apps.productos.urls")),   # /api/productos/
    path("api/",           include("apps.proveedores.urls")), # /api/proveedores/
    path("api/",           include("apps.inventario.urls")),  # /api/stock/ + /api/movimientos/
    path("api/",           include("apps.expedientes.urls")), # /api/ocs/ + /api/expedientes/ + /api/lineas/ + /api/documentos/
    path("api/",           include("apps.cobros.urls")),      # /api/cobros/ + /api/pagos/ + /api/conciliaciones/
    path("api/",           include("apps.analytics.urls")),   # /api/analytics/<action>/
    path("api/",           include("apps.portal.urls")),      # /api/portal/<action>/
    path("api/",           include("apps.transfers.urls")),   # /api/transferencias/ + /api/transfer-lineas/ + /api/transfer-eventos/
    path("api/",           include("apps.email_templates.urls")),  # /api/email-templates/ + /api/email-template-versions/
    path("api/",           include("apps.notifications.urls")),    # /api/notification-logs/ + /api/collection-logs/
    path("api/",           include("apps.storage.urls")),          # /api/storage/signed_url/ + /api/storage/paperless_ingest/
    path("api/",           include("apps.ocr.urls")),              # /api/ocr/parse-oc/ + /api/ocr/resolve-line/
    path("api/",           include("apps.ai_hub.urls")),           # /api/ai/agents/ + /api/ai/skills/ + /api/ai/threads/ + /api/ai/chat/
    path("api/",           include("apps.commercial.urls")),       # /api/commercial/* + /api/commercial/resolve_client_price/
    path("api/",           include("apps.sizing.urls")),           # /api/sizing/tallas/ + /api/sizing/options/ + catálogos
    path("api/",           include("apps.users.urls")),            # /api/users/ + /api/user-addresses/ + /api/activity-feed/ [M3 CORE · identidad]
    path("api/",           include("apps.roles.urls")),            # /api/roles/ + /api/permissions/*  [M3 CORE · RBAC]
    path("api/",           include("apps.tickets.urls")),          # /api/tickets/ + chat + adjuntos + dashboard [LOTE_SM_TICKETS]
    path("api/",           include("apps.finance.urls")),          # /api/finance/payments/ [v2.0 · drawer Registrar Pago + IA + audit]
]
