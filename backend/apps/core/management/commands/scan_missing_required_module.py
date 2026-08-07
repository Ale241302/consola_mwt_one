"""
=====================================================================
MWT.ONE · apps.core.management.commands.scan_missing_required_module
Agente responsable: [AG-BACKEND]
Ola 1 — F4: escanea viewsets/APIViews sin required_module.

Uso:
    python manage.py scan_missing_required_module
    python manage.py scan_missing_required_module --app expedientes
====================================================================="""
from __future__ import annotations

import inspect
from typing import Type

from django.core.management.base import BaseCommand
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSetMixin


class Command(BaseCommand):
    help = "Lista viewsets/APIViews que no declaran required_module."

    def add_arguments(self, parser):
        parser.add_argument(
            "--app",
            default=None,
            help="Filtrar por app Django (ej. expedientes).",
        )

    def handle(self, *args, **opts):
        from django.urls import get_resolver
        from django.apps import apps

        target_app = opts.get("app")
        candidates: set[Type[APIView]] = set()

        # Recorrer todas las apps instaladas buscando views.py
        for config in apps.get_app_configs():
            if target_app and config.label != target_app:
                continue
            try:
                views_module = config.get_module("views")
            except ImportError:
                continue
            for name in dir(views_module):
                obj = getattr(views_module, name)
                if (
                    inspect.isclass(obj)
                    and issubclass(obj, APIView)
                    and obj is not APIView
                    and not getattr(obj, "__abstract__", False)
                ):
                    candidates.add(obj)

        missing = []
        for cls in sorted(candidates, key=lambda c: f"{c.__module__}.{c.__name__}"):
            if getattr(cls, "required_module", None):
                continue
            if getattr(cls, "permission_classes", None) == [AllowAny]:
                continue
            missing.append(f"{cls.__module__}.{cls.__name__}")

        if not missing:
            self.stdout.write(self.style.SUCCESS("Todas las vistas DRF declaran required_module."))
            return

        self.stdout.write(self.style.WARNING(
            f"Vistas sin required_module ({len(missing)}):"
        ))
        for m in missing:
            self.stdout.write(f"  - {m}")


# Import lazy para evitar circular con settings.
from rest_framework.permissions import AllowAny
