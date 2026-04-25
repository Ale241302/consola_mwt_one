#!/usr/bin/env python3
"""
=====================================================================
MWT.ONE · build_collection.py
Genera MWT_ONE.postman_collection.json a partir del catálogo de
endpoints reales del backend Django.

Uso:
    cd backend && python ../postman/build_collection.py

Genera:
    postman/MWT_ONE.postman_collection.json   (Postman v2.1)
    postman/MWT_ONE.postman_environment.json  (variables)

Conectar a Git:
    Ver postman/README.md
=====================================================================
"""
import json
import os
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_COLL = ROOT / "MWT_ONE.postman_collection.json"
OUT_ENV  = ROOT / "MWT_ONE.postman_environment.json"

COLLECTION_NAME = "MWT.ONE · API completa (15 módulos)"
COLLECTION_DESC = """
Colección de pruebas de la API REST del ERP MWT.ONE.

Cubre los 15 módulos:
  1. Dashboard
  2. Expedientes
  3. Pipeline
  4. Portal B2B
  5. Financiero
  6. Transferencias
  7. Nodos
  8. Clientes
  9. Marcas
  10. Productos
  11. Proveedores
  12. Inventario
  13. Plantillas de Email
  14. Historial de Notificaciones
  15. Cobros

Plus: Auth, Users + Roles, Storage, AI Hub.

Flujo recomendado:
  1. Importa también MWT_ONE.postman_environment.json y selecciónalo.
  2. Edita la variable `base_url` si no es https://consola.mwt.one.
  3. Ejecuta "Auth ▸ Login" — guarda automáticamente access_token y user_id.
  4. Recorre los demás endpoints (la auth Bearer ya está aplicada a la colección).

Variables clave (definidas en environment):
  · base_url           = https://consola.mwt.one
  · access_token       = (lo setea Login)
  · refresh_token      = (lo setea Login)
  · user_id            = (lo setea Login)
  · admin_email        = alejandro@muitowork.com
  · admin_password     = MuitoWork2026?
  · client_uuid        = (cualquier cliente real — para probar /clientes/<id>/)
  · brand_uuid         = (cualquier marca real)
  · product_uuid       = (cualquier producto real)
  · oc_uuid            = (cualquier OC real)

Conectado a GitHub: ver postman/README.md
"""

# ─────────────────────────────────────────────────────────────────────
# Helpers para construir requests Postman v2.1
# ─────────────────────────────────────────────────────────────────────
def gen_id():
    return str(uuid.uuid4())


def url_obj(path, query=None):
    """Construye un objeto URL Postman a partir de un path como
    "/api/clientes/{{client_uuid}}/"."""
    full = "{{base_url}}" + path
    raw  = full
    host = ["{{base_url}}"]
    parts = path.strip("/").split("/")
    out = {
        "raw": raw,
        "host": host,
        "path": parts,
    }
    if query:
        out["query"] = [{"key": k, "value": v, "disabled": False}
                        for k, v in query.items()]
        out["raw"] += "?" + "&".join(f"{k}={v}" for k, v in query.items())
    return out


def req(name, method, path, body=None, query=None, description="",
        auto_extract_id_to=None, auto_extract_field="id"):
    """
    Construye un request Postman.

    auto_extract_id_to: si se especifica, agrega un test script que
        toma el primer item de la respuesta y guarda su `auto_extract_field`
        en la variable de environment indicada. Ej:
            auto_extract_id_to="client_uuid"
        guarda response.json()[0].id en {{client_uuid}}.

        Útil para los endpoints `List` — el primer Send rellena el UUID
        para todos los demás endpoints que dependen de él.
    """
    r = {
        "name": name,
        "request": {
            "method": method,
            "header": [
                {"key": "Content-Type", "value": "application/json"}
            ] if body is not None else [],
            "url": url_obj(path, query),
            "description": description,
        },
        "response": [],
    }
    if body is not None:
        r["request"]["body"] = {
            "mode": "raw",
            "raw": json.dumps(body, indent=2, ensure_ascii=False),
            "options": {"raw": {"language": "json"}},
        }
    if auto_extract_id_to:
        r["event"] = [{
            "listen": "test",
            "script": {
                "type": "text/javascript",
                "exec": [
                    "if (pm.response.code === 200) {",
                    "  try {",
                    "    const data = pm.response.json();",
                    "    let item = null;",
                    "    if (Array.isArray(data) && data.length > 0) item = data[0];",
                    "    else if (data && Array.isArray(data.results) && data.results.length > 0) item = data.results[0];",
                    "    else if (data && Array.isArray(data.clients) && data.clients.length > 0) item = data.clients[0];",
                    f"    if (item && item['{auto_extract_field}']) {{",
                    f"      pm.environment.set('{auto_extract_id_to}', item['{auto_extract_field}']);",
                    f"      console.log('[auto] {auto_extract_id_to} =', item['{auto_extract_field}']);",
                    "    }",
                    "  } catch (e) { console.warn('[auto-extract] parse failed:', e); }",
                    "}",
                ],
            },
        }]
    return r


