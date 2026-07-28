# =====================================================================
# MWT.ONE · apps/expedientes/views_timeline.py
# Sprint 2026-06-13 · Agente responsable: [AG-02 BACKEND]
#
# Endpoint AGREGADO para el Cronograma (/cronograma). Reemplaza el patrón
# N+1 del front (loadCronograma hacía 1 + 3·N + 1 requests: por CADA
# expediente disparaba factura-payload + events + phase-durations) por
# UNA sola respuesta construida con 4 queries set-based (batch).
#
# GET /api/expedientes/timeline-bundle/?client=<uuid>
#   → { expedientes: [ { row, payload:{lineas, operating_company},
#                        events:[{created_at, phase_to}],
#                        phase_durations:{...} }, ... ] }
#
# El front mapea cada elemento con el MISMO normalizeItem(row, payload,
# events, phase_durations) — sin cambiar la matemática del Gantt.
#
# Scope R3 (POL_VISIBILIDAD): reutiliza filter_by_user_clients con scope
# dual (client_id ∪ operating_company_id), idéntico al listado.
# =====================================================================
import json
import logging

from django.db import connection
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.constants import MWT_OPERATING_CLIENT_ID
from apps.core.scoped_querysets import filter_by_user_clients

from .models import Expediente
from .serializers import (
    ExpedienteListSerializer,
    build_expediente_ref_batches,
    _viewer_is_client,
)

log = logging.getLogger(__name__)

STAGES = ("REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO",
          "TRANSITO", "EN_DESTINO", "CERRADO")


def _iso(dt):
    """datetime/date → ISO string (o el valor crudo si ya es str/None)."""
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except AttributeError:
        return str(dt)


def _as_dict(v):
    """jsonb crudo del cursor puede llegar como str — normaliza a dict."""
    if isinstance(v, dict):
        return v
    if isinstance(v, str) and v:
        try:
            return json.loads(v)
        except (ValueError, TypeError):
            return {}
    return {}


