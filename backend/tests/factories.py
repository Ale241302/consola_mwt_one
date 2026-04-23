"""
=====================================================================
MWT.ONE · tests/factories.py
Agente responsable: [AG-DATABASE]   (estructura/UUIDs)
                    [AG-06-QA]      (factory_boy + payloads de API)

OBJETIVO:
  Generar fixtures consistentes para los tests sin violar la
  REGLA DE ORO de MWT: CERO LLAVES FORÁNEAS FÍSICAS.
  Cualquier campo `*_id` se genera como `str(uuid.uuid4())` —
  jamás se inserta una fila en la tabla "padre" para "satisfacer un FK"
  porque el FK no existe en la base.

MWT usa modelos `managed=False` apuntando a tablas con schema explícito
(`db_table = 'productos"."producto'`). El ORM puede INSERTAR igual,
porque `auto_now_add` se ejecuta en `pre_save` independientemente del
flag managed. Lo único obligatorio es pasar el PK UUID a mano (no hay
default a nivel modelo Django).

Distinguimos dos tipos de factory:

  · *PayloadFactory  → dict listo para POST /api/<recurso>/. NO toca la DB.
  · *ModelFactory    → inserta una fila vía ORM (.objects.create). SÍ toca la DB.

Los tests usan PayloadFactory para Crear (porque la API genera el id
server-side) y ModelFactory para precargar registros que después se
listan/editan/borran.
=====================================================================
"""
from __future__ import annotations

import uuid
from datetime import date

import factory
from factory import LazyFunction

from apps.brands.models import BrandDiscountCode, Marca
from apps.clientes.models import Cliente
from apps.cobros.models import (
    Cobro,
    Conciliacion,
    Pago,
    Vencimiento,
)
from apps.commercial.models import (
    ClientAssignment,
    CommissionRule,
    EarlyPaymentPolicy,
    EarlyPaymentTier,
    GradeItem,
    PriceListVersion,
)
from apps.expedientes.models import Expediente, Oc
from apps.inventario.models import Movimiento, Stock
from apps.nodos.models import Nodo
from apps.productos.models import Producto
from apps.proveedores.models import (
    Proveedor,
    SupplierCertificacion,
    SupplierPromoCode,
)
from apps.transfers.models import (
    Evento,
    Linea as TransferLinea,
    Transferencia,
    TransferenciaDocumento,
)

# ─── BLOQUE 4 imports ─────────────────────────────────────────────────
from apps.analytics.models import DashboardSnapshot, WidgetCat
from apps.email_templates.models import (
    RenderPreviewLog,
    Template as EmailTemplate,
    Version as EmailTemplateVersion,
)
from apps.expedientes.models import EventLog, TransicionCat
from apps.notifications.models import EmailQueueLog, NotificationLog
from apps.portal.models import (
    MwtUser as PortalMwtUser,
    PortalAuditLog,
    PortalSessionLog,
)


# ═════════════════════════════════════════════════════════════════════
# Helpers — UUIDs cruzados (la "promesa" de FK conceptual)
# ═════════════════════════════════════════════════════════════════════
def fake_marca_id() -> str:
    """UUID de una marca conceptual. NO se persiste — no hay FK."""
    return str(uuid.uuid4())


def fake_cliente_id() -> str:
    return str(uuid.uuid4())


def fake_brand_id() -> str:
    return str(uuid.uuid4())


def fake_proveedor_id() -> str:
    return str(uuid.uuid4())


def fake_oc_id() -> str:
    return str(uuid.uuid4())


def fake_producto_id() -> str:
    return str(uuid.uuid4())


def fake_nodo_id() -> str:
    return str(uuid.uuid4())


def fake_responsable_id() -> str:
    """UUID de un usuario interno responsable. Sin FK contra core.users."""
    return str(uuid.uuid4())


def fake_legal_entity_id() -> str:
    """UUID de la entidad legal owner del nodo. Sin FK."""
    return str(uuid.uuid4())


def fake_operator_id() -> str:
    """UUID del operador del nodo. Sin FK."""
    return str(uuid.uuid4())


def fake_actor_id() -> str:
    """UUID del actor de un evento de auditoría. Sin FK."""
    return str(uuid.uuid4())


def fake_cobro_id() -> str:
    """UUID de un cobro conceptual (sin FK)."""
    return str(uuid.uuid4())


def fake_pago_id() -> str:
    """UUID de un pago conceptual (sin FK)."""
    return str(uuid.uuid4())


def fake_transferencia_id() -> str:
    """UUID de una transferencia conceptual (sin FK)."""
    return str(uuid.uuid4())


def fake_pricelist_version_id() -> str:
    """UUID de una pricelist version conceptual (sin FK)."""
    return str(uuid.uuid4())


def fake_expediente_id() -> str:
    """UUID conceptual de un expediente — sin FK física."""
    return str(uuid.uuid4())


def fake_template_id() -> str:
    return str(uuid.uuid4())


def fake_dashboard_snapshot_id() -> str:
    return str(uuid.uuid4())


def fake_portal_user_id() -> str:
    return str(uuid.uuid4())


def fake_notification_id() -> str:
    return str(uuid.uuid4())


def fake_event_id() -> str:
    return str(uuid.uuid4())


def fake_user_id() -> str:
    return str(uuid.uuid4())


def fake_policy_id() -> str:
    """UUID de una EarlyPaymentPolicy conceptual (sin FK)."""
    return str(uuid.uuid4())


# ═════════════════════════════════════════════════════════════════════
# PRODUCTO · Payload (para POST) y Model (para precargar DB)
# ═════════════════════════════════════════════════════════════════════
class ProductoPayloadFactory(factory.DictFactory):
    """
    Dict listo para `client.post('/api/productos/', data=...)`.
    NO incluye `id` — el endpoint lo genera con uuid.uuid4().
    """
    sku                 = factory.Sequence(lambda n: f"TEST-SKU-{n:05d}")
    nombre              = factory.Sequence(lambda n: f"Producto Test {n}")
    descripcion         = "Producto generado por la suite de pruebas QA"
    marca_id            = LazyFunction(fake_marca_id)
    categoria           = "CALZADO"
    subcategoria        = "BOTAS"
    unidad              = "PAR"
    moneda              = "USD"
    costo_estandar      = "25.50"
    precio_lista        = "78.00"
    precio_distribuidor = "62.40"
    precio_mwt          = "55.00"
    especificaciones    = factory.LazyFunction(lambda: {
        "tipo_puntera":  "acero",
        "normativa":     "EN ISO 20345 S3",
        "drop_mm":       8,
    })
    peso_kg                 = "0.850"
    volumen_m3              = "0.0042"
    tallas                  = factory.LazyFunction(lambda: ["40", "41", "42", "43"])
    colores                 = factory.LazyFunction(lambda: ["NEGRO", "MARRON"])
    estado                  = "ACTIVO"
    proveedor_principal_id  = LazyFunction(fake_proveedor_id)
    pais_origen_iso2        = "BR"
    hs_code                 = "640340"
    stock_minimo            = "20.000"
    stock_maximo            = "500.000"
    visibility_tier         = "INTERNAL"


