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
]