def folder(name, items, description=""):
    return {
        "name": name,
        "description": description,
        "item": items,
    }


def crud(prefix_name, base_path, sample_create, id_var="id", extra=None):
    """Genera CRUD básico (List, Retrieve, Create, Update, Delete) para
    un viewset DRF estándar. Usa {{<id_var>}} como placeholder del id en
    URL y como ?id en variables."""
    items = [
        req(f"List {prefix_name}",     "GET",    f"{base_path}/"),
        req(f"Retrieve {prefix_name}", "GET",    f"{base_path}/{{{{{id_var}}}}}/"),
        req(f"Create {prefix_name}",   "POST",   f"{base_path}/", body=sample_create),
        req(f"Update {prefix_name}",   "PATCH",  f"{base_path}/{{{{{id_var}}}}}/", body={"is_active": True}),
        req(f"Delete {prefix_name}",   "DELETE", f"{base_path}/{{{{{id_var}}}}}/"),
    ]
    if extra:
        items.extend(extra)
    return items


# ═════════════════════════════════════════════════════════════════════
# 0. Auth
# ═════════════════════════════════════════════════════════════════════
auth_items = [
    {
        "name": "Login (auto-guarda tokens)",
        "request": {
            "method": "POST",
            "header": [{"key": "Content-Type", "value": "application/json"}],
            "url": url_obj("/api/auth/login/"),
            "body": {
                "mode": "raw",
                "raw": json.dumps({
                    "usuario":  "{{admin_email}}",
                    "password": "{{admin_password}}",
                }, indent=2, ensure_ascii=False),
                "options": {"raw": {"language": "json"}},
            },
            "auth": {"type": "noauth"},
            "description": "Devuelve access + refresh JWT y los guarda en variables del environment.",
        },
        "event": [{
            "listen": "test",
            "script": {
                "type": "text/javascript",
                "exec": [
                    "if (pm.response.code === 200) {",
                    "  const j = pm.response.json();",
                    "  pm.environment.set('access_token',  j.access  || '');",
                    "  pm.environment.set('refresh_token', j.refresh || '');",
                    "  if (j.user) {",
                    "    pm.environment.set('user_id',    j.user.id    || '');",
                    "    pm.environment.set('user_email', j.user.email || '');",
                    "    pm.environment.set('user_role',  j.user.role  || '');",
                    "  }",
                    "  console.log('[auth] tokens guardados ·', j.user && j.user.email);",
                    "} else {",
                    "  console.warn('[auth] login fallido', pm.response.code, pm.response.text());",
                    "}",
                ],
            },
        }],
    },
    req("Refresh access token", "POST", "/api/auth/refresh/",
        body={"refresh": "{{refresh_token}}"}),
    req("Me (perfil del JWT)",  "GET",  "/api/auth/me/"),
    req("Logout",               "POST", "/api/auth/logout/",
        body={"refresh": "{{refresh_token}}"}),
]

# ═════════════════════════════════════════════════════════════════════
# 1. Dashboard
# ═════════════════════════════════════════════════════════════════════
dashboard_items = [
    req("KPIs globales",          "GET", "/api/analytics/kpis/"),
    req("KPIs por marca",         "GET", "/api/analytics/kpis_brand/", query={"brand_id": "{{brand_uuid}}"}),
    req("KPIs por nodo",          "GET", "/api/analytics/kpis_nodo/",  query={"node_id":  "{{node_uuid}}"}),
    req("Embudo de ventas",       "GET", "/api/analytics/funnel/"),
    req("Series temporales",      "GET", "/api/analytics/timeseries/", query={"days": "30"}),
    req("List dashboard widgets", "GET", "/api/dashboard-widgets/"),
    req("List snapshots",         "GET", "/api/dashboard-snapshots/"),
]

