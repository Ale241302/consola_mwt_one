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
