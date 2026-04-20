"""
=====================================================================
MWT.ONE · apps.cobros.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/80_cobros.sql
=====================================================================
"""
from django.db import models


# ── Catálogos ────────────────────────────────────────────────
class MetodoCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    direccion = models.CharField(max_length=1, default="=")
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'cobros"."metodo_cat'
        ordering = ("orden", "label")


class EstadoPagoCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'cobros"."estado_pago_cat'
        ordering = ("orden", "label")


class DireccionCat(models.Model):
    codigo    = models.CharField(max_length=16, primary_key=True)
    label     = models.CharField(max_length=64)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed = False
        db_table = 'cobros"."direccion_cat'
        ordering = ("label",)


# ── Cobro ────────────────────────────────────────────────────
class Cobro(models.Model):
    id                = models.UUIDField(primary_key=True)
    codigo            = models.CharField(max_length=32, unique=True)
    oc_id             = models.UUIDField(null=True, blank=True)
    expediente_id     = models.UUIDField(null=True, blank=True)
    client_id         = models.UUIDField(null=True, blank=True)
    moneda            = models.CharField(max_length=3, default="USD")
    monto_total       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    monto_pagado      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    monto_pendiente   = models.DecimalField(max_digits=14, decimal_places=2, default=0)  # generada
    fecha_vencimiento = models.DateField(null=True, blank=True)
    dias_credito      = models.IntegerField(default=0)
    estado            = models.CharField(max_length=32, default="PENDIENTE")
    notas             = models.TextField(null=True, blank=True)
    visibility_tier   = models.CharField(max_length=16, default="INTERNAL")
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'cobros"."cobro'


# ── Pago ─────────────────────────────────────────────────────
class Pago(models.Model):
    id                 = models.UUIDField(primary_key=True)
    codigo             = models.CharField(max_length=32, unique=True)
    direccion          = models.CharField(max_length=16, default="INGRESO")
    cobro_id           = models.UUIDField(null=True, blank=True)
    oc_id              = models.UUIDField(null=True, blank=True)
    expediente_id      = models.UUIDField(null=True, blank=True)
    client_id          = models.UUIDField(null=True, blank=True)
    proveedor_id       = models.UUIDField(null=True, blank=True)
    metodo             = models.CharField(max_length=32, default="TRANSFERENCIA")
    referencia_externa = models.CharField(max_length=128, null=True, blank=True)
    banco_origen       = models.CharField(max_length=96, null=True, blank=True)
    banco_destino      = models.CharField(max_length=96, null=True, blank=True)
    moneda             = models.CharField(max_length=3, default="USD")
    monto              = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    fx_rate            = models.DecimalField(max_digits=12, decimal_places=6, default=1)
    monto_usd          = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    estado             = models.CharField(max_length=32, default="PENDIENTE")
    fecha_operacion    = models.DateField(null=True, blank=True)
    fecha_acreditacion = models.DateField(null=True, blank=True)
    verificado_at      = models.DateTimeField(null=True, blank=True)
    verificado_by      = models.UUIDField(null=True, blank=True)
    liberado_at        = models.DateTimeField(null=True, blank=True)
    conciliado_at      = models.DateTimeField(null=True, blank=True)
    comprobante_url    = models.TextField(null=True, blank=True)
    notas              = models.TextField(null=True, blank=True)
    visibility_tier    = models.CharField(max_length=16, default="INTERNAL")
    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'cobros"."pago'


# ── Conciliación ─────────────────────────────────────────────
class Conciliacion(models.Model):
    id              = models.UUIDField(primary_key=True)
    pago_ingreso_id = models.UUIDField()
    pago_egreso_id  = models.UUIDField(null=True, blank=True)
    cobro_id        = models.UUIDField(null=True, blank=True)
    monto_matched   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    moneda          = models.CharField(max_length=3, default="USD")
    notas           = models.TextField(null=True, blank=True)
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'cobros"."conciliacion'
