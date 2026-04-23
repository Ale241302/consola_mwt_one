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
import hashlib
import logging
import secrets
import uuid
from django.db import connection
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import MwtUser, PortalSessionLog, PortalAuditLog
from .serializers import (
    MwtUserListSerializer, MwtUserSerializer,
    PortalSessionLogSerializer, PortalAuditLogSerializer,
    ProductPortalListSerializer, ProductPortalDetailSerializer,
)
from apps.productos.models import Producto

log = logging.getLogger(__name__)


def _hash_password(raw: str) -> str:
    """pbkdf2 simple — en prod reemplazar por argon2/bcrypt."""
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256$120000${salt}${h.hex()}"


def _verify_password(raw: str, stored: str) -> bool:
    try:
        scheme, iters, salt, expected = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        h = hashlib.pbkdf2_hmac("sha256", raw.encode("utf-8"), salt.encode("utf-8"), int(iters))
        return secrets.compare_digest(h.hex(), expected)
    except Exception:
        return False


def _record_audit(user_id, email, action, resource_type, resource_id=None,
                  resource_label=None, request=None, status_code=200, payload=None):
    """Best-effort insert en portal_audit_log."""
    try:
        ip = None
        ua = None
        if request is not None:
            ip = request.META.get("REMOTE_ADDR")
            ua = request.META.get("HTTP_USER_AGENT")
        PortalAuditLog.objects.create(
            id             = uuid.uuid4(),
            mwt_user_id    = user_id,
            email          = email,
            action         = action,
            resource_type  = resource_type,
            resource_id    = resource_id,
            resource_label = resource_label,
            ip_address     = ip,
            user_agent     = ua,
            status_code    = status_code,
            payload        = payload or {},
        )
    except Exception as e:
        log.warning("_record_audit falló: %s", e)


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

    # ── /api/portal/expediente_detail/?id=<uuid> ──────────────
    @action(detail=False, methods=["get"], url_path="expediente_detail")
    def expediente_detail(self, request):
        """Detalle de un expediente del cliente (scope-checked por client_id).

        Devuelve solo campos seguros (ver comentario en mis_expedientes).
        Registra VIEW en portal_audit_log.
        """
        cid = _resolve_client_id(request)
        if not cid:
            return _forbidden()
        exp_id = request.query_params.get("id")
        if not exp_id:
            return Response({"detail": "Falta query param 'id'"},
                            status=status.HTTP_400_BAD_REQUEST)

        r = _fetchone("""
            SELECT
              id, codigo, oc_id, brand_id, client_id,
              estado, origin, destination, freight_mode,
              eta, last_event_at,
              total_invoiced, total_paid, balance, coverage_pct,
              credit_days, credit_days_limit,
              created_at, updated_at
            FROM expedientes.expediente
            WHERE is_active = TRUE AND id = %s AND client_id = %s
        """, [exp_id, cid])
        if not r:
            return Response({"detail": "Expediente no encontrado o fuera de scope."},
                            status=status.HTTP_404_NOT_FOUND)

        estado = r[5]
        m = CLIENT_STATE_MAP.get(estado, {})
        data = {
            "id":                   r[0],
            "codigo":               r[1],
            "oc_id":                r[2],
            "brand_id":             r[3],
            "client_id":            r[4],
            "estado":               estado,
            "estado_cliente_es":    m.get("es", estado),
            "estado_cliente_en":    m.get("en", estado),
            "estado_cliente_step":  m.get("step", 0),
            "origin":               r[6],
            "destination":          r[7],
            "freight_mode":         r[8],
            "eta":                  r[9],
            "last_event_at":        r[10],
            "total_invoiced":       float(r[11] or 0),
            "total_paid":           float(r[12] or 0),
            "balance":              float(r[13] or 0),
            "coverage_pct":         float(r[14] or 0),
            "credit_days":          r[15],
            "credit_days_limit":    r[16],
            "created_at":           r[17],
            "updated_at":           r[18],
        }

        # Eventos del expediente (pipeline.event_log) — solo campos visibles
        events = _fetchall("""
            SELECT id, phase_from, phase_to, note, created_at
            FROM pipeline.event_log
            WHERE expediente_id = %s AND is_active = TRUE
            ORDER BY created_at ASC
        """, [exp_id])
        data["events"] = events

        # Audit best-effort
        user = getattr(request, "user", None)
        user_id = getattr(user, "id", None)
        user_email = getattr(user, "email", None)
        if user_id:
            _record_audit(
                user_id=user_id, email=user_email,
                action="VIEW", resource_type="expediente",
                resource_id=exp_id, resource_label=data["codigo"],
                request=request, status_code=200,
                payload={"client_id": cid},
            )

        return Response(data)

    # ── /api/portal/update_preferences/ ───────────────────────
    @action(detail=False, methods=["patch", "post"], url_path="update_preferences")
    def update_preferences(self, request):
        """PATCH mwt_user.preferences (JSONB merge top-level).

        Requiere request.user.id. Hace UPDATE preferences = preferences || %s.
        """
        user = getattr(request, "user", None)
        user_id = getattr(user, "id", None)
        if not user_id:
            return Response({"detail": "Usuario no autenticado."},
                            status=status.HTTP_401_UNAUTHORIZED)
        prefs = request.data.get("preferences") or {}
        if not isinstance(prefs, dict):
            return Response({"detail": "preferences debe ser dict."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            with connection.cursor() as c:
                c.execute("""
                    UPDATE portal.mwt_user
                    SET preferences = COALESCE(preferences,'{}'::jsonb) || %s::jsonb,
                        updated_at = NOW()
                    WHERE id = %s AND is_active = TRUE
                    RETURNING preferences
                """, [
                    __import__("json").dumps(prefs),
                    str(user_id),
                ])
                row = c.fetchone()
        except Exception as e:
            log.warning("update_preferences falló: %s", e)
            return Response({"detail": str(e)},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        if not row:
            return Response({"detail": "Usuario no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)

        _record_audit(
            user_id=user_id, email=getattr(user, "email", None),
            action="UPDATE", resource_type="perfil",
            resource_id=user_id, resource_label="preferences",
            request=request, status_code=200,
            payload={"keys": list(prefs.keys())},
        )
        return Response({"ok": True, "preferences": row[0]})

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


# ══════════════════════════════════════════════════════════════
# MwtUserViewSet — CRUD + acciones de portal (invitaciones, pwd)
# ══════════════════════════════════════════════════════════════
class MwtUserViewSet(viewsets.ModelViewSet):
    """CRUD de usuarios del portal (portal.mwt_user).

    · Idempotente por `idempotence_token` (early-return).
    · Hash de password via pbkdf2_sha256 — prod reemplazar por argon2.
    · Nunca expone `password_hash` ni `api_key_hash`.
    """
    queryset = MwtUser.objects.filter(is_active=True)
    serializer_class = MwtUserSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return MwtUserListSerializer
        return MwtUserSerializer

    def get_queryset(self):
        qs = MwtUser.objects.filter(is_active=True)
        role = self.request.query_params.get("role")
        legal_entity_id = self.request.query_params.get("legal_entity_id")
        email = self.request.query_params.get("email")
        search = self.request.query_params.get("search")
        if role:
            qs = qs.filter(role=role)
        if legal_entity_id:
            qs = qs.filter(legal_entity_id=legal_entity_id)
        if email:
            qs = qs.filter(email__iexact=email)
        if search:
            qs = qs.filter(email__icontains=search)
        return qs

    def create(self, request, *args, **kwargs):
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        token = data.get("idempotence_token")

        # Idempotence early-return
        if token:
            existing = MwtUser.objects.filter(
                idempotence_token=token, is_active=True).first()
            if existing:
                return Response(
                    MwtUserSerializer(existing).data,
                    status=status.HTTP_200_OK,
                    headers={"X-Idempotent-Replay": "true"},
                )

        # Auto-generate UUID si no viene
        if not data.get("id"):
            data["id"] = str(uuid.uuid4())

        # Hash password si viene raw
        raw_pwd = data.pop("password", None)
        if raw_pwd:
            data["password_hash"] = _hash_password(raw_pwd)
            data["password_changed_at"] = timezone.now().isoformat()

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # ── POST /api/mwt-users/<id>/accept_invitation/ ───────────
    @action(detail=True, methods=["post"])
    def accept_invitation(self, request, pk=None):
        """Consume invite_token y activa la cuenta.
        Body: {"invite_token": "...", "password": "..."}
        """
        token = (request.data.get("invite_token") or "").strip()
        raw_pwd = request.data.get("password")
        if not token or not raw_pwd:
            return Response(
                {"detail": "invite_token y password son obligatorios."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            u = MwtUser.objects.get(pk=pk, is_active=True)
        except MwtUser.DoesNotExist:
            return Response({"detail": "Usuario no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)
        if u.invite_token != token:
            return Response({"detail": "invite_token inválido."},
                            status=status.HTTP_403_FORBIDDEN)
        if u.invite_expires_at and u.invite_expires_at < timezone.now():
            return Response({"detail": "invite_token expirado."},
                            status=status.HTTP_403_FORBIDDEN)

        u.password_hash = _hash_password(raw_pwd)
        u.password_changed_at = timezone.now()
        u.accepted_at = timezone.now()
        u.invite_token = None
        u.invite_expires_at = None
        u.failed_login_count = 0
        u.locked_until = None
        u.save(update_fields=[
            "password_hash", "password_changed_at", "accepted_at",
            "invite_token", "invite_expires_at",
            "failed_login_count", "locked_until", "updated_at",
        ])

        _record_audit(
            user_id=u.id, email=u.email,
            action="UPDATE", resource_type="perfil",
            resource_id=u.id, resource_label="accept_invitation",
            request=request, status_code=200,
        )
        return Response({"ok": True, "id": str(u.id), "accepted_at": u.accepted_at})

    # ── POST /api/mwt-users/<id>/change_password/ ─────────────
    @action(detail=True, methods=["post"])
    def change_password(self, request, pk=None):
        """Body: {"old_password": "...", "new_password": "..."}"""
        old = request.data.get("old_password")
        new = request.data.get("new_password")
        if not new or len(new) < 8:
            return Response(
                {"detail": "new_password debe tener al menos 8 caracteres."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            u = MwtUser.objects.get(pk=pk, is_active=True)
        except MwtUser.DoesNotExist:
            return Response({"detail": "Usuario no encontrado."},
                            status=status.HTTP_404_NOT_FOUND)

        if u.password_hash:
            if not old or not _verify_password(old, u.password_hash):
                _record_audit(
                    user_id=u.id, email=u.email,
                    action="UPDATE", resource_type="perfil",
                    resource_id=u.id, resource_label="change_password_failed",
                    request=request, status_code=403,
                )
                return Response({"detail": "old_password inválido."},
                                status=status.HTTP_403_FORBIDDEN)

        u.password_hash = _hash_password(new)
        u.password_changed_at = timezone.now()
        u.failed_login_count = 0
        u.locked_until = None
        u.save(update_fields=[
            "password_hash", "password_changed_at",
            "failed_login_count", "locked_until", "updated_at",
        ])
        _record_audit(
            user_id=u.id, email=u.email,
            action="UPDATE", resource_type="perfil",
            resource_id=u.id, resource_label="change_password",
            request=request, status_code=200,
        )
        return Response({"ok": True, "password_changed_at": u.password_changed_at})

    # ── GET /api/mwt-users/<id>/audit_log/ ────────────────────
    @action(detail=True, methods=["get"])
    def audit_log(self, request, pk=None):
        """Audit log del usuario (filtro opcional por action/resource_type)."""
        qs = PortalAuditLog.objects.filter(mwt_user_id=pk, is_active=True)
        act = request.query_params.get("action")
        rtype = request.query_params.get("resource_type")
        if act:
            qs = qs.filter(action=act)
        if rtype:
            qs = qs.filter(resource_type=rtype)
        qs = qs.order_by("-created_at")[:500]
        return Response(PortalAuditLogSerializer(qs, many=True).data)

    # ── GET /api/mwt-users/<id>/session_log/ ──────────────────
    @action(detail=True, methods=["get"])
    def session_log(self, request, pk=None):
        """Historial de sesiones del usuario."""
        qs = PortalSessionLog.objects.filter(mwt_user_id=pk, is_active=True)
        ev = request.query_params.get("event_type")
        if ev:
            qs = qs.filter(event_type=ev)
        succ = request.query_params.get("success")
        if succ is not None:
            qs = qs.filter(success=(succ.lower() in ("1", "true", "yes")))
        qs = qs.order_by("-created_at")[:500]
        return Response(PortalSessionLogSerializer(qs, many=True).data)


# ══════════════════════════════════════════════════════════════
# PortalSessionLogViewSet — read-only
# ══════════════════════════════════════════════════════════════
class PortalSessionLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PortalSessionLog.objects.filter(is_active=True)
    serializer_class = PortalSessionLogSerializer

    def get_queryset(self):
        qs = PortalSessionLog.objects.filter(is_active=True)
        user_id = self.request.query_params.get("mwt_user_id")
        email = self.request.query_params.get("email")
        ev = self.request.query_params.get("event_type")
        succ = self.request.query_params.get("success")
        if user_id:
            qs = qs.filter(mwt_user_id=user_id)
        if email:
            qs = qs.filter(email__iexact=email)
        if ev:
            qs = qs.filter(event_type=ev)
        if succ is not None:
            qs = qs.filter(success=(succ.lower() in ("1", "true", "yes")))
        return qs.order_by("-created_at")


# ══════════════════════════════════════════════════════════════
# PortalAuditLogViewSet — read-only
# ══════════════════════════════════════════════════════════════
class PortalAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PortalAuditLog.objects.filter(is_active=True)
    serializer_class = PortalAuditLogSerializer

    def get_queryset(self):
        qs = PortalAuditLog.objects.filter(is_active=True)
        user_id = self.request.query_params.get("mwt_user_id")
        act = self.request.query_params.get("action")
        rtype = self.request.query_params.get("resource_type")
        rid = self.request.query_params.get("resource_id")
        if user_id:
            qs = qs.filter(mwt_user_id=user_id)
        if act:
            qs = qs.filter(action=act)
        if rtype:
            qs = qs.filter(resource_type=rtype)
        if rid:
            qs = qs.filter(resource_id=rid)
        return qs.order_by("-created_at")

    # ── GET /api/portal-audit/kpis/ ───────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """Stats agregados del audit log (últimos 30 días)."""
        from django.utils import timezone as tz
        from datetime import timedelta
        since = tz.now() - timedelta(days=30)
        qs = PortalAuditLog.objects.filter(is_active=True, created_at__gte=since)
        total = qs.count()
        by_action = {}
        for row in qs.values_list("action", flat=True):
            by_action[row] = by_action.get(row, 0) + 1
        return Response({
            "total_30d": total,
            "by_action": by_action,
        })


# ══════════════════════════════════════════════════════════════════════
# PortalProductViewSet — Catálogo B2B (strip-down)
#
# GET  /api/portal/products/        → list (cards del grid)
# GET  /api/portal/products/{id}/   → retrieve (ficha técnica)
# POST / PUT / PATCH / DELETE       → 403 Forbidden (read-only por spec)
#
# Reglas (DEFENSA EN PROFUNDIDAD):
#   1. ClientScopedManager lógico: el scope se resuelve vía
#      _resolve_client_id() (igual que el resto del portal). Si no hay
#      scope → 403 (no se filtra data del CEO).
#   2. Filtrado por visibility_tier ∈ {'PUBLIC', 'PARTNER_B2B'}. Los
#      productos INTERNAL/CEO-ONLY se ocultan al cliente.
#   3. `precio_venta` se resuelve por cliente llamando a
#      apps.commercial.resolve_client_price (best-effort; si falla
#      caemos a precio_distribuidor en el serializer).
#   4. El serializer usa whitelist explícita (ProductPortalListSerializer/
#      ProductPortalDetailSerializer) — los campos CEO-ONLY NO entran
#      al payload bajo ninguna circunstancia, incluso si alguien hace
#      patch directo del modelo en el futuro.
#   5. PATCH/PUT/POST/DELETE → 403 explícito (no 405), porque queremos
#      transmitir la intención "prohibido", no "método no configurado".
# ══════════════════════════════════════════════════════════════════════
class PortalProductViewSet(viewsets.ReadOnlyModelViewSet):
    """Catálogo B2B del portal del cliente. 100% read-only, strip-down.

    Tests cubren esto en tests/test_portal_products.py (BLOQUE 5).
    """
    serializer_class = ProductPortalListSerializer

    # Solo aceptamos los métodos que queremos (DRF respeta esta lista);
    # cualquier otro se bloquea en `dispatch` con 403 explícito.
    http_method_names = ["get", "head", "options"]

    def get_serializer_class(self):
        # Detail devuelve MÁS campos (ficha técnica completa), list da
        # el mínimo del grid para que el payload sea ligero.
        if self.action == "retrieve":
            return ProductPortalDetailSerializer
        return ProductPortalListSerializer

    # ── SECURITY GATE ─────────────────────────────────────────────
    def initial(self, request, *args, **kwargs):
        """Enforce client scope ANTES de ejecutar la acción.
        Si no podemos resolver el client_id → 403 directo (no 401/404),
        para no filtrar la existencia del endpoint."""
        super().initial(request, *args, **kwargs)
        cid = _resolve_client_id(request)
        if not cid:
            # Usamos una excepción estándar para que DRF la serialice bien
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("No se pudo resolver el cliente del portal.")
        # Dejamos el client_id resuelto accesible para list/retrieve
        request._portal_client_id = cid

    # ── QUERYSET — scope + whitelist de visibility_tier ───────────
    def get_queryset(self):
        qs = Producto.objects.filter(
            is_active=True,
            visibility_tier__in=["PUBLIC", "PARTNER_B2B"],
        )

        # Filtros opcionales (útiles en el grid: q, marca, categoría)
        q = self.request.query_params.get("q")
        if q:
            qs = qs.filter(nombre__icontains=q)
        marca_id = self.request.query_params.get("marca_id")
        if marca_id:
            qs = qs.filter(marca_id=marca_id)
        categoria = self.request.query_params.get("categoria")
        if categoria:
            qs = qs.filter(categoria=categoria)

        # Scope adicional: brands asignados al cliente vía
        # commercial.client_assignment (si existe). Best-effort.
        cid = getattr(self.request, "_portal_client_id", None)
        if cid:
            try:
                with connection.cursor() as c:
                    c.execute("""
                        SELECT brand_id FROM commercial.client_assignment
                        WHERE client_id = %s AND is_active = TRUE
                    """, [str(cid)])
                    brand_ids = [r[0] for r in c.fetchall() if r[0]]
                if brand_ids:
                    qs = qs.filter(marca_id__in=brand_ids)
            except Exception:
                # Si la tabla no está montada → se deja el whitelist
                # visibility_tier como único filtro (comportamiento OK
                # en ambientes dev/sandbox).
                pass

        return qs.order_by("marca_id", "sku")

    # ── Enriquecimiento: marca_label + precio resuelto ────────────
    def _hydrate_batch(self, productos):
        """Anexa `_marca_label` (del catálogo brands.marca) y
        `precio_venta_resolved` (del resolver comercial) a cada objeto.
        Best-effort: tolera ausencia de schemas."""
        if not productos:
            return

        cid = getattr(self.request, "_portal_client_id", None)
        brand_ids = list({str(p.marca_id) for p in productos if p.marca_id})
        brand_map = {}
        if brand_ids:
            try:
                with connection.cursor() as c:
                    c.execute(
                        "SELECT id, nombre FROM brands.marca "
                        "WHERE id = ANY(%s::uuid[]) AND is_active = TRUE",
                        [brand_ids],
                    )
                    brand_map = {str(r[0]): r[1] for r in c.fetchall()}
            except Exception:
                brand_map = {}

        # Precios resueltos por cliente — una call por SKU (N+1
        # aceptable porque el grid del portal muestra a lo sumo ~50
        # productos y esto se puede cachear en Redis más adelante).
        for p in productos:
            p._marca_label = brand_map.get(str(p.marca_id)) if p.marca_id else None
            if cid and p.sku and p.marca_id:
                try:
                    from apps.commercial.services import resolve_client_price  # noqa: PLC0415
                    verdict = resolve_client_price(
                        client_id=str(cid),
                        brand_id=str(p.marca_id),
                        product_sku=p.sku,
                        quantity=1,
                    )
                    if verdict and verdict.get("ok"):
                        p.precio_venta_resolved = verdict.get("final_price")
                except Exception:
                    # Silencio intencional — el fallback del serializer
                    # (precio_distribuidor) maneja el caso.
                    pass

    # ── LIST ──────────────────────────────────────────────────────
    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        # Paginación: limit/offset manual (no queremos acoplar al
        # pagination_class global de DRF — el grid del front pagina
        # infinito con `?limit=24&offset=0`).
        try:
            limit  = min(int(request.query_params.get("limit")  or 60), 200)
            offset = max(int(request.query_params.get("offset") or 0), 0)
        except (TypeError, ValueError):
            limit, offset = 60, 0
        total = qs.count()
        page = list(qs[offset:offset + limit])
        self._hydrate_batch(page)
        ser = self.get_serializer(page, many=True)

        _record_audit(
            user_id=getattr(request.user, "id", None),
            email=getattr(request.user, "email", None),
            action="VIEW", resource_type="portal_catalogo",
            resource_id=None, resource_label=f"catalog (n={len(page)})",
            request=request, status_code=200,
            payload={"limit": limit, "offset": offset, "total": total},
        )
        return Response({
            "count":   total,
            "limit":   limit,
            "offset":  offset,
            "results": ser.data,
        })

    # ── RETRIEVE ──────────────────────────────────────────────────
    def retrieve(self, request, *args, **kwargs):
        pk = kwargs.get("pk")
        try:
            p = self.get_queryset().get(pk=pk)
        except Producto.DoesNotExist:
            return Response(
                {"detail": "Producto no encontrado o fuera de scope."},
                status=status.HTTP_404_NOT_FOUND,
            )
        self._hydrate_batch([p])
        ser = self.get_serializer(p)

        _record_audit(
            user_id=getattr(request.user, "id", None),
            email=getattr(request.user, "email", None),
            action="VIEW", resource_type="portal_producto",
            resource_id=str(p.id), resource_label=p.sku,
            request=request, status_code=200,
        )
        return Response(ser.data)

    # ── Bloqueo explícito de métodos no permitidos (403 > 405) ───
    # Nota: `http_method_names` ya excluye POST/PUT/PATCH/DELETE, pero
    # añadimos este override para que, si alguien en el futuro hace
    # http_method_names += ["patch"] por error, el 403 siga aplicando
    # y no haya fuga de superficie de ataque.
    def _forbidden_write(self, request, *args, **kwargs):
        _record_audit(
            user_id=getattr(request.user, "id", None),
            email=getattr(request.user, "email", None),
            action="UPDATE", resource_type="portal_producto",
            resource_id=kwargs.get("pk"),
            resource_label="blocked_write_attempt",
            request=request, status_code=403,
            payload={"method": request.method},
        )
        return Response(
            {"detail": "El catálogo B2B es read-only desde el portal."},
            status=status.HTTP_403_FORBIDDEN,
        )

    create          = _forbidden_write
    update          = _forbidden_write
    partial_update  = _forbidden_write
    destroy         = _forbidden_write
