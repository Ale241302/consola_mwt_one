"""
=====================================================================
MWT.ONE · apps.transfers.models
Agente responsable: [AG-BACKEND]
Tablas creadas por [AG-DATABASE] en backend/sql/90_transfers.sql
+ extensiones BLOQUE 3 en backend/sql/91_transfers_audit.sql

BLOQUE 3 añade:
  · Estados CLOSED / DISCREPANCY en el catálogo.
  · TransicionCat: state machine explícita (estado_from → estado_to).
  · Extensiones en Linea: tolerancia_pct, estado_discrepancia,
    snapshot_unit_cost, snapshot_created_at.
  · Extensiones en Transferencia: reconciled_by_*, reconciled_at,
    reconciled_note, snapshot_created_at, discrepancy_count,
    has_discrepancy (generated).
  · TransferenciaDocumento (remisiones, BLs, DUAs, actas).
  · Evento.idempotence_token para prevenir transiciones duplicadas.
=====================================================================
"""
from django.db import models


# ── Catálogos ────────────────────────────────────────────────
class EstadoTransferCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=64)
    color     = models.CharField(max_length=16, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'transfers"."estado_transfer_cat'
        ordering = ("orden", "label")


class LegalContextCat(models.Model):
    codigo      = models.CharField(max_length=32, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'transfers"."legal_context_cat'
        ordering = ("label",)


class TransicionCat(models.Model):
    """State machine explícita para transfers (quién puede ir de dónde a dónde)."""
    id             = models.UUIDField(primary_key=True)
    estado_from    = models.CharField(max_length=32)
    estado_to      = models.CharField(max_length=32)
    needs_approval = models.BooleanField(default=False)
    legal_context  = models.CharField(max_length=32, null=True, blank=True)
    descripcion    = models.TextField(null=True, blank=True)
    orden          = models.IntegerField(default=100)
    is_active      = models.BooleanField(default=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    class Meta:
        managed  = False
        db_table = 'transfers"."transicion_cat'
        ordering = ("orden",)


# ── Transferencia ────────────────────────────────────────────
class Transferencia(models.Model):
    id               = models.UUIDField(primary_key=True)
    codigo           = models.CharField(max_length=32, unique=True)
    origen_id        = models.UUIDField(null=True, blank=True)
    destino_id       = models.UUIDField(null=True, blank=True)
    origen_label     = models.CharField(max_length=128, null=True, blank=True)
    destino_label    = models.CharField(max_length=128, null=True, blank=True)
    legal_context    = models.CharField(max_length=32, default="INTERNAL")
    estado           = models.CharField(max_length=32, default="PLANNED")
    ref_tracking     = models.CharField(max_length=64, null=True, blank=True)
    needs_approval   = models.BooleanField(default=False)
    value_usd        = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    notes            = models.TextField(null=True, blank=True)
    created_by_id    = models.UUIDField(null=True, blank=True)
    created_by_name  = models.CharField(max_length=128, null=True, blank=True)
    approved_by_id   = models.UUIDField(null=True, blank=True)
    approved_by_name = models.CharField(max_length=128, null=True, blank=True)
    received_by_id   = models.UUIDField(null=True, blank=True)
    received_by_name = models.CharField(max_length=128, null=True, blank=True)
    dispatched_at    = models.DateField(null=True, blank=True)
    eta              = models.DateField(null=True, blank=True)
    received_at      = models.DateField(null=True, blank=True)

    # ── Extensiones BLOQUE 3 ──────────────────────────────
    reconciled_by_id    = models.UUIDField(null=True, blank=True)
    reconciled_by_name  = models.CharField(max_length=128, null=True, blank=True)
    reconciled_at       = models.DateTimeField(null=True, blank=True)
    reconciled_note     = models.TextField(null=True, blank=True)
    snapshot_created_at = models.DateTimeField(null=True, blank=True)
    discrepancy_count   = models.IntegerField(default=0)
    has_discrepancy     = models.BooleanField(default=False)  # columna GENERATED en DB

    # Sprint Transfer Engine v2 — metadata condicional por legal_context
    # (91f_transfers_context_data.sql). El shape varía por motivo; ver
    # _validate_context_data() en el serializer.
    context_data        = models.JSONField(default=dict, blank=True)

    # Sprint Transfer Engine v3 — Landed Cost (91g_transfers_landed_cost.sql)
    liquidated_at       = models.DateTimeField(null=True, blank=True)
    liquidated_by_id    = models.UUIDField(null=True, blank=True)         # ⛔ sin FK
    liquidated_by_name  = models.CharField(max_length=128, null=True, blank=True)
    dua_document_id     = models.UUIDField(null=True, blank=True)         # ⛔ sin FK
    awb_document_id     = models.UUIDField(null=True, blank=True)         # ⛔ sin FK
    liquidation_method  = models.CharField(max_length=16, default="BY_VALUE")

    # Sprint v4 (91h) — Lifecycle + Gap contable
    approved_at             = models.DateTimeField(null=True, blank=True)
    dispatch_document_id    = models.UUIDField(null=True, blank=True)
    receipt_document_id     = models.UUIDField(null=True, blank=True)
    exception_document_id   = models.UUIDField(null=True, blank=True)
    gap_justification       = models.TextField(null=True, blank=True)

    # Sprint v3.5 (91i) — Documentos legales por motivo.
    # IDs apuntan a expedientes.artifact_instances u otra tabla de
    # storage; sin FK física por R6. Definidos como CharField(36) para
    # alinear con la migración SQL (VARCHAR(36)).
    supplier_invoice_document_id = models.CharField(max_length=36, null=True, blank=True)  # NATIONALIZATION
    export_invoice_document_id   = models.CharField(max_length=36, null=True, blank=True)  # EXPORT / DISTRIBUTION
    freight_quote_document_id    = models.CharField(max_length=36, null=True, blank=True)  # EXPORT
    remission_guide_document_id  = models.CharField(max_length=36, null=True, blank=True)  # CONSIGNMENT

    # Sprint v3.5 (91l) — ledger de notas operativas. Cada elemento:
    # {id, text, created_at, created_by_name}. Reemplaza el campo plano
    # `notes` que solo permitía 1 nota. Append-only desde el FE; el
    # delete actualiza el array filtrando el id.
    notes_log        = models.JSONField(default=list, blank=True)

    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."transferencia'


# ── Línea ────────────────────────────────────────────────────
class Linea(models.Model):
    id               = models.UUIDField(primary_key=True)
    transferencia_id = models.UUIDField()
    producto_id      = models.UUIDField(null=True, blank=True)
    sku              = models.CharField(max_length=64, null=True, blank=True)
    product_label    = models.CharField(max_length=255, null=True, blank=True)
    size             = models.CharField(max_length=16, null=True, blank=True)
    qty_transfer     = models.IntegerField(default=0)
    qty_reserve      = models.IntegerField(default=0)
    qty_received     = models.IntegerField(null=True, blank=True)
    unit_cost        = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    unit_value       = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    # ── Extensiones BLOQUE 3 ──────────────────────────────
    tolerancia_pct       = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    estado_discrepancia  = models.CharField(max_length=32, null=True, blank=True)
    snapshot_unit_cost   = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    snapshot_created_at  = models.DateTimeField(null=True, blank=True)

    # ── Sprint Transfer Engine v3 — Landed Cost (91g) ──
    # `cost_share_usd` = porción TOTAL del prorrateo (no per-unit).
    # `landed_cost_usd` = unit_value + (cost_share_usd / qty_transfer).
    cost_share_usd       = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    landed_cost_usd      = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)

    # Sprint v4 (91h) — Cantidad realmente despachada
    qty_dispatched       = models.IntegerField(null=True, blank=True)

    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."linea'


# ── Evento (audit trail) ─────────────────────────────────────
class Evento(models.Model):
    """
    Append-only audit trail. ⚠️ NO añadir is_active aquí.

    La tabla transfers.evento NO tiene columna is_active por decisión de
    diseño explícita (ver backend/sql/91_transfers_audit.sql §6 línea 157:
    "transfers.evento es append-only — sin columna is_active").

    Si se declara un BooleanField is_active en este modelo, Django lo
    incluirá en cada INSERT (managed=False NO protege contra eso) y romperá
    con: ProgrammingError: column "is_active" of relation "evento" does
    not exist → HTTP 500 al crear/modificar transferencias.
    """
    id                = models.UUIDField(primary_key=True)
    transferencia_id  = models.UUIDField()
    estado_prev       = models.CharField(max_length=32, null=True, blank=True)
    estado_nuevo      = models.CharField(max_length=32)
    actor_id          = models.UUIDField(null=True, blank=True)
    actor_name        = models.CharField(max_length=128, null=True, blank=True)
    notes             = models.TextField(null=True, blank=True)
    idempotence_token = models.CharField(max_length=64, null=True, blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."evento'
        ordering = ("-created_at",)


# ── Documento de transporte (BLOQUE 3) ───────────────────────
class TransferenciaDocumento(models.Model):
    id                = models.UUIDField(primary_key=True)
    transferencia_id  = models.UUIDField()                              # ⛔ sin FK
    tipo              = models.CharField(max_length=32)
    # REMISION / BL / DUA / FACTURA / ACTA_RECEPCION / FOTO / OTRO
    titulo            = models.CharField(max_length=255, null=True, blank=True)
    url               = models.TextField(null=True, blank=True)
    bucket            = models.CharField(max_length=64, null=True, blank=True)
    object_key        = models.CharField(max_length=512, null=True, blank=True)
    content_type      = models.CharField(max_length=64, null=True, blank=True)
    size_bytes        = models.BigIntegerField(null=True, blank=True)

    numero_ref        = models.CharField(max_length=64, null=True, blank=True)
    fecha_emision     = models.DateField(null=True, blank=True)
    descripcion       = models.TextField(null=True, blank=True)

    uploaded_by       = models.UUIDField(null=True, blank=True)         # ⛔ sin FK
    uploaded_by_name  = models.CharField(max_length=128, null=True, blank=True)

    # Sprint Transfer Engine v2 (91e_transfers_cost_lines.sql)
    ocr_processed_at  = models.DateTimeField(null=True, blank=True)
    ocr_payload_json  = models.JSONField(null=True, blank=True)

    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."transferencia_documento'
        ordering = ("-created_at",)


# ── Catálogo de tipo de costo (sprint Transfer Engine v2) ────
class CostKindCat(models.Model):
    codigo      = models.CharField(max_length=32, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    is_fiscal   = models.BooleanField(default=False)
    color       = models.CharField(max_length=16, null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."cost_kind_cat'
        ordering = ("orden", "label")


# ── Línea de costo (DUA / aduana / flete / seguro) ───────────
class CostLine(models.Model):
    """Costo incremental asociado a una transferencia.

    Source:
      · MANUAL  → tipeado por el usuario.
      · OCR_DUA → extraído por gpt-5-nano del DUA.
      · SYSTEM  → calculado automáticamente.

    `amount_usd` es columna GENERATED en BD: amount * fx_to_usd.
    """
    id                 = models.UUIDField(primary_key=True)
    transferencia_id   = models.UUIDField()                  # ⛔ sin FK
    kind               = models.CharField(max_length=32)     # → cost_kind_cat
    label              = models.CharField(max_length=160, null=True, blank=True)

    amount             = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    currency           = models.CharField(max_length=3, default="USD")
    fx_to_usd          = models.DecimalField(max_digits=14, decimal_places=6, default=1)
    amount_usd         = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # ↑ GENERATED en DB; el ORM no debe intentar escribirla.

    source             = models.CharField(max_length=16, default="MANUAL")
    document_id        = models.UUIDField(null=True, blank=True)        # ⛔ sin FK
    ocr_confidence     = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    notes              = models.TextField(null=True, blank=True)

    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'transfers"."cost_line'
        ordering = ("-created_at",)
