"""
apps.tareas · serializers (Etapa 2)
"""
from rest_framework import serializers

from .models import Tarea, TareaCatalogo, TareaEvento


class TareaCatalogoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TareaCatalogo
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class TareaSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Tarea
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "completed_at")


class TareaEventoSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TareaEvento
        fields = "__all__"
        read_only_fields = ("id", "created_at")