# ═════════════════════════════════════════════════════════════════════
# 2. Expedientes
# ═════════════════════════════════════════════════════════════════════
expedientes_items = [
    # OCs
    req("List OCs",     "GET",  "/api/ocs/", auto_extract_id_to="oc_uuid"),
    req("Retrieve OC",  "GET",  "/api/ocs/{{oc_uuid}}/"),
    req("Create OC",    "POST", "/api/ocs/", body={
        "codigo": "PO-DEMO-2026-0001",
        "client_id": "{{client_uuid}}",
        "brand_id":  "{{brand_uuid}}",
        "fecha_emision": "2026-04-25",
        "moneda": "USD",
        "total_estimado": 12000,
        "estado": "REGISTRO",
    }),
    req("Update OC",    "PATCH",  "/api/ocs/{{oc_uuid}}/", body={"estado": "CONFIRMADA"}),
    req("Delete OC",    "DELETE", "/api/ocs/{{oc_uuid}}/"),

    # Expedientes
    req("List expedientes",       "GET",  "/api/expedientes/", auto_extract_id_to="expediente_uuid"),
    req("Retrieve expediente",    "GET",  "/api/expedientes/{{expediente_uuid}}/"),
    req("Update expediente",      "PATCH","/api/expedientes/{{expediente_uuid}}/",
        body={"fase": "PRODUCCION"}),

    # OCR + create-from-oc
    req("OCR · parse OC (Excel)", "POST", "/api/ocr/parse-oc/",
        body={"_comment": "Multipart real: subir archivo .xlsx en file. Aquí solo skeleton JSON."}),
    req("OCR · resolve line",     "POST", "/api/ocr/resolve-line/", body={
        "sku": "BIS-OXF-BLK-42", "qty": 100, "unit_price": 95.0,
    }),
    req("Create from OC (orchestrator)", "POST", "/api/expedientes/create-from-oc/", body={
        "oc": {"codigo": "PO-2026-0099", "client_id": "{{client_uuid}}",
                "brand_id": "{{brand_uuid}}", "moneda": "USD"},
        "lineas": [{"sku": "BIS-OXF-BLK-42", "qty": 60, "unit_price": 95.0}],
        "modo_operacion": "FULL",
    }),

    # Líneas + documentos
    req("List líneas",      "GET", "/api/lineas/", query={"expediente_id": "{{expediente_uuid}}"}),
    req("List documentos",  "GET", "/api/documentos/", query={"expediente_id": "{{expediente_uuid}}"}),
    req("OCR parsing log",  "GET", "/api/ocr-parsing-log/"),
]

# ═════════════════════════════════════════════════════════════════════
# 3. Pipeline
# ═════════════════════════════════════════════════════════════════════
pipeline_items = [
    req("List transiciones permitidas", "GET", "/api/pipeline-transiciones/"),
    req("List eventos pipeline",        "GET", "/api/pipeline-events/"),
    req("Eventos de un expediente",     "GET", "/api/pipeline-events/",
        query={"expediente_id": "{{expediente_uuid}}"}),
]

# ═════════════════════════════════════════════════════════════════════
# 4. Portal B2B
# ═════════════════════════════════════════════════════════════════════
portal_items = [
    req("Portal · catálogo productos",        "GET", "/api/portal/products/",
        query={"limit": "24", "offset": "0"}),
    req("Portal · detalle producto",          "GET", "/api/portal/products/{{product_uuid}}/"),
    req("Portal · expedientes del cliente",   "GET", "/api/portal/expedientes/"),
    req("Portal · detalle expediente",        "GET", "/api/portal/expedientes/{{expediente_uuid}}/"),
    req("List portal sessions",               "GET", "/api/portal-sessions/"),
    req("List portal audit",                  "GET", "/api/portal-audit/"),
    req("List MWT users (portal scope)",      "GET", "/api/mwt-users/"),
]

# ═════════════════════════════════════════════════════════════════════
# 5. Financiero (parte 1 — pagos + vencimientos + FX)
# ═════════════════════════════════════════════════════════════════════
financiero_items = [
    req("List pagos",          "GET", "/api/pagos/", auto_extract_id_to="pago_uuid"),
    req("Retrieve pago",       "GET", "/api/pagos/{{pago_uuid}}/"),
    req("Create pago",         "POST", "/api/pagos/", body={
        "cliente_id": "{{client_uuid}}", "monto_usd": 5000.0,
        "fecha_pago": "2026-04-25", "metodo": "TRANSFER",
        "referencia": "TRX-DEMO-001",
    }),
    req("List conciliaciones", "GET",  "/api/conciliaciones/"),
    req("Create conciliacion", "POST", "/api/conciliaciones/", body={
        "pago_id": "{{pago_uuid}}", "expediente_id": "{{expediente_uuid}}",
        "monto_aplicado_usd": 5000.0,
    }),
    req("List vencimientos",   "GET", "/api/vencimientos/"),
    req("List FX rate history","GET", "/api/fx-rate-history/"),
]

