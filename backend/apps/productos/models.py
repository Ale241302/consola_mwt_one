"""
=====================================================================
MWT.ONE · apps.productos.models
Agente responsable: [AG-BACKEND]
Tabla creada por [AG-DATABASE] en backend/sql/40_productos.sql
Reglas:
  - managed = False (DB la maneja [AG-DATABASE])
  - sin ForeignKey: vínculos por UUID plano
=====================================================================
"""
from django.db import models


class Producto(models.Model):
    id                     = models.UUIDField(primary_key=True)
    sku                    = models.CharField(max_length=64, unique=True, null=True, blank=True)
    nombre                 = models.CharField(max_length=160, null=True, blank=True)
    descripcion            = models.TextField(null=True, blank=True)

    marca_id               = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    categoria              = models.CharField(max_length=32, default="OTROS")
    subcategoria           = models.CharField(max_length=48, null=True, blank=True)
    unidad                 = models.CharField(max_length=8,  default="PZA")

    moneda                 = models.CharField(max_length=3, default="USD")
    costo_estandar         = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    precio_lista           = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    precio_distribuidor    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Extensiones 93_schema_extensions.sql (JSON canónico #10):
    #   precio_mwt       → precio interno MWT (distinto al distribuidor).
    #   especificaciones → ficha técnica larga (tipo_puntera, normativa, …).
    precio_mwt             = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    especificaciones       = models.JSONField(default=dict, blank=True)

    peso_kg                = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    volumen_m3             = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)

    imagen_url             = models.TextField(null=True, blank=True)
    ficha_url              = models.TextField(null=True, blank=True)
    tallas                 = models.JSONField(default=list, blank=True)
    colores                = models.JSONField(default=list, blank=True)

    estado                 = models.CharField(max_length=16, default="ACTIVO")
    proveedor_principal_id = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    pais_origen_iso2       = models.CharField(max_length=2, null=True, blank=True)
    hs_code                = models.CharField(max_length=16, null=True, blank=True)
    stock_minimo           = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    stock_maximo           = models.DecimalField(max_digits=14, decimal_places=3, default=0)

    visibility_tier        = models.CharField(max_length=16, default="INTERNAL")
    is_active              = models.BooleanField(default=True)
    created_at             = models.DateTimeField(auto_now_add=True)
    updated_at             = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'productos"."producto'


class CategoriaCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=96)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'productos"."categoria_cat'
        ordering = ("orden", "label")


class SubcategoriaCat(models.Model):
    codigo         = models.CharField(max_length=48, primary_key=True)
    categoria_code = models.CharField(max_length=32)
    label          = models.CharField(max_length=96)
    orden          = models.IntegerField(default=100)
    is_active      = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'productos"."subcategoria_cat'
        ordering = ("orden", "label")


class UnidadCat(models.Model):
    codigo    = models.CharField(max_length=8, primary_key=True)
    label     = models.CharField(max_length=32)
    factor    = models.DecimalField(max_digits=10, decimal_places=4, default=1)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'productos"."unidad_cat'
        ordering = ("orden", "label")


class EstadoCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=48)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'productos"."estado_cat'
        ordering = ("orden", "label")
