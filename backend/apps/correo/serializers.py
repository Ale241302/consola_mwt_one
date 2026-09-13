"""
apps.correo · serializers (Etapa 3)
"""
from rest_framework import serializers

from .models import Adjunto, Contacto, Envio, Estilo, Grupo, Mensaje


class ContactoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Contacto
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class GrupoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Grupo
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class EstiloSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Estilo
        fields = "__all__"
        read_only_fields = ("id", "created_at", "version")


class AdjuntoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Adjunto
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class MensajeSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Mensaje
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class EnvioSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Envio
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "estado", "sent_at", "message_id", "error")