# ═════════════════════════════════════════════════════════════════════
# 6. Transferencias
# ═════════════════════════════════════════════════════════════════════
transfers_items = [
    req("List transferencias",       "GET", "/api/transferencias/", auto_extract_id_to="transfer_uuid"),
    req("Retrieve transferencia",    "GET", "/api/transferencias/{{transfer_uuid}}/"),
    req("Create transferencia",      "POST","/api/transferencias/", body={
        "codigo": "TRF-2026-DEMO",
        "nodo_origen_id": "{{node_origen_uuid}}",
        "nodo_destino_id": "{{node_destino_uuid}}",
        "fecha_envio": "2026-04-25",
        "estado": "PREPARANDO",
    }),
    req("Update transferencia",      "PATCH", "/api/transferencias/{{transfer_uuid}}/",
        body={"estado": "EN_TRANSITO"}),
    req("List líneas transferencia", "GET",   "/api/transfer-lineas/",
        query={"transferencia_id": "{{transfer_uuid}}"}),
    req("List eventos transferencia","GET",   "/api/transfer-eventos/",
        query={"transferencia_id": "{{transfer_uuid}}"}),
    req("List documentos transfer",  "GET",   "/api/transfer-documentos/"),
]

# ═════════════════════════════════════════════════════════════════════
# 7. Nodos
# ═════════════════════════════════════════════════════════════════════
nodos_items = [
    req("List nodos", "GET", "/api/nodos/", auto_extract_id_to="node_uuid"),
] + crud(
    "nodo (CRUD)", "/api/nodos",
    sample_create={
        "codigo": "NODO-DEMO",
        "nombre": "Nodo demo Lima",
        "tipo":   "WAREHOUSE",
        "pais_iso2": "PE", "ciudad": "Lima",
        "capabilities": ["RECEIVE", "DISPATCH"],
        "zona_horaria": "America/Lima",
        "is_active": True,
    },
    id_var="node_uuid",
)

# ═════════════════════════════════════════════════════════════════════
# 8. Clientes
# ═════════════════════════════════════════════════════════════════════
clientes_items = [
    req("List clientes",       "GET", "/api/clientes/", auto_extract_id_to="client_uuid"),
    req("List clientes (filtros)", "GET", "/api/clientes/",
        query={"q": "Atacama", "tipo": "B2B", "estado": "ACTIVO"}),
    req("Retrieve cliente",    "GET", "/api/clientes/{{client_uuid}}/"),
    req("Create cliente",      "POST","/api/clientes/", body={
        "razon_social": "Demo Cliente SA",
        "tax_id": "20999888777", "tipo": "B2B", "segmento": "B",
        "pais_iso2": "PE", "ciudad": "Lima",
        "codigo_marluvas": "4000000999",
        "cedula_juridica": "20999888777",
        "direccion_entrega": "Av. Demo 123",
        "contacto_nombre": "Juan Demo", "contacto_email": "demo@example.com",
        "contacto_tel": "+51 999 999 999",
        "canal": "DISTRIBUIDOR", "incoterm": "CIF", "medio_pago": "TRANSFER_BANCARIA",
        "dias_credito": 60,
        "credito_limit_usd": 150000,
        "comision_pct": 0.08,
        "estado": "ACTIVO",
    }),
    req("Update cliente",      "PATCH","/api/clientes/{{client_uuid}}/",
        body={"contacto_email": "nuevo@example.com"}),
    req("Soft-delete cliente", "DELETE","/api/clientes/{{client_uuid}}/"),
    # Selects auxiliares
    req("Select tipos",        "GET", "/api/clientes/select_tipos/"),
    req("Select estados",      "GET", "/api/clientes/select_estados/"),
    req("Select canales",      "GET", "/api/clientes/select_canales/"),
    req("Select medios pago",  "GET", "/api/clientes/select_medios_pago/"),
    req("Select incoterms",    "GET", "/api/clientes/select_incoterms/"),
    req("Select países",       "GET", "/api/clientes/select_paises/"),
    req("Select nodos",        "GET", "/api/clientes/select_nodos/"),
    req("Select responsables", "GET", "/api/clientes/select_responsables/"),
    # Crédito
    req("KPIs cliente",        "GET", "/api/clientes/{{client_uuid}}/kpis/"),
    req("Histórico crédito",   "GET", "/api/clientes/{{client_uuid}}/credit_history/"),
    req("Refresh crédito",     "POST","/api/clientes/{{client_uuid}}/refresh_credit/", body={}),
]

