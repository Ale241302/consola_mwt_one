"""MWT.ONE · apps.core.harness_share_views — compartición de recursos del harness.

La consola es el almacén compartido entre los procesos del harness DeepSeek, que
corren aislados por usuario. Cada usuario publica aquí un agente, skill, Space o
Work Flow que creó y decide con quién compartirlo: correos concretos o todos los
usuarios de su empresa. El harness lee lo que le comparten y lo materializa como
copia de solo lectura, de modo que quien lo recibe no puede editarlo ni borrarlo.

Dos familias conviven en `core.harness_share`:

  · `agent` / `skill` — una fila por recurso, compartida con varios correos
    (`shared_emails` o `share_all`). Su identidad es `(owner, kind, name)`.
  · `space` / `workflow` — un grant por invitado, con el id remoto del recurso,
    los permisos por acción y el estado de aceptación. Su identidad es
    `(owner, kind, resource_id, grantee_email)`, para no pisar el grant de otro
    invitado al compartir el mismo recurso.

La vista se auto-scopea al propio usuario (`rbac_bypass`): sólo devuelve lo que
él publicó y lo que le compartieron explícitamente, nunca el resto del catálogo.
"""
import json
import re
import uuid as uuidlib

from django.db import connection
from django.http import HttpResponse
from django.utils.html import escape
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.renderers import StaticHTMLRenderer
from rest_framework.response import Response

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

#: Agentes/skills: una fila por recurso con varios destinatarios.
AGENT_KINDS = ("agent", "skill")
#: Spaces/Work Flows: un grant por invitado, con id remoto y permisos.
GRANT_KINDS = ("space", "workflow")
#: Todas las familias publicables.
ALL_KINDS = AGENT_KINDS + GRANT_KINDS
#: Estados de un grant de Space/Work Flow.
GRANT_STATUSES = ("pending", "active", "revoked")

#: Columnas que devuelven `list` y `create`.
ROW_COLUMNS = (
    "id::text, kind, owner_email, company_id, name, payload, share_all, "
    "shared_emails, resource_id, permissions, status, created_at, updated_at"
)


