"""
=====================================================================
MWT.ONE · apps.sizing.models
Agente responsable: [AG-BACKEND]
Sprint: SIZING ENGINE v1

Espeja la DDL de `A3_sizing_engine.sql`. Reglas MWT:
  · `Meta.managed = False`  — la tabla se crea/modifica vía SQL puro.
  · `db_table = 'ops"."tabla'` para apuntar al schema correcto sin FK.
  · Cero ForeignKey: los campos referenciales son UUIDField o CharField.
  · TODOS los campos de negocio son `null=True, blank=True` — la app
    permite borradores (sólo `id` es obligatorio).
=====================================================================
"""
import uuid
from django.db import models


# ─────────────────────────────────────────────────────────────────────
# Catálogos (alimentan el endpoint /api/sizing/options/)
# ─────────────────────────────────────────────────────────────────────
class TipoProductoCat(models.Model):
    """Catálogo: 'calzado' / 'plantilla' (extensible)."""
    codigo               = models.CharField(max_length=32, primary_key=True)
    label                = models.CharField(max_length=80)
    descripcion          = models.TextField(null=True, blank=True)
    icon                 = models.CharField(max_length=40, null=True, blank=True)
    requiere_dimensiones = models.BooleanField(default=False)
    orden                = models.IntegerField(default=100)
    is_active            = models.BooleanField(default=True)
    created_at           = models.DateTimeField(auto_now_add=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ops"."tipo_producto_cat'
        ordering = ["orden", "codigo"]

    def __str__(self) -> str:
        return f"{self.codigo} · {self.label}"


class MedidaSistemaCat(models.Model):
    """Catálogo: los 15 sistemas de medida internacionales."""
    codigo      = models.CharField(max_length=24, primary_key=True)
    label       = models.CharField(max_length=60)
    region      = models.CharField(max_length=40, null=True, blank=True)
    descripcion = models.TextField(null=True, blank=True)
    grupo       = models.CharField(max_length=40, null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'ops"."medida_sistema_cat'
        ordering = ["orden", "codigo"]

    def __str__(self) -> str:
        return f"{self.codigo} · {self.label}"


# ─────────────────────────────────────────────────────────────────────
# Maestro: ops.tallas
# ─────────────────────────────────────────────────────────────────────
class Talla(models.Model):
    """
    Catálogo maestro de tallas.

    No hay FK: si en el futuro un producto se asocia a una talla,
    se almacena este `id` (UUID) como CharField/UUIDField del lado
    consumidor.

    TODO el contenido de negocio es opcional — soporta borradores.
    """
    # ── Auditoría ───────────────────────────────────────────────────
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Clasificación + identificador base ──────────────────────────
    tipo_producto = models.CharField(max_length=32,  null=True, blank=True)
    talla_base    = models.CharField(max_length=40,  null=True, blank=True)
    nombre        = models.CharField(max_length=120, null=True, blank=True)
    descripcion   = models.TextField(null=True, blank=True)

    # ── Matriz de Equivalencias (15 sistemas) ──────────────────────
    eu       = models.CharField(max_length=20, null=True, blank=True)
    us_men   = models.CharField(max_length=20, null=True, blank=True)
    us_women = models.CharField(max_length=20, null=True, blank=True)
    us_youth = models.CharField(max_length=20, null=True, blank=True)
    uk_men   = models.CharField(max_length=20, null=True, blank=True)
    uk_women = models.CharField(max_length=20, null=True, blank=True)
    uk_youth = models.CharField(max_length=20, null=True, blank=True)
    br       = models.CharField(max_length=20, null=True, blank=True)
    mx       = models.CharField(max_length=20, null=True, blank=True)
    ar       = models.CharField(max_length=20, null=True, blank=True)
    jp       = models.CharField(max_length=20, null=True, blank=True)
    cn       = models.CharField(max_length=20, null=True, blank=True)
    kr       = models.CharField(max_length=20, null=True, blank=True)
    cm       = models.CharField(max_length=20, null=True, blank=True)
    # Sprint 2026-07-21 · sistema IN (pulgadas) = comprimento_mm ÷ 25.4.
    # Ver G12_tallas_sistema_inch_sin_alfa.sql
    inch     = models.CharField(max_length=20, null=True, blank=True)
    alfa     = models.CharField(max_length=20, null=True, blank=True)

    # ── Especificaciones Dimensionales (sólo plantilla) ────────────
    grosor_antepie_mm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    grosor_talon_mm   = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    drop_mm           = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    peso_g            = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)

    # ── Medidas internas del calzado (mm) — Sprint 2026-07-21 ─────
    # PDF oficial Marluvas "Sepa la talla". CM (Mondopoint) =
    # comprimento_mm ÷ 10. Opcionales; ver G11_tallas_ancho_comprimento_borra_32.sql
    ancho_mm       = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    comprimento_mm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    # ── Clasificadores multi-valor (Sprint 2026-07-16) ─────────────
    # Una talla puede pertenecer a UNA O MÁS marcas, tipos y familias.
    #   marca_ids → lista de UUIDs (texto) de brands.marca
    #   tipos     → lista de tipos de calzado (Bota Alta, Tenis, Plantilla…)
    #   familias  → lista de familias/líneas = prefijo del nombre del
    #               producto (ej. 50B22 engloba 50B22M-CPAP-PAD, 50B22-V…)
    # Ver backend/sql/G1_tallas_familias_attr_opciones.sql
    marca_ids = models.JSONField(default=list, blank=True)
    tipos     = models.JSONField(default=list, blank=True)
    familias  = models.JSONField(default=list, blank=True)

    # ── Metadata libre ──────────────────────────────────────────────
    metadata = models.JSONField(default=dict, blank=True)

    # ── Tupla canónica de columnas de equivalencias ────────────────
    EQUIVALENCE_FIELDS = (
        "eu", "us_men", "us_women", "us_youth",
        "uk_men", "uk_women", "uk_youth",
        "br", "mx", "ar", "jp", "cn", "kr", "cm", "inch", "alfa",
    )
    DIMENSION_FIELDS = (
        "grosor_antepie_mm", "grosor_talon_mm", "drop_mm", "peso_g",
    )
    # Sprint 2026-07-21 · medidas internas del calzado (mm) — PDF Marluvas
    MEDIDA_FIELDS = (
        "ancho_mm", "comprimento_mm",
    )

    class Meta:
        managed  = False
        db_table = 'ops"."tallas'
        ordering = ["tipo_producto", "talla_base", "id"]

    def __str__(self) -> str:
        base = self.talla_base or "(borrador)"
        tip  = self.tipo_producto or "—"
        return f"Talla[{tip}] {base}"
