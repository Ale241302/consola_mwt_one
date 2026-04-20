"""
=====================================================================
MWT.ONE · apps.proveedores.models
Agente responsable: [AG-BACKEND]
Tabla creada por [AG-DATABASE] en backend/sql/50_proveedores.sql
=====================================================================
"""
from django.db import models


class Proveedor(models.Model):
    id                = models.UUIDField(primary_key=True)
    codigo            = models.CharField(max_length=32, null=True, blank=True, unique=True)
    razon_social      = models.CharField(max_length=192)
    nombre_comercial  = models.CharField(max_length=160, null=True, blank=True)
    tax_id            = models.CharField(max_length=48,  null=True, blank=True)
    tipo              = models.CharField(max_length=24,  default="FABRICANTE")
    estado            = models.CharField(max_length=16,  default="PROSPECTO")

    pais_iso2         = models.CharField(max_length=2, null=True, blank=True)
    ciudad            = models.CharField(max_length=96, null=True, blank=True)
    direccion         = models.TextField(null=True, blank=True)
    zona_horaria      = models.CharField(max_length=64, null=True, blank=True)

    contacto_nombre   = models.CharField(max_length=96,  null=True, blank=True)
    contacto_email    = models.CharField(max_length=254, null=True, blank=True)
    contacto_tel      = models.CharField(max_length=32,  null=True, blank=True)
    web               = models.CharField(max_length=160, null=True, blank=True)

    moneda_default    = models.CharField(max_length=3, default="USD")
    incoterm_default  = models.CharField(max_length=8, default="EXW")
    lead_time_dias    = models.IntegerField(default=0)
    moq               = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    condiciones_pago  = models.CharField(max_length=96, null=True, blank=True)
    dias_credito      = models.IntegerField(default=0)

    rating            = models.DecimalField(max_digits=3, decimal_places=2, default=0)
    nps               = models.IntegerField(null=True, blank=True)
    notas_internas    = models.TextField(null=True, blank=True)
    categorias        = models.JSONField(default=list, blank=True)
    certificaciones   = models.JSONField(default=list, blank=True)

    responsable_id    = models.UUIDField(null=True, blank=True)    # ⛔ sin FK
    visibility_tier   = models.CharField(max_length=16, default="INTERNAL")

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'proveedores"."proveedor'


class TipoCat(models.Model):
    codigo    = models.CharField(max_length=24, primary_key=True)
    label     = models.CharField(max_length=48)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'proveedores"."tipo_cat'
        ordering = ("orden", "label")


class EstadoCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=48)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'proveedores"."estado_cat'
        ordering = ("orden", "label")


class IncotermCat(models.Model):
    codigo      = models.CharField(max_length=8, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'proveedores"."incoterm_cat'
        ordering = ("orden", "label")
