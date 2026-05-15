"""
apps.transfers.views_builder_artifacts — Builder artifacts asociados a
una transferencia. Sprint 2026-05-14 · Fase 16.

Reutiliza la tabla existente `nodos.builder_artifact_instance` ampliada
con la columna `transferencia_id` (SQL B3). Cada artefacto creado desde
el detalle de una transferencia se persiste con `nodo_id = destino_id`
y `transferencia_id = trf_id`, lo que permite que:

  · La tab "Artefactos" del nodo destino los siga viendo.
  · El detalle de la transferencia los filtre por transferencia_id.
  · El expediente asociado los siga viendo en su tab Artefactos.

Rutas (montadas por apps.transfers.urls):
  GET    /api/transferencias/{trf_id}/builder-artifacts/
  POST   /api/transferencias/{trf_id}/builder-artifacts/
  GET    /api/transferencias/{trf_id}/builder-artifacts/{art_id}/
  PATCH  /api/transferencias/{trf_id}/builder-artifacts/{art_id}/
  DELETE /api/transferencias/{trf_id}/builder-artifacts/{art_id}/
  GET    /api/transferencias/{trf_id}/builder-artifacts/available-lines/
  GET    /api/transferencias/{trf_id}/builder-artifacts/expedientes/

El picker de scope se alimenta de las **lineas de la transferencia**
(no del inventario del nodo) — vía join transfers.linea ×
inventario.expediente_nodo_assignment para conocer el expediente_id
de cada (producto, talla).
"""
import uuid
import logging

from django.db import connection, transaction
from rest_framework import status as drf_status
from rest_framework.decorators import permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.nodos.models import (
    NodoBuilderArtifactInstance, NodoBuilderArtifactLine,
)
from apps.nodos.serializers import (
    NodoBuilderArtifactInstanceSerializer,
    NodoBuilderArtifactInstanceUpdateSerializer,
)
from apps.nodos.views_builder_artifacts import (
    _lines_payload_for, _save_lines_for,
)
from .models import Transferencia
from .views import _resolve_trf

log = logging.getLogger(__name__)


def _resolve_destino_id(trf_id):
    """Devuelve destino_id de la transferencia o None si no existe."""
    try:
        t = _resolve_trf(trf_id)
    except Transferencia.DoesNotExist:
        return None
    return t.destino_id


# ════════════════════════════════════════════════════════════
# GET / POST /api/transferencias/{trf_id}/builder-artifacts/
# ════════════════════════════════════════════════════════════
class TransferBuilderArtifactsListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, trf_id):
        try:
            uuid.UUID(str(trf_id))
        except (TypeError, ValueError):
            return Response({"detail": "transferencia_id inválido"}, status=400)

        qs = NodoBuilderArtifactInstance.objects.filter(
            transferencia_id=trf_id, is_active=True,
        ).order_by("-created_at")

        template_id = request.query_params.get("template_id")
        if template_id:
            try:
                qs = qs.filter(template_id=int(template_id))
            except (TypeError, ValueError):
                pass

        data = NodoBuilderArtifactInstanceSerializer(qs, many=True).data
        if data:
            ids = [str(it["id"]) for it in data]
            sql = """
                SELECT
                    bal.builder_artifact_instance_id::text AS iid,
                    COUNT(*)::int                          AS lines_count,
                    COALESCE(SUM(bal.qty)::int, 0)         AS total_qty
                FROM nodos.builder_artifact_line bal
                WHERE bal.builder_artifact_instance_id = ANY(%(ids)s::uuid[])
                  AND bal.is_active = TRUE
                GROUP BY bal.builder_artifact_instance_id
            """
            with connection.cursor() as c:
                c.execute(sql, {"ids": ids})
                stats = {r[0]: {"lines_count": r[1], "total_qty": r[2]}
                         for r in c.fetchall()}
            for it in data:
                s = stats.get(str(it["id"]), {"lines_count": 0, "total_qty": 0})
                it["lines_count"] = s["lines_count"]
                it["total_qty"]   = s["total_qty"]
        return Response(data)

    def post(self, request, trf_id):
        try:
            uuid.UUID(str(trf_id))
        except (TypeError, ValueError):
            return Response({"detail": "transferencia_id inválido"}, status=400)

        destino_id = _resolve_destino_id(trf_id)
        if not destino_id:
            return Response({"detail": "Transferencia no existe"}, status=404)

        s = NodoBuilderArtifactInstanceSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        user = request.user
        created_by_id   = str(getattr(user, "id", "") or "") or None
        created_by_name = (
            getattr(user, "nombre", None)
            or getattr(user, "username", None)
            or getattr(user, "email", None)
            or "system"
        )

        lines_payload = request.data.get("lines")
        with transaction.atomic():
            instance = s.save(
                id=uuid.uuid4(),
                # Sprint Fase 16 — el artefacto vive en el nodo destino
                # de la transferencia (semánticamente correcto: el stock
                # llega ahí), y queda tagueado con transferencia_id para
                # que el detalle de la transfer lo pueda filtrar.
                nodo_id=uuid.UUID(str(destino_id)),
                transferencia_id=uuid.UUID(str(trf_id)),
                created_by_id=created_by_id,
                created_by_name=created_by_name,
                updated_by_id=created_by_id,
                updated_by_name=created_by_name,
            )
            _save_lines_for(instance, lines_payload, creator_id=created_by_id)

        payload = NodoBuilderArtifactInstanceSerializer(instance).data
        payload["lines"] = _lines_payload_for(instance)
        return Response(payload, status=drf_status.HTTP_201_CREATED)


