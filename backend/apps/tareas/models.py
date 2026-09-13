"""
apps.tareas · models (Etapa 2)
Catálogo de tareas, agenda por expediente y bitácora.

Convención del proyecto: managed=False, PK UUID lógica, sin ForeignKey.
El esquema lo crea backend/sql/K7_tareas.sql (aplicado por el entrypoint).
"""
from django.db import models


class TareaCatalogo(models.Model):
    id                  = models.UUIDField(primary_key=True)
    codigo              = models.CharField(max_length=48, unique=True)
    nombre              = models.CharField(max_length=160)
    descripcion         = models.TextField(null=True, blank=True)
    tipo                = models.CharField(max_length=24, default="OPERATIVO")
    offset_dias_habiles = models.IntegerField(null=True, blank=True)
    offset_ref          = models.CharField(max_length=24, null=True, blank=True)
    depends_on_hito     = models.CharField(max_length=24, null=True, blank=True)
    orden               = models.IntegerField(default=100)
    is_active           = models.BooleanField(default=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'tareas"."catalogo'
        ordering = ["orden", "codigo"]

    def __str__(self):
        return self.codigo


class Tarea(models.Model):
    id                  = models.UUIDField(primary_key=True)
    expediente_id       = models.UUIDField(null=True, blank=True)
    oc_id               = models.UUIDField(null=True, blank=True)
    client_id           = models.UUIDField(null=True, blank=True)
    catalogo_id         = models.UUIDField(null=True, blank=True)
    catalogo_codigo     = models.CharField(max_length=48, null=True, blank=True)
    titulo              = models.CharField(max_length=200)
    descripcion         = models.TextField(null=True, blank=True)
    tipo                = models.CharField(max_length=24, default="OPERATIVO")
    estado              = models.CharField(max_length=24, default="PENDIENTE")
    prioridad           = models.CharField(max_length=16, default="MEDIA")
    responsable_user_id = models.UUIDField(null=True, blank=True)
    origen              = models.CharField(max_length=12, default="MANUAL")
    due_date            = models.DateField(null=True, blank=True)
    depends_on_hito     = models.CharField(max_length=24, null=True, blank=True)
    depends_on_tarea_id = models.UUIDField(null=True, blank=True)
    last_sent_at        = models.DateTimeField(null=True, blank=True)
    responded_at        = models.DateTimeField(null=True, blank=True)
    completed_at        = models.DateTimeField(null=True, blank=True)
    notes               = models.TextField(null=True, blank=True)
    external_ref        = models.TextField(null=True, blank=True)
    evidence            = models.JSONField(default=dict, blank=True)
    documentos          = models.JSONField(default=list, blank=True)
    is_override         = models.BooleanField(default=False)
    is_active           = models.BooleanField(default=True)
    created_by_id       = models.UUIDField(null=True, blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)
    updated_at          = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'tareas"."tarea'
        ordering = ["due_date", "created_at"]

    def __str__(self):
        return f"{self.catalogo_codigo or self.titulo} [{self.estado}]"


class TareaEvento(models.Model):
    id         = models.UUIDField(primary_key=True)
    tarea_id   = models.UUIDField()
    accion     = models.CharField(max_length=32)
    detalle    = models.JSONField(default=dict, blank=True)
    user_id    = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'tareas"."tarea_evento'
        ordering = ["-created_at"]
