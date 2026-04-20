"""
=====================================================================
MWT.ONE · apps.portal.views
Agente responsable: [AG-BACKEND]

Portal B2B — read-only · scopeado al client_id.

Reglas de visibilidad (ENT_CLIENT_PORTAL_VISIBILITY):
  - NUNCA exponer: total_cost, projected_margin, real_margin,
                   commission_pct, supplier_id, modo_operacion, phase_signal,
                   rejection reasons.
  - Solo expone: codigo, estado técnico traducido a estado natural de cliente,
                 total_invoiced, total_paid, balance, eta, origin, destination,
                 freight_mode, coverage_pct, credit_days_used/limit.

Scope del cliente:
  1. request.user.portal_client_id (futuro — cuando User tenga ese campo)
  2. Header HTTP 'X-Portal-Client' (dev)
  3. Query param ?client_id= (dev/fallback)

Si no se resuelve client_id → 403.
=====================================================================
"""
from django.db import connection
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response


# ══════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════
def _fetchall(sql, params=None):
    try:
        with connection.cursor() as c:
            c.execute(sql, params or [])
            cols = [d[0] for d in c.description]
            return [dict(zip(cols, r)) for r in c.fetchall()]
    except Exception:
        return []


def _fetchone(sql, params=None):
    try:
        with connection.cursor() as c:
            c.execute(sql, params or [])
            return c.fetchone()
    except Exception:
        return None


def _resolve_client_id(request):
    """Resuelve el client_id del portal. Orden de precedencia:
       1. request.user.portal_client_id  (futuro)
       2. header X-Portal-Client
       3. query param ?client_id=
    """
    u = getattr(request, "user", None)
    pcid = getattr(u, "portal_client_id", None) if u is not None else None
    if pcid:
        return str(pcid)
    hdr = request.headers.get("X-Portal-Client")
    if hdr:
        return hdr
    q = request.query_params.get("client_id")
    if q:
        return q
    return None


def _forbidden():
    return Response(
        {"detail": "No se pudo resolver el cliente del portal."},
        status=status.HTTP_403_FORBIDDEN,
    )


# ══════════════════════════════════════════════════════════════
# Mapeo de estados técnicos → naturales (cliente)
# ══════════════════════════════════════════════════════════════
CLIENT_STATE_MAP = {
    "REGISTRO":    {"es": "Confirmado",     "en": "Confirmed",      "step": 0},
    "PRODUCCION":  {"es": "En fabricación", "en": "Manufacturing",  "step": 1},
    "PREPARACION": {"es": "Preparación",    "en": "Preparing",      "step": 2},
    "DESPACHO":    {"es": "Despachado",     "en": "Dispatched",     "step": 3},
    "TRANSITO":    {"es": "En tránsito",    "en": "In transit",     "step": 3},
    "EN_DESTINO":  {"es": "En aduana",      "en": "In customs",     "step": 4},
    "CERRADO":     {"es": "Listo",          "en": "Ready",          "step": 5},
}