class ProductoModelFactory(factory.django.DjangoModelFactory):
    """
    Inserta directamente vía ORM (Producto.objects.create). Útil para
    precargar productos antes de testear listar/editar/borrar.
    """
    class Meta:
        model = Producto

    id                  = LazyFunction(lambda: uuid.uuid4())  # UUIDField acepta UUID o str
    sku                 = factory.Sequence(lambda n: f"SEED-SKU-{n:05d}")
    nombre              = factory.Sequence(lambda n: f"Producto Seed {n}")
    descripcion         = "Seed para pruebas QA"
    marca_id            = LazyFunction(lambda: uuid.uuid4())
    categoria           = "CALZADO"
    subcategoria        = "BOTAS"
    unidad              = "PAR"
    moneda              = "USD"
    costo_estandar      = "20.00"
    precio_lista        = "60.00"
    precio_distribuidor = "48.00"
    precio_mwt          = "42.00"
    especificaciones    = factory.LazyFunction(dict)
    estado              = "ACTIVO"
    proveedor_principal_id = LazyFunction(lambda: uuid.uuid4())
    pais_origen_iso2    = "BR"
    visibility_tier     = "INTERNAL"
    is_active           = True


# ═════════════════════════════════════════════════════════════════════
# OC (Orden de Compra) · Payload + Model
# ═════════════════════════════════════════════════════════════════════
class OcPayloadFactory(factory.DictFactory):
    codigo          = factory.Sequence(lambda n: f"OC-TEST-{n:05d}")
    client_id       = LazyFunction(fake_cliente_id)
    brand_id        = LazyFunction(fake_brand_id)
    proforma        = factory.Sequence(lambda n: f"PRF-{n:05d}")
    estado          = "EMITIDA"
    moneda          = "USD"
    issued_at       = LazyFunction(lambda: date.today().isoformat())
    total_value     = "12500.00"
    total_invoiced  = "0.00"
    total_paid      = "0.00"
    balance         = "12500.00"
    coverage_pct    = "0.0000"
    lines_count     = 0
    lines_with_sap  = 0
    air_pct         = "0.0000"
    sea_pct         = "1.0000"
    credit_days_max = 60
    credit_band     = "NORMAL"
    notas           = "OC creada por la suite QA"
    visibility_tier = "INTERNAL"


class OcModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Oc

    id          = LazyFunction(lambda: uuid.uuid4())
    codigo      = factory.Sequence(lambda n: f"OC-SEED-{n:05d}")
    client_id   = LazyFunction(lambda: uuid.uuid4())
    brand_id    = LazyFunction(lambda: uuid.uuid4())
    estado      = "EMITIDA"
    moneda      = "USD"
    issued_at   = LazyFunction(date.today)
    total_value = "10000.00"
    balance     = "10000.00"
    visibility_tier = "INTERNAL"
    is_active   = True


# ═════════════════════════════════════════════════════════════════════
# EXPEDIENTE · Payload + Model
# ═════════════════════════════════════════════════════════════════════
class ExpedientePayloadFactory(factory.DictFactory):
    codigo              = factory.Sequence(lambda n: f"EXP-TEST-{n:05d}")
    oc_id               = LazyFunction(fake_oc_id)
    client_id           = LazyFunction(fake_cliente_id)
    brand_id            = LazyFunction(fake_brand_id)
    estado              = "REGISTRO"
    modo_operacion      = "FULL"
    incoterm            = "FOB"
    freight_mode        = "SEA"
    dispatch_mode       = "FCL"
    origin              = "Sao Paulo"
    destination         = "Buenos Aires"
    origin_country      = "BR"
    destination_country = "AR"
    container_count     = 1
    product_count       = 4
    moneda              = "USD"
    total_cost          = "9800.00"
    total_invoiced      = "0.00"
    total_paid          = "0.00"
    balance             = "9800.00"
    commission_pct      = "0.0500"
    dai_pct             = "0.1800"
    iva_pct             = "0.2100"
    credit_days         = 45
    credit_band         = "NORMAL"
    artifacts_done      = 0
    artifacts_total     = 6
    baseline_days       = 10
    visibility_tier     = "INTERNAL"
    notas               = "Expediente generado por la suite QA"


class ExpedienteModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Expediente

    id              = LazyFunction(lambda: uuid.uuid4())
    codigo          = factory.Sequence(lambda n: f"EXP-SEED-{n:05d}")
    oc_id           = LazyFunction(lambda: uuid.uuid4())
    client_id       = LazyFunction(lambda: uuid.uuid4())
    brand_id        = LazyFunction(lambda: uuid.uuid4())
    estado          = "REGISTRO"
    modo_operacion  = "FULL"
    moneda          = "USD"
    total_cost      = "5000.00"
    balance         = "5000.00"
    artifacts_total = 6
    baseline_days   = 10
    visibility_tier = "INTERNAL"
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# CLIENTE · Payload + Model   (Módulo 8)
# ═════════════════════════════════════════════════════════════════════
class ClientePayloadFactory(factory.DictFactory):
    """
    POST /api/clientes/. Required mínimos del serializer:
      razon_social, tax_id, tipo, pais_iso2.
    Cross-UUIDs (nodo_asignado_id, responsable_id) generados al vuelo.
    """
    razon_social     = factory.Sequence(lambda n: f"Cliente Test SRL {n:04d}")
    nombre_comercial = factory.Sequence(lambda n: f"ClienteTest{n}")
    tax_id           = factory.Sequence(lambda n: f"30-{n:08d}-{n % 10}")
    tipo             = "B2B"
    segmento         = "B"
    pais_iso2        = "AR"
    ciudad           = "Buenos Aires"
    direccion        = "Av. Corrientes 1234"
    moneda           = "USD"
    credito_aprobado = "50000.00"
    credito_usado    = "10000.00"
    dias_credito     = 30
    contacto_nombre  = "Juan Tester"
    contacto_email   = "qa@cliente-test.local"
    contacto_tel     = "+5491155551234"
    estado           = "ACTIVO"
    nodo_asignado_id = LazyFunction(fake_nodo_id)
    responsable_id   = LazyFunction(fake_responsable_id)
    visibility_tier  = "INTERNAL"
    canal            = "DIRECTO"
    incoterm         = "DAP"
    medio_pago       = "TRANSFERENCIA"


class ClienteModelFactory(factory.django.DjangoModelFactory):
    """ORM-backed para precargar clientes (listar/editar/borrar)."""
    class Meta:
        model = Cliente

    id               = LazyFunction(lambda: uuid.uuid4())
    razon_social     = factory.Sequence(lambda n: f"Cliente Seed {n:04d}")
    nombre_comercial = factory.Sequence(lambda n: f"ClienteSeed{n}")
    tax_id           = factory.Sequence(lambda n: f"20-{n:08d}-{n % 10}")
    tipo             = "B2B"
    segmento         = "B"
    pais_iso2        = "AR"
    ciudad           = "Buenos Aires"
    moneda           = "USD"
    credito_aprobado = "100000.00"
    credito_usado    = "0.00"
    dias_credito     = 30
    estado           = "ACTIVO"
    nodo_asignado_id = LazyFunction(lambda: uuid.uuid4())
    responsable_id   = LazyFunction(lambda: uuid.uuid4())
    visibility_tier  = "INTERNAL"
    is_active        = True


