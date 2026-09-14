"""
apps.correo · models (Etapa 3)
Bandeja (mensajes + adjuntos), libreta de contactos, grupos, estilo y envíos.

managed=False, PK UUID lógica (esquema `correo`, ver backend/sql/L1_correo.sql).
"""
from django.contrib.postgres.fields import ArrayField
from django.db import models


class Contacto(models.Model):
    id            = models.UUIDField(primary_key=True)
    email         = models.CharField(max_length=254)
    nombre        = models.CharField(max_length=160, null=True, blank=True)
    empresa       = models.CharField(max_length=160, null=True, blank=True)
    marca         = models.CharField(max_length=120, null=True, blank=True)
    funcion       = models.CharField(max_length=120, null=True, blank=True)
    idioma        = models.CharField(max_length=8, null=True, blank=True)
    idioma_source = models.CharField(max_length=24, null=True, blank=True)
    grupos        = ArrayField(models.TextField(), default=list, blank=True)
    notas         = models.TextField(null=True, blank=True)
    perfil        = models.JSONField(default=dict, blank=True)
    is_active     = models.BooleanField(default=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'correo"."contacto'
        ordering = ["nombre", "email"]


class Grupo(models.Model):
    id          = models.UUIDField(primary_key=True)
    codigo      = models.CharField(max_length=48, unique=True)
    nombre      = models.CharField(max_length=160)
    descripcion = models.TextField(null=True, blank=True)
    emails      = ArrayField(models.TextField(), default=list, blank=True)
    para        = ArrayField(models.TextField(), default=list, blank=True)
    cc          = ArrayField(models.TextField(), default=list, blank=True)
    is_active   = models.BooleanField(default=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'correo"."grupo'
        ordering = ["nombre"]


class Estilo(models.Model):
    id            = models.UUIDField(primary_key=True)
    version       = models.IntegerField()
    contenido     = models.TextField()
    reglas        = models.JSONField(default=dict, blank=True)
    is_active     = models.BooleanField(default=True)
    created_by_id = models.UUIDField(null=True, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'correo"."estilo'
        ordering = ["-version"]


class Mensaje(models.Model):
    id              = models.UUIDField(primary_key=True)
    message_id      = models.TextField(null=True, blank=True)
    thread_key      = models.TextField(null=True, blank=True)
    folder          = models.CharField(max_length=96, null=True, blank=True)
    direction       = models.CharField(max_length=3, default="IN")
    owner_email     = models.CharField(max_length=254, null=True, blank=True)
    from_email      = models.TextField(null=True, blank=True)
    from_name       = models.TextField(null=True, blank=True)
    to_emails       = ArrayField(models.TextField(), default=list, blank=True)
    cc_emails       = ArrayField(models.TextField(), default=list, blank=True)
    subject         = models.TextField(null=True, blank=True)
    sent_at         = models.DateTimeField(null=True, blank=True)
    received_at     = models.DateTimeField(null=True, blank=True)
    body_text       = models.TextField(null=True, blank=True)
    body_html       = models.TextField(null=True, blank=True)
    has_attachments = models.BooleanField(default=False)
    expediente_id   = models.UUIDField(null=True, blank=True)
    oc_id           = models.UUIDField(null=True, blank=True)
    proforma        = models.TextField(null=True, blank=True)
    sap             = models.TextField(null=True, blank=True)
    match_status    = models.CharField(max_length=16, default="POR_VINCULAR")
    match_reason    = models.TextField(null=True, blank=True)
    is_read         = models.BooleanField(default=False)
    is_active       = models.BooleanField(default=True)
    source          = models.CharField(max_length=16, default="IMAP")
    raw_ref         = models.TextField(null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'correo"."mensaje'
        ordering = ["-sent_at", "-created_at"]


class MensajeExpediente(models.Model):
    id            = models.UUIDField(primary_key=True)
    mensaje_id    = models.UUIDField()
    expediente_id = models.UUIDField()
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'correo"."mensaje_expediente'
        ordering = ["created_at"]


class Extraccion(models.Model):
    id            = models.UUIDField(primary_key=True)
    mensaje_id    = models.UUIDField(null=True, blank=True)
    expediente_id = models.UUIDField(null=True, blank=True)
    campo         = models.CharField(max_length=24)
    valor_raw     = models.TextField(null=True, blank=True)
    valor_fecha   = models.DateField(null=True, blank=True)
    precision     = models.CharField(max_length=16, default="EXACTA")
    fuente        = models.CharField(max_length=32, default="MENSAJE")
    confianza     = models.DecimalField(max_digits=4, decimal_places=3, default=0)
    estado        = models.CharField(max_length=16, default="PROPUESTO")
    conflicto     = models.BooleanField(default=False)
    tipo_mencion  = models.CharField(max_length=16, default="CONFIRMACION")
    evidencias    = models.JSONField(default=dict, blank=True)
    created_by_id = models.UUIDField(null=True, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'correo"."extraccion'
        ordering = ["-created_at"]


class ExpedienteFecha(models.Model):
    id                   = models.UUIDField(primary_key=True)
    expediente_id        = models.UUIDField()
    campo                = models.CharField(max_length=24)
    valor_raw            = models.TextField(null=True, blank=True)
    valor_fecha          = models.DateField(null=True, blank=True)
    precision            = models.CharField(max_length=16, default="EXACTA")
    publicado            = models.BooleanField(default=True)
    fuente_extraccion_id = models.UUIDField(null=True, blank=True)
    created_at           = models.DateTimeField(auto_now_add=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'correo"."expediente_fecha'
        ordering = ["campo"]


class Adjunto(models.Model):
    id          = models.UUIDField(primary_key=True)
    mensaje_id  = models.UUIDField()
    filename    = models.TextField(null=True, blank=True)
    mimetype    = models.CharField(max_length=160, null=True, blank=True)
    size_bytes  = models.BigIntegerField(null=True, blank=True)
    storage_key = models.TextField(null=True, blank=True)
    sha256      = models.CharField(max_length=64, null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed  = False
        db_table = 'correo"."adjunto'
        ordering = ["filename"]


class Envio(models.Model):
    id             = models.UUIDField(primary_key=True)
    expediente_id  = models.UUIDField(null=True, blank=True)
    oc_id          = models.UUIDField(null=True, blank=True)
    from_email     = models.CharField(max_length=254, null=True, blank=True)
    destinatarios  = ArrayField(models.TextField(), default=list, blank=True)
    cc             = ArrayField(models.TextField(), default=list, blank=True)
    bcc            = ArrayField(models.TextField(), default=list, blank=True)
    subject        = models.TextField(null=True, blank=True)
    body_es        = models.TextField(null=True, blank=True)
    body_traducido = models.TextField(null=True, blank=True)
    idioma         = models.CharField(max_length=8, null=True, blank=True)
    estado         = models.CharField(max_length=16, default="BORRADOR")
    sent_at        = models.DateTimeField(null=True, blank=True)
    message_id     = models.TextField(null=True, blank=True)
    error          = models.TextField(null=True, blank=True)
    adjuntos       = models.JSONField(default=list, blank=True)
    created_by_id  = models.UUIDField(null=True, blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'correo"."envio'
        ordering = ["-created_at"]