# ════════════════════════════════════════════════════════════
# GET / PATCH / DELETE /api/transferencias/{trf_id}/builder-artifacts/{art_id}/
# ════════════════════════════════════════════════════════════
class TransferBuilderArtifactDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_or_404(self, trf_id, art_id):
        try:
            return NodoBuilderArtifactInstance.objects.get(
                pk=art_id, transferencia_id=trf_id, is_active=True,
            )
        except NodoBuilderArtifactInstance.DoesNotExist:
            return None

    def get(self, request, trf_id, art_id):
        obj = self._get_or_404(trf_id, art_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)
        payload = NodoBuilderArtifactInstanceSerializer(obj).data
        payload["lines"] = _lines_payload_for(obj)
        return Response(payload)

    def patch(self, request, trf_id, art_id):
        obj = self._get_or_404(trf_id, art_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)
        s = NodoBuilderArtifactInstanceUpdateSerializer(
            obj, data=request.data, partial=True,
        )
        s.is_valid(raise_exception=True)

        user = request.user
        updated_by_id   = str(getattr(user, "id", "") or "") or None
        updated_by_name = (
            getattr(user, "nombre", None)
            or getattr(user, "username", None)
            or getattr(user, "email", None)
            or "system"
        )
        lines_payload = request.data.get("lines")
        with transaction.atomic():
            s.save(updated_by_id=updated_by_id, updated_by_name=updated_by_name)
            if lines_payload is not None:
                _save_lines_for(obj, lines_payload, creator_id=updated_by_id)
        obj.refresh_from_db()
        payload = NodoBuilderArtifactInstanceSerializer(obj).data
        payload["lines"] = _lines_payload_for(obj)
        return Response(payload)

    def delete(self, request, trf_id, art_id):
        obj = self._get_or_404(trf_id, art_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)
        with transaction.atomic():
            obj.is_active = False
            obj.save(update_fields=["is_active", "updated_at"])
            NodoBuilderArtifactLine.objects.filter(
                builder_artifact_instance_id=obj.id, is_active=True,
            ).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# GET /api/transferencias/{trf_id}/builder-artifacts/available-lines/
