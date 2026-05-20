"""
=====================================================================
MWT.ONE · apps.commercial.views_price_history
Agente responsable: [AG-BACKEND]

F6 · Sprint 2026-05-20 · Endpoints CEO-ONLY de bitácora histórica
de cambios de precios Marluvas.

GET /api/commercial/marluvas/price-history/
    ?brand_id=<uuid>        (opcional)
    ?cliente_id=<uuid>      (opcional)
    ?sku=<sku>              (opcional, filtra eventos que contengan ese SKU)
    ?since=YYYY-MM-DD       (opcional, filtra snapshot_at >= since)
    ?limit=N                (default 50, max 200)

  → Lista paginada de eventos. Por cada evento:
      id, brand_id, cliente_id, snapshot_at, fecha_inicio, fecha_fin,
      sku_count, cells_count, created_by_user_id, notas,
      cliente { id, razon_social, pais_iso2 }

GET /api/commercial/marluvas/price-history/<event_id>/
  → Detalle completo del evento + lista de SKUs con su snapshot
    (anchor, prices_matrix, sizes_pricing, modificadores).

Visibilidad: CEO-ONLY. CLIENT_* recibe 403.
=====================================================================
"""
import logging
import uuid
from datetime import datetime, date as _date

from django.db import connection
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

log = logging.getLogger(__name__)


def _is_client(request):
    """True si el caller es CLIENT_* (Portal B2B)."""
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    role = (getattr(user, "role_default", "") or
            getattr(user, "role", "") or "")
    try:
        role_upper = str(role).upper()
    except (TypeError, ValueError):
        return False
    return role_upper.startswith("CLIENT_") or role_upper in (
        "CLIENT", "CLIENTE", "CLIENT_B2B",
    )


def _parse_uuid_opt(raw, name):
    """Parse opcional. Devuelve UUID o None. Levanta ValueError si valor inválido."""
    if not raw:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        raise ValueError(f"{name} no es UUID válido")


def _parse_date_opt(raw, name):
    """Parse opcional de fecha YYYY-MM-DD."""
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise ValueError(f"{name} debe ser YYYY-MM-DD")


