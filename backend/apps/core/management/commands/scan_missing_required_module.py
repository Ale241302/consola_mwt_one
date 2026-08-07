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

import importlib
import inspect
from typing import Type

from django.core.management.base import BaseCommand
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView


class Command(BaseCommand):
    help = "Lista viewsets/APIViews que no declaran required_module."

    def add_arguments(self, parser):
        parser.add_argument(
            "--app",
            default=None,
            help="Filtrar por app Django (ej. expedientes).",
        )

    def handle(self, *args, **opts):
        from django.apps import apps
        from apps.core.permissions import RoleBasedPermission

        target_app = opts.get("app")
        candidates: set[Type[APIView]] = set()

        # Recorrer todas las apps instaladas buscando views.py
        for config in apps.get_app_configs():
            if target_app and config.label != target_app:
                continue
            # Ignorar librerías de terceros (ej: rest_framework_simplejwt)
            if config.name.startswith("rest_framework"):
                continue
            try:
                views_module = importlib.import_module(f"{config.name}.views")
            except (ImportError, ModuleNotFoundError):
                continue
            for name in dir(views_module):
                obj = getattr(views_module, name)
                if (
                    inspect.isclass(obj)
                    and issubclass(obj, APIView)
                    and obj is not APIView
                    and not getattr(obj, "__abstract__", False)
                    and obj.__module__.startswith("apps.")
                ):
                    candidates.add(obj)

        missing = []
        for cls in sorted(candidates, key=lambda c: f"{c.__module__}.{c.__name__}"):
            if getattr(cls, "required_module", None):
                continue
            
            perms = getattr(cls, "permission_classes", None)
            if perms is not None:
                # Convertir tupla/lista a set de clases
                perm_classes = set(perms) if isinstance(perms, (list, tuple)) else {perms}
                # Si AllowAny o IsAuthenticated explícito y no incluye RoleBasedPermission, no requiere required_module
                if AllowAny in perm_classes:
                    continue
                if RoleBasedPermission not in perm_classes and (IsAuthenticated in perm_classes or len(perm_classes) > 0):
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