# ═════════════════════════════════════════════════════════════════════
# 9. Marcas (incluye motor de precios brand-client)
# ═════════════════════════════════════════════════════════════════════
marcas_items = [
    req("List marcas",       "GET", "/api/marcas/", auto_extract_id_to="brand_uuid"),
    req("Retrieve marca",    "GET", "/api/marcas/{{brand_uuid}}/"),
    req("Create marca",      "POST","/api/marcas/", body={
        "nombre": "Marca Demo", "codigo": "MD",
        "tipo": "PROPIA", "is_active": True,
    }),
    req("Update marca",      "PATCH","/api/marcas/{{brand_uuid}}/", body={"is_active": True}),
    req("Soft-delete marca", "DELETE","/api/marcas/{{brand_uuid}}/"),
    # Motor de precios — clients summary
    req("Brand clients summary (cards)", "GET",
        "/api/commercial/brands/{{brand_uuid}}/clients_summary/"),
    # CRUD pricing assignment
    req("List brand-client-pricing", "GET",
        "/api/commercial/brand-client-pricing/", query={"brand_id": "{{brand_uuid}}"}),
    req("Create brand-client-pricing", "POST",
        "/api/commercial/brand-client-pricing/", body={
            "brand_id": "{{brand_uuid}}",
            "cliente_id": "{{client_uuid}}",
            "fecha_inicio": "2026-04-25",
            "fecha_fin": None,
            "sobre_precio_pct": "0.0500",
            "pronto_pago_dias": 10,
            "pronto_pago_pct": "0.0300",
            "volumen_min_units": 500,
            "volumen_pct": "0.0400",
            "notas": "Demo asignación",
        }),
    req("Upload archivo (multipart)", "POST",
        "/api/commercial/brand-client-pricing/{{bcpa_uuid}}/upload-file/",
        body={"_comment": "multipart: campo 'file' con .xlsx — aquí JSON skeleton"}),
    # Resolve precio
    req("Resolve client price (waterfall)", "POST",
        "/api/commercial/resolve_client_price/", body={
            "client_id": "{{client_uuid}}", "brand_id": "{{brand_uuid}}",
            "sku": "BIS-OXF-BLK-42",
        }),
    req("Resolve COMEX price (Excel J18)", "POST",
        "/api/commercial/resolve_price/", body={
            "sku": "701407", "comision_pct": 0.08,
            "dias_pago": 28, "mercado": "ME",
        }),
    req("Payment index list",       "GET", "/api/commercial/payment_index/"),
    req("Pricing constants list",   "GET", "/api/commercial/pricing_constants/"),
    # Commercial sub-recursos
    req("List pricelist versions",  "GET", "/api/commercial/pricelist-versions/"),
    req("List grade items",         "GET", "/api/commercial/grade-items/"),
    req("List client assignments",  "GET", "/api/commercial/client-assignments/"),
    req("List EPP policies",        "GET", "/api/commercial/early-payment-policies/"),
    req("List EPP tiers",           "GET", "/api/commercial/early-payment-tiers/"),
    req("List commission rules",    "GET", "/api/commercial/commission-rules/"),
    req("Catalog · currencies",     "GET", "/api/commercial/catalogs/currencies/"),
    req("Catalog · sources",        "GET", "/api/commercial/catalogs/sources/"),
    req("Catalog · commission bases","GET","/api/commercial/catalogs/commission-bases/"),
]

# ═════════════════════════════════════════════════════════════════════
# 10. Productos
# ═════════════════════════════════════════════════════════════════════
productos_items = [
    req("List productos",   "GET", "/api/productos/", auto_extract_id_to="product_uuid"),
    req("List productos · filtros", "GET", "/api/productos/",
        query={"brand_id": "{{brand_uuid}}", "q": "Oxford"}),
    req("Retrieve producto","GET", "/api/productos/{{product_uuid}}/"),
    req("Create producto",  "POST","/api/productos/", body={
        "sku": "DEMO-SKU-001", "nombre": "Producto demo",
        "brand_id": "{{brand_uuid}}",
        "precio_mwt": 89.0, "moneda": "USD",
        "is_active": True,
        "especificaciones": {"material": "cuero", "color": "negro"},
    }),
    req("Update producto",  "PATCH","/api/productos/{{product_uuid}}/",
        body={"precio_mwt": 95.0}),
    req("Soft-delete prod", "DELETE","/api/productos/{{product_uuid}}/"),
]

# ═════════════════════════════════════════════════════════════════════
# 11. Proveedores
# ═════════════════════════════════════════════════════════════════════
proveedores_items = [
    req("List proveedores",    "GET", "/api/proveedores/", auto_extract_id_to="supplier_uuid"),
    req("Retrieve proveedor",  "GET", "/api/proveedores/{{supplier_uuid}}/"),
    req("Create proveedor",    "POST","/api/proveedores/", body={
        "razon_social": "Fabrica Demo Ltda", "codigo": "PROV-DEMO",
        "pais_iso2": "BR", "ciudad": "Sao Paulo",
        "tax_id": "12.345.678/0001-90",
        "contacto_email": "demo@fabrica.br",
        "contacto_tel": "+55 11 1234 5678",
        "is_active": True,
    }),
    req("Update proveedor",    "PATCH","/api/proveedores/{{supplier_uuid}}/",
        body={"is_active": True}),
    req("Soft-delete prov",    "DELETE","/api/proveedores/{{supplier_uuid}}/"),
]

