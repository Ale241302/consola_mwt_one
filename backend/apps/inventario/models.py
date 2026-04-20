"""
=====================================================================
MWT.ONE · apps.inventario.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/60_inventario.sql

Stock por (nodo, producto, lote) + ledger de movimientos. Sin FK.
=====================================================================
"""
from django.db import models


class Stock(models.Model):
    id                    = models.UUIDField(primary_key=True)

    nodo_id               = models.UUIDField()                        # ⛔ sin FK
    producto_id           = models.UUIDField()                        # ⛔ sin FK
    lote                  = models.CharField(max_length=64, default="")
    fecha_vencimiento     = models.DateField(null=True, blank=True)

    cantidad_disponible   = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    cantidad_reservada    = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    cantidad_en_transito  = models.DecimalField(max_digits=14, decimal_places=3, default=0)

    costo_unitario_usd    = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    ubicacion_fisica      = models.CharField(max_length=64, null=True, blank=True)
    last_movement_at      = models.DateTimeField(null=True, blank=True)

    is_active             = models.BooleanField(default=True)
    created_at            = models.DateTimeField(auto_now_add=True)
    updated_at            = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'inventario"."stock'
        unique_together = (("nodo_id", "producto_id", "lote"),)


class Movimiento(models.Model):
    id                  = models.UUIDField(primary_key=True)

    tipo                = models.CharField(max_length=16)
    motivo              = models.CharField(max_length=32, null=True, blank=True)

    producto_id         = models.UUIDField()                          # ⛔ sin FK
    nodo_origen_id      = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    nodo_destino_id     = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    lote                = models.CharField(max_length=64, default="")

    cantidad            = models.DecimalField(max_digits=14, decimal_places=3)
    costo_unitario_usd  = models.DecimalField(max_digits=14, decimal_places=4, default=0)

    referencia_tipo     = models.CharField(max_length=24, null=True, blank=True)
    referencia_id       = models.UUIDField(null=True, blank=True)
    notas               = models.TextField(null=True, blank=True)

    user_id             = models.UUIDField(null=True, blank=True)     # ⛔ sin FK

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'inventario"."movimiento'
        ordering = ("-created_at",)


class TipoMovimientoCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=48)
    direccion = models.CharField(max_length=1)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'inventario"."tipo_movimiento_cat'
        ordering = ("orden", "label")


class MotivoCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=96)
    tipo_mov  = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'inventario"."motivo_cat'
        ordering = ("orden", "label")
