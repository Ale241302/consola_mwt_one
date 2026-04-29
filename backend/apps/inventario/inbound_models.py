"""
=====================================================================
MWT.ONE · apps.inventario.inbound_models
Agente responsable: [AG-BACKEND]

Modelos del Motor de Recepción (Inbound) — sprint 2026-04-29.
Tablas creadas por backend/sql/62_inventario_inbound.sql.

POL_VISIBILIDAD: unit_cost_usd / total_value_usd / line_value_usd son
CEO-ONLY. La defensa primaria es en el serializer (apps.inventario.
inbound_serializers); los modelos exponen los campos sin filtrar.
=====================================================================
"""
from django.db import models


class SourceTypeCat(models.Model):
    codigo      = models.CharField(max_length=32, primary_key=True)
    label       = models.CharField(max_length=96)
    descripcion = models.TextField(null=True, blank=True)
    color       = models.CharField(max_length=16, null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."source_type_cat'
        ordering = ("orden", "label")


class RecepcionEstadoCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."recepcion_estado_cat'
        ordering = ("orden", "label")


class Recepcion(models.Model):
    id                       = models.UUIDField(primary_key=True)
    codigo                   = models.CharField(max_length=32, unique=True)
    destination_node_id      = models.UUIDField()
    destination_node_label   = models.CharField(max_length=128, null=True, blank=True)

    source_type              = models.CharField(max_length=32, default="BLIND_RECEIPT")
    reference_id             = models.UUIDField(null=True, blank=True)
    reference_label          = models.CharField(max_length=160, null=True, blank=True)

    estado                   = models.CharField(max_length=32, default="DRAFT")
    document_artifact_id     = models.UUIDField(null=True, blank=True)

    ocr_processed_at         = models.DateTimeField(null=True, blank=True)
    ocr_payload_json         = models.JSONField(null=True, blank=True)
    ocr_confidence_avg       = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    received_by_id           = models.UUIDField(null=True, blank=True)
    received_by_name         = models.CharField(max_length=128, null=True, blank=True)
    received_at              = models.DateTimeField(null=True, blank=True)

    has_discrepancy          = models.BooleanField(default=False)
    discrepancy_count        = models.IntegerField(default=0)
    exception_document_id    = models.UUIDField(null=True, blank=True)

    total_units              = models.IntegerField(default=0)
    total_value_usd          = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    notes                    = models.TextField(null=True, blank=True)

    is_active                = models.BooleanField(default=True)
    created_by_id            = models.UUIDField(null=True, blank=True)
    created_by_name          = models.CharField(max_length=128, null=True, blank=True)
    created_at               = models.DateTimeField(auto_now_add=True)
    updated_at               = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."recepcion'
        ordering = ("-created_at",)


class RecepcionLinea(models.Model):
    id                  = models.UUIDField(primary_key=True)
    recepcion_id        = models.UUIDField()

    producto_id         = models.UUIDField(null=True, blank=True)
    product_sku         = models.CharField(max_length=64)
    product_label       = models.CharField(max_length=255, null=True, blank=True)
    talla               = models.CharField(max_length=16, null=True, blank=True)

    lote_code           = models.CharField(max_length=64, default="")
    expiration_date     = models.DateField(null=True, blank=True)

    expected_qty        = models.IntegerField(default=0)
    received_qty        = models.IntegerField(null=True, blank=True)
    delta_qty           = models.IntegerField(null=True, blank=True)   # GENERATED

    unit_cost_usd       = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    line_value_usd      = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)  # GENERATED

    gap_justification   = models.TextField(null=True, blank=True)

    source              = models.CharField(max_length=16, default="MANUAL")
    ocr_confidence      = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    notes               = models.TextField(null=True, blank=True)
    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."recepcion_linea'
        ordering = ("created_at",)


class RecepcionExcepcion(models.Model):
    id                  = models.UUIDField(primary_key=True)
    recepcion_id        = models.UUIDField()
    linea_id            = models.UUIDField(null=True, blank=True)
    tipo                = models.CharField(max_length=32, default="GAP")

    expected_qty        = models.IntegerField(null=True, blank=True)
    received_qty        = models.IntegerField(null=True, blank=True)
    delta_qty           = models.IntegerField(null=True, blank=True)

    justification       = models.TextField(null=True, blank=True)
    auto_generated      = models.BooleanField(default=True)
    requires_action     = models.BooleanField(default=True)

    resolved_at         = models.DateTimeField(null=True, blank=True)
    resolved_by_id      = models.UUIDField(null=True, blank=True)
    resolved_by_name    = models.CharField(max_length=128, null=True, blank=True)
    resolution_note     = models.TextField(null=True, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'inventario"."recepcion_excepcion'
        ordering = ("-created_at",)
