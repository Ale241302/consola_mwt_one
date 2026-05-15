"""
apps.nodos.models — Django ORM sobre la tabla `nodos.nodo` creada en SQL puro.
CERO migrations: Meta.managed = False.
CERO FK: responsable_id / legal_entity_owner_id / operator_id son UUIDField plano.
"""
from django.db import models


class Nodo(models.Model):
    id              = models.UUIDField(primary_key=True)
    codigo          = models.CharField(max_length=16, unique=True)
    nombre          = models.CharField(max_length=128)
    tipo            = models.CharField(max_length=16)
    pais_iso2       = models.CharField(max_length=2)
    ciudad          = models.CharField(max_length=96, null=True, blank=True)
    direccion       = models.TextField(null=True, blank=True)
    zona_horaria    = models.CharField(max_length=48, default="America/Lima")
    responsable_id  = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    contacto_email  = models.CharField(max_length=160, null=True, blank=True)
    contacto_tel    = models.CharField(max_length=32,  null=True, blank=True)
    lat             = models.DecimalField(max_digits=9,  decimal_places=6, null=True, blank=True)
    lng             = models.DecimalField(max_digits=9,  decimal_places=6, null=True, blank=True)
    capacidad_m2    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    observaciones   = models.TextField(null=True, blank=True)

    # Extensiones 93_schema_extensions.sql §2 (gobernanza + capacidades):
    legal_entity_owner_id = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    operator_id           = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    capabilities          = models.JSONField(default=list, blank=True)
    status                = models.CharField(max_length=16, null=True, blank=True)
                            # ACTIVE / INACTIVE / SETUP / RETIRED

    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'nodos\".\"nodo'           # schema-qualified


class TipoCat(models.Model):
    codigo = models.CharField(max_length=16, primary_key=True)
    label  = models.CharField(max_length=64)
    color  = models.CharField(max_length=16, null=True, blank=True)
    orden  = models.SmallIntegerField(default=0)

    class Meta:
        managed  = False
        db_table = 'nodos\".\"tipo_cat'
        ordering = ('orden',)


class StatusCat(models.Model):
    """Catálogo ACTIVE/INACTIVE/SETUP/RETIRED — creado por 11_nodos_audit.sql."""
    codigo      = models.CharField(max_length=16, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    color       = models.CharField(max_length=16, null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'nodos\".\"status_cat'
        ordering = ('orden',)


class NodoJerarquia(models.Model):
    """Árbol padre-hijo por UUID plano — creado por 11_nodos_audit.sql."""
    id              = models.UUIDField(primary_key=True)
    nodo_id         = models.UUIDField()                          # ⛔ sin FK
    nodo_padre_id   = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    nivel           = models.SmallIntegerField(default=0)
    relacion_tipo   = models.CharField(max_length=16, default='ESTRUCTURAL')
    path_uuid       = models.TextField(null=True, blank=True)
    notas           = models.TextField(null=True, blank=True)
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'nodos\".\"nodo_jerarquia'
        ordering = ('nivel', 'created_at')


# ─────────────────────────────────────────────────────────────────
# Sprint 2026-05-11 · Fase 2 del paquete Nodos.
# Tabla `nodos.artefacto` creada por SQL 11b_nodos_artefactos.sql.
# Permite asociar archivos arbitrarios a un nodo (proformas, contratos
# 3PL, fotos de bodega, certificados). El mismo tipo puede repetirse
# y el estado es texto libre — la BD no restringe el enum.
# ─────────────────────────────────────────────────────────────────
class NodoArtefacto(models.Model):
    id              = models.UUIDField(primary_key=True)
    nodo_id         = models.UUIDField()                                # ⛔ sin FK
    tipo            = models.CharField(max_length=48)
    nombre          = models.CharField(max_length=160)
    estado          = models.CharField(max_length=32, default='PUBLICADO')
    descripcion     = models.TextField(null=True, blank=True)
    archivo_url     = models.TextField(null=True, blank=True)
    archivo_nombre  = models.CharField(max_length=255, null=True, blank=True)
    archivo_size    = models.BigIntegerField(null=True, blank=True)
    archivo_mime    = models.CharField(max_length=96,  null=True, blank=True)
    metadata        = models.JSONField(default=dict, blank=True)
    uploaded_by_id  = models.UUIDField(null=True, blank=True)           # ⛔ sin FK
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'nodos\".\"artefacto'
        ordering = ('-created_at',)


# ─────────────────────────────────────────────────────────────────
# Sprint 2026-05-11 · Fase 4 — Builder artifacts en nodos.
# Tabla `nodos.builder_artifact_instance` (creada por SQL B1).
# Reemplaza el flujo simple de NodoArtefacto (que queda como tabla
# legacy sin uso en UI) por integración real con el Builder externo
# (https://builder.muito.work).
# ─────────────────────────────────────────────────────────────────
class NodoBuilderArtifactInstance(models.Model):
    id                  = models.UUIDField(primary_key=True)
    nodo_id             = models.UUIDField()                            # ⛔ sin FK
    template_id         = models.IntegerField()                          # builder.artefactos.id
    template_title      = models.TextField()
    data                = models.JSONField(default=dict)
    structure_snapshot  = models.JSONField(default=dict)

    # Sprint 2026-05-14 · Fase 16 — vínculo opcional a una transferencia.
    # Cuando el artefacto se crea desde /transferencias/{id}/, este campo
    # contiene el UUID de la transfer. Persistido por SQL B3.
    transferencia_id    = models.UUIDField(null=True, blank=True)       # ⛔ sin FK

    created_by_id       = models.UUIDField(null=True, blank=True)
    created_by_name     = models.CharField(max_length=128, null=True, blank=True)
    updated_by_id       = models.UUIDField(null=True, blank=True)
    updated_by_name     = models.CharField(max_length=128, null=True, blank=True)

    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'nodos\".\"builder_artifact_instance'
        ordering = ('-created_at',)


# ─────────────────────────────────────────────────────────────────
# Sprint 2026-05-11 · Fase 5 — Líneas asociadas a un artefacto del nodo.
# Tabla creada por SQL B2_nodos_builder_artifact_lines.sql. Append-only.
# ─────────────────────────────────────────────────────────────────
class NodoBuilderArtifactLine(models.Model):
    id                            = models.UUIDField(primary_key=True)
    builder_artifact_instance_id  = models.UUIDField()                  # ⛔ sin FK
    nodo_id                       = models.UUIDField()
    expediente_id                 = models.UUIDField()
    producto_id                   = models.UUIDField()
    talla                         = models.CharField(max_length=16, null=True, blank=True)
    qty                           = models.IntegerField()
    notas                         = models.TextField(null=True, blank=True)
    created_by_id                 = models.UUIDField(null=True, blank=True)
    is_active                     = models.BooleanField(default=True)
    created_at                    = models.DateTimeField(auto_now_add=True)
    updated_at                    = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'nodos\".\"builder_artifact_line'
        ordering = ('-created_at',)