# ═════════════════════════════════════════════════════════════════════
# MARCA · Payload + Model   (Módulo 9)
# ═════════════════════════════════════════════════════════════════════
class MarcaPayloadFactory(factory.DictFactory):
    """
    POST /api/marcas/. Required del serializer:
      nombre, slug (UNIQUE), pais_origen_iso2, categoria_principal.
    Cross-UUIDs (responsable_id, issuing_entity_id) generados al vuelo.
    """
    nombre              = factory.Sequence(lambda n: f"Marca Test {n}")
    slug                = factory.Sequence(lambda n: f"marca-test-{n:05d}")
    pais_origen_iso2    = "BR"
    categoria_principal = "CALZADO"
    descripcion         = "Marca generada por la suite QA"
    logo_url            = "https://cdn.test.local/marcas/test.svg"
    website             = "https://marca-test.local"
    estado_comercial    = "PROSPECTO"
    responsable_id      = LazyFunction(fake_responsable_id)
    territorios         = factory.LazyFunction(lambda: ["AR", "UY", "PY"])
    markup_default      = "2.50"
    dias_pago_default   = 30
    moneda_default      = "USD"
    visibility_tier     = "INTERNAL"
    issuing_entity_id   = LazyFunction(fake_legal_entity_id)
    mercados_activos    = factory.LazyFunction(lambda: ["AR", "BR"])
    min_margin_alert_pct = "25.00"
    brand_code          = factory.Sequence(lambda n: f"BRD{n:04d}")
    tipo                = "EXCLUSIVA"


class MarcaModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Marca

    id                  = LazyFunction(lambda: uuid.uuid4())
    nombre              = factory.Sequence(lambda n: f"Marca Seed {n}")
    slug                = factory.Sequence(lambda n: f"marca-seed-{n:05d}")
    pais_origen_iso2    = "BR"
    categoria_principal = "CALZADO"
    estado_comercial    = "ACTIVA"
    responsable_id      = LazyFunction(lambda: uuid.uuid4())
    territorios         = factory.LazyFunction(list)
    markup_default      = "2.50"
    dias_pago_default   = 30
    moneda_default      = "USD"
    visibility_tier     = "INTERNAL"
    mercados_activos    = factory.LazyFunction(list)
    min_margin_alert_pct = "25.00"
    tipo                = "EXCLUSIVA"
    is_active           = True


# ═════════════════════════════════════════════════════════════════════
# BRAND DISCOUNT CODE · satélite de Marca
# ═════════════════════════════════════════════════════════════════════
class BrandDiscountCodePayloadFactory(factory.DictFactory):
    """
    POST /api/marcas/{id}/discount_codes/.
    El proveedor `marca_id` lo inyecta el endpoint, no se manda.
    """
    codigo         = factory.Sequence(lambda n: f"PROMO-{n:05d}")
    descripcion    = "Descuento de prueba — suite QA"
    tipo_descuento = "PCT"
    valor_pct      = "10.00"
    valor_fijo_usd = "0.00"
    max_usos       = 100
    scope          = "GLOBAL"
    scope_ids      = factory.LazyFunction(list)
    reglas_json    = factory.LazyFunction(dict)


class BrandDiscountCodeModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = BrandDiscountCode

    id              = LazyFunction(lambda: uuid.uuid4())
    marca_id        = LazyFunction(lambda: uuid.uuid4())
    codigo          = factory.Sequence(lambda n: f"PROMO-SEED-{n:05d}")
    descripcion     = "Promo seedeada"
    tipo_descuento  = "PCT"
    valor_pct       = "5.00"
    scope           = "GLOBAL"
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# PROVEEDOR · Payload + Model   (Módulo 11)
# ═════════════════════════════════════════════════════════════════════
class ProveedorPayloadFactory(factory.DictFactory):
    """POST /api/proveedores/. Required: razon_social, tipo."""
    codigo            = factory.Sequence(lambda n: f"PROV-{n:05d}")
    razon_social      = factory.Sequence(lambda n: f"Proveedor Test SA {n:04d}")
    nombre_comercial  = factory.Sequence(lambda n: f"ProvTest{n}")
    tax_id            = factory.Sequence(lambda n: f"30-{n:08d}-9")
    tipo              = "FABRICANTE"
    estado            = "PROSPECTO"
    pais_iso2         = "BR"
    ciudad            = "Sao Paulo"
    direccion         = "Av Paulista 1000"
    zona_horaria      = "America/Sao_Paulo"
    contacto_nombre   = "Carla Tester"
    contacto_email    = "qa@proveedor-test.local"
    contacto_tel      = "+5511999999999"
    web               = "https://proveedor-test.local"
    moneda_default    = "USD"
    incoterm_default  = "FOB"
    lead_time_dias    = 45
    moq               = "100.000"
    condiciones_pago  = "30/60"
    dias_credito      = 60
    rating            = "4.50"
    nps               = 9
    categorias        = factory.LazyFunction(lambda: ["CALZADO", "EPP"])
    certificaciones   = factory.LazyFunction(lambda: ["ISO_9001", "ISO_45001"])
    responsable_id    = LazyFunction(fake_responsable_id)
    visibility_tier   = "INTERNAL"
    clase             = "CRITICO"
    score_iso         = "4.5"
    producto_servicio = "Botas de seguridad y EPP"


class ProveedorModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Proveedor

    id                = LazyFunction(lambda: uuid.uuid4())
    codigo            = factory.Sequence(lambda n: f"PROV-SEED-{n:05d}")
    razon_social      = factory.Sequence(lambda n: f"Proveedor Seed {n:04d}")
    tipo              = "FABRICANTE"
    estado            = "ACTIVO"
    pais_iso2         = "BR"
    ciudad            = "Sao Paulo"
    moneda_default    = "USD"
    incoterm_default  = "FOB"
    lead_time_dias    = 30
    rating            = "4.00"
    categorias        = factory.LazyFunction(list)
    certificaciones   = factory.LazyFunction(list)
    responsable_id    = LazyFunction(lambda: uuid.uuid4())
    visibility_tier   = "INTERNAL"
    clase             = "NORMAL"
    is_active         = True


# ═════════════════════════════════════════════════════════════════════
# SUPPLIER CERTIFICACION · satélite de Proveedor
# ═════════════════════════════════════════════════════════════════════
class SupplierCertificacionPayloadFactory(factory.DictFactory):
    """POST /api/proveedores/{id}/certificaciones/. proveedor_id lo inyecta el viewset."""
    tipo              = "ISO_9001"
    descripcion       = "Sistema de gestión de calidad"
    numero_certif     = factory.Sequence(lambda n: f"CERT-{n:06d}")
    fecha_emision     = LazyFunction(lambda: date(2024, 1, 15).isoformat())
    fecha_vencimiento = LazyFunction(lambda: date(2027, 1, 15).isoformat())
    alert_dias_antes  = 60
    documento_url     = "https://docs.test.local/cert.pdf"


class SupplierCertificacionModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = SupplierCertificacion

    id                = LazyFunction(lambda: uuid.uuid4())
    proveedor_id      = LazyFunction(lambda: uuid.uuid4())
    tipo              = "ISO_9001"
    numero_certif     = factory.Sequence(lambda n: f"CERT-SEED-{n:06d}")
    fecha_emision     = LazyFunction(lambda: date(2024, 1, 15))
    fecha_vencimiento = LazyFunction(lambda: date(2027, 1, 15))
    alert_dias_antes  = 60
    is_active         = True


# ═════════════════════════════════════════════════════════════════════
# SUPPLIER PROMO CODE · satélite de Proveedor
# ═════════════════════════════════════════════════════════════════════
class SupplierPromoCodePayloadFactory(factory.DictFactory):
    """POST /api/proveedores/{id}/promo_codes/. proveedor_id lo inyecta el viewset."""
    codigo         = factory.Sequence(lambda n: f"SUPPROMO-{n:05d}")
    descripcion    = "Promo de prueba — suite QA"
    tipo_descuento = "PCT"
    valor_pct      = "12.50"
    valor_fijo_usd = "0.00"
    min_volumen    = "10.000"
    max_usos       = 50
    scope          = "GLOBAL"
    scope_ids      = factory.LazyFunction(list)
    reglas_json    = factory.LazyFunction(dict)


class SupplierPromoCodeModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = SupplierPromoCode

    id              = LazyFunction(lambda: uuid.uuid4())
    proveedor_id    = LazyFunction(lambda: uuid.uuid4())
    codigo          = factory.Sequence(lambda n: f"SUPPROMO-SEED-{n:05d}")
    tipo_descuento  = "PCT"
    valor_pct       = "10.00"
    scope           = "GLOBAL"
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# NODO · Payload + Model   (Módulo 7)
# ═════════════════════════════════════════════════════════════════════
class NodoPayloadFactory(factory.DictFactory):
    """
    POST /api/nodos/. Required: codigo (UNIQUE), nombre, tipo,
    pais_iso2, ciudad. capabilities y status tienen defaults en la view.
    """
    codigo                = factory.Sequence(lambda n: f"NODO-{n:05d}")
    nombre                = factory.Sequence(lambda n: f"Nodo Test {n}")
    tipo                  = "DEPOSITO"
    pais_iso2             = "AR"
    ciudad                = "Buenos Aires"
    direccion             = "Av Industrial 100"
    zona_horaria          = "America/Argentina/Buenos_Aires"
    responsable_id        = LazyFunction(fake_responsable_id)
    contacto_email        = "qa@nodo-test.local"
    contacto_tel          = "+5491144441234"
    lat                   = "-34.603722"
    lng                   = "-58.381592"
    capacidad_m2          = "1500.00"
    observaciones         = "Nodo de prueba — generado por suite QA"
    legal_entity_owner_id = LazyFunction(fake_legal_entity_id)
    operator_id           = LazyFunction(fake_operator_id)
    capabilities          = factory.LazyFunction(
        lambda: ["receive", "store", "dispatch"]
    )
    status                = "ACTIVE"


class NodoModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Nodo

    id                    = LazyFunction(lambda: uuid.uuid4())
    codigo                = factory.Sequence(lambda n: f"NODO-SEED-{n:05d}")
    nombre                = factory.Sequence(lambda n: f"Nodo Seed {n}")
    tipo                  = "DEPOSITO"
    pais_iso2             = "AR"
    ciudad                = "Buenos Aires"
    zona_horaria          = "America/Argentina/Buenos_Aires"
    responsable_id        = LazyFunction(lambda: uuid.uuid4())
    legal_entity_owner_id = LazyFunction(lambda: uuid.uuid4())
    operator_id           = LazyFunction(lambda: uuid.uuid4())
    capabilities          = factory.LazyFunction(lambda: ["receive", "store"])
    status                = "ACTIVE"
    is_active             = True


# ═════════════════════════════════════════════════════════════════════
# STOCK · Payload + Model   (Módulo 12 · Inventario)
# ═════════════════════════════════════════════════════════════════════
class StockPayloadFactory(factory.DictFactory):
    """
    POST /api/stock/. Required del serializer:
      nodo_id, producto_id, cantidad_disponible.
    UUIDs cruzados sin FK.
    """
    nodo_id              = LazyFunction(fake_nodo_id)
    producto_id          = LazyFunction(fake_producto_id)
    lote                 = factory.Sequence(lambda n: f"LOTE-{n:05d}")
    cantidad_disponible  = "100.000"
    cantidad_reservada   = "0.000"
    cantidad_en_transito = "0.000"
    costo_unitario_usd   = "12.5000"
    cantidad_minima      = "20.000"
    cantidad_maxima      = "500.000"
    dias_stock_minimo    = 14
    ubicacion_fisica     = "A-01-03"


class StockModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Stock

    id                   = LazyFunction(lambda: uuid.uuid4())
    nodo_id              = LazyFunction(lambda: uuid.uuid4())
    producto_id          = LazyFunction(lambda: uuid.uuid4())
    lote                 = factory.Sequence(lambda n: f"LOTE-SEED-{n:05d}")
    cantidad_disponible  = "200.000"
    cantidad_reservada   = "0.000"
    cantidad_en_transito = "0.000"
    costo_unitario_usd   = "10.0000"
    cantidad_minima      = "30.000"
    dias_stock_minimo    = 14
    is_active            = True


# ═════════════════════════════════════════════════════════════════════
# MOVIMIENTO · Payload + Model   (Módulo 12 · Inventario)
# ═════════════════════════════════════════════════════════════════════
class MovimientoPayloadFactory(factory.DictFactory):
    """
    POST /api/movimientos/. Required: tipo, producto_id, cantidad.
    Para ENTRADA: nodo_destino_id; para SALIDA: nodo_origen_id;
    para TRANSFER: ambos.
    """
    tipo               = "ENTRADA"
    motivo             = "RECEPCION_OC"
    producto_id        = LazyFunction(fake_producto_id)
    nodo_origen_id     = None
    nodo_destino_id    = LazyFunction(fake_nodo_id)
    lote               = factory.Sequence(lambda n: f"LOTE-MOV-{n:05d}")
    cantidad           = "50.000"
    costo_unitario_usd = "11.5000"
    referencia_tipo    = "OC"
    referencia_id      = LazyFunction(fake_oc_id)
    notas              = "Movimiento generado por la suite QA"
    contexto_legal     = "INTERNAL"


class MovimientoModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Movimiento

    id                 = LazyFunction(lambda: uuid.uuid4())
    tipo               = "ENTRADA"
    motivo             = "RECEPCION_OC"
    producto_id        = LazyFunction(lambda: uuid.uuid4())
    nodo_destino_id    = LazyFunction(lambda: uuid.uuid4())
    lote               = factory.Sequence(lambda n: f"LOTE-MOV-SEED-{n:05d}")
    cantidad           = "25.000"
    costo_unitario_usd = "10.0000"
    contexto_legal     = "INTERNAL"
    is_active          = True