def _safe_float(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# =====================================================================
# Lista
# =====================================================================
class PriceHistoryListView(APIView):
    """GET · lista paginada de eventos de historial."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _is_client(request):
            return Response({"detail": "CEO-ONLY"}, status=403)

        # ── Filtros ──
        try:
            brand_id   = _parse_uuid_opt(request.query_params.get("brand_id"),   "brand_id")
            cliente_id = _parse_uuid_opt(request.query_params.get("cliente_id"), "cliente_id")
            since      = _parse_date_opt(request.query_params.get("since"),      "since")
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        sku = (request.query_params.get("sku") or "").strip() or None

        try:
            limit = int(request.query_params.get("limit") or 50)
        except (TypeError, ValueError):
            limit = 50
        limit = max(1, min(limit, 200))

        # ── Query con join a cliente para razón social + país ──
        where = ["e.id IS NOT NULL"]
        params = []
        if brand_id:
            where.append("e.brand_id = %s::uuid")
            params.append(str(brand_id))
        if cliente_id:
            where.append("e.cliente_id = %s::uuid")
            params.append(str(cliente_id))
        if since:
            where.append("e.snapshot_at >= %s")
            params.append(since)
        if sku:
            # Filtro por SKU: traer solo eventos que tengan al menos 1 fila
            # en marluvas_price_history_sku con ese SKU.
            where.append(
                "EXISTS (SELECT 1 FROM pricing.marluvas_price_history_sku s "
                "WHERE s.event_id = e.id AND s.sku = %s)"
            )
            params.append(sku)

        params.append(limit)
        sql = f"""
            SELECT
                e.id, e.brand_id, e.cliente_id, e.snapshot_at,
                e.fecha_inicio, e.fecha_fin,
                e.sku_count, e.cells_count, e.created_by_user_id, e.notas,
                e.custom_plazos,
                c.razon_social, c.nombre_comercial, c.pais_iso2
            FROM pricing.marluvas_price_history_event e
            LEFT JOIN clientes.cliente c ON c.id = e.cliente_id
            WHERE {' AND '.join(where)}
            ORDER BY e.snapshot_at DESC
            LIMIT %s
        """

        out = []
        try:
            with connection.cursor() as cur:
                cur.execute(sql, params)
                cols = [c[0] for c in cur.description]
                for row in cur.fetchall():
                    r = dict(zip(cols, row))
                    # Conteo defensivo: aceptamos sólo claves que parezcan
                    # bandaId (1..12). Snapshots viejos pueden traer JSON
                    # con shape inesperado (ej. lista plana de plazos
                    # serializada como dict-de-índices), por eso filtramos.
                    cp = r.get("custom_plazos") or {}
                    if isinstance(cp, dict):
                        valid_band_keys = []
                        for k in cp.keys():
                            try:
                                kn = int(k)
                                if 1 <= kn <= 12:
                                    valid_band_keys.append(kn)
                            except (TypeError, ValueError):
                                continue
                        custom_count = len(valid_band_keys)
                    else:
                        custom_count = 0
                    out.append({
                        "id":                 str(r["id"]),
                        "brand_id":           str(r["brand_id"]) if r["brand_id"] else None,
                        "cliente_id":         str(r["cliente_id"]) if r["cliente_id"] else None,
                        "snapshot_at":        r["snapshot_at"].isoformat() if r["snapshot_at"] else None,
                        "fecha_inicio":       r["fecha_inicio"].isoformat() if r["fecha_inicio"] else None,
                        "fecha_fin":          r["fecha_fin"].isoformat()    if r["fecha_fin"]    else None,
                        "sku_count":          int(r["sku_count"] or 0),
                        "cells_count":        int(r["cells_count"] or 0),
                        "custom_plazos_bands": custom_count,
                        "created_by_user_id": str(r["created_by_user_id"]) if r["created_by_user_id"] else None,
                        "notas":              r["notas"],
                        "cliente": {
                            "razon_social":     r["razon_social"],
                            "nombre_comercial": r["nombre_comercial"],
                            "pais_iso2":        r["pais_iso2"],
                        },
                    })
        except Exception as exc:  # noqa: BLE001
            log.warning("PriceHistoryListView query failed: %s", exc)
            return Response({"detail": str(exc)}, status=500)

        return Response({
            "count":   len(out),
            "limit":   limit,
            "events":  out,
        }, status=200)


# =====================================================================
# Detalle de un evento
# =====================================================================
class PriceHistoryDetailView(APIView):
    """GET · detalle completo de un evento (cabecera + SKUs)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, event_id):
        if _is_client(request):
            return Response({"detail": "CEO-ONLY"}, status=403)

        try:
            evid = uuid.UUID(str(event_id))
        except (ValueError, AttributeError, TypeError):
            return Response({"detail": "event_id no es UUID válido"}, status=400)

        # ── Cabecera + cliente ──
        ev = None
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT
                        e.id, e.brand_id, e.cliente_id, e.snapshot_at,
                        e.fecha_inicio, e.fecha_fin,
                        e.sku_count, e.cells_count, e.created_by_user_id, e.notas,
                        e.custom_plazos,
                        c.razon_social, c.nombre_comercial, c.pais_iso2
                    FROM pricing.marluvas_price_history_event e
                    LEFT JOIN clientes.cliente c ON c.id = e.cliente_id
                    WHERE e.id = %s::uuid
                    LIMIT 1
                """, [str(evid)])
                row = cur.fetchone()
                if not row:
                    return Response({"detail": "Evento no encontrado."}, status=404)
                cols = [c[0] for c in cur.description]
                ev = dict(zip(cols, row))
        except Exception as exc:  # noqa: BLE001
            log.warning("PriceHistoryDetailView cabecera failed: %s", exc)
            return Response({"detail": str(exc)}, status=500)

        # ── Detalle SKUs ──
        skus_out = []
        try:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT
                        id, sku, brl_override, com_pct, ajuste_usd,
                        sobreprecio_pct, anchor, prices_matrix, sizes_pricing,
                        activo, created_at
                    FROM pricing.marluvas_price_history_sku
                    WHERE event_id = %s::uuid
                    ORDER BY sku
                """, [str(evid)])
                cols = [c[0] for c in cur.description]
                for row in cur.fetchall():
                    r = dict(zip(cols, row))
                    skus_out.append({
                        "id":              str(r["id"]),
                        "sku":             r["sku"],
                        "brl_override":    _safe_float(r["brl_override"]),
                        "com_pct":         _safe_float(r["com_pct"]) or 0.0,
                        "ajuste_usd":      _safe_float(r["ajuste_usd"]) or 0.0,
                        "sobreprecio_pct": _safe_float(r["sobreprecio_pct"]) or 0.0,
                        "anchor":          r["anchor"] or None,
                        "prices_matrix":   r["prices_matrix"] or {},
                        "sizes_pricing":   r["sizes_pricing"] or {},
                        "activo":          bool(r["activo"]),
                    })
        except Exception as exc:  # noqa: BLE001
            log.warning("PriceHistoryDetailView detalle failed: %s", exc)
            return Response({"detail": str(exc)}, status=500)

        return Response({
            "event": {
                "id":                 str(ev["id"]),
                "brand_id":           str(ev["brand_id"])   if ev["brand_id"]   else None,
                "cliente_id":         str(ev["cliente_id"]) if ev["cliente_id"] else None,
                "snapshot_at":        ev["snapshot_at"].isoformat() if ev["snapshot_at"] else None,
                "fecha_inicio":       ev["fecha_inicio"].isoformat() if ev["fecha_inicio"] else None,
                "fecha_fin":          ev["fecha_fin"].isoformat()    if ev["fecha_fin"]    else None,
                "sku_count":          int(ev["sku_count"] or 0),
                "cells_count":        int(ev["cells_count"] or 0),
                "custom_plazos":      ev["custom_plazos"] or {},
                "created_by_user_id": str(ev["created_by_user_id"]) if ev["created_by_user_id"] else None,
                "notas":              ev["notas"],
                "cliente": {
                    "razon_social":     ev["razon_social"],
                    "nombre_comercial": ev["nombre_comercial"],
                    "pais_iso2":        ev["pais_iso2"],
                },
            },
            "skus": skus_out,
        }, status=200)