# ═════════════════════════════════════════════════════════════════════
# 12. Inventario
# ═════════════════════════════════════════════════════════════════════
inventario_items = [
    req("List stock",          "GET", "/api/stock/", auto_extract_id_to="stock_uuid"),
    req("List stock · por nodo","GET", "/api/stock/", query={"node_id": "{{node_uuid}}"}),
    req("Retrieve stock",      "GET", "/api/stock/{{stock_uuid}}/"),
    req("List movimientos",    "GET", "/api/movimientos/"),
    req("Create movimiento",   "POST","/api/movimientos/", body={
        "tipo": "ENTRADA",
        "node_id": "{{node_uuid}}",
        "product_id": "{{product_uuid}}",
        "qty": 100,
        "ref_documento": "TRF-2026-DEMO",
    }),
]

# ═════════════════════════════════════════════════════════════════════
# 13. Plantillas Email
# ═════════════════════════════════════════════════════════════════════
templates_items = [
    req("List email templates",    "GET", "/api/email-templates/", auto_extract_id_to="template_uuid"),
    req("Retrieve template",       "GET", "/api/email-templates/{{template_uuid}}/"),
    req("Create template",         "POST","/api/email-templates/", body={
        "key": "demo.welcome",
        "asunto": "Bienvenido {{ '{{nombre}}' }}",
        "cuerpo_html": "<h1>Hola {{ '{{nombre}}' }}</h1>",
        "lang": "es", "is_active": True,
    }),
    req("Update template",         "PATCH","/api/email-templates/{{template_uuid}}/",
        body={"is_active": True}),
    req("List versions",           "GET", "/api/email-template-versions/",
        query={"template_id": "{{template_uuid}}"}),
    req("List preview log",        "GET", "/api/email-preview-log/"),
]

# ═════════════════════════════════════════════════════════════════════
# 14. Historial Notificaciones
# ═════════════════════════════════════════════════════════════════════
notif_items = [
    req("List notification logs",   "GET", "/api/notification-logs/"),
    req("List collection logs",     "GET", "/api/collection-logs/"),
    req("List grace days",          "GET", "/api/grace-days/"),
    req("List email queue log",     "GET", "/api/email-queue-log/"),
]

# ═════════════════════════════════════════════════════════════════════
# 15. Cobros
# ═════════════════════════════════════════════════════════════════════
cobros_items = [
    req("List cobros",              "GET", "/api/cobros/", auto_extract_id_to="cobro_uuid"),
    req("Retrieve cobro",           "GET", "/api/cobros/{{cobro_uuid}}/"),
    req("Create cobro",             "POST","/api/cobros/", body={
        "cliente_id": "{{client_uuid}}",
        "expediente_id": "{{expediente_uuid}}",
        "monto_usd": 12000.0,
        "fecha_emision": "2026-04-25",
        "fecha_vencimiento": "2026-06-25",
        "estado": "PENDIENTE",
    }),
    req("List withholding log",     "GET", "/api/withholding-log/"),
    req("List collection events",   "GET", "/api/collection-events/"),
]

# ═════════════════════════════════════════════════════════════════════
# Bonus · Auth (Users + Roles)
# ═════════════════════════════════════════════════════════════════════
users_items = [
    req("List users",            "GET", "/api/users/", auto_extract_id_to="user_uuid"),
    req("Retrieve user",         "GET", "/api/users/{{user_uuid}}/"),
    req("Create user",           "POST","/api/users/", body={
        "email_plain": "demo@muitowork.com",
        "full_name": "Demo User", "role_default": "operator",
        "preferred_language": "es", "timezone": "America/Lima",
        "password": "DemoPass123!",
    }),
    req("Update user",           "PATCH","/api/users/{{user_uuid}}/",
        body={"is_active": True}),
    req("Reset password",        "POST","/api/users/{{user_uuid}}/reset-password/",
        body={"ttl_hours": 24}),
    req("Toggle active",         "POST","/api/users/{{user_uuid}}/toggle-active/", body={}),
    req("My profile · GET",      "GET", "/api/users/me/profile/"),
    req("My profile · PATCH",    "PATCH","/api/users/me/profile/", body={
        "phone": "+51 999 111 222",
        "preferred_language": "es",
        "addresses": [
            {"label": "Oficina", "kind": "BOTH",
             "address_line_1": "Av. Demo 123", "city": "Lima",
             "country": "PE", "is_default": True},
        ],
    }),
    req("List addresses (admin)","GET", "/api/user-addresses/",
        query={"user_id": "{{user_uuid}}"}),
    req("List activity feed",    "GET", "/api/activity-feed/", query={"limit": "20"}),
    req("Activity feed unread",  "GET", "/api/activity-feed/unread-count/"),
    req("Mark all read",         "POST","/api/activity-feed/read-all/", body={}),
]