# ═════════════════════════════════════════════════════════════════════
# TRANSFERENCIA · Payload + Model   (Módulo 6)
# ═════════════════════════════════════════════════════════════════════
class TransferenciaPayloadFactory(factory.DictFactory):
    """
    POST /api/transferencias/. Required del serializer:
      codigo (UNIQUE), origen_id, destino_id.
    Estado por defecto: PLANNED. Las transiciones se hacen vía actions.
    """
    codigo           = factory.Sequence(lambda n: f"TR-TEST-{n:05d}")
    origen_id        = LazyFunction(fake_nodo_id)
    destino_id       = LazyFunction(fake_nodo_id)
    origen_label     = "Depósito Origen QA"
    destino_label    = "Depósito Destino QA"
    legal_context    = "INTERNAL"
    estado           = "PLANNED"
    ref_tracking     = factory.Sequence(lambda n: f"TRK-{n:08d}")
    needs_approval   = False
    value_usd        = "12500.00"
    notes            = "Transferencia generada por la suite QA"
    created_by_id    = LazyFunction(fake_actor_id)
    created_by_name  = "QA Bot"
    eta              = LazyFunction(lambda: date(2026, 5, 15).isoformat())


class TransferenciaModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Transferencia

    id              = LazyFunction(lambda: uuid.uuid4())
    codigo          = factory.Sequence(lambda n: f"TR-SEED-{n:05d}")
    origen_id       = LazyFunction(lambda: uuid.uuid4())
    destino_id      = LazyFunction(lambda: uuid.uuid4())
    origen_label    = "Depósito Origen Seed"
    destino_label   = "Depósito Destino Seed"
    legal_context   = "INTERNAL"
    estado          = "PLANNED"
    value_usd       = "10000.00"
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# TRANSFER · LINEA · Payload + Model
# ═════════════════════════════════════════════════════════════════════
class TransferLineaPayloadFactory(factory.DictFactory):
    """POST /api/transfer-lineas/. Required: transferencia_id, qty_transfer."""
    transferencia_id = LazyFunction(fake_transferencia_id)
    producto_id      = LazyFunction(fake_producto_id)
    sku              = factory.Sequence(lambda n: f"SKU-LIN-{n:05d}")
    product_label    = factory.Sequence(lambda n: f"Producto Línea {n}")
    size             = "42"
    qty_transfer     = 100
    qty_reserve      = 0
    unit_cost        = "12.50"
    unit_value       = "25.00"
    tolerancia_pct   = "2.00"


class TransferLineaModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = TransferLinea

    id               = LazyFunction(lambda: uuid.uuid4())
    transferencia_id = LazyFunction(lambda: uuid.uuid4())
    producto_id      = LazyFunction(lambda: uuid.uuid4())
    sku              = factory.Sequence(lambda n: f"SKU-LIN-SEED-{n:05d}")
    qty_transfer     = 50
    qty_reserve      = 0
    unit_cost        = "10.00"
    unit_value       = "20.00"
    tolerancia_pct   = "0.00"
    is_active        = True


# ═════════════════════════════════════════════════════════════════════
# TRANSFER · EVENTO · Payload + Model
# ═════════════════════════════════════════════════════════════════════
class TransferEventoPayloadFactory(factory.DictFactory):
    """POST /api/transfer-eventos/. Required: transferencia_id, estado_nuevo."""
    transferencia_id  = LazyFunction(fake_transferencia_id)
    estado_prev       = "PLANNED"
    estado_nuevo      = "APPROVED"
    actor_id          = LazyFunction(fake_actor_id)
    actor_name        = "QA Approver"
    notes             = "Aprobada por suite QA"
    idempotence_token = factory.Sequence(lambda n: f"tok-{n:08d}")


class TransferEventoModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Evento

    id                = LazyFunction(lambda: uuid.uuid4())
    transferencia_id  = LazyFunction(lambda: uuid.uuid4())
    estado_prev       = "PLANNED"
    estado_nuevo      = "APPROVED"
    actor_id          = LazyFunction(lambda: uuid.uuid4())
    actor_name        = "Seed Actor"
    is_active         = True


# ═════════════════════════════════════════════════════════════════════
# TRANSFER · DOCUMENTO · Payload + Model
# ═════════════════════════════════════════════════════════════════════
class TransferDocumentoPayloadFactory(factory.DictFactory):
    """POST /api/transferencias/{id}/documentos/. transferencia_id lo inyecta el viewset."""
    tipo             = "REMISION"
    titulo           = "Remisión de prueba"
    url              = "https://docs.test.local/remision.pdf"
    bucket           = "transfers"
    object_key       = factory.Sequence(lambda n: f"remisiones/{n:08d}.pdf")
    content_type     = "application/pdf"
    size_bytes       = 102400
    numero_ref       = factory.Sequence(lambda n: f"R-{n:06d}")
    fecha_emision    = LazyFunction(lambda: date(2026, 4, 1).isoformat())
    descripcion      = "Documento de prueba — suite QA"
    uploaded_by      = LazyFunction(fake_actor_id)
    uploaded_by_name = "QA Uploader"


class TransferDocumentoModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = TransferenciaDocumento

    id               = LazyFunction(lambda: uuid.uuid4())
    transferencia_id = LazyFunction(lambda: uuid.uuid4())
    tipo             = "REMISION"
    titulo           = "Remisión seedeada"
    is_active        = True


# ═════════════════════════════════════════════════════════════════════
# COBRO · Payload + Model   (Módulo 15)
# ═════════════════════════════════════════════════════════════════════
class CobroPayloadFactory(factory.DictFactory):
    """POST /api/cobros/. Required: codigo (UNIQUE)."""
    codigo            = factory.Sequence(lambda n: f"COB-TEST-{n:05d}")
    oc_id             = LazyFunction(fake_oc_id)
    expediente_id     = LazyFunction(lambda: str(uuid.uuid4()))
    client_id         = LazyFunction(fake_cliente_id)
    moneda            = "USD"
    monto_total       = "10000.00"
    monto_pagado      = "0.00"
    monto_pendiente   = "10000.00"
    fecha_vencimiento = LazyFunction(lambda: date(2026, 5, 30).isoformat())
    dias_credito      = 30
    estado            = "PENDIENTE"
    notas             = "Cobro generado por la suite QA"
    visibility_tier   = "INTERNAL"
    collection_stage  = "NONE"


class CobroModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Cobro

    id                = LazyFunction(lambda: uuid.uuid4())
    codigo            = factory.Sequence(lambda n: f"COB-SEED-{n:05d}")
    oc_id             = LazyFunction(lambda: uuid.uuid4())
    client_id         = LazyFunction(lambda: uuid.uuid4())
    moneda            = "USD"
    monto_total       = "5000.00"
    monto_pagado      = "0.00"
    monto_pendiente   = "5000.00"
    fecha_vencimiento = LazyFunction(lambda: date(2026, 6, 15))
    dias_credito      = 30
    estado            = "PENDIENTE"
    visibility_tier   = "INTERNAL"
    collection_stage  = "NONE"
    is_active         = True


