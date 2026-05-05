"""
=====================================================================
MWT.ONE · apps.tickets.models
Agente responsable: [AG-01 · AG-DATABASE]
Tablas creadas en backend/sql/B4_tickets.sql.

Reglas:
  - managed = False (DB la maneja [AG-DATABASE])
  - sin ForeignKey: vinculos por UUID plano
=====================================================================
"""
from django.db import models


# ── Catalogos ────────────────────────────────────────────────
class ReasonCat(models.Model):
    codigo    = models.CharField(max_length=32, primary_key=True)
    label_es  = models.CharField(max_length=96)
    label_en  = models.CharField(max_length=96, null=True, blank=True)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'tickets"."reason_cat'
        ordering = ("orden", "codigo")


class StatusCat(models.Model):
    codigo       = models.CharField(max_length=16, primary_key=True)
    label_es     = models.CharField(max_length=64)
    label_en     = models.CharField(max_length=64, null=True, blank=True)
    color        = models.CharField(max_length=16, null=True, blank=True)
    orden        = models.IntegerField(default=100)
    admin_only   = models.BooleanField(default=False)
    estado_final = models.BooleanField(default=False)
    is_active    = models.BooleanField(default=True)

    class Meta:
        managed  = False
        db_table = 'tickets"."status_cat'
        ordering = ("orden", "codigo")


# ── Ticket ────────────────────────────────────────────────────
class Ticket(models.Model):
    """
    Cabecera de un ticket de soporte. Inmutable cuando status == 'FINALIZADO'.
    """
    REASON_CHOICES = (
        ("MEJORA",      "Mejoras de funcionamiento"),
        ("BUG",         "Reporte de bug"),
        ("SOPORTE_OP",  "Soporte operativo"),
        ("FACTURACION", "Duda de facturacion"),
        ("OTRO",        "Otro"),
    )
    STATUS_CHOICES = (
        ("ABIERTO",     "Abierto"),
        ("EN_REVISION", "En revision"),
        ("RESUELTO",    "Resuelto"),
        ("FINALIZADO",  "Finalizado"),
    )

    id              = models.UUIDField(primary_key=True)
    user_id         = models.UUIDField()
    user_email      = models.CharField(max_length=255, null=True, blank=True)
    user_full_name  = models.CharField(max_length=255, null=True, blank=True)
    context_url     = models.CharField(max_length=512, null=True, blank=True)
    reason          = models.CharField(max_length=32, choices=REASON_CHOICES, default="OTRO")
    description     = models.TextField()
    status          = models.CharField(max_length=16, choices=STATUS_CHOICES, default="ABIERTO")

    finalized_at    = models.DateTimeField(null=True, blank=True)
    finalized_by_id = models.UUIDField(null=True, blank=True)
    first_response_at = models.DateTimeField(null=True, blank=True)

    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'tickets"."ticket'
        ordering = ("-created_at",)

    @property
    def is_finalized(self) -> bool:
        return self.status == "FINALIZADO"


# ── TicketMessage ────────────────────────────────────────────
class TicketMessage(models.Model):
    id           = models.UUIDField(primary_key=True)
    ticket_id    = models.UUIDField()
    sender_id    = models.UUIDField()
    sender_email = models.CharField(max_length=255, null=True, blank=True)
    sender_role  = models.CharField(max_length=32, null=True, blank=True)
    content      = models.TextField()
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'tickets"."ticket_message'
        ordering = ("created_at",)


# ── TicketAttachment (polimorfico ticket | message) ──────────
class TicketAttachment(models.Model):
    KIND_CHOICES = (
        ("PDF",   "PDF"),
        ("DOCX",  "DOCX"),
        ("JPG",   "JPG"),
        ("PNG",   "PNG"),
        ("OTHER", "Otro"),
    )

    id              = models.UUIDField(primary_key=True)
    ticket_id       = models.UUIDField(null=True, blank=True)
    message_id      = models.UUIDField(null=True, blank=True)

    file_object_key = models.TextField()
    file_name       = models.CharField(max_length=255)
    file_size_bytes = models.IntegerField(null=True, blank=True)
    file_mime       = models.CharField(max_length=96, null=True, blank=True)
    file_kind       = models.CharField(max_length=8, choices=KIND_CHOICES, default="OTHER")

    uploaded_by_id  = models.UUIDField(null=True, blank=True)
    is_active       = models.BooleanField(default=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'tickets"."ticket_attachment'
        ordering = ("created_at",)