def _dicts(cursor):
    """Filas del cursor como diccionarios, con las columnas del SELECT.

    El cursor crudo devuelve las columnas `jsonb` como texto; `payload` se
    normaliza a objeto para que el harness (y el cliente) lean su contenido.
    """
    columns = [column[0] for column in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    for row in rows:
        payload = row.get("payload")
        if isinstance(payload, str):
            try:
                row["payload"] = json.loads(payload)
            except (TypeError, ValueError):
                pass
    return rows


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


def _normalize_permissions(raw):
    """Permisos como lista de strings sin duplicados, o `None` si no es lista."""
    if not isinstance(raw, (list, tuple)):
        return None
    result = []
    for candidate in raw:
        permission = str(candidate).strip()
        if permission and permission not in result:
            result.append(permission)
    return result


def _accept_page(title, message):
    """Página mínima de confirmación para el enlace de aceptación del correo."""
    return (
        '<!doctype html><html lang="es"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{escape(title)}</title></head>"
        '<body style="font-family:system-ui,-apple-system,sans-serif;background:#151517;'
        'color:#f9fafb;display:flex;align-items:center;justify-content:center;'
        'min-height:100vh;margin:0"><main style="max-width:32rem;padding:2rem;text-align:center">'
        f'<h1 style="font-size:1.25rem">{escape(title)}</h1>'
        f'<p style="color:#adb2b8">{escape(message)}</p></main></body></html>'
    )


class HarnessShareViewSet(viewsets.ViewSet):
    """Recursos del harness compartidos por el usuario o con él.

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
                f"""
                SELECT {ROW_COLUMNS}
                  FROM core.harness_share
                 WHERE owner_email = %s
                 ORDER BY updated_at DESC
                """,
                [email],
            )
            outgoing = _dicts(cursor)
            cursor.execute(
                f"""
                SELECT {ROW_COLUMNS}
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
        if kind not in ALL_KINDS:
            return Response({"detail": "kind debe ser 'agent', 'skill', 'space' o 'workflow'."}, status=400)
        name = str(data.get("name", "")).strip()
        if not name:
            return Response({"detail": "name es obligatorio."}, status=400)
        payload = data.get("payload", {})
        if not isinstance(payload, dict):
            return Response({"detail": "payload debe ser un objeto JSON."}, status=400)
        shared_emails = _normalize_emails(data.get("shared_emails") or [])
        companies = _viewer_companies(request)
        company_id = companies[0] if companies else None

        if kind in GRANT_KINDS:
            return self._create_grant(
                data, kind, name, payload, shared_emails, email, company_id,
            )
        return self._create_resource(
            data, kind, name, payload, shared_emails, email, company_id,
        )

    def _create_resource(self, data, kind, name, payload, shared_emails, email, company_id):
        """Publica un agente/skill (una fila por recurso, varios destinatarios)."""
        share_all = bool(data.get("share_all", False))
        if not share_all and not shared_emails:
            return Response(
                {"detail": "Comparte con al menos un correo o con toda tu empresa."},
                status=400,
            )
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO core.harness_share
                       (id, kind, owner_email, company_id, name, payload, share_all, shared_emails)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (owner_email, kind, name) WHERE kind IN ('agent', 'skill')
                DO UPDATE SET payload = EXCLUDED.payload,
                              share_all = EXCLUDED.share_all,
                              shared_emails = EXCLUDED.shared_emails,
                              company_id = EXCLUDED.company_id,
                              updated_at = now()
                RETURNING {ROW_COLUMNS}
                """,
                [
                    str(uuidlib.uuid4()), kind, email, company_id, name,
                    json.dumps(payload), share_all, shared_emails,
                ],
            )
            row = _dicts(cursor)[0]
        return Response(row, status=201)

    def _create_grant(self, data, kind, name, payload, shared_emails, email, company_id):
        """Publica un grant de Space/Work Flow (id remoto, permisos y estado)."""
        resource_id = str(data.get("resource_id", "")).strip()
        if not resource_id:
            return Response({"detail": "resource_id es obligatorio para un Space o Work Flow."}, status=400)
        if not shared_emails:
            return Response({"detail": "Comparte con al menos un correo."}, status=400)
        permissions = _normalize_permissions(data.get("permissions") or [])
        if permissions is None:
            return Response({"detail": "permissions debe ser una lista."}, status=400)
        status_value = str(data.get("status", "pending")).strip().lower()
        if status_value not in GRANT_STATUSES:
            status_value = "pending"
        grantee_email = shared_emails[0]
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO core.harness_share
                       (id, kind, owner_email, company_id, name, payload, share_all,
                        shared_emails, resource_id, permissions, status, grantee_email)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, false,
                        %s, %s, %s, %s, %s)
                ON CONFLICT (owner_email, kind, resource_id, grantee_email) WHERE kind IN ('space', 'workflow')
                DO UPDATE SET name = EXCLUDED.name,
                              payload = EXCLUDED.payload,
                              shared_emails = EXCLUDED.shared_emails,
                              permissions = EXCLUDED.permissions,
                              status = EXCLUDED.status,
                              company_id = EXCLUDED.company_id,
                              updated_at = now()
                RETURNING {ROW_COLUMNS}
                """,
                [
                    str(uuidlib.uuid4()), kind, email, company_id, name,
                    json.dumps(payload), shared_emails, resource_id,
                    permissions, status_value, grantee_email,
                ],
            )
            row = _dicts(cursor)[0]
        return Response(row, status=201)

    @action(detail=False, methods=["post"], url_path="republish")
    def republish(self, request):
        """Reemplaza el snapshot de los grants de un recurso, sin tocar estado.

        El dueño refresca el contenido que viaja a sus invitados; la identidad
        del grant, sus permisos y su estado de aceptación quedan intactos.
        """
        email = _viewer_email(request)
        if not email:
            return Response({"detail": "La identidad no tiene correo."}, status=400)
        data = request.data or {}
        kind = str(data.get("kind", "")).strip().lower()
        if kind not in GRANT_KINDS:
            return Response({"detail": "kind debe ser 'space' o 'workflow'."}, status=400)
        resource_id = str(data.get("resource_id", "")).strip()
        if not resource_id:
            return Response({"detail": "resource_id es obligatorio."}, status=400)
        payload = data.get("payload", {})
        if not isinstance(payload, dict):
            return Response({"detail": "payload debe ser un objeto JSON."}, status=400)
        name = str(data.get("name", "")).strip()
        if len(name) > 200:
            name = name[:200]
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE core.harness_share
                   SET payload = %s::jsonb,
                       name = CASE WHEN %s = '' THEN name ELSE %s END,
                       updated_at = now()
                 WHERE owner_email = %s AND kind = %s AND resource_id = %s
                """,
                [json.dumps(payload), name, name, email, kind, resource_id],
            )
            updated = cursor.rowcount
        return Response({"updated": updated})

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

    @action(detail=False, methods=["get"], url_path="accept",
            authentication_classes=[], permission_classes=[AllowAny],
            renderer_classes=[StaticHTMLRenderer])
    def accept(self, request):
        """Acepta un grant de Space/Work Flow desde el enlace del correo.

        El id de la fila viaja sólo en el correo del invitado, así que actúa
        como secreto del enlace; no requiere sesión para no obligar a iniciar
        sesión en la consola desde el navegador antes de aceptar.
        """
        grant_id = str(request.query_params.get("grant", "")).strip()
        if not grant_id:
            return HttpResponse(
                _accept_page("Enlace inválido", "Falta el identificador del grant."),
                status=400, content_type="text/html; charset=utf-8",
            )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE core.harness_share
                   SET status = 'active', accepted_at = now(), updated_at = now()
                 WHERE id::text = %s AND kind IN ('space', 'workflow')
                RETURNING name
                """,
                [grant_id],
            )
            row = cursor.fetchone()
        if row is None:
            return HttpResponse(
                _accept_page(
                    "Grant no encontrado",
                    "El enlace no es válido, ya fue aceptado o el recurso no es un Space/Work Flow.",
                ),
                status=404, content_type="text/html; charset=utf-8",
            )
        return HttpResponse(
            _accept_page("Acceso aceptado", f"Ya puedes usar «{row[0]}»."),
            status=200, content_type="text/html; charset=utf-8",
        )