class ExpedienteTimelineBundleView(APIView):
    """Bundle agregado del Cronograma — mata el N+1 del front."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # 1) Filas en alcance (mismo orden y scope que ExpedienteViewSet.list).
        qs = (Expediente.objects
              .filter(is_active=True)
              .order_by("-last_event_at", "-created_at"))
        client = request.query_params.get("client")
        if client:
            qs = qs.filter(client_id=client)
        estado = request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        qs = filter_by_user_clients(
            qs, request.user,
            client_field="client_id",
            extra_fields=("operating_company_id",),
        )
        rows = list(qs)
        if not rows:
            return Response({"expedientes": []}, status=200)

        ctx = {"request": request}
        ctx.update(build_expediente_ref_batches(rows, is_client=_viewer_is_client(request.user)))
        row_data = ExpedienteListSerializer(rows, many=True, context=ctx).data

        exp_ids = [str(r.id) for r in rows]

        lineas_by_exp = self._fetch_lineas(exp_ids)
        events_by_exp = self._fetch_events(exp_ids)
        pd_by_exp, op_by_exp = self._fetch_meta(exp_ids)

        out = []
        for r_obj, r_data in zip(rows, row_data):
            eid = str(r_obj.id)
            meta = op_by_exp.get(eid, {})
            out.append({
                "row": r_data,
                "payload": {
                    "lineas": lineas_by_exp.get(eid, []),
                    "operating_company": {
                        "operated_by_mwt": meta.get("operated_by_mwt", False),
                        "client_name":     meta.get("client_name", ""),
                    },
                },
                "events": events_by_exp.get(eid, []),
                "phase_durations": pd_by_exp.get(eid, {}),
            })
        return Response({"expedientes": out}, status=200)

    # ---------------------------------------------------------------
    # Queries batch (set-based; una por dominio, no por expediente).
    # ---------------------------------------------------------------
    @staticmethod
    def _fetch_lineas(exp_ids):
        """Líneas por expediente — mismo shape que factura_payload.lineas
        (sku, size, qty_planned, precios, product_label, ncm, sap, nodo)."""
        out = {}
        with connection.cursor() as c:
            c.execute(
                """
                SELECT e.id::text AS exp_id,
                       l.sku, COALESCE(l.size, ''), l.qty,
                       l.unit_price_mwt, l.unit_price_client, l.producto_id,
                       COALESCE(p.nombre, ''), p.especificaciones->>'ncm',
                       COALESCE(l.sap, ''),
                       COALESCE(na.nodo_label, '')
                FROM expedientes.expediente e
                JOIN expedientes.linea l
                  ON (l.expediente_id = e.id OR l.oc_id = e.oc_id)
                LEFT JOIN productos.producto p ON p.id = l.producto_id
                LEFT JOIN LATERAL (
                    SELECT n.codigo AS nodo_label
                    FROM inventario.expediente_nodo_assignment a
                    JOIN nodos.nodo n ON n.id = a.nodo_id
                    WHERE a.expediente_id = e.id
                      AND a.producto_id = l.producto_id
                      AND COALESCE(a.talla, '') = COALESCE(l.size, '')
                      AND a.is_active = TRUE
                    ORDER BY a.qty_asignada DESC
                    LIMIT 1
                ) na ON TRUE
                WHERE e.id = ANY(%(ids)s::uuid[])
                  AND l.is_active = TRUE
                ORDER BY e.id, l.sku, l.size
                """,
                {"ids": exp_ids},
            )
            for (exp_id, sku, size, qty, p_mwt, p_cli, prod_id,
                 nombre, ncm, sap, nodo) in c.fetchall():
                out.setdefault(exp_id, []).append({
                    "sku":               sku,
                    "size":              size,
                    "qty_planned":       int(qty) if qty is not None else 0,
                    "unit_price_mwt":    float(p_mwt) if p_mwt is not None else 0.0,
                    "unit_price_client": float(p_cli) if p_cli is not None else 0.0,
                    "producto_id":       str(prod_id) if prod_id else None,
                    "product_label":     nombre,
                    "ncm":               ncm,
                    "sap":               sap,
                    "nodo":              nodo,
                })
        return out

    @staticmethod
    def _fetch_events(exp_ids):
        """Primer evento por (expediente, fase) — suficiente para reconstruir
        el historial del Gantt (normalizeItem toma el primero por fase)."""
        out = {}
        with connection.cursor() as c:
            c.execute(
                """
                SELECT DISTINCT ON (el.aggregate_id, el.phase_to)
                       el.aggregate_id::text, el.phase_to, el.created_at
                FROM pipeline.event_log el
                WHERE el.aggregate_id = ANY(%(ids)s::uuid[])
                  AND el.aggregate_type = 'expediente'
                  AND el.is_active = TRUE
                  AND el.phase_to IS NOT NULL
                ORDER BY el.aggregate_id, el.phase_to, el.created_at ASC
                """,
                {"ids": exp_ids},
            )
            for exp_id, phase_to, created_at in c.fetchall():
                out.setdefault(exp_id, []).append({
                    "phase_to":   phase_to,
                    "created_at": _iso(created_at),
                })
        return out

    @staticmethod
    def _fetch_meta(exp_ids):
        """phase_durations_json + operating_company (operated_by_mwt + nombre
        de cliente) por expediente, en una query."""
        pd_by_exp = {}
        op_by_exp = {}
        mwt_id = str(MWT_OPERATING_CLIENT_ID).lower()
        with connection.cursor() as c:
            c.execute(
                """
                SELECT e.id::text,
                       COALESCE(e.phase_durations_json, '{}'::jsonb),
                       e.operating_company_id,
                       COALESCE(cl.razon_social, '')
                FROM expedientes.expediente e
                LEFT JOIN clientes.cliente cl ON cl.id = e.client_id
                WHERE e.id = ANY(%(ids)s::uuid[])
                """,
                {"ids": exp_ids},
            )
            for exp_id, pdj, op_id, cliente in c.fetchall():
                pd_by_exp[exp_id] = _as_dict(pdj)
                op = str(op_id).lower() if op_id else None
                op_by_exp[exp_id] = {
                    "operated_by_mwt": bool(op) and op == mwt_id,
                    "client_name":     cliente,
                }
        return pd_by_exp, op_by_exp
