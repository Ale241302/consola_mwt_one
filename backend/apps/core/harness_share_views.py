"""MWT.ONE · apps.core.harness_share_views — compartición de agentes y skills del harness.

La consola es el almacén compartido entre los procesos del harness DeepSeek, que
corren aislados por usuario. Cada usuario publica aquí un agente o skill que creó
y decide con quién compartirlo: correos concretos o todos los usuarios de su
empresa. El harness lee lo que le comparten y lo materializa como copia de solo
lectura, de modo que quien lo recibe no puede editarlo ni borrarlo.

La vista se auto-scopea al propio usuario (`rbac_bypass`): sólo devuelve lo que
él publicó y lo que le compartieron explícitamente, nunca el resto del catálogo.
"""
import json
import re
import uuid as uuidlib

from django.db import connection
from rest_framework import viewsets
from rest_framework.response import Response

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _dicts(cursor):
    """Filas del cursor como diccionarios, con las columnas del SELECT."""
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _viewer_email(request):
    """Correo canónico (minúsculas) del usuario autenticado."""
    return (getattr(request.user, "email", "") or "").strip().lower()


def _viewer_companies(request):
    """Empresas del usuario, en minúsculas, para el scope de empresa."""
    return [str(company).lower() for company in (getattr(request.user, "legal_entity_ids", None) or []) if str(company).strip()]


def _normalize_emails(raw):
    """Correos válidos, en minúsculas y sin duplicados."""
    result = []
    for candidate in raw or []:
        email = str(candidate).strip().lower()
        if email and EMAIL_RE.match(email) and email not in result:
            result.append(email)
    return result


class HarnessShareViewSet(viewsets.ViewSet):
    """Agentes y skills del harness compartidos por el usuario o con él.

    Rutas (prefijo `/api/harness/`):
      · `GET    /api/harness/shares/`        → `{outgoing, incoming}` del usuario.
      · `POST   /api/harness/shares/`        → publica o actualiza un recurso propio.
      · `DELETE /api/harness/shares/<uuid>/` → retira un recurso propio.
    """

    #: La vista sólo toca lo del propio usuario; no requiere módulo en el RBAC.
    rbac_bypass = True

    def list(self, request):
        email = _viewer_email(request)
        companies = _viewer_companies(request)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id::text, kind, owner_email, company_id, name, payload,
                       share_all, shared_emails, created_at, updated_at
                  FROM core.harness_share
                 WHERE owner_email = %s
                 ORDER BY updated_at DESC
                """,
                [email],
            )
            outgoing = _dicts(cursor)
            cursor.execute(
                """
                SELECT id::text, kind, owner_email, company_id, name, payload,
                       share_all, shared_emails, created_at, updated_at
                  FROM core.harness_share
                 WHERE owner_email <> %s
                   AND ( %s = ANY(shared_emails)
                         OR (share_all AND company_id IS NOT NULL AND company_id = ANY(%s)) )
                 ORDER BY updated_at DESC
                """,
                [email, email, companies],
            )
            incoming = _dicts(cursor)
        return Response({"outgoing": outgoing, "incoming": incoming})

    def create(self, request):
        email = _viewer_email(request)
        if not email:
            return Response({"detail": "La identidad no tiene correo."}, status=400)
        data = request.data or {}
        kind = str(data.get("kind", "")).strip().lower()
        if kind not in ("agent", "skill"):
            return Response({"detail": "kind debe ser 'agent' o 'skill'."}, status=400)
        name = str(data.get("name", "")).strip()
        if not name:
            return Response({"detail": "name es obligatorio."}, status=400)
        payload = data.get("payload")
        if not isinstance(payload, dict):
            return Response({"detail": "payload debe ser un objeto JSON."}, status=400)
        share_all = bool(data.get("share_all", False))
        shared_emails = _normalize_emails(data.get("shared_emails") or [])
        if not share_all and not shared_emails:
            return Response(
                {"detail": "Comparte con al menos un correo o con toda tu empresa."},
                status=400,
            )
        companies = _viewer_companies(request)
        company_id = companies[0] if companies else None
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO core.harness_share
                       (id, kind, owner_email, company_id, name, payload, share_all, shared_emails)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (owner_email, kind, name)
                DO UPDATE SET payload = EXCLUDED.payload,
                              share_all = EXCLUDED.share_all,
                              shared_emails = EXCLUDED.shared_emails,
                              company_id = EXCLUDED.company_id,
                              updated_at = now()
                RETURNING id::text, kind, owner_email, company_id, name, payload,
                          share_all, shared_emails, created_at, updated_at
                """,
                [
                    str(uuidlib.uuid4()), kind, email, company_id, name,
                    json.dumps(payload), share_all, shared_emails,
                ],
            )
            row = _dicts(cursor)[0]
        return Response(row, status=201)

    def destroy(self, request, pk=None):
        email = _viewer_email(request)
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM core.harness_share WHERE id = %s AND owner_email = %s",
                [pk, email],
            )
            removed = cursor.rowcount
        if not removed:
            return Response({"detail": "No existe o no es tuyo."}, status=404)
        return Response(status=204)
