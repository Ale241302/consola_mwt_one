"""apps.brands.models — tabla `brands.marca` (SQL puro, Meta.managed=False)."""
from django.db import models


class Marca(models.Model):
    id                  = models.UUIDField(primary_key=True)
    nombre              = models.CharField(max_length=128)
    slug                = models.CharField(max_length=64, unique=True)
    pais_origen_iso2    = models.CharField(max_length=2)
    categoria_principal = models.CharField(max_length=32)
    descripcion         = models.TextField(null=True, blank=True)
    logo_url            = models.CharField(max_length=500, null=True, blank=True)
    website             = models.CharField(max_length=200, null=True, blank=True)
    estado_comercial    = models.CharField(max_length=16, default="PROSPECTO")
    fecha_firma         = models.DateField(null=True, blank=True)
    responsable_id      = models.UUIDField(null=True, blank=True)      # sin FK
    territorios         = models.JSONField(default=list)
    markup_default      = models.DecimalField(max_digits=5, decimal_places=2, default=2.5)
    dias_pago_default   = models.SmallIntegerField(default=30)
    moneda_default      = models.CharField(max_length=3, default="USD")
    visibility_tier     = models.CharField(max_length=16, default="INTERNAL")
    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'brands\".\"marca'


class CategoriaCat(models.Model):
    codigo = models.CharField(max_length=32, primary_key=True)
    label  = models.CharField(max_length=64)
    orden  = models.SmallIntegerField(default=0)

    class Meta:
        managed  = False
        db_table = 'brands\".\"categoria_cat'
        ordering = ('orden',)


class EstadoCat(models.Model):
    codigo = models.CharField(max_length=16, primary_key=True)
    label  = models.CharField(max_length=64)
    color  = models.CharField(max_length=16, null=True, blank=True)
    orden  = models.SmallIntegerField(default=0)

    class Meta:
        managed  = False
        db_table = 'brands\".\"estado_cat'
        ordering = ('orden',)