roles_items = [
    req("List roles (CRUD)",        "GET", "/api/roles/"),
    req("Retrieve role",            "GET", "/api/roles/{{role_slug}}/"),
    req("Create role",              "POST","/api/roles/", body={
        "slug": "demo-role", "nombre": "Rol demo",
        "color": "#3083FE", "orden": 50, "is_active": True,
    }),
    req("Update role",              "PATCH","/api/roles/{{role_slug}}/",
        body={"color": "#00B286"}),
    req("Delete role (soft)",       "DELETE","/api/roles/{{role_slug}}/"),
    req("List modules",             "GET", "/api/permissions/modules/"),
    req("List permission cells",    "GET", "/api/permissions/cells/"),
    req("Get role matrix",          "GET", "/api/permissions/groups/{{role_slug}}/"),
    req("PATCH role matrix",        "PATCH","/api/permissions/groups/{{role_slug}}/", body={
        "matrix": [
            {"module": "expedientes", "can_create": True, "can_read": True,
             "can_update": True, "can_delete": False},
        ],
    }),
]

# ═════════════════════════════════════════════════════════════════════
# Bonus · AI Hub + Storage + Sizing
# ═════════════════════════════════════════════════════════════════════
ai_items = [
    req("List agents",        "GET", "/api/ai/agents/"),
    req("List skills",        "GET", "/api/ai/skills/"),
    req("List instructions",  "GET", "/api/ai/instructions/"),
    req("List threads",       "GET", "/api/ai/threads/", auto_extract_id_to="thread_uuid"),
    req("Send message",       "POST","/api/ai/chat/send/", body={
        "thread_id": "{{thread_uuid}}",
        "message": "¿Cuál es el margen del Bisontes 2026?",
    }),
    req("Upload attachment",  "POST","/api/ai/chat/upload/",
        body={"_comment": "multipart: file"}),
    req("Usage logs",         "GET", "/api/ai/usage-logs/"),
]

storage_items = [
    req("List storage objects", "GET", "/api/storage/"),
    req("Retrieve signed URL",  "GET", "/api/storage/{{storage_uuid}}/"),
]

sizing_items = [
    req("List tallas",          "GET", "/api/sizing/tallas/"),
    req("Sizing options",       "GET", "/api/sizing/options/"),
    req("List tipos producto",  "GET", "/api/sizing/tipos-producto/"),
    req("List sistemas medida", "GET", "/api/sizing/sistemas-medida/"),
]


