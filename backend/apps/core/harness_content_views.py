"""MWT.ONE · apps.core.harness_content_views — contenido compartido de un Space.

El harness DeepSeek corre aislado por usuario. Al compartir un Space, sus
miembros publican aquí su propia memoria, contexto, Work Flows y rutinas para
que el resto de invitados del Space los lean. La consola es el transporte entre
hosts: el autor hace POST con su conjunto completo, cada miembro hace GET para
importar lo que le compartieron, y el dueño del Space (o el propio autor) puede
retirar una fila.

La vista se auto-scopea: devuelve los ítems de los Spaces que el usuario puede
ver (es dueño del grant, o es el invitado con la aceptación activa) y nunca el
contenido de un Space ajeno. El POST reemplaza por completo el conjunto del
autor para ese Space: las filas que no viajan en el lote se podan.
"""
import json
import uuid as uuidlib

from django.db import connection
from rest_framework import viewsets
from rest_framework.response import Response

#: Tipos de ítem publicables en un Space.
CONTENT_KINDS = ("memory", "context", "workflow", "routine")

#: Columnas que devuelven `list` y `create`.
ROW_COLUMNS = (
    "id::text, space_id, kind, item_key, author_email, company_id, "
    "payload, created_at, updated_at"
)


def _dicts(cursor):
    """Filas del cursor como diccionarios, con las columnas del SELECT.

    El cursor crudo devuelve la columna `jsonb` `payload` como texto; se
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


class HarnessContentViewSet(viewsets.ViewSet):
    """Memoria/contexto/Work Flows/rutinas compartidos en los Spaces del usuario.

    Rutas (prefijo `/api/harness/`):
      · `GET    /api/harness/contents/`        → `{incoming}` de los Spaces visibles.
      · `POST   /api/harness/contents/`        → publica y reemplaza el lote propio.
      · `DELETE /api/harness/contents/<uuid>/` → retira una fila propia (o del Space).
    """

    #: La vista sólo toca lo del propio usuario; no requiere módulo en el RBAC.
    rbac_bypass = True

    def list(self, request):
        email = _viewer_email(request)
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT {ROW_COLUMNS}
                  FROM core.harness_shared_content c
                 WHERE c.author_email <> %s
                   AND EXISTS (
                         SELECT 1
                           FROM core.harness_share g
                          WHERE g.kind = 'space'
                            AND g.resource_id = c.space_id
                            AND ( g.owner_email = %s
                                  OR (g.grantee_email = %s AND g.status = 'active') )
                   )
                 ORDER BY c.updated_at DESC
                """,
                [email, email, email],
            )
            incoming = _dicts(cursor)
        return Response({"incoming": incoming})

    def create(self, request):
        email = _viewer_email(request)
        if not email:
            return Response({"detail": "La identidad no tiene correo."}, status=400)
        data = request.data or {}
        space_id = str(data.get("space_id", "")).strip()
        if not space_id:
            return Response({"detail": "space_id es obligatorio."}, status=400)
        items = data.get("items")
        if not isinstance(items, list):
            return Response({"detail": "items debe ser una lista."}, status=400)
        normalized = []
        for item in items:
            if not isinstance(item, dict):
                return Response({"detail": "Cada ítem debe ser un objeto JSON."}, status=400)
            kind = str(item.get("kind", "")).strip().lower()
            if kind not in CONTENT_KINDS:
                return Response(
                    {"detail": "kind debe ser 'memory', 'context', 'workflow' o 'routine'."},
                    status=400,
                )
            item_key = str(item.get("item_key", "")).strip()
            if not item_key:
                return Response({"detail": "item_key es obligatorio en cada ítem."}, status=400)
            payload = item.get("payload", {})
            if not isinstance(payload, dict):
                return Response({"detail": "payload debe ser un objeto JSON."}, status=400)
            normalized.append((kind, item_key, payload))

        companies = _viewer_companies(request)
        company_id = companies[0] if companies else None
        with connection.cursor() as cursor:
            rows = []
            for kind, item_key, payload in normalized:
                cursor.execute(
                    f"""
                    INSERT INTO core.harness_shared_content
                           (id, space_id, kind, item_key, author_email, company_id, payload)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (space_id, kind, author_email, item_key)
                    DO UPDATE SET payload = EXCLUDED.payload,
                                  company_id = EXCLUDED.company_id,
                                  updated_at = now()
                    RETURNING {ROW_COLUMNS}
                    """,
                    [
                        str(uuidlib.uuid4()), space_id, kind, item_key,
                        email, company_id, json.dumps(payload),
                    ],
                )
                rows.extend(_dicts(cursor))
            # Reemplazo completo: poda las filas que el lote ya no incluye.
            cursor.execute(
                """
                DELETE FROM core.harness_shared_content c
                 WHERE c.space_id = %s
                   AND c.author_email = %s
                   AND NOT EXISTS (
                         SELECT 1
                           FROM unnest(%s::text[], %s::text[]) AS s(kind, item_key)
                          WHERE s.kind = c.kind AND s.item_key = c.item_key
                   )
                """,
                [
                    space_id, email,
                    [kind for kind, _, _ in normalized],
                    [item_key for _, item_key, _ in normalized],
                ],
            )
        return Response({"rows": rows}, status=201)

    def destroy(self, request, pk=None):
        email = _viewer_email(request)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM core.harness_shared_content c
                 WHERE c.id::text = %s
                   AND ( c.author_email = %s
                         OR EXISTS (
                              SELECT 1 FROM core.harness_share g
                               WHERE g.kind = 'space'
                                 AND g.resource_id = c.space_id
                                 AND g.owner_email = %s ) )
                """,
                [str(pk), email, email],
            )
            removed = cursor.rowcount
        if not removed:
            return Response({"detail": "No existe o no es tuyo."}, status=404)
        return Response(status=204)
