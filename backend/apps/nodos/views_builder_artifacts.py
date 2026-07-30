"""
apps.nodos.views_builder_artifacts — Builder artifacts por nodo.

Sprint 2026-05-11 · Fase 4 — espejo del módulo
`apps.expedientes.views_builder_artifacts` pero parametrizado para
`nodos.builder_artifact_instance`.

Rutas (montadas por apps.nodos.urls):
  GET    /api/nodos/{nodo_id}/builder-artifacts/
  POST   /api/nodos/{nodo_id}/builder-artifacts/
  PATCH  /api/nodos/{nodo_id}/builder-artifacts/{artifact_id}/
  DELETE /api/nodos/{nodo_id}/builder-artifacts/{artifact_id}/  (soft)

El proxy real al Builder externo (`/api/builder/templates/`) ya existe
en `apps.expedientes.views_builder_artifacts` — lo seguimos usando desde
allá; este módulo solo gestiona las instancias *persistidas* en
`nodos.builder_artifact_instance`. El frontend hace ambas llamadas
secuencialmente (1: lista templates → 2: crea instancia con template_id).
"""
import uuid
import logging

from django.db import connection, transaction
from rest_framework import status as drf_status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Nodo, NodoBuilderArtifactInstance, NodoBuilderArtifactLine,
)
from .serializers import (
    NodoBuilderArtifactInstanceSerializer,
    NodoBuilderArtifactInstanceUpdateSerializer,
)

log = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════
# GET / POST /api/nodos/{nodo_id}/builder-artifacts/
# ════════════════════════════════════════════════════════════
class NodoBuilderArtifactsListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    # ── List ──────────────────────────────────────────
    def get(self, request, nodo_id):
        try:
            uuid.UUID(str(nodo_id))
        except (TypeError, ValueError):
            return Response({"detail": "nodo_id inválido"}, status=400)

        qs = NodoBuilderArtifactInstance.objects.filter(
            nodo_id=nodo_id, is_active=True,
        ).order_by("-created_at")

        # Sprint 2026-07-30 · Visibilidad cliente: los usuarios con rol
        # client_b2b solo ven artefactos marcados como publicados. Staff
        # interno (admin/manager/operator/...) los ve todos.
        if getattr(request.user, "is_client", False):
            qs = qs.filter(publicado=True)

        template_id = request.query_params.get("template_id")
        if template_id:
            try:
                qs = qs.filter(template_id=int(template_id))
            except (TypeError, ValueError):
                pass

        # Sprint 2026-05-26 (CEO) - filtrar template_id=13 (Factura
        # Comercial) cuando el viewer no esta autorizado para el
        # operating_company del nodo. Mismo principio de visibility
        # POL_R3 que aplicamos en expedientes/pagos de factura.
        try:
            from apps.core.scoped_querysets import _is_bypass as _isb, _scope_ids as _sids
            user = request.user
            if not _isb(user):
                allowed_factura = False
                try:
                    op_id = (Nodo.objects.filter(id=nodo_id)
                             .values_list("operating_company_id", flat=True).first())
                except Exception:
                    op_id = None
                if op_id:
                    scope = [str(s) for s in (_sids(user) or [])]
                    if str(op_id) in scope:
                        allowed_factura = True
                if not allowed_factura:
                    qs = qs.exclude(template_id=13)
        except Exception:
            pass  # defensivo: si falla la visibility, NO bloqueamos la respuesta

        # Sprint 2026-05-11 fase 5 · enriquecemos cada item con el
        # conteo de líneas asociadas y el total de unidades, para que
        # el FE muestre el alcance de cada artefacto en su card.
        data = NodoBuilderArtifactInstanceSerializer(qs, many=True).data
        if data:
            ids = [str(it["id"]) for it in data]
            sql = """
                SELECT
                    bal.builder_artifact_instance_id::text AS iid,
                    -- Sprint 2026-07-30 (CEO) - contar SKUs distintos, no
                    -- filas: varias tallas del mismo SKU cuentan 1 línea.
                    COUNT(DISTINCT bal.producto_id)::int   AS lines_count,
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

    # ── Create ────────────────────────────────────────
    def post(self, request, nodo_id):
        try:
            uuid.UUID(str(nodo_id))
        except (TypeError, ValueError):
            return Response({"detail": "nodo_id inválido"}, status=400)

        # Defensa en profundidad: el nodo debe existir y estar activo.
        if not Nodo.objects.filter(pk=nodo_id, is_active=True).exists():
            return Response({"detail": "Nodo no existe"}, status=404)

        s = NodoBuilderArtifactInstanceSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        # Capturar autor (best-effort — el JWT siempre trae user.id si
        # el usuario está autenticado, pero algunos contextos legacy
        # pueden traer un AnonymousUser; protegemos con getattr).
        user = request.user
        created_by_id   = str(getattr(user, "id", "") or "") or None
        created_by_name = (
            getattr(user, "nombre", None)
            or getattr(user, "username", None)
            or getattr(user, "email", None)
            or "system"
        )

        # Sprint 2026-05-11 fase 5 · Si el cliente manda `lines: [...]`,
        # se persisten en nodos.builder_artifact_line junto con la
        # instancia, en la misma transacción.
        lines_payload = request.data.get("lines")
        with transaction.atomic():
            instance = s.save(
                id=uuid.uuid4(),
                nodo_id=uuid.UUID(str(nodo_id)),
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
# PATCH / DELETE /api/nodos/{nodo_id}/builder-artifacts/{artifact_id}/
# ════════════════════════════════════════════════════════════
class NodoBuilderArtifactDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_or_404(self, nodo_id, artifact_id):
        try:
            return NodoBuilderArtifactInstance.objects.get(
                pk=artifact_id, nodo_id=nodo_id, is_active=True,
            )
        except NodoBuilderArtifactInstance.DoesNotExist:
            return None

    def get(self, request, nodo_id, artifact_id):
        obj = self._get_or_404(nodo_id, artifact_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)
        payload = NodoBuilderArtifactInstanceSerializer(obj).data
        # Sprint 2026-05-11 fase 5 · incluimos las líneas asociadas para
        # que el FE pueda renderizar el modal de edición pre-llenado.
        payload["lines"] = _lines_payload_for(obj)
        return Response(payload)

    def patch(self, request, nodo_id, artifact_id):
        obj = self._get_or_404(nodo_id, artifact_id)
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
        # Sprint 2026-05-11 fase 5 · si el cliente manda `lines: [...]`,
        # se reemplazan atómicamente en la misma transacción.
        lines_payload = request.data.get("lines")
        with transaction.atomic():
            s.save(updated_by_id=updated_by_id, updated_by_name=updated_by_name)
            if lines_payload is not None:
                _save_lines_for(obj, lines_payload, creator_id=updated_by_id)
        # Devolvemos la entidad completa (no solo lo modificado) para que
        # el FE pueda refrescar el modal con los timestamps actualizados.
        obj.refresh_from_db()
        payload = NodoBuilderArtifactInstanceSerializer(obj).data
        payload["lines"] = _lines_payload_for(obj)
        return Response(payload)

    def delete(self, request, nodo_id, artifact_id):
        obj = self._get_or_404(nodo_id, artifact_id)
        if obj is None:
            return Response({"detail": "Artefacto no existe"}, status=404)
        # Soft-delete (convención MWT — preserva trazabilidad).
        # También soft-deleteamos sus líneas asociadas para que el
        # "descuento por template" deje de afectar la disponibilidad.
        with transaction.atomic():
            obj.is_active = False
            obj.save(update_fields=["is_active", "updated_at"])
            NodoBuilderArtifactLine.objects.filter(
                builder_artifact_instance_id=obj.id, is_active=True,
            ).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Sprint 2026-05-11 · Fase 5
#
# 1) Helpers para enriquecer la respuesta con `lines: [...]`.
# 2) Endpoint GET /available-lines/ con descuento por template.
# 3) Hook que persiste `lines` cuando el cliente las manda en POST/PATCH.
# ════════════════════════════════════════════════════════════

def _lines_payload_for(instance):
    """Devuelve el array `lines` que se incluye en la respuesta de una
    instancia de artefacto, enriquecido con sku/nombre/codigo de
    expediente para que el FE pueda renderizar el modal de edición sin
    fetch extra."""
    if instance is None:
        return []
    sql = """
        SELECT
            l.id::text,
            l.expediente_id::text,
            e.codigo                                  AS expediente_codigo,
            l.producto_id::text,
            ln.sku                                    AS sku,
            COALESCE(p.nombre, p.descripcion, ln.sku, '—') AS nombre,
            l.talla,
            l.qty
        FROM nodos.builder_artifact_line l
        LEFT JOIN expedientes.expediente e  ON e.id  = l.expediente_id
        LEFT JOIN productos.producto    p   ON p.id  = l.producto_id
        LEFT JOIN LATERAL (
            SELECT ln.sku
            FROM expedientes.linea ln
            WHERE ln.producto_id = l.producto_id
              AND ln.expediente_id = l.expediente_id
              AND COALESCE(ln.size,'') = COALESCE(l.talla,'')
              AND ln.is_active = TRUE
            LIMIT 1
        ) ln ON TRUE
        WHERE l.builder_artifact_instance_id = %(iid)s::uuid
          AND l.is_active = TRUE
        ORDER BY e.codigo, ln.sku, l.talla
    """
    with connection.cursor() as c:
        c.execute(sql, {"iid": str(instance.id)})
        cols = [d[0] for d in c.description]
        return [dict(zip(cols, r)) for r in c.fetchall()]


def _save_lines_for(instance, lines_payload, creator_id):
    """Reemplaza atómicamente las líneas activas de una instancia por
    el array que mandó el cliente. Cada item debe tener:
      { expediente_id, producto_id, talla, qty }
    """
    if not isinstance(lines_payload, list):
        return  # No vinieron lines — no se toca nada.

    # Validar cada item antes de tocar BD.
    cleaned = []
    for it in lines_payload:
        try:
            qty = int(it["qty"])
            if qty <= 0:
                continue
            cleaned.append({
                "expediente_id": it["expediente_id"],
                "producto_id":   it["producto_id"],
                "talla":         (it.get("talla") or None),
                "qty":           qty,
            })
        except (KeyError, ValueError, TypeError):
            continue

    with transaction.atomic():
        # Soft-delete de las líneas activas previas — preserva auditoría.
        NodoBuilderArtifactLine.objects.filter(
            builder_artifact_instance_id=instance.id, is_active=True,
        ).update(is_active=False)

        # Bulk create de las nuevas.
        for it in cleaned:
            NodoBuilderArtifactLine.objects.create(
                id=uuid.uuid4(),
                builder_artifact_instance_id=instance.id,
                nodo_id=instance.nodo_id,
                expediente_id=it["expediente_id"],
                producto_id=it["producto_id"],
                talla=it["talla"],
                qty=it["qty"],
                created_by_id=creator_id,
                is_active=True,
            )


# ════════════════════════════════════════════════════════════
# GET /api/nodos/{nodo_id}/builder-artifacts/available-lines/
#     ?template_id=N&expediente_ids=A,B,C&exclude_instance_id=X
# Devuelve las líneas disponibles del nodo para este template, ya
# descontadas por instancias previas del mismo template (excluyendo
# la instancia actual si se está editando).
# ════════════════════════════════════════════════════════════
class NodoBuilderArtifactAvailableLinesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, nodo_id):
        try:
            uuid.UUID(str(nodo_id))
        except (TypeError, ValueError):
            return Response({"detail": "nodo_id inválido"}, status=400)

        # Sprint 2026-05-11 fase 5 fix · template_id es OPCIONAL.
        # En modo create del scope todavía no hay template — devolvemos
        # qty_base sin descuento. Cuando se pasa template_id se aplica
        # el descuento por uso previo del mismo template.
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

        # Lógica:
        # 1) base = cantidades asignadas al nodo desde
        #    inventario.expediente_nodo_assignment (lo que el operador
        #    metió en el wizard de recepción).
        # 2) usado = SUM(qty) de nodos.builder_artifact_line cuyas
        #    instancias están activas, pertenecen al nodo y al template;
        #    se excluye `exclude_instance_id` (caso edit).
        # 3) saldo = base - usado.
        # Si NO hay template_id, el CTE `usado` queda vacío (filtro
        # imposible) y qty_disponible == qty_base.
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
                WHERE a.nodo_id    = %(nodo_id)s::uuid
                  AND a.is_active  = TRUE
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
                -- Si NO hay template_id, este CTE queda vacío
                -- (la condición %(template_id)s IS NULL se cumple
                -- antes del filtro real y no hay rows).
                SELECT
                    bal.expediente_id,
                    bal.producto_id,
                    COALESCE(bal.talla, '') AS talla,
                    SUM(bal.qty)::int        AS qty_usado
                FROM nodos.builder_artifact_line bal
                JOIN nodos.builder_artifact_instance bai
                  ON bai.id = bal.builder_artifact_instance_id
                WHERE bal.nodo_id      = %(nodo_id)s::uuid
                  AND bal.is_active    = TRUE
                  AND bai.is_active    = TRUE
                  AND %(template_id)s::int IS NOT NULL
                  AND bai.template_id  = %(template_id)s::int
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
              ON u.expediente_id   = b.expediente_id
             AND u.producto_id     = b.producto_id
             AND u.talla           = COALESCE(b.talla, '')
            ORDER BY b.expediente_codigo, b.sku, b.talla
        """
        try:
            with connection.cursor() as c:
                c.execute(sql, {
                    "nodo_id":        nodo_id,
                    "template_id":    template_id_int,   # puede ser None
                    "has_exp_filter": bool(exp_ids),
                    "exp_ids":        exp_ids,
                    "exclude_iid":    exclude_instance_id,
                })
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("available_lines SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response(rows)


# ════════════════════════════════════════════════════════════
# Endpoint auxiliar: expedientes asignados al nodo (chips del Modal 1).
# Versión simplificada de la del wizard — sólo devuelve los expedientes
# que tienen al menos UNA línea con qty_disponible > 0 para este
# template. Reutiliza la query de available-lines internamente.
# ════════════════════════════════════════════════════════════
class NodoBuilderArtifactExpedientesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, nodo_id):
        try:
            uuid.UUID(str(nodo_id))
        except (TypeError, ValueError):
            return Response({"detail": "nodo_id inválido"}, status=400)

        template_id = request.query_params.get("template_id")
        try:
            template_id_int = int(template_id) if template_id else None
        except (TypeError, ValueError):
            return Response({"detail": "template_id debe ser entero"}, status=400)

        exclude_instance_id = request.query_params.get("exclude_instance_id") or None

        # Cuando hay template_id, descontamos uso previo. Cuando NO hay,
        # simplemente listamos expedientes con assignments en el nodo.
        if template_id_int is not None:
            sql = """
                WITH base AS (
                    SELECT
                        a.expediente_id,
                        a.producto_id,
                        a.talla,
                        SUM(a.qty_asignada)::int AS qty_base
                    FROM inventario.expediente_nodo_assignment a
                    WHERE a.nodo_id   = %(nodo_id)s::uuid
                      AND a.is_active = TRUE
                    GROUP BY a.expediente_id, a.producto_id, a.talla
                ),
                usado AS (
                    SELECT
                        bal.expediente_id,
                        bal.producto_id,
                        COALESCE(bal.talla, '') AS talla,
                        SUM(bal.qty)::int AS qty_usado
                    FROM nodos.builder_artifact_line bal
                    JOIN nodos.builder_artifact_instance bai
                      ON bai.id = bal.builder_artifact_instance_id
                    WHERE bal.nodo_id     = %(nodo_id)s::uuid
                      AND bal.is_active   = TRUE
                      AND bai.is_active   = TRUE
                      AND bai.template_id = %(template_id)s
                      AND (
                           %(exclude_iid)s::uuid IS NULL
                        OR bai.id <> %(exclude_iid)s::uuid
                      )
                    GROUP BY bal.expediente_id, bal.producto_id, bal.talla
                )
                SELECT DISTINCT
                    e.id::text          AS expediente_id,
                    e.codigo            AS expediente_codigo,
                    e.sap,
                    pf.codigo           AS proforma_codigo
                FROM base b
                LEFT JOIN usado u
                  ON u.expediente_id   = b.expediente_id
                 AND u.producto_id     = b.producto_id
                 AND u.talla           = COALESCE(b.talla, '')
                LEFT JOIN expedientes.expediente e ON e.id = b.expediente_id
                LEFT JOIN LATERAL (
                    SELECT d.codigo
                    FROM expedientes.documento d
                    WHERE d.expediente_id = e.id
                      AND d.kind = 'PROFORMA'
                      AND d.is_active = TRUE
                      AND d.codigo IS NOT NULL
                      AND d.codigo <> ''
                    ORDER BY d.created_at DESC
                    LIMIT 1
                ) pf ON TRUE
                WHERE b.qty_base - COALESCE(u.qty_usado, 0) > 0
                ORDER BY e.codigo NULLS LAST
            """
            params = {
                "nodo_id":     nodo_id,
                "template_id": template_id_int,
                "exclude_iid": exclude_instance_id,
            }
        else:
            sql = """
                SELECT DISTINCT
                    e.id::text          AS expediente_id,
                    e.codigo            AS expediente_codigo,
                    e.sap,
                    pf.codigo           AS proforma_codigo
                FROM inventario.expediente_nodo_assignment a
                LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
                LEFT JOIN LATERAL (
                    SELECT d.codigo
                    FROM expedientes.documento d
                    WHERE d.expediente_id = e.id
                      AND d.kind = 'PROFORMA'
                      AND d.is_active = TRUE
                      AND d.codigo IS NOT NULL
                      AND d.codigo <> ''
                    ORDER BY d.created_at DESC
                    LIMIT 1
                ) pf ON TRUE
                WHERE a.nodo_id   = %(nodo_id)s::uuid
                  AND a.is_active = TRUE
                ORDER BY e.codigo NULLS LAST
            """
            params = {"nodo_id": nodo_id}

        try:
            with connection.cursor() as c:
                c.execute(sql, params)
                cols = [d[0] for d in c.description]
                rows = [dict(zip(cols, r)) for r in c.fetchall()]
        except Exception as exc:
            log.exception("artifact_expedientes SQL failed")
            return Response({"detail": f"SQL error: {exc}"}, status=500)
        return Response(rows)