# ═════════════════════════════════════════════════════════════════════
# PAGO · Payload + Model
# ═════════════════════════════════════════════════════════════════════
class PagoPayloadFactory(factory.DictFactory):
    """POST /api/pagos/. Required: codigo (UNIQUE)."""
    codigo             = factory.Sequence(lambda n: f"PAG-TEST-{n:05d}")
    direccion          = "INGRESO"
    cobro_id           = LazyFunction(fake_cobro_id)
    oc_id              = LazyFunction(fake_oc_id)
    client_id          = LazyFunction(fake_cliente_id)
    metodo             = "TRANSFERENCIA"
    referencia_externa = factory.Sequence(lambda n: f"REF-EXT-{n:08d}")
    banco_origen       = "Banco Test Origen"
    banco_destino      = "Banco Test Destino"
    moneda             = "USD"
    monto              = "5000.00"
    fx_rate            = "1.000000"
    monto_usd          = "5000.00"
    estado             = "PENDIENTE"
    fecha_operacion    = LazyFunction(lambda: date(2026, 4, 20).isoformat())
    visibility_tier    = "INTERNAL"
    fx_source          = "MANUAL"
    withholding_usd    = "0.00"
    fees_bank_usd      = "0.00"


class PagoModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Pago

    id              = LazyFunction(lambda: uuid.uuid4())
    codigo          = factory.Sequence(lambda n: f"PAG-SEED-{n:05d}")
    direccion       = "INGRESO"
    cobro_id        = LazyFunction(lambda: uuid.uuid4())
    metodo          = "TRANSFERENCIA"
    moneda          = "USD"
    monto           = "2500.00"
    fx_rate         = "1.000000"
    monto_usd       = "2500.00"
    estado          = "PENDIENTE"
    visibility_tier = "INTERNAL"
    fx_source       = "MANUAL"
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# CONCILIACION · Payload + Model
# ═════════════════════════════════════════════════════════════════════
class ConciliacionPayloadFactory(factory.DictFactory):
    """POST /api/conciliaciones/. Required: pago_ingreso_id."""
    pago_ingreso_id   = LazyFunction(fake_pago_id)
    pago_egreso_id    = None
    cobro_id          = LazyFunction(fake_cobro_id)
    monto_matched     = "5000.00"
    moneda            = "USD"
    notas             = "Conciliación generada por la suite QA"
    external_ref      = factory.Sequence(lambda n: f"CONC-EXT-{n:08d}")
    auto_matched      = False
    match_score       = "0.95"


class ConciliacionModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Conciliacion

    id              = LazyFunction(lambda: uuid.uuid4())
    pago_ingreso_id = LazyFunction(lambda: uuid.uuid4())
    cobro_id        = LazyFunction(lambda: uuid.uuid4())
    monto_matched   = "1000.00"
    moneda          = "USD"
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# VENCIMIENTO · Payload + Model   (Plan T1/T2/T3)
# ═════════════════════════════════════════════════════════════════════
class VencimientoPayloadFactory(factory.DictFactory):
    """POST /api/vencimientos/. Required: cobro_id, tramo, pct_monto, monto_usd, fecha_vencimiento."""
    cobro_id          = LazyFunction(fake_cobro_id)
    tramo             = "T1"
    pct_monto         = "33.33"
    monto_usd         = "3333.00"
    fecha_vencimiento = LazyFunction(lambda: date(2026, 5, 15).isoformat())
    monto_pagado_usd  = "0.00"
    estado            = "PENDIENTE"


class VencimientoModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Vencimiento

    id                = LazyFunction(lambda: uuid.uuid4())
    cobro_id          = LazyFunction(lambda: uuid.uuid4())
    tramo             = "T1"
    pct_monto         = "33.33"
    monto_usd         = "1000.00"
    fecha_vencimiento = LazyFunction(lambda: date(2026, 5, 15))
    estado            = "PENDIENTE"
    is_active         = True


# ═════════════════════════════════════════════════════════════════════
# COMMERCIAL · PriceListVersion (Módulo 5 · Financiero)
# ═════════════════════════════════════════════════════════════════════
class PriceListVersionPayloadFactory(factory.DictFactory):
    """POST /api/commercial/pricelist-versions/. Required: brand_id, codigo, nombre, valid_from."""
    brand_id    = LazyFunction(fake_brand_id)
    codigo      = factory.Sequence(lambda n: f"PLV-TEST-{n:05d}")
    nombre      = factory.Sequence(lambda n: f"PriceList QA #{n}")
    descripcion = "Pricelist generada por suite QA"
    currency    = "USD"
    valid_from  = LazyFunction(lambda: date(2026, 1, 1).isoformat())
    valid_to    = LazyFunction(lambda: date(2026, 12, 31).isoformat())
    source      = "UPLOAD"


class PriceListVersionModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PriceListVersion

    id          = LazyFunction(lambda: uuid.uuid4())
    brand_id    = LazyFunction(lambda: uuid.uuid4())
    codigo      = factory.Sequence(lambda n: f"PLV-SEED-{n:05d}")
    nombre      = factory.Sequence(lambda n: f"PriceList Seed {n}")
    currency    = "USD"
    valid_from  = LazyFunction(lambda: date(2026, 1, 1))
    source      = "UPLOAD"
    is_active   = True


# ═════════════════════════════════════════════════════════════════════
# COMMERCIAL · GradeItem
# ═════════════════════════════════════════════════════════════════════
class GradeItemPayloadFactory(factory.DictFactory):
    """POST /api/commercial/grade-items/. Required: pricelist_version_id, brand_id, product_sku, unit_price_usd."""
    pricelist_version_id = LazyFunction(fake_pricelist_version_id)
    brand_id             = LazyFunction(fake_brand_id)
    product_sku          = factory.Sequence(lambda n: f"GRD-SKU-{n:05d}")
    product_name         = factory.Sequence(lambda n: f"Grade Item {n}")
    unit_price_usd       = "42.5000"
    cost_usd             = "18.2000"
    size_multipliers     = factory.LazyFunction(lambda: {"40": 4, "41": 6, "42": 5})
    tags                 = factory.LazyFunction(lambda: ["ss26", "qa"])


class GradeItemModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = GradeItem

    id                   = LazyFunction(lambda: uuid.uuid4())
    pricelist_version_id = LazyFunction(lambda: uuid.uuid4())
    brand_id             = LazyFunction(lambda: uuid.uuid4())
    product_sku          = factory.Sequence(lambda n: f"GRD-SKU-SEED-{n:05d}")
    unit_price_usd       = "30.0000"
    cost_usd             = "12.0000"
    size_multipliers     = factory.LazyFunction(dict)
    tags                 = factory.LazyFunction(list)
    is_active            = True


