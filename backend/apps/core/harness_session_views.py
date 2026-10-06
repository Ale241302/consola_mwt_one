"""MWT.ONE · apps.core.harness_session_views — sesiones compartidas de un Space.

El harness DeepSeek corre aislado por usuario. Al compartir un Space, su dueño
publica aquí las sesiones de conversación de esa área para que los miembros del
Space las lean. La consola es el transporte entre hosts: el autor hace POST, y
cada miembro hace GET para importar lo que le compartieron.

La vista se auto-scopea: devuelve las sesiones de los Spaces que el usuario
puede ver (es dueño del grant, o es el invitado con la aceptación activa) y
nunca las sesiones de un Space ajeno.
"""
import uuid as uuidlib

from django.db import connection
from rest_framework import viewsets
from rest_framework.response import Response

#: Columnas que devuelven `list` y `create`.
ROW_COLUMNS = (
    "id::text, space_id, session_id, owner_email, company_id, title, "
    "workspace_id, message_count, content, created_at, updated_at"
)


def _viewer_email(request):
    """Correo canónico (minúsculas) del usuario autenticado."""
    return (getattr(request.user, "email", "") or "").strip().lower()


def _viewer_companies(request):
    """Empresas del usuario, en minúsculas, para el scope de empresa."""
    return [str(company).lower() for company in (getattr(request.user, "legal_entity_ids", None) or []) if str(company).strip()]


def _int_or_zero(raw):
    """Entero válido, o 0 cuando falta o no es numérico."""
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return 0


class HarnessSessionViewSet(viewsets.ViewSet):
    """Sesiones de conversación compartidas en los Spaces del usuario.

    Rutas (prefijo `/api/harness/`):
      · `GET    /api/harness/sessions/`        → `{incoming}` de los Spaces visibles.
      · `POST   /api/harness/sessions/`        → publica o actualiza una sesión propia.
      · `DELETE /api/harness/sessions/<uuid>/` → retira una sesión propia.
    """

    #: La vista sólo toca lo del propio usuario; no requiere módulo en el RBAC.
    rbac_bypass = True

    def list(self, request):
        email = _viewer_email(request)
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT {ROW_COLUMNS}
                  FROM core.harness_shared_session s
                 WHERE s.owner_email <> %s
                   AND EXISTS (
                         SELECT 1
                           FROM core.harness_share g
                          WHERE g.kind = 'space'
                            AND g.resource_id = s.space_id
                            AND ( g.owner_email = %s
                                  OR (g.grantee_email = %s AND g.status = 'active') )
                   )
                 ORDER BY s.updated_at DESC
                """,
                [email, email, email],
            )
            columns = [column[0] for column in cursor.description]
            incoming = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return Response({"incoming": incoming})

    def create(self, request):
        email = _viewer_email(request)
        if not email:
            return Response({"detail": "La identidad no tiene correo."}, status=400)
        data = request.data or {}
        space_id = str(data.get("space_id", "")).strip()
        session_id = str(data.get("session_id", "")).strip()
        if not space_id or not session_id:
            return Response({"detail": "space_id y session_id son obligatorios."}, status=400)
        content = data.get("content", "")
        if not isinstance(content, str):
            content = str(content)
        companies = _viewer_companies(request)
        company_id = companies[0] if companies else None
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO core.harness_shared_session
                       (id, space_id, session_id, owner_email, company_id, title,
                        workspace_id, message_count, content, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                        COALESCE(%s::timestamptz, now()), COALESCE(%s::timestamptz, now()))
                ON CONFLICT (owner_email, space_id, session_id)
                DO UPDATE SET title = EXCLUDED.title,
                              workspace_id = EXCLUDED.workspace_id,
                              message_count = EXCLUDED.message_count,
                              content = EXCLUDED.content,
                              company_id = EXCLUDED.company_id,
                              updated_at = now()
                RETURNING {ROW_COLUMNS}
                """,
                [
                    str(uuidlib.uuid4()), space_id, session_id, email, company_id,
                    str(data.get("title", "") or ""),
                    (None if data.get("workspace_id") in (None, "") else str(data.get("workspace_id"))),
                    _int_or_zero(data.get("message_count")),
                    content,
                    data.get("created_at"),
                    data.get("updated_at"),
                ],
            )
            columns = [column[0] for column in cursor.description]
            row = dict(zip(columns, cursor.fetchone()))
        return Response(row, status=201)

    def destroy(self, request, pk=None):
        email = _viewer_email(request)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM core.harness_shared_session s
                 WHERE s.id::text = %s
                   AND ( s.owner_email = %s
                         OR EXISTS (
                              SELECT 1 FROM core.harness_share g
                               WHERE g.kind = 'space'
                                 AND g.resource_id = s.space_id
                                 AND g.owner_email = %s ) )
                """,
                [str(pk), email, email],
            )
            removed = cursor.rowcount
        if not removed:
            return Response({"detail": "No existe o no es tuyo."}, status=404)
        return Response(status=204)