#     ?template_id=N&expediente_ids=A,B&exclude_instance_id=X
#
# Líneas del PICKER del scope modal: vienen de las lineas de la
# transferencia (no del stock del nodo). Cada (expediente, producto,
# talla) sale con qty_base = qty_transfer (lo que se movió) y
# qty_disponible = qty_base − qty_usado_por_artefactos_mismo_template.
# ════════════════════════════════════════════════════════════
class TransferBuilderArtifactAvailableLinesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, trf_id):
        try:
            uuid.UUID(str(trf_id))
        except (TypeError, ValueError):
            return Response({"detail": "transferencia_id inválido"}, status=400)

        template_id = request.query_params.get("template_id")
        template_id_int = None
        if template_id:
            try:
                template_id_int = int(template_id)
            except (TypeError, ValueError):
                return Response({"detail": "template_id debe ser entero"}, status=400)

        raw_exp_ids = (request.query_params.get("expediente_ids") or "").strip()
        exp_ids = [s.strip() for s in raw_exp_ids.split(",") if s.strip()]
        exclude_instance_id = request.query_params.get("exclude_instance_id") or None

        # Base: lineas de la transferencia + expediente_id resuelto vía
        # assignment con transferencia_id. Si el assignment no existe
        # (transferencia muy vieja sin trazabilidad), la fila se omite.
        # Descuento: instancias activas del mismo template_id en esta
        # MISMA transferencia (excluyendo la instancia que se está
        # editando si se pasó exclude_instance_id).
        sql = """
            WITH base AS (
                SELECT
                    a.expediente_id,
                    e.codigo                                       AS expediente_codigo,
                    a.producto_id,
                    a.talla,
                    SUM(a.qty_asignada)::int                       AS qty_base,
                    ln.sku                                         AS sku,
                    COALESCE(p.nombre, p.descripcion, ln.sku, '—') AS nombre
                FROM inventario.expediente_nodo_assignment a
                LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
                LEFT JOIN productos.producto     p ON p.id = a.producto_id
                LEFT JOIN LATERAL (
                    SELECT ln.sku
                    FROM expedientes.linea ln
                    WHERE ln.producto_id   = a.producto_id
                      AND ln.expediente_id = a.expediente_id
                      AND COALESCE(ln.size,'') = COALESCE(a.talla,'')
                      AND ln.is_active = TRUE
                    LIMIT 1
                ) ln ON TRUE
                WHERE a.transferencia_id = %(trf_id)s::uuid
                  AND a.is_active        = TRUE
                  AND a.nodo_id          = (SELECT destino_id
                                            FROM transfers.transferencia
                                            WHERE id = %(trf_id)s::uuid)
                  AND (
                       %(has_exp_filter)s = FALSE
                    OR a.expediente_id = ANY(%(exp_ids)s::uuid[])
                  )
                GROUP BY
                    a.expediente_id, e.codigo,
                    a.producto_id, a.talla,
                    ln.sku, p.nombre, p.descripcion
            ),
            usado AS (
                SELECT
                    bal.expediente_id,
                    bal.producto_id,
                    COALESCE(bal.talla, '') AS talla,
                    SUM(bal.qty)::int       AS qty_usado
                FROM nodos.builder_artifact_line bal
                JOIN nodos.builder_artifact_instance bai
                  ON bai.id = bal.builder_artifact_instance_id
                WHERE bai.transferencia_id = %(trf_id)s::uuid
                  AND bal.is_active        = TRUE
                  AND bai.is_active        = TRUE
                  AND %(template_id)s::int IS NOT NULL
                  AND bai.template_id      = %(template_id)s::int
                  AND (
                       %(exclude_iid)s::uuid IS NULL
                    OR bai.id <> %(exclude_iid)s::uuid
                  )
                GROUP BY bal.expediente_id, bal.producto_id, bal.talla
            )
            SELECT
                b.expediente_id::text                 AS expediente_id,
                b.expediente_codigo,
                b.producto_id::text                   AS producto_id,
                b.sku,
                b.nombre,
                b.talla,
                b.qty_base,
                COALESCE(u.qty_usado, 0)              AS qty_usado,
                (b.qty_base - COALESCE(u.qty_usado, 0))::int
                                                      AS qty_disponible
            FROM base b
            LEFT JOIN usado u
              ON u.expediente_id = b.expediente_id
             AND u.producto_id   = b.producto_id
             AND u.talla         = COALESCE(b.talla, '')
            ORDER BY b.expediente_codigo, b.sku, b.talla
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {
                    "trf_id":         trf_id,
                    "template_id":    template_id_int,
                    "has_exp_filter": bool(exp_ids),
                    "exp_ids":        exp_ids,
                    "exclude_iid":    exclude_instance_id,
                })
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("transfer available_lines SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response(rows)


# ════════════════════════════════════════════════════════════
# GET /api/transferencias/{trf_id}/builder-artifacts/expedientes/
# Lista de expedientes que participan en esta transferencia (chips del
# Modal 1 del scope picker). Cada item incluye codigo + proforma + qty
# total movida para mostrar en el chip.
# ════════════════════════════════════════════════════════════
class TransferBuilderArtifactExpedientesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, trf_id):
        try:
            uuid.UUID(str(trf_id))
        except (TypeError, ValueError):
            return Response({"detail": "transferencia_id inválido"}, status=400)

        sql = """
            SELECT
                a.expediente_id::text                          AS id,
                e.codigo                                       AS codigo,
                pf.codigo                                      AS proforma_codigo,
                COUNT(*)::int                                  AS lines_count,
                SUM(a.qty_asignada)::int                       AS qty_total
            FROM inventario.expediente_nodo_assignment a
            LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
            LEFT JOIN LATERAL (
                SELECT d.codigo
                FROM expedientes.documento d
                WHERE d.expediente_id = e.id
                  AND d.kind = 'PROFORMA'
                  AND d.is_active = TRUE
                  AND d.codigo IS NOT NULL AND d.codigo <> ''
                ORDER BY d.created_at DESC LIMIT 1
            ) pf ON TRUE
            WHERE a.transferencia_id = %(trf_id)s::uuid
              AND a.is_active        = TRUE
              AND a.nodo_id          = (SELECT destino_id
                                        FROM transfers.transferencia
                                        WHERE id = %(trf_id)s::uuid)
            GROUP BY a.expediente_id, e.codigo, pf.codigo
            HAVING SUM(a.qty_asignada) > 0
            ORDER BY e.codigo
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {"trf_id": trf_id})
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("transfer artifact expedientes SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response(rows)
