"""
apps.nodos.models — Django ORM sobre la tabla `nodos.nodo` creada en SQL puro.
CERO migrations: Meta.managed = False.
CERO FK: responsable_id es UUIDField plano.
"""
from django.db import models


class Nodo(models.Model):
    id              = models.UUIDField(primary_key=True)
    codigo          = models.CharField(max_length=16, unique=True)
    nombre          = models.CharField(max_length=128)
    tipo            = models.CharField(max_length=16)
    pais_iso2       = models.CharField(max_length=2)
    ciudad          = models.CharField(max_length=96)
    direccion       = models.TextField(null=True, blank=True)
    zona_horaria    = models.CharField(max_length=48, default="America/Lima")
    responsable_id  = models.UUIDField(null=True, blank=True)     # ⛔ sin FK
    contacto_email  = models.CharField(max_length=160, null=True, blank=True)
    contacto_tel    = models.CharField(max_length=32,  null=True, blank=True)
    lat             = models.DecimalField(max_digits=9,  decimal_places=6, null=True, blank=True)
    lng             = models.DecimalField(max_digits=9,  decimal_places=6, null=True, blank=True)
    capacidad_m2    = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    observaciones   = models.TextField(null=True, blank=True)
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