# ══════════════════════════════════════════════════════════════
# ViewSet
# ══════════════════════════════════════════════════════════════
class PortalViewSet(viewsets.ViewSet):
    """Endpoints del portal B2B. Todas las acciones son read-only."""

    # ── /api/portal/me/ ───────────────────────────────────────
    @action(detail=False, methods=["get"])
    def me(self, request):
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        r = _fetchone("""
            SELECT id, nombre, contacto, email, telefono, credit_days
            FROM clientes.cliente
            WHERE id = %s AND is_active = TRUE
        """, [cid])
        if not r:
            # Cliente no existe todavía en backend — shape mínimo
            return Response({"id": cid, "nombre": None, "contacto": None,
                             "email": None, "telefono": None,
                             "credit_days": None})
        return Response({
            "id":          r[0],
            "nombre":      r[1],
            "contacto":    r[2],
            "email":       r[3],
            "telefono":    r[4],
            "credit_days": r[5],
        })

    # ── /api/portal/mis_ocs/ ──────────────────────────────────
    @action(detail=False, methods=["get"])
    def mis_ocs(self, request):
        """Lista de órdenes (OCs) del cliente — solo campos visibles."""
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        rows = _fetchall("""
            SELECT
              id, codigo, brand_id, moneda,
              total_value, total_invoiced, total_paid, balance,
              coverage_pct, lines_count, issued_at,
              estado
            FROM expedientes.oc
            WHERE is_active = TRUE AND client_id = %s
            ORDER BY issued_at DESC, created_at DESC
            LIMIT 50
        """, [cid])
        return Response(rows)

    # ── /api/portal/mis_expedientes/ ──────────────────────────
    @action(detail=False, methods=["get"])
    def mis_expedientes(self, request):
        """Lista de expedientes del cliente.

        NOTA: NO expone total_cost, projected_margin, real_margin,
              commission_pct, modo_operacion, phase_signal, is_blocked,
              supplier_id. Sólo se incluyen los campos seguros del spec.
        """
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        rows = _fetchall("""
            SELECT
              id, codigo, oc_id, brand_id,
              estado,
              origin, destination, freight_mode,
              eta, last_event_at,
              total_invoiced, total_paid, balance,
              coverage_pct
            FROM expedientes.expediente
            WHERE is_active = TRUE AND client_id = %s
            ORDER BY last_event_at DESC, created_at DESC
            LIMIT 100
        """, [cid])
        # Traducir estado técnico → natural
        for r in rows:
            m = CLIENT_STATE_MAP.get(r.get("estado"), {})
            r["estado_cliente_es"]   = m.get("es", r.get("estado"))
            r["estado_cliente_en"]   = m.get("en", r.get("estado"))
            r["estado_cliente_step"] = m.get("step", 0)
        return Response(rows)

    # ── /api/portal/mis_pagos/ ────────────────────────────────
    @action(detail=False, methods=["get"])
    def mis_pagos(self, request):
        """Historial de pagos realizados por el cliente (INGRESO)."""
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        rows = _fetchall("""
            SELECT
              p.id, p.codigo, p.oc_id, p.expediente_id,
              p.metodo, p.moneda, p.monto, p.monto_usd,
              p.fecha_operacion, p.fecha_acreditacion,
              p.estado, p.referencia_externa
            FROM cobros.pago p
            WHERE p.is_active = TRUE
              AND p.client_id = %s
              AND p.direccion = 'INGRESO'
            ORDER BY p.fecha_operacion DESC, p.created_at DESC
            LIMIT 200
        """, [cid])
        return Response(rows)

    # ── /api/portal/mis_cobros/ ───────────────────────────────
    @action(detail=False, methods=["get"])
    def mis_cobros(self, request):
        """Cobros vigentes del cliente (resumen de saldos)."""
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        rows = _fetchall("""
            SELECT
              id, codigo, oc_id, expediente_id,
              monto_total, monto_pagado, monto_pendiente,
              fecha_vencimiento, dias_credito, estado
            FROM cobros.cobro
            WHERE is_active = TRUE AND client_id = %s
            ORDER BY fecha_vencimiento ASC, created_at DESC
            LIMIT 100
        """, [cid])
        return Response(rows)

    # ── /api/portal/mis_documentos/ ───────────────────────────
    @action(detail=False, methods=["get"])
    def mis_documentos(self, request):
        """Documentos del cliente (OC + expedientes). La URL devuelta
           es un placeholder — en prod se reemplaza por signed URL (15 min)."""
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        rows = _fetchall("""
            SELECT
              d.id, d.oc_id, d.expediente_id, d.kind, d.codigo, d.titulo,
              d.fecha, d.storage_url
            FROM expedientes.documento d
            WHERE d.is_active = TRUE
              AND (
                d.oc_id IN (SELECT id FROM expedientes.oc
                            WHERE client_id = %s AND is_active = TRUE)
                OR d.expediente_id IN (SELECT id FROM expedientes.expediente
                                       WHERE client_id = %s AND is_active = TRUE)
              )
            ORDER BY d.fecha DESC, d.created_at DESC
            LIMIT 200
        """, [cid, cid])
        # TODO: wrap storage_url en signed URL con expiración 15 min
        for r in rows:
            r["signed_url_ttl_sec"] = 900
        return Response(rows)

    # ── /api/portal/kpis/ ─────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """KPIs seguros para el cliente: coverage%, credit days used, órdenes activas."""
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        out = {
            "ocs_activas":     0,
            "total_invoiced":  0.0,
            "total_paid":      0.0,
            "balance":         0.0,
            "coverage_pct":    0.0,
            "credit_days_limit": 0,
            "credit_days_used":  0,
        }
        r = _fetchone("""
            SELECT
              COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO','CANCELADA')),
              COALESCE(SUM(total_invoiced),0),
              COALESCE(SUM(total_paid),0),
              COALESCE(SUM(balance),0)
            FROM expedientes.oc
            WHERE is_active = TRUE AND client_id = %s
        """, [cid])
        if r:
            out["ocs_activas"]    = r[0] or 0
            out["total_invoiced"] = float(r[1] or 0)
            out["total_paid"]     = float(r[2] or 0)
            out["balance"]        = float(r[3] or 0)
            if out["total_invoiced"] > 0:
                out["coverage_pct"] = out["total_paid"] / out["total_invoiced"]

        # Crédito del cliente (días límite)
        r = _fetchone("""
            SELECT COALESCE(credit_days, 0)
            FROM clientes.cliente
            WHERE id = %s AND is_active = TRUE
        """, [cid])
        if r:
            out["credit_days_limit"] = r[0] or 0

        # Máximo de credit_days en expedientes activos → días usados
        r = _fetchone("""
            SELECT COALESCE(MAX(credit_days), 0)
            FROM expedientes.expediente
            WHERE is_active = TRUE AND client_id = %s
              AND estado NOT IN ('CERRADO','CANCELADA')
        """, [cid])
        if r:
            out["credit_days_used"] = r[0] or 0

        return Response(out)
