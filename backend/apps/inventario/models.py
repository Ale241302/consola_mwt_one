"""
=====================================================================
MWT.ONE · apps.inventario.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/60_inventario.sql
+ extensiones BLOQUE 3 en backend/sql/61_inventario_audit.sql

Stock por (nodo, producto, lote) + ledger de movimientos. Sin FK.
BLOQUE 3 añade:
  · Mínimos / máximos / coberturas / costo corriente.
  · Contexto legal en movimiento + idempotence_token.
  · Snapshot histórico diario (StockSnapshot).
  · Multi-bin (StockUbicacion).
  · Import log 2-step (InventoryImportLog).
=====================================================================
"""
from django.db import models


class Stock(models.Model):
    id                    = models.UUIDField(primary_key=True)

    nodo_id               = models.UUIDField()                        # ⛔ sin FK
    producto_id           = models.UUIDField()                        # ⛔ sin FK
    lote                  = models.CharField(max_length=64, default="")
    # Sprint Inbound v2 (2026-04-30): granularidad por talla (size).
    # Columna creada por SQL 63_inventario_stock_by_size.sql + UNIQUE
    # uq_stock_nodo_producto_lote_size con COALESCE(size, '').
    size                  = models.CharField(max_length=16, null=True, blank=True)
    fecha_vencimiento     = models.DateField(null=True, blank=True)

    cantidad_disponible   = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    cantidad_reservada    = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    cantidad_en_transito  = models.DecimalField(max_digits=14, decimal_places=3, default=0)

    costo_unitario_usd    = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    ubicacion_fisica      = models.CharField(max_length=64, null=True, blank=True)
    last_movement_at      = models.DateTimeField(null=True, blank=True)

    # ── Extensiones BLOQUE 3 ───────────────────────────────
    cantidad_minima       = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    cantidad_maxima       = models.DecimalField(max_digits=14, decimal_places=3, null=True, blank=True)
    dias_stock_minimo     = models.SmallIntegerField(default=14)
    costo_actual_usd      = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    dias_para_vencimiento = models.SmallIntegerField(null=True, blank=True)
    rotacion_dias         = models.SmallIntegerField(null=True, blank=True)

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

    # ── Extensiones BLOQUE 3 ───────────────────────────────
    contexto_legal      = models.CharField(max_length=32, null=True, blank=True)
    idempotence_token   = models.CharField(max_length=64, null=True, blank=True)
    updated_at          = models.DateTimeField(auto_now=True)

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


# =====================================================================
# BLOQUE 3 · Catálogo de contexto legal del movimiento.
# =====================================================================
class ContextoMovimientoCat(models.Model):
    codigo         = models.CharField(max_length=32, primary_key=True)
    label          = models.CharField(max_length=96)
    descripcion    = models.TextField(null=True, blank=True)
    needs_approval = models.BooleanField(default=False)
    color          = models.CharField(max_length=16, null=True, blank=True)
    orden          = models.IntegerField(default=100)
    is_active      = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'inventario"."contexto_movimiento_cat'
        ordering = ("orden", "label")


# =====================================================================
# BLOQUE 3 · Snapshot histórico diario valuado (fuente de reportes).
# =====================================================================
class StockSnapshot(models.Model):
    id                   = models.UUIDField(primary_key=True)
    snapshot_date        = models.DateField()
    nodo_id              = models.UUIDField()                           # ⛔ sin FK
    producto_id          = models.UUIDField()                           # ⛔ sin FK
    lote                 = models.CharField(max_length=64, default="")

    cantidad_disponible   = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    cantidad_reservada    = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    cantidad_en_transito  = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    costo_unitario_usd    = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    valor_total_usd       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    dias_para_vencimiento = models.SmallIntegerField(null=True, blank=True)
    source                = models.CharField(max_length=32, default="EOD_JOB")

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."stock_snapshot'
        ordering = ("-snapshot_date", "nodo_id", "producto_id")


# =====================================================================
# BLOQUE 3 · Ubicaciones físicas multi-bin por stock.
# =====================================================================
class StockUbicacion(models.Model):
    id         = models.UUIDField(primary_key=True)
    stock_id   = models.UUIDField()                                     # ⛔ sin FK
    zona       = models.CharField(max_length=32, null=True, blank=True)
    pasillo    = models.CharField(max_length=16, null=True, blank=True)
    estante    = models.CharField(max_length=16, null=True, blank=True)
    bin        = models.CharField(max_length=16, null=True, blank=True)
    cantidad   = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    is_default = models.BooleanField(default=False)

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."stock_ubicacion'
        ordering = ("-is_default", "zona", "pasillo", "estante", "bin")


# =====================================================================
# BLOQUE 3 · Import log de stock (2-step preview → commit).
# =====================================================================
class InventoryImportLog(models.Model):
    id             = models.UUIDField(primary_key=True)
    nodo_id        = models.UUIDField(null=True, blank=True)            # nodo destino
    filename       = models.CharField(max_length=255, null=True, blank=True)
    total_rows     = models.IntegerField(default=0)
    valid_rows     = models.IntegerField(default=0)
    invalid_rows   = models.IntegerField(default=0)

    mapping_json   = models.JSONField(default=dict, blank=True)
    preview_json   = models.JSONField(default=list, blank=True)
    errors_json    = models.JSONField(default=list, blank=True)

    status         = models.CharField(max_length=16, default="VALIDATING")
    committed_rows = models.IntegerField(default=0)
    idempotence_token = models.CharField(max_length=64, null=True, blank=True)

    started_by   = models.UUIDField(null=True, blank=True)
    committed_at = models.DateTimeField(null=True, blank=True)
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."inventory_import_log'
        ordering = ("-created_at",)


# ─────────────────────────────────────────────────────────────────
# Sprint 2026-05-11 · Fase 3 del paquete Nodos + Recepción.
# Tabla `inventario.expediente_nodo_assignment` creada por SQL
# 65b_expediente_nodo_assignment.sql.
#
# Modelo append-only: cada confirmación del wizard de recepción inserta
# una o más filas. Los saldos se calculan por SUM(qty_asignada).
# ─────────────────────────────────────────────────────────────────
class ExpedienteNodoAssignment(models.Model):
    id             = models.UUIDField(primary_key=True)
    expediente_id  = models.UUIDField()                                 # ⛔ sin FK
    producto_id    = models.UUIDField()                                 # ⛔ sin FK
    talla          = models.CharField(max_length=16, null=True, blank=True)
    nodo_id        = models.UUIDField()                                 # ⛔ sin FK
    qty_asignada   = models.IntegerField()                              # CHECK > 0 en BD
    recepcion_id   = models.UUIDField(null=True, blank=True)            # ⛔ sin FK
    notas          = models.TextField(null=True, blank=True)
    created_by_id  = models.UUIDField(null=True, blank=True)            # ⛔ sin FK
    is_active      = models.BooleanField(default=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."expediente_nodo_assignment'
        ordering = ("-created_at",)