# ═════════════════════════════════════════════════════════════════════
# COMMERCIAL · ClientAssignment (CPA)
# ═════════════════════════════════════════════════════════════════════
class ClientAssignmentPayloadFactory(factory.DictFactory):
    """POST /api/commercial/client-assignments/. Required: client_id, brand_id, brand_sku, cached_client_price, valid_from."""
    client_id           = LazyFunction(fake_cliente_id)
    brand_id            = LazyFunction(fake_brand_id)
    brand_sku           = factory.Sequence(lambda n: f"CPA-SKU-{n:05d}")
    cached_client_price = "39.9000"
    currency            = "USD"
    valid_from          = LazyFunction(lambda: date(2026, 1, 1).isoformat())
    valid_to            = LazyFunction(lambda: date(2026, 12, 31).isoformat())
    notes               = "CPA generada por suite QA"


class ClientAssignmentModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = ClientAssignment

    id                  = LazyFunction(lambda: uuid.uuid4())
    client_id           = LazyFunction(lambda: uuid.uuid4())
    brand_id            = LazyFunction(lambda: uuid.uuid4())
    brand_sku           = factory.Sequence(lambda n: f"CPA-SKU-SEED-{n:05d}")
    cached_client_price = "29.9000"
    currency            = "USD"
    valid_from          = LazyFunction(lambda: date(2026, 1, 1))
    is_active           = True


# ═════════════════════════════════════════════════════════════════════
# COMMERCIAL · EarlyPaymentPolicy + Tier
# ═════════════════════════════════════════════════════════════════════
class EarlyPaymentPolicyPayloadFactory(factory.DictFactory):
    """POST /api/commercial/early-payment-policies/. Required: client_id, brand_id, codigo, nombre, valid_from."""
    client_id   = LazyFunction(fake_cliente_id)
    brand_id    = LazyFunction(fake_brand_id)
    codigo      = factory.Sequence(lambda n: f"EPP-TEST-{n:05d}")
    nombre      = factory.Sequence(lambda n: f"Early Payment Policy {n}")
    descripcion = "Política generada por suite QA"
    valid_from  = LazyFunction(lambda: date(2026, 1, 1).isoformat())
    valid_to    = LazyFunction(lambda: date(2026, 12, 31).isoformat())


class EarlyPaymentPolicyModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = EarlyPaymentPolicy

    id          = LazyFunction(lambda: uuid.uuid4())
    client_id   = LazyFunction(lambda: uuid.uuid4())
    brand_id    = LazyFunction(lambda: uuid.uuid4())
    codigo      = factory.Sequence(lambda n: f"EPP-SEED-{n:05d}")
    nombre      = factory.Sequence(lambda n: f"EPP Seed {n}")
    valid_from  = LazyFunction(lambda: date(2026, 1, 1))
    is_active   = True


class EarlyPaymentTierPayloadFactory(factory.DictFactory):
    """POST /api/commercial/early-payment-tiers/. Required: policy_id, payment_days."""
    policy_id    = LazyFunction(fake_policy_id)
    payment_days = 30
    discount_pct = "2.500"
    tier_label   = "30 días"
    orden        = 1


class EarlyPaymentTierModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = EarlyPaymentTier

    id           = LazyFunction(lambda: uuid.uuid4())
    policy_id    = LazyFunction(lambda: uuid.uuid4())
    payment_days = 30
    discount_pct = "1.000"
    tier_label   = "Seed Tier"
    orden        = 0
    is_active    = True


# ═════════════════════════════════════════════════════════════════════
# COMMERCIAL · CommissionRule (CEO-ONLY)
# ═════════════════════════════════════════════════════════════════════
class CommissionRulePayloadFactory(factory.DictFactory):
    """POST /api/commercial/commission-rules/ — CEO-ONLY."""
    brand_id        = LazyFunction(fake_brand_id)
    client_id       = LazyFunction(fake_cliente_id)
    codigo          = factory.Sequence(lambda n: f"COMM-TEST-{n:05d}")
    nombre          = factory.Sequence(lambda n: f"Commission Rule {n}")
    descripcion     = "Comisión CEO-ONLY de prueba"
    commission_pct  = "5.000"
    commission_base = "sale_price"
    valid_from      = LazyFunction(lambda: date(2026, 1, 1).isoformat())


class CommissionRuleModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = CommissionRule

    id              = LazyFunction(lambda: uuid.uuid4())
    brand_id        = LazyFunction(lambda: uuid.uuid4())
    codigo          = factory.Sequence(lambda n: f"COMM-SEED-{n:05d}")
    nombre          = factory.Sequence(lambda n: f"Commission Seed {n}")
    commission_pct  = "3.000"
    commission_base = "sale_price"
    valid_from      = LazyFunction(lambda: date(2026, 1, 1))
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# BLOQUE 4 · ANALYTICS — DashboardSnapshot + WidgetCat
# ═════════════════════════════════════════════════════════════════════
class DashboardSnapshotPayloadFactory(factory.DictFactory):
    """POST /api/dashboard-snapshots/ — UUID server-side. Soporta
    `idempotence_token` para tests de replay."""
    user_id        = LazyFunction(fake_user_id)
    snapshot_type  = "preferences"
    label          = factory.Sequence(lambda n: f"Snapshot {n}")
    snapshot_data  = factory.LazyFunction(
        lambda: {"filters": {"brand": "ALL"}, "widgets": ["kpi.cash"]}
    )
    is_pinned      = False
    generated_by   = "user"


class DashboardSnapshotModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = DashboardSnapshot

    id             = LazyFunction(lambda: uuid.uuid4())
    user_id        = LazyFunction(lambda: uuid.uuid4())
    snapshot_type  = "preferences"
    label          = factory.Sequence(lambda n: f"Snapshot Seed {n}")
    snapshot_data  = factory.LazyFunction(
        lambda: {"widgets": ["kpi.cash", "aging"]}
    )
    is_pinned      = False
    generated_by   = "user"
    is_active      = True


class WidgetCatModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = WidgetCat
        django_get_or_create = ("codigo",)

    codigo         = factory.Sequence(lambda n: f"widget.test.{n:04d}")
    label          = factory.Sequence(lambda n: f"Widget Test {n}")
    category       = "kpi"
    min_role       = "ops"
    default_layout = factory.LazyFunction(lambda: {"w": 4, "h": 2})
    orden          = 100
    is_active      = True


# ═════════════════════════════════════════════════════════════════════
# BLOQUE 4 · PORTAL — MwtUser + SessionLog + AuditLog
# ═════════════════════════════════════════════════════════════════════
class PortalMwtUserPayloadFactory(factory.DictFactory):
    """POST /api/mwt-users/ — DRF ModelViewSet (status 201)."""
    email           = factory.Sequence(lambda n: f"portal-user-{n:05d}@mwt.test")
    full_name       = factory.Sequence(lambda n: f"Portal User {n}")
    role            = "b2b_client"
    legal_entity_id = LazyFunction(fake_legal_entity_id)
    locale          = "es"
    timezone        = "America/Lima"
    preferences     = factory.LazyFunction(lambda: {"theme": "light"})
    scope_ids       = factory.LazyFunction(lambda: [])


class PortalMwtUserModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PortalMwtUser

    id                  = LazyFunction(lambda: uuid.uuid4())
    email               = factory.Sequence(lambda n: f"portal-seed-{n:05d}@mwt.test")
    full_name           = factory.Sequence(lambda n: f"Portal Seed {n}")
    role                = "b2b_client"
    locale              = "es"
    timezone            = "America/Lima"
    preferences         = factory.LazyFunction(lambda: {})
    scope_ids           = factory.LazyFunction(lambda: [])
    failed_login_count  = 0
    is_active           = True


class PortalSessionLogModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PortalSessionLog

    id           = LazyFunction(lambda: uuid.uuid4())
    mwt_user_id  = LazyFunction(lambda: uuid.uuid4())
    email        = factory.Sequence(lambda n: f"session-{n:05d}@mwt.test")
    event_type   = "LOGIN"
    success      = True
    is_active    = True


class PortalAuditLogModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PortalAuditLog

    id             = LazyFunction(lambda: uuid.uuid4())
    mwt_user_id    = LazyFunction(lambda: uuid.uuid4())
    email          = factory.Sequence(lambda n: f"audit-{n:05d}@mwt.test")
    action         = "VIEW"
    resource_type  = "expediente"
    status_code    = 200
    payload        = factory.LazyFunction(lambda: {})
    is_active      = True


# ═════════════════════════════════════════════════════════════════════
# BLOQUE 4 · EMAIL TEMPLATES — Template + Version + RenderPreviewLog
# ═════════════════════════════════════════════════════════════════════
class EmailTemplatePayloadFactory(factory.DictFactory):
    """POST /api/email-templates/ — UUID server-side."""
    name             = factory.Sequence(lambda n: f"Template QA {n}")
    template_key     = factory.Sequence(lambda n: f"qa.template.{n:05d}")
    language         = "ES"
    brand            = "GLOBAL"
    subject_template = "Bienvenido {{nombre}} a Rana Walk"
    body_template    = "Hola {{nombre}}, tu pedido {pedido_id} está listo."
    variables_meta   = factory.LazyFunction(lambda: ["nombre", "pedido_id"])
    status           = "DRAFT"


class EmailTemplateModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = EmailTemplate

    id               = LazyFunction(lambda: uuid.uuid4())
    name             = factory.Sequence(lambda n: f"Template Seed {n}")
    template_key     = factory.Sequence(lambda n: f"seed.template.{n:05d}")
    language         = "ES"
    brand            = "GLOBAL"
    subject_template = "Subject seed"
    body_template    = "Body seed con {{variable}}"
    variables_meta   = factory.LazyFunction(lambda: ["variable"])
    status           = "DRAFT"
    is_active        = True


class EmailTemplateVersionModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = EmailTemplateVersion

    id               = LazyFunction(lambda: uuid.uuid4())
    template_id      = LazyFunction(lambda: uuid.uuid4())
    subject_template = "Subject v1"
    body_template    = "Body v1"
    change_note      = "Seed version"


class RenderPreviewLogModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = RenderPreviewLog

    id              = LazyFunction(lambda: uuid.uuid4())
    template_id     = LazyFunction(lambda: uuid.uuid4())
    template_key    = factory.Sequence(lambda n: f"preview.key.{n:05d}")
    language        = "ES"
    brand           = "GLOBAL"
    payload_sample  = factory.LazyFunction(lambda: {"nombre": "Tester"})
    rendered_subject = "Subject rendered"
    rendered_body    = "Body rendered"
    render_ok        = True
    is_active        = True


# ═════════════════════════════════════════════════════════════════════
# BLOQUE 4 · NOTIFICATIONS — NotificationLog + EmailQueueLog
# ═════════════════════════════════════════════════════════════════════
def _now_aware():
    """timezone-aware now (Django ORM en mode TZ)."""
    from django.utils import timezone
    return timezone.now()


class NotificationLogPayloadFactory(factory.DictFactory):
    """POST /api/notification-logs/ — UUID + ts server-side."""
    expediente_id   = LazyFunction(fake_expediente_id)
    template_key    = factory.Sequence(lambda n: f"qa.notif.{n:05d}")
    recipient_email = factory.Sequence(lambda n: f"recipient-{n:05d}@mwt.test")
    subject         = "Asunto de prueba"
    body_preview    = "Body preview de prueba…"
    trigger         = "manual"
    status          = "Sent"


class NotificationLogModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = NotificationLog

    id              = LazyFunction(lambda: uuid.uuid4())
    ts              = LazyFunction(_now_aware)
    expediente_id   = LazyFunction(lambda: uuid.uuid4())
    template_key    = factory.Sequence(lambda n: f"seed.notif.{n:05d}")
    recipient_email = factory.Sequence(lambda n: f"seed-rcpt-{n:05d}@mwt.test")
    subject         = "Subject seed"
    body_preview    = "Body seed"
    trigger         = "manual"
    status          = "Sent"
    retries         = 0
    attempt_count   = 1
    is_active       = True


class CollectionLogModelFactory(NotificationLogModelFactory):
    """Notification con trigger ∈ {C1,C2,C3} — visible en /api/collection-logs/."""
    trigger        = "C1"
    amount_overdue = "1500.00"
    currency       = "USD"


class EmailQueueLogPayloadFactory(factory.DictFactory):
    """POST /api/email-queue-log/ — UUID server-side."""
    celery_task_id  = factory.Sequence(lambda n: f"celery-task-{n:08d}")
    template_key    = factory.Sequence(lambda n: f"qa.queue.{n:05d}")
    recipient_email = factory.Sequence(lambda n: f"queue-{n:05d}@mwt.test")
    status          = "QUEUED"
    payload         = factory.LazyFunction(lambda: {"variables": {"x": 1}})


class EmailQueueLogModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = EmailQueueLog

    id              = LazyFunction(lambda: uuid.uuid4())
    celery_task_id  = factory.Sequence(lambda n: f"queue-seed-{n:08d}")
    template_key    = factory.Sequence(lambda n: f"seed.queue.{n:05d}")
    recipient_email = factory.Sequence(lambda n: f"queue-seed-{n:05d}@mwt.test")
    status          = "QUEUED"
    retries         = 0
    max_retries     = 5
    payload         = factory.LazyFunction(lambda: {})
    is_active       = True


# ═════════════════════════════════════════════════════════════════════
# BLOQUE 4 · PIPELINE — TransicionCat + EventLog
# ═════════════════════════════════════════════════════════════════════
class TransicionCatModelFactory(factory.django.DjangoModelFactory):
    """Seed de transiciones permitidas (motor de fases)."""
    class Meta:
        model = TransicionCat

    id           = LazyFunction(lambda: uuid.uuid4())
    fase_from    = "REGISTRO"
    fase_to      = "PRODUCCION"
    label        = "Confirmar SAP"
    is_rollback  = False
    orden        = 100
    is_active    = True


class EventLogModelFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = EventLog

    id              = LazyFunction(lambda: uuid.uuid4())
    correlation_id  = LazyFunction(lambda: uuid.uuid4())
    event_type      = "expediente.phase_transition"
    aggregate_type  = "expediente"
    aggregate_id    = LazyFunction(lambda: uuid.uuid4())
    action_source   = "C11"
    payload         = factory.LazyFunction(lambda: {})
    is_active       = True