# ═════════════════════════════════════════════════════════════════════
# Ensamblado final
# ═════════════════════════════════════════════════════════════════════
collection = {
    "info": {
        "_postman_id": gen_id(),
        "name": COLLECTION_NAME,
        "description": COLLECTION_DESC.strip(),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "auth": {
        "type": "bearer",
        "bearer": [{"key": "token", "value": "{{access_token}}", "type": "string"}],
    },
    "event": [],
    "variable": [
        {"key": "base_url", "value": "https://consola.mwt.one", "type": "string"},
    ],
    "item": [
        folder("0 · Auth", auth_items,
               "Login (auto-guarda tokens), refresh, me, logout."),
        folder("1 · Dashboard", dashboard_items,
               "KPIs globales y por marca/nodo, embudo, series temporales."),
        folder("2 · Expedientes", expedientes_items,
               "OCs + expedientes + líneas + documentos + OCR + create-from-oc."),
        folder("3 · Pipeline", pipeline_items,
               "Transiciones permitidas + log de eventos."),
        folder("4 · Portal B2B", portal_items,
               "Catálogo público del cliente + sus expedientes + audit."),
        folder("5 · Financiero", financiero_items,
               "Pagos, conciliaciones, vencimientos, FX rate history."),
        folder("6 · Transferencias", transfers_items,
               "Transferencias entre nodos + líneas + eventos + documentos."),
        folder("7 · Nodos", nodos_items,
               "CRUD de nodos (warehouses, stores, hubs)."),
        folder("8 · Clientes", clientes_items,
               "CRUD + selects + KPIs + histórico de crédito."),
        folder("9 · Marcas (Motor de Precios)", marcas_items,
               "CRUD marcas + brand-client-pricing + resolve waterfall + COMEX."),
        folder("10 · Productos", productos_items,
               "CRUD productos + filtros."),
        folder("11 · Proveedores", proveedores_items,
               "CRUD proveedores."),
        folder("12 · Inventario", inventario_items,
               "Stock + movimientos."),
        folder("13 · Plantillas Email", templates_items,
               "Templates + versiones + preview log."),
        folder("14 · Historial Notificaciones", notif_items,
               "Notification logs + collection logs + grace days + queue."),
        folder("15 · Cobros", cobros_items,
               "Cobros + withholding log + collection events."),
        folder("Bonus · Users + Profile", users_items,
               "Gestión de usuarios + addresses + activity feed."),
        folder("Bonus · Roles + Permissions", roles_items,
               "RBAC: roles + módulos + matriz de permisos."),
        folder("Bonus · AI Hub", ai_items,
               "Agentes, skills, instructions, threads, chat."),
        folder("Bonus · Storage", storage_items,
               "MinIO/Paperless · signed URLs."),
        folder("Bonus · Sizing", sizing_items,
               "Motor de tallas — catálogos + tallas + opciones."),
    ],
}

# ═════════════════════════════════════════════════════════════════════
# Environment
# ═════════════════════════════════════════════════════════════════════
environment = {
    "id":   gen_id(),
    "name": "MWT.ONE · producción",
    "values": [
        {"key": "base_url",         "value": "https://consola.mwt.one", "type": "default", "enabled": True},
        # Credenciales · cambia esto antes de hacer push a Git
        {"key": "admin_email",      "value": "alejandro@muitowork.com", "type": "default", "enabled": True},
        {"key": "admin_password",   "value": "MuitoWork2026?",          "type": "secret",  "enabled": True},
        # Tokens · los rellena Login automáticamente
        {"key": "access_token",     "value": "",                         "type": "secret",  "enabled": True},
        {"key": "refresh_token",    "value": "",                         "type": "secret",  "enabled": True},
        {"key": "user_id",          "value": "",                         "type": "default", "enabled": True},
        {"key": "user_email",       "value": "",                         "type": "default", "enabled": True},
        {"key": "user_role",        "value": "",                         "type": "default", "enabled": True},
        # UUIDs reales — pégalos manualmente cuando los tengas
        {"key": "client_uuid",      "value": "",                         "type": "default", "enabled": True},
        {"key": "brand_uuid",       "value": "",                         "type": "default", "enabled": True},
        {"key": "product_uuid",     "value": "",                         "type": "default", "enabled": True},
        {"key": "supplier_uuid",    "value": "",                         "type": "default", "enabled": True},
        {"key": "node_uuid",        "value": "",                         "type": "default", "enabled": True},
        {"key": "node_origen_uuid", "value": "",                         "type": "default", "enabled": True},
        {"key": "node_destino_uuid","value": "",                         "type": "default", "enabled": True},
        {"key": "oc_uuid",          "value": "",                         "type": "default", "enabled": True},
        {"key": "expediente_uuid",  "value": "",                         "type": "default", "enabled": True},
        {"key": "transfer_uuid",    "value": "",                         "type": "default", "enabled": True},
        {"key": "stock_uuid",       "value": "",                         "type": "default", "enabled": True},
        {"key": "pago_uuid",        "value": "",                         "type": "default", "enabled": True},
        {"key": "cobro_uuid",       "value": "",                         "type": "default", "enabled": True},
        {"key": "template_uuid",    "value": "",                         "type": "default", "enabled": True},
        {"key": "user_uuid",        "value": "",                         "type": "default", "enabled": True},
        {"key": "role_slug",        "value": "operator",                 "type": "default", "enabled": True},
        {"key": "thread_uuid",      "value": "",                         "type": "default", "enabled": True},
        {"key": "storage_uuid",     "value": "",                         "type": "default", "enabled": True},
        {"key": "bcpa_uuid",        "value": "",                         "type": "default", "enabled": True},
    ],
    "_postman_variable_scope": "environment",
}

# ═════════════════════════════════════════════════════════════════════
# Escribir archivos
# ═════════════════════════════════════════════════════════════════════
OUT_COLL.write_text(json.dumps(collection, indent=2, ensure_ascii=False), encoding="utf-8")
OUT_ENV.write_text(json.dumps(environment, indent=2, ensure_ascii=False), encoding="utf-8")

print(f"✔ Colección: {OUT_COLL.relative_to(ROOT.parent)}")
print(f"✔ Environment: {OUT_ENV.relative_to(ROOT.parent)}")
print()

# Estadísticas
def count_requests(items):
    n = 0
    for it in items:
        if "request" in it:
            n += 1
        elif "item" in it:
            n += count_requests(it["item"])
    return n

print(f"Total folders: {len(collection['item'])}")
print(f"Total requests: {count_requests(collection['item'])}")
