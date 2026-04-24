"""apps.clientes.models — tabla `clientes.cliente` (SQL puro, Meta.managed=False)."""
from django.db import models


class Cliente(models.Model):
    id               = models.UUIDField(primary_key=True)
    razon_social     = models.CharField(max_length=200)
    nombre_comercial = models.CharField(max_length=160, null=True, blank=True)
    tax_id           = models.CharField(max_length=32)
    tipo             = models.CharField(max_length=16)
    segmento         = models.CharField(max_length=1, default="C")
    pais_iso2        = models.CharField(max_length=2)
    ciudad           = models.CharField(max_length=96, null=True, blank=True)
    direccion        = models.TextField(null=True, blank=True)
    moneda           = models.CharField(max_length=3, default="USD")
    credito_aprobado = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credito_usado    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    dias_credito     = models.SmallIntegerField(default=0)
    contacto_nombre  = models.CharField(max_length=160, null=True, blank=True)
    contacto_email   = models.CharField(max_length=160, null=True, blank=True)
    contacto_tel     = models.CharField(max_length=32,  null=True, blank=True)
    estado           = models.CharField(max_length=16, default="ACTIVO")
    nodo_asignado_id = models.UUIDField(null=True, blank=True)          # sin FK
    responsable_id   = models.UUIDField(null=True, blank=True)          # sin FK
    visibility_tier  = models.CharField(max_length=16, default="INTERNAL")

    # Extensiones 93_schema_extensions.sql §4 (comerciales):
    codigo_marluvas   = models.CharField(max_length=32, null=True, blank=True)
    canal             = models.CharField(max_length=32, null=True, blank=True)
    incoterm          = models.CharField(max_length=8,  null=True, blank=True)
    medio_pago        = models.CharField(max_length=48, null=True, blank=True)
    direccion_entrega = models.TextField(null=True, blank=True)

    # Extensiones 32_clientes_extensions.sql (sprint Cliente M3b):
    cedula_juridica   = models.CharField(max_length=32, null=True, blank=True)
    comision_pct      = models.DecimalField(
        max_digits=6, decimal_places=4, null=True, blank=True,
    )   # CEO-ONLY — ver POL_VISIBILIDAD en serializers.

    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'clientes\".\"cliente'


class TipoCat(models.Model):
    codigo = models.CharField(max_length=16, primary_key=True)
    label  = models.CharField(max_length=64)
    orden  = models.SmallIntegerField(default=0)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"tipo_cat'
        ordering = ('orden',)


class EstadoCat(models.Model):
    codigo = models.CharField(max_length=16, primary_key=True)
    label  = models.CharField(max_length=64)
    color  = models.CharField(max_length=16, null=True, blank=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"estado_cat'


class SegmentoCat(models.Model):
    codigo = models.CharField(max_length=1, primary_key=True)
    label  = models.CharField(max_length=64)
    color  = models.CharField(max_length=16, null=True, blank=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"segmento_cat'


class CanalCat(models.Model):
    """Catálogo de canales — creado por 31_clientes_audit.sql."""
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=96)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"canal_cat'
        ordering = ('orden',)


class MedioPagoCat(models.Model):
    """Catálogo de medios de pago — creado por 31_clientes_audit.sql."""
    codigo    = models.CharField(max_length=48, primary_key=True)
    label     = models.CharField(max_length=96)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"medio_pago_cat'
        ordering = ('orden',)


class IncotermCat(models.Model):
    """Catálogo de incoterms — creado por 31_clientes_audit.sql."""
    codigo      = models.CharField(max_length=8, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"incoterm_cat'
        ordering = ('orden',)


class ClienteCreditSnapshot(models.Model):
    """Histórico auditable del semáforo de crédito — 31_clientes_audit.sql."""
    id                 = models.UUIDField(primary_key=True)
    cliente_id         = models.UUIDField()                        # ⛔ sin FK
    snapshot_date      = models.DateField()

    credito_aprobado   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credito_usado      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credito_disponible = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tasa_utilizacion   = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    dias_mora_max      = models.IntegerField(default=0)
    facturas_vencidas  = models.IntegerField(default=0)
    monto_vencido_usd  = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    estado_semaforo    = models.CharField(max_length=16, default='VERDE')
    motivo             = models.TextField(null=True, blank=True)
    calculo_json       = models.JSONField(default=dict, blank=True)

    triggered_by       = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    source             = models.CharField(max_length=32, default='MANUAL')

    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'clientes\".\"cliente_credit_snapshot'
        ordering = ('-snapshot_date', '-created_at')
