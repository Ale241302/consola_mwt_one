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
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import MwtUser, PortalSessionLog, PortalAuditLog
from .serializers import (
    MwtUserListSerializer, MwtUserSerializer,
    PortalSessionLogSerializer, PortalAuditLogSerializer,
    ProductPortalListSerializer, ProductPortalDetailSerializer,
    ExpedientePortalListSerializer, ExpedientePortalDetailSerializer,
)
from apps.productos.models import Producto
from apps.expedientes.models import Expediente

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
    """LEGACY · Resuelve UN client_id del portal.

    Mantenido por retrocompat para `expediente_detail` u otros endpoints
    detail/RPC que aún esperan un cliente único.

    Orden de precedencia:
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


def _resolve_client_ids(request):
    """Sprint 2026-05-20 · Multi-empresa.

    Resuelve LISTA de client_ids (empresas) del portal. Orden de precedencia:
       1. JWT del usuario → query a `users.mwtuser.legal_entity_ids` (TEXT[]).
          Esto cubre el caso real: usuario tiene 1+ empresas asignadas.
       2. Override por query param `?empresa_id=` (filtra a UNA del set, debe
          estar en el array del usuario; si no, se ignora).
       3. Override por header `X-Portal-Client` (legacy, scope a UNA).
       4. Legacy `?client_id=` (mismo efecto que header).

    Retorna: lista de UUIDs como strings, posiblemente vacía si el usuario
    no tiene empresas asignadas (en cuyo caso la UI mostrará EmptyState
    "Aún no tienes empresas asignadas. Contactá a MWT.").

    IMPORTANTE (Sprint 2026-05-21 · fix multi-tabla):
      · `core.users` (login/JWT) y `users.mwtuser` (donde vive
        legal_entity_ids) son tablas INDEPENDIENTES con UUIDs
        distintos para el mismo usuario.
      · `seed_admins` solo siembra en core.users; los chips de empresa
        del UI /usuarios viven en users.mwtuser.
      · Por eso joineamos por EMAIL case-insensitive, no por id.
    """
    # 1. Empresas reales del usuario.
    #
    # Sprint 2026-05-21 · single source of truth.
    # `MwtJWTAuthentication.get_user` ya inyecta `legal_entity_ids` en
    # `request.user` (joineando users.mwtuser por email/id). Usamos ESA
    # lista como fuente canónica — evita duplicar el lookup SQL aquí y
    # garantiza que portal, expedientes y dashboards vean lo mismo.
    #
    # El fallback SQL queda como red de seguridad si por algún motivo el
    # campo no se hidrataba (auth backend distinto, etc).
    user_ids: list[str] = []
    u = getattr(request, "user", None)
    if u is not None and getattr(u, "is_authenticated", False):
        injected = list(getattr(u, "legal_entity_ids", None) or [])
        if injected:
            # Normalizar a lowercase. Defensa contra `legal_entity_ids`
            # guardado en mayúsculas (algunos paths del UI envían el
            # UUID como `str(uuid)` que es lowercase, pero impersonations
            # vía Tweaks podrían inyectar uppercase). El `client_id::text`
            # de PG siempre es lowercase.
            user_ids = [str(x).lower() for x in injected if x]

    # Fallback SQL si el campo no fue inyectado por la JWT auth.
    if not user_ids:
        try:
            if u is not None and getattr(u, "is_authenticated", False):
                email = (getattr(u, "email", "") or "").strip().lower()
                with connection.cursor() as cur:
                    if email:
                        cur.execute(
                            """
                            SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                              FROM users.mwtuser
                             WHERE lower(trim(email_plain)) = %s
                                OR lower(trim(COALESCE(contact_email, ''))) = %s
                             ORDER BY (CASE WHEN is_active THEN 0 ELSE 1 END),
                                      cardinality(COALESCE(legal_entity_ids, '{}'::TEXT[])) DESC,
                                      updated_at DESC NULLS LAST
                             LIMIT 1
                            """,
                            [email, email],
                        )
                        row = cur.fetchone()
                        if row and row[0]:
                            user_ids = [str(x) for x in row[0] if x]
                    if not user_ids:
                        cur.execute(
                            """
                            SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                              FROM users.mwtuser
                             WHERE id::text = %s
                             LIMIT 1
                            """,
                            [str(u.id)],
                        )
                        row = cur.fetchone()
                        if row and row[0]:
                            user_ids = [str(x) for x in row[0] if x]
        except Exception as e:
            log.warning("_resolve_client_ids fallback SQL falló: %s", e)
            user_ids = []

    # 2. Override: query param ?empresa_id (cliente activo del usuario)
    empresa_q = request.query_params.get("empresa_id")
    if empresa_q and (not user_ids or empresa_q in user_ids):
        return [empresa_q]

    # 3. Override: header X-Portal-Client (legacy, una sola empresa)
    hdr = request.headers.get("X-Portal-Client")
    if hdr:
        # Si user_ids está poblado y el header NO está, ignorarlo
        # (no podemos confiar en headers para autorización).
        if not user_ids or hdr in user_ids:
            return [hdr]

    # 4. Legacy ?client_id=
    cid_q = request.query_params.get("client_id")
    if cid_q and (not user_ids or cid_q in user_ids):
        return [cid_q]

    # 5. Por defecto: TODAS las empresas del usuario
    return user_ids


def _all_user_client_ids(request):
    """Variante de _resolve_client_ids que IGNORA empresa_id / X-Portal-Client
    y siempre devuelve la lista canónica de empresas del usuario logueado.
    Útil para /api/portal/me/ donde queremos exponer SIEMPRE el catálogo
    completo de empresas, independiente del filtro activo del UI.
    """
    user_ids: list[str] = []
    u = getattr(request, "user", None)
    if u is not None and getattr(u, "is_authenticated", False):
        injected = list(getattr(u, "legal_entity_ids", None) or [])
        if injected:
            user_ids = [str(x).lower() for x in injected if x]

    # Mismo fallback SQL por email/id que _resolve_client_ids
    if not user_ids:
        try:
            if u is not None and getattr(u, "is_authenticated", False):
                email = (getattr(u, "email", "") or "").strip().lower()
                with connection.cursor() as cur:
                    if email:
                        cur.execute(
                            """
                            SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                              FROM users.mwtuser
                             WHERE lower(trim(email_plain)) = %s
                                OR lower(trim(COALESCE(contact_email, ''))) = %s
                             ORDER BY (CASE WHEN is_active THEN 0 ELSE 1 END),
                                      cardinality(COALESCE(legal_entity_ids, '{}'::TEXT[])) DESC,
                                      updated_at DESC NULLS LAST
                             LIMIT 1
                            """,
                            [email, email],
                        )
                        row = cur.fetchone()
                        if row and row[0]:
                            user_ids = [str(x) for x in row[0] if x]
                    if not user_ids:
                        cur.execute(
                            """
                            SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                              FROM users.mwtuser
                             WHERE id::text = %s
                             LIMIT 1
                            """,
                            [str(u.id)],
                        )
                        row = cur.fetchone()
                        if row and row[0]:
                            user_ids = [str(x) for x in row[0] if x]
        except Exception as e:
            log.warning("_all_user_client_ids fallback SQL falló: %s", e)
            user_ids = []

    return user_ids


def _user_identity(request):
    """Devuelve {id, email, full_name} del usuario logueado o None.
    Resuelve full_name desde users.mwtuser via email/id (core.users solo
    tiene email/username y dispatch_admin)."""
    u = getattr(request, "user", None)
    if u is None or not getattr(u, "is_authenticated", False):
        return None
    out = {
        "id":         str(getattr(u, "id", "") or ""),
        "email":      getattr(u, "email", "") or "",
        "full_name":  None,
    }
    try:
        email = (out["email"] or "").strip().lower()
        with connection.cursor() as cur:
            if email:
                cur.execute(
                    """
                    SELECT full_name
                      FROM users.mwtuser
                     WHERE lower(trim(email_plain)) = %s
                        OR lower(trim(COALESCE(contact_email, ''))) = %s
                     ORDER BY (CASE WHEN is_active THEN 0 ELSE 1 END),
                              updated_at DESC NULLS LAST
                     LIMIT 1
                    """,
                    [email, email],
                )
                row = cur.fetchone()
                if row and row[0]:
                    out["full_name"] = row[0]
            if not out["full_name"] and out["id"]:
                cur.execute(
                    "SELECT full_name FROM users.mwtuser WHERE id::text = %s LIMIT 1",
                    [out["id"]],
                )
                row = cur.fetchone()
                if row and row[0]:
                    out["full_name"] = row[0]
    except Exception as e:
        log.warning("_user_identity lookup falló: %s", e)
    return out


def _forbidden():
    return Response(
        {"detail": "No se pudo resolver el cliente del portal."},
        status=status.HTTP_403_FORBIDDEN,
    )


def _empty_scope():
    """Helper para retornar [] cuando el user no tiene empresas asignadas."""
    return Response([], status=status.HTTP_200_OK)


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
        """Sprint 2026-05-20 · Multi-empresa.

        Devuelve TODAS las empresas del usuario (vía users.mwtuser.legal_entity_ids).
        Shape:
          {
            empresas: [
              { id, nombre, contacto, email, telefono, credit_days, pais_iso2 },
              ...
            ],
            primary: { ...primera empresa de la lista... }  // retrocompat
          }
        Si el usuario no tiene empresas asignadas, devuelve
        `{user: {...}, empresas: [], primary: null}`.

        IMPORTANTE — Sprint 2026-05-21 · multi-empresa.
        Este endpoint IGNORA `?empresa_id=` y `X-Portal-Client`. Siempre
        devuelve TODAS las empresas del usuario para que el chip-row del
        portal pueda mostrar el catálogo completo y permitir cambiar de
        empresa activa sin perder las otras opciones. El filtro vivo
        sigue aplicándose en mis_ocs/mis_expedientes/mis_pagos.
        """
        user = _user_identity(request)
        cids = _all_user_client_ids(request)
        if not cids:
            return Response({"user": user, "empresas": [], "primary": None})

        # Una sola query con IN (...) — sin N+1
        placeholders = ",".join(["%s"] * len(cids))
        rows = _fetchall(
            f"""
            SELECT id::text,
                   COALESCE(nombre_comercial, razon_social) AS nombre,
                   contacto_nombre AS contacto,
                   contacto_email  AS email,
                   contacto_tel    AS telefono,
                   dias_credito    AS credit_days,
                   pais_iso2
              FROM clientes.cliente
             WHERE lower(id::text) IN ({placeholders})
               AND is_active = TRUE
             ORDER BY COALESCE(nombre_comercial, razon_social)
            """,
            cids,
        )
        empresas = rows or []
        return Response({
            "user":     user,
            "empresas": empresas,
            "primary":  empresas[0] if empresas else None,
        })

    # ── /api/portal/mis_ocs/ ──────────────────────────────────
    @action(detail=False, methods=["get"])
    def mis_ocs(self, request):
        """Lista de órdenes (OCs) de las empresas del usuario.

        Sprint 2026-05-20 · Multi-empresa. Devuelve OCs de TODAS las
        empresas asignadas al usuario (vía legal_entity_ids[]) — o de
        una sola si se pasa ?empresa_id=.

        Sprint 2026-05-21 · fix DB drift.
        Las OCs en BD pueden tener `oc.client_id` NULL mientras los
        expedientes hijos sí tienen client_id correcto. Por eso aquí
        incluimos UNION lógica:
          · OCs cuyo `client_id` matchea, O
          · OCs que tienen algún expediente con `client_id` del usuario.

        Rev 2026-05-21b · Scope dual: agregamos `operating_company_id`
        del expediente hijo a la UNION. Alineado con mis_expedientes y
        ExpedienteViewSet de la consola interna — una empresa asignada
        ve sus OCs también cuando es la operadora del expediente.

        Incluye `client_id` y `client_name` para agrupar por empresa.
        """
        cids = _resolve_client_ids(request)
        if not cids:
            return _empty_scope()

        placeholders = ",".join(["%s"] * len(cids))
        # Rev 2026-05-21c · EXISTS en vez de LATERAL+LIMIT 1.
        # Bug previo: el LATERAL solo evaluaba EL PRIMER expediente hijo, así
        # que si la OC tenia multiples expedientes el match fallaba si el
        # primero no era el que matcheaba con cids. EXISTS examina TODOS los
        # expedientes hijos. Tambien cubre OCs cuyo `client_id` esta NULL
        # pero algun expediente hijo tiene `operating_company_id` del usuario.
        rows = _fetchall(
            f"""
            SELECT DISTINCT
              o.id, o.codigo, o.brand_id, o.proforma, o.moneda,
              o.total_value, o.total_invoiced, o.total_paid, o.balance,
              o.coverage_pct, o.lines_count, o.issued_at, o.estado,
              COALESCE(o.client_id, exp_first.client_id) AS client_id,
              COALESCE(c.nombre_comercial, c.razon_social) AS client_name
            FROM expedientes.oc o
            LEFT JOIN LATERAL (
              SELECT e.client_id, e.operating_company_id
                FROM expedientes.expediente e
               WHERE e.oc_id = o.id
                 AND e.is_active = TRUE
               ORDER BY (e.client_id IS NOT NULL) DESC,
                        e.created_at ASC
               LIMIT 1
            ) exp_first ON TRUE
            LEFT JOIN clientes.cliente c
                   ON c.id = COALESCE(o.client_id, exp_first.client_id)
            WHERE o.is_active = TRUE
              AND (
                lower(o.client_id::text) IN ({placeholders})
                OR EXISTS (
                  SELECT 1
                    FROM expedientes.expediente e2
                   WHERE e2.oc_id = o.id
                     AND e2.is_active = TRUE
                     AND (
                       lower(e2.client_id::text) IN ({placeholders})
                       OR lower(e2.operating_company_id::text) IN ({placeholders})
                     )
                )
              )
            ORDER BY o.issued_at DESC NULLS LAST, o.created_at DESC
            LIMIT 100
            """,
            list(cids) + list(cids) + list(cids),
        )
        return Response(rows)

    # ── /api/portal/mis_expedientes/ ──────────────────────────
    @action(detail=False, methods=["get"])
    def mis_expedientes(self, request):
        """Lista de expedientes de las empresas del usuario (multi-empresa).

        NOTA: NO expone total_cost, projected_margin, real_margin,
              commission_pct, modo_operacion, phase_signal, is_blocked,
              supplier_id. Sólo se incluyen los campos seguros del spec.

        Sprint 2026-05-20: devuelve además `oc_codigo`, `oc_proforma`,
        `brand_name`, `client_id`, `client_name` para que el frontend
        no haga lookups separados.
        """
        cids = _resolve_client_ids(request)
        if not cids:
            return _empty_scope()

        # Rev 2026-05-21b · Scope dual: client_id ∪ operating_company_id.
        # Alineado con apps.expedientes.views.ExpedienteViewSet.list().
        # Una empresa asignada al usuario puede actuar como cliente final
        # o como operadora del expediente; ambos casos cuentan.
        placeholders = ",".join(["%s"] * len(cids))
        rows = _fetchall(
            f"""
            SELECT
              e.id, e.codigo, e.oc_id, e.brand_id,
              e.estado,
              e.origin, e.destination, e.freight_mode,
              e.eta, e.last_event_at,
              e.total_invoiced, e.total_paid, e.balance,
              e.client_id,
              o.codigo   AS oc_codigo,
              o.proforma AS oc_proforma,
              COALESCE(c.nombre_comercial, c.razon_social) AS client_name,
              m.nombre   AS brand_name
            FROM expedientes.expediente e
            LEFT JOIN expedientes.oc    o ON o.id = e.oc_id
            LEFT JOIN clientes.cliente  c ON c.id = e.client_id
            LEFT JOIN brands.marca      m ON m.id = e.brand_id
            WHERE e.is_active = TRUE
              AND (
                lower(e.client_id::text) IN ({placeholders})
                OR lower(e.operating_company_id::text) IN ({placeholders})
              )
            ORDER BY e.last_event_at DESC, e.created_at DESC
            LIMIT 100
            """,
            list(cids) + list(cids),
        )
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
        """Historial de pagos (INGRESO) de las empresas del usuario."""
        cids = _resolve_client_ids(request)
        if not cids:
            return _empty_scope()

        placeholders = ",".join(["%s"] * len(cids))
        rows = _fetchall(
            f"""
            SELECT
              p.id, p.codigo, p.oc_id, p.expediente_id,
              p.metodo, p.moneda, p.monto, p.monto_usd,
              p.fecha_operacion, p.fecha_acreditacion,
              p.estado, p.referencia_externa,
              p.client_id,
              c.nombre AS client_name
            FROM cobros.pago p
            LEFT JOIN clientes.cliente c ON c.id = p.client_id
            WHERE p.is_active = TRUE
              AND lower(p.client_id::text) IN ({placeholders})
              AND p.direccion = 'INGRESO'
            ORDER BY p.fecha_operacion DESC, p.created_at DESC
            LIMIT 200
            """,
            cids,
        )
        return Response(rows)

    # ── /api/portal/mis_cobros/ ───────────────────────────────
    @action(detail=False, methods=["get"])
    def mis_cobros(self, request):
        """Cobros vigentes de las empresas del usuario."""
        cids = _resolve_client_ids(request)
        if not cids:
            return _empty_scope()

        placeholders = ",".join(["%s"] * len(cids))
        rows = _fetchall(
            f"""
            SELECT
              id, codigo, oc_id, expediente_id,
              monto_total, monto_pagado, monto_pendiente,
              fecha_vencimiento, dias_credito, estado,
              client_id
            FROM cobros.cobro
            WHERE is_active = TRUE
              AND lower(client_id::text) IN ({placeholders})
            ORDER BY fecha_vencimiento ASC, created_at DESC
            LIMIT 100
            """,
            cids,
        )
        return Response(rows)

    # ── /api/portal/mis_documentos/ ───────────────────────────
    @action(detail=False, methods=["get"])
    def mis_documentos(self, request):
        """Documentos de las empresas del usuario (OCs + expedientes).

        Sprint 2026-05-20 · Multi-empresa. La tab Documentos del Portal
        está siendo eliminada (mandato CEO §4), pero el endpoint se
        mantiene porque el detalle de cada expediente sigue listando
        documentos. Por eso seguimos exponiéndolo.
        """
        cids = _resolve_client_ids(request)
        if not cids:
            return _empty_scope()

        placeholders = ",".join(["%s"] * len(cids))
        rows = _fetchall(
            f"""
            SELECT
              d.id, d.oc_id, d.expediente_id, d.kind, d.codigo, d.titulo,
              d.fecha, d.storage_url
            FROM expedientes.documento d
            WHERE d.is_active = TRUE
              AND (
                d.oc_id IN (SELECT id FROM expedientes.oc
                            WHERE lower(client_id::text) IN ({placeholders})
                              AND is_active = TRUE)
                OR d.expediente_id IN (SELECT id FROM expedientes.expediente
                                       WHERE lower(client_id::text) IN ({placeholders})
                                         AND is_active = TRUE)
              )
            ORDER BY d.fecha DESC, d.created_at DESC
            LIMIT 200
            """,
            cids + cids,
        )
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

    # ── /api/portal/_debug/ ───────────────────────────────────
    @action(detail=False, methods=["get"], url_path="_debug")
    def _debug(self, request):
        """Diagnóstico del scope del portal (CEO/staff únicamente).

        Devuelve EXACTAMENTE qué encuentra el resolver en cada paso:
          · request.user info (id, email, role)
          · Filas de users.mwtuser que coincidan por email y por id
          · client_ids resueltos
          · Para cada client_id: nombre + is_active

        Útil para diagnosticar por qué `empresas` viene vacío.
        Solo accesible para staff (CEO/admin).
        """
        u = getattr(request, "user", None)
        role = (getattr(u, "role", "") or "").lower()
        email = (getattr(u, "email", "") or "").strip().lower()

        # Limitar a staff por seguridad (cliente B2B no debe ver internals)
        staff_roles = {"superadmin", "admin", "ceo", "manager"}
        if role not in staff_roles:
            return Response(
                {"detail": "Debug endpoint only for staff."},
                status=status.HTTP_403_FORBIDDEN,
            )

        injected_ids = list(getattr(u, "legal_entity_ids", None) or [])
        out = {
            "request_user": {
                "id":    str(getattr(u, "id", None)),
                "email": getattr(u, "email", None),
                "role":  role,
                "injected_legal_entity_ids": injected_ids,
            },
            "lookup_email_lowercased": email,
            "mwtuser_by_email":   [],
            "mwtuser_by_id":      [],
            "all_alejandro_rows": [],     # Búsqueda LIKE en email
            "resolved_client_ids": [],
            "resolved_empresas":   [],
            "sample_expedientes":  [],
            "sample_clientes":     [],
        }

        try:
            with connection.cursor() as cur:
                # Filas en users.mwtuser que matcheen email
                cur.execute("""
                    SELECT id::text, email_plain, contact_email,
                           is_active, legal_entity_ids
                      FROM users.mwtuser
                     WHERE lower(trim(email_plain)) = %s
                        OR lower(trim(COALESCE(contact_email, ''))) = %s
                """, [email, email])
                for r in cur.fetchall():
                    out["mwtuser_by_email"].append({
                        "id":               r[0],
                        "email_plain":      r[1],
                        "contact_email":    r[2],
                        "is_active":        r[3],
                        "legal_entity_ids": list(r[4]) if r[4] else [],
                    })

                # Filas en users.mwtuser que matcheen id (case-insensitive)
                cur.execute("""
                    SELECT id::text, email_plain, is_active, legal_entity_ids
                      FROM users.mwtuser
                     WHERE lower(id::text) = lower(%s)
                """, [str(getattr(u, "id", "")) or "x"])
                for r in cur.fetchall():
                    out["mwtuser_by_id"].append({
                        "id":               r[0],
                        "email_plain":      r[1],
                        "is_active":        r[2],
                        "legal_entity_ids": list(r[3]) if r[3] else [],
                    })

                # Búsqueda LIKE — captura emails con minúsculas/mayúsculas
                # mixtas o variantes. Útil para diagnosticar duplicados.
                local = email.split("@")[0] if "@" in email else email
                cur.execute("""
                    SELECT id::text, email_plain, is_active, legal_entity_ids,
                           created_at::text, updated_at::text
                      FROM users.mwtuser
                     WHERE email_plain ILIKE %s
                     ORDER BY updated_at DESC NULLS LAST
                     LIMIT 5
                """, [f"%{local}%"])
                for r in cur.fetchall():
                    out["all_alejandro_rows"].append({
                        "id":               r[0],
                        "email_plain":      r[1],
                        "is_active":        r[2],
                        "legal_entity_ids": list(r[3]) if r[3] else [],
                        "created_at":       r[4],
                        "updated_at":       r[5],
                    })

                # Muestra de expedientes activos — para ver el formato del
                # client_id (mayúsculas vs minúsculas) en la BD.
                cur.execute("""
                    SELECT codigo, client_id::text, is_active, estado
                      FROM expedientes.expediente
                     WHERE is_active = TRUE
                     ORDER BY last_event_at DESC NULLS LAST
                     LIMIT 5
                """)
                for r in cur.fetchall():
                    out["sample_expedientes"].append({
                        "codigo":    r[0],
                        "client_id": r[1],
                        "is_active": r[2],
                        "estado":    r[3],
                    })

                # Muestra de clientes activos
                cur.execute("""
                    SELECT id::text,
                           COALESCE(nombre_comercial, razon_social) AS nombre,
                           is_active
                      FROM clientes.cliente
                     WHERE is_active = TRUE
                     ORDER BY COALESCE(nombre_comercial, razon_social)
                     LIMIT 10
                """)
                for r in cur.fetchall():
                    out["sample_clientes"].append({
                        "id":        r[0],
                        "nombre":    r[1],
                        "is_active": r[2],
                    })
        except Exception as e:
            out["error"] = str(e)

        cids = _resolve_client_ids(request)
        out["resolved_client_ids"] = cids

        if cids:
            placeholders = ",".join(["%s"] * len(cids))
            empresas = _fetchall(
                f"""
                SELECT id::text,
                       COALESCE(nombre_comercial, razon_social) AS nombre,
                       is_active
                  FROM clientes.cliente
                 WHERE lower(id::text) IN ({placeholders})
                """,
                cids,
            )
            out["resolved_empresas"] = empresas

            # Probar el mismo query que mis_expedientes
            exp_count = _fetchone(
                f"""
                SELECT COUNT(*)::int
                  FROM expedientes.expediente
                 WHERE is_active = TRUE
                   AND lower(client_id::text) IN ({placeholders})
                """,
                cids,
            )
            out["mis_expedientes_count"] = (exp_count[0] if exp_count else 0)

        return Response(out)

    # ── /api/portal/_my_debug/ ────────────────────────────────
    # Sprint 2026-05-21 · Diagnóstico user-level del drift core.users ↔ users.mwtuser.
    # A diferencia de _debug (staff only), éste lo puede abrir CUALQUIER usuario
    # autenticado y ver SOLO sus propios datos. Útil cuando un CLIENT reporta
    # "no veo nada en el portal" — abrimos este endpoint con su sesión y vemos
    # exactamente qué injecta el JWT vs qué hay en users.mwtuser.
    # NO expone datos de otros usuarios. NO expone claims internos del JWT.
    @action(detail=False, methods=["get"], url_path="_my_debug")
    def _my_debug(self, request):
        u = getattr(request, "user", None)
        if u is None or not getattr(u, "is_authenticated", False):
            return Response(
                {"detail": "Debes estar autenticado para diagnosticar tu scope."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        injected_ids = list(getattr(u, "legal_entity_ids", None) or [])
        email = (getattr(u, "email", "") or "").strip().lower()
        uid   = str(getattr(u, "id", "") or "")

        out = {
            "jwt_view": {
                "user_id":           uid,
                "email":             getattr(u, "email", None),
                "role":              getattr(u, "role", None),
                "legal_entity_ids":  injected_ids,
                "n_empresas_jwt":    len(injected_ids),
            },
            "users_mwtuser_lookup": {
                "by_id":    None,
                "by_email": None,
            },
            "join_diagnosis": None,
            "resolved_empresas": [],
        }

        try:
            with connection.cursor() as cur:
                # 1) ¿Existe el mismo UUID en users.mwtuser?
                cur.execute("""
                    SELECT id::text, email_plain, contact_email, is_active,
                           role_default,
                           COALESCE(legal_entity_ids, '{}'::TEXT[]) AS leis,
                           cardinality(COALESCE(legal_entity_ids, '{}'::TEXT[])) AS n_leis
                      FROM users.mwtuser
                     WHERE lower(id::text) = lower(%s)
                     LIMIT 1
                """, [uid])
                r = cur.fetchone()
                if r:
                    out["users_mwtuser_lookup"]["by_id"] = {
                        "id":               r[0],
                        "email_plain":      r[1],
                        "contact_email":    r[2],
                        "is_active":        r[3],
                        "role_default":     r[4],
                        "legal_entity_ids": list(r[5] or []),
                        "n_empresas":       r[6],
                    }

                # 2) ¿Existe el mismo email en users.mwtuser?
                if email:
                    cur.execute("""
                        SELECT id::text, email_plain, contact_email, is_active,
                               role_default,
                               COALESCE(legal_entity_ids, '{}'::TEXT[]) AS leis,
                               cardinality(COALESCE(legal_entity_ids, '{}'::TEXT[])) AS n_leis
                          FROM users.mwtuser
                         WHERE lower(trim(email_plain)) = %s
                            OR lower(trim(COALESCE(contact_email,''))) = %s
                         ORDER BY (CASE WHEN is_active THEN 0 ELSE 1 END),
                                  cardinality(COALESCE(legal_entity_ids, '{}'::TEXT[])) DESC,
                                  updated_at DESC NULLS LAST
                         LIMIT 1
                    """, [email, email])
                    r = cur.fetchone()
                    if r:
                        out["users_mwtuser_lookup"]["by_email"] = {
                            "id":               r[0],
                            "email_plain":      r[1],
                            "contact_email":    r[2],
                            "is_active":        r[3],
                            "role_default":     r[4],
                            "legal_entity_ids": list(r[5] or []),
                            "n_empresas":       r[6],
                        }

            # 3) Diagnóstico humano-legible
            by_id    = out["users_mwtuser_lookup"]["by_id"]
            by_email = out["users_mwtuser_lookup"]["by_email"]
            if injected_ids:
                out["join_diagnosis"] = "JWT injecto legal_entity_ids correctamente."
            elif by_id and by_id["n_empresas"] > 0:
                out["join_diagnosis"] = (
                    "DRIFT por email: el UUID del JWT existe en users.mwtuser "
                    "y tiene empresas, pero el JOIN por email fallo. "
                    "Probable email_plain distinto entre core.users y users.mwtuser."
                )
            elif by_email and by_email["n_empresas"] > 0:
                out["join_diagnosis"] = (
                    "DRIFT por UUID: el email existe en users.mwtuser con "
                    "empresas, pero el UUID es distinto al del JWT. "
                    "El JWT auth deberia haber matcheado por email — verificar "
                    "que el email del JWT (core.users.email_plain) este poblado."
                )
            elif by_id or by_email:
                out["join_diagnosis"] = (
                    "Usuario existe en users.mwtuser pero SIN empresas asignadas. "
                    "Ir a /usuarios/{id} y asignar al menos una."
                )
            else:
                out["join_diagnosis"] = (
                    "Usuario NO existe en users.mwtuser. Crear primero la "
                    "ficha desde /usuarios y asignar empresas."
                )

            # 4) ¿Qué empresas resuelve el portal hoy?
            cids = _resolve_client_ids(request)
            if cids:
                placeholders = ",".join(["%s"] * len(cids))
                empresas = _fetchall(
                    f"""
                    SELECT id::text,
                           COALESCE(nombre_comercial, razon_social) AS nombre,
                           is_active
                      FROM clientes.cliente
                     WHERE lower(id::text) IN ({placeholders})
                    """,
                    cids,
                )
                out["resolved_empresas"] = empresas

        except Exception as e:
            out["error"] = str(e)

        return Response(out)

    # ── /api/portal/kpis/ ─────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """KPIs agregados sobre TODAS las empresas del usuario (multi-empresa).

        Sprint 2026-05-20 · Frontend ya no debe renderizar 0%/0$ con
        delta encima — si TODAS las métricas vienen en 0, mostrar
        EmptyState 'Aún sin facturación'. Por eso este endpoint además
        devuelve `is_empty: true` para que el frontend lo detecte sin
        recalcular.
        """
        cids = _resolve_client_ids(request)
        out = {
            "ocs_activas":       0,
            "total_invoiced":    0.0,
            "total_paid":        0.0,
            "balance":           0.0,
            "coverage_pct":      None,   # null → EmptyState honesto
            "credit_days_limit": 0,
            "credit_days_used":  0,
            "is_empty":          True,
            "scope_empresa_count": len(cids),
        }
        if not cids:
            # Usuario sin empresas asignadas
            return Response(out)

        placeholders = ",".join(["%s"] * len(cids))

        # KPI principal: OCs y montos sumados sobre las empresas del usuario
        r = _fetchone(
            f"""
            SELECT
              COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO','CANCELADA')),
              COALESCE(SUM(total_invoiced),0),
              COALESCE(SUM(total_paid),0),
              COALESCE(SUM(balance),0)
            FROM expedientes.oc
            WHERE is_active = TRUE AND lower(client_id::text) IN ({placeholders})
            """,
            cids,
        )
        if r:
            out["ocs_activas"]    = r[0] or 0
            out["total_invoiced"] = float(r[1] or 0)
            out["total_paid"]     = float(r[2] or 0)
            out["balance"]        = float(r[3] or 0)
            if out["total_invoiced"] > 0:
                out["coverage_pct"] = out["total_paid"] / out["total_invoiced"]
                out["is_empty"] = False
            elif out["ocs_activas"] > 0 or out["balance"] > 0:
                # Hay OCs pero sin facturación todavía
                out["is_empty"] = False

        # Crédito límite: el MENOR de las empresas asignadas
        # (el usuario está limitado por la más restrictiva).
        r = _fetchone(
            f"""
            SELECT COALESCE(MIN(dias_credito), 0)
            FROM clientes.cliente
            WHERE lower(id::text) IN ({placeholders}) AND is_active = TRUE
            """,
            cids,
        )
        if r:
            out["credit_days_limit"] = r[0] or 0

        # Máximo de credit_days en expedientes activos → días usados
        r = _fetchone(
            f"""
            SELECT COALESCE(MAX(credit_days), 0)
            FROM expedientes.expediente
            WHERE is_active = TRUE
              AND lower(client_id::text) IN ({placeholders})
              AND estado NOT IN ('CERRADO','CANCELADA')
            """,
            cids,
        )
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

    # Roles considerados "staff interno MWT" — pueden navegar el catálogo
    # sin scope de cliente B2B. El filtro por visibility_tier sigue
    # aplicando (staff NO accede a productos CEO-ONLY por esta ruta;
    # para eso está /api/productos/ del backoffice).
    _STAFF_ROLES = {
        "superadmin", "admin", "ceo", "manager", "operator",
        "finance", "viewer", "compras",
    }

    # ── SECURITY GATE ─────────────────────────────────────────────
    def initial(self, request, *args, **kwargs):
        """Enforce client scope ANTES de ejecutar la acción.

        Sprint 2026-05-21 · Multi-empresa:
          Usa `_resolve_client_ids` (lista) para soportar usuarios
          que tienen N empresas en `users.mwtuser.legal_entity_ids`.
          El primer elemento se expone como `_portal_client_id` para
          retrocompat con el resolver de precios + filtro por brand_id.
          La lista completa queda en `_portal_client_ids` por si el
          queryset la necesita (ej. brands de todas las empresas).

        Política:
          · staff interno MWT  → scope opcional. Si no hay scope,
                                 ven el catálogo completo filtrado por
                                 visibility_tier (sin personalización
                                 de precio por cliente).
          · cliente B2B        → scope obligatorio. Si no podemos
                                 resolver al menos UNA empresa → 403
                                 explícito (no 401/404) para no filtrar
                                 existencia.
        """
        super().initial(request, *args, **kwargs)
        role = (getattr(request.user, "role", "") or "").lower()
        cids = _resolve_client_ids(request)
        cid = cids[0] if cids else None

        if role in self._STAFF_ROLES:
            # Staff: scope opcional.
            request._portal_client_id  = cid          # puede ser None
            request._portal_client_ids = cids or []   # puede ser []
            return

        # Cliente B2B: scope obligatorio
        if not cids:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("No se pudo resolver el cliente del portal.")
        request._portal_client_id  = cid
        request._portal_client_ids = cids

    # ── QUERYSET — scope + gobernanza ─────────────────────────────
    #
    # Sprint 2026-05-21 · fix gobernanza producto↔cliente.
    # La gobernanza producto-cliente vive en
    #   `productos.producto.especificaciones->visibility`
    # con shape:
    #   { "visible_to_all": bool, "client_overrides": { "<client_uuid>": bool } }
    #
    # Reglas de visibilidad (POL_VISIBILIDAD_PRODUCTO):
    #   · visible_to_all === TRUE  → todos los clientes B2B lo ven.
    #   · visible_to_all === FALSE → solo lo ven los clientes con override TRUE.
    #
    # Esto OVERRIDEA el `visibility_tier` legacy. Aquí asumimos que cualquier
    # producto activo es candidato; la decisión final es por JSON.
    def get_queryset(self):
        qs = Producto.objects.filter(is_active=True)

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

        # Resolver client_ids del scope (multi-empresa)
        cids = getattr(self.request, "_portal_client_ids", None) or []
        if not cids:
            cid_single = getattr(self.request, "_portal_client_id", None)
            if cid_single:
                cids = [str(cid_single)]

        # ── Gobernanza por especificaciones.visibility ────────────────
        # Si el usuario tiene N empresas, el producto se incluye si:
        #   - visibility.visible_to_all = TRUE  (todos los clientes lo ven)
        #   - OR  visibility.client_overrides[<empresa_id>] = TRUE  para
        #         alguna de las empresas del usuario.
        #
        # Para evitar Q complejos, hacemos un OR construido con extra(where=).
        if cids:
            # Cada empresa contribuye una cláusula
            # (especificaciones->'visibility'->'client_overrides'->><id>)::boolean = TRUE
            override_clauses = []
            params = []
            for cid in cids:
                override_clauses.append(
                    "(especificaciones->'visibility'->'client_overrides'->>%s)::text = 'true'"
                )
                params.append(str(cid))
            override_or = " OR ".join(override_clauses) if override_clauses else "FALSE"
            qs = qs.extra(  # noqa: S610 — params binded
                where=[
                    f"(COALESCE((especificaciones->'visibility'->>'visible_to_all')::text, 'true') = 'true' "
                    f" OR ({override_or}))"
                ],
                params=params,
            )
        else:
            # Sin scope (staff sin impersonación): mostramos solo productos
            # marcados como visibles para TODOS los clientes (no expongamos
            # productos sensibles por defecto).
            qs = qs.extra(
                where=[
                    "(COALESCE((especificaciones->'visibility'->>'visible_to_all')::text, 'true') = 'true')"
                ],
            )

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
        #
        # Sprint 2026-05-22 · Leemos `?tc=<usd_brl>` del request. El
        # frontend del portal envía la cotización en vivo (mismo hook
        # useExchangeRateUSDBRL que usa el admin) para que el backend
        # escoja la banda Marluvas vigente al resolver el precio 90d.
        # Si no viene, services.resolve_client_price() cae a banda 6.
        tc_raw = (self.request.query_params.get("tc")
                  if hasattr(self.request, "query_params") else None)
        try:
            tc_usd_brl = float(tc_raw) if tc_raw not in (None, "", "null") else None
        except (TypeError, ValueError):
            tc_usd_brl = None

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
                        tc_usd_brl=tc_usd_brl,
                    )
                    if verdict and verdict.get("ok"):
                        p.precio_venta_resolved = verdict.get("final_price")
                        p._resolved_banda_id = verdict.get("banda_id")
                except Exception as e:
                    # Log estructurado — antes era silencio total y eso
                    # ocultó el ImportError del services.py inexistente
                    # por semanas (se manifestaba como "Consultar precio"
                    # en todas las cards del portal).
                    log.warning(
                        "portal._hydrate_batch · resolve_client_price "
                        "falló · sku=%s brand=%s client=%s tc=%s · %s",
                        p.sku, p.marca_id, cid, tc_usd_brl, e,
                    )

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


# ══════════════════════════════════════════════════════════════════════
# PortalExpedienteViewSet — Detalle de expediente del cliente B2B
#
# GET  /api/portal/expedientes/        → list (expedientes del cliente)
# GET  /api/portal/expedientes/{id}/   → detalle strip-down
# POST / PUT / PATCH / DELETE          → 403 Forbidden (read-only)
#
# Reglas (DEFENSA EN PROFUNDIDAD):
#   1. Scope obligatorio por `_resolve_client_id`.
#      · Staff (admin/manager/…) puede impersonar vía X-Portal-Client.
#      · CLIENT B2B debe aportar scope del JWT/header/query.
#   2. Filtrado por client_id — un cliente sólo ve SUS expedientes.
#   3. Serializer strip-down: NUNCA expone total_cost, projected_margin,
#      real_margin, modo_operacion, freight_mode, transport_mode,
#      dispatch_mode, price_basis, credit_band, credit_days, phase_signal,
#      cost_lines, margins, available_transitions, supplier_id.
#   4. PATCH/PUT/POST/DELETE → 403 explícito + audit log.
# ══════════════════════════════════════════════════════════════════════
class PortalExpedienteViewSet(viewsets.ReadOnlyModelViewSet):
    """Detalle de expediente del portal B2B. 100% read-only, strip-down."""

    serializer_class = ExpedientePortalListSerializer
    http_method_names = ["get", "head", "options"]

    _STAFF_ROLES = {
        "superadmin", "admin", "ceo", "manager", "operator",
        "finance", "viewer", "compras",
    }

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ExpedientePortalDetailSerializer
        return ExpedientePortalListSerializer

    # ── SECURITY GATE ─────────────────────────────────────────────
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        role = (getattr(request.user, "role", "") or "").lower()
        cids = _resolve_client_ids(request)
        cid  = cids[0] if cids else None

        if role in self._STAFF_ROLES:
            # Staff: scope opcional (para impersonar en dev vía Tweaks).
            request._portal_client_id  = cid
            request._portal_client_ids = cids or []
            return

        # Cliente B2B: scope obligatorio
        if not cids:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("No se pudo resolver el cliente del portal.")
        request._portal_client_id  = cid
        request._portal_client_ids = cids

    def get_queryset(self):
        # Rev 2026-05-21b · Scope dual: client_id ∪ operating_company_id.
        # Alineado con mis_expedientes (mismo módulo) y ExpedienteViewSet
        # de la consola interna. El portal expone el expediente cuando la
        # empresa del usuario es cliente final O operadora.
        qs = Expediente.objects.filter(is_active=True)
        cids = getattr(self.request, "_portal_client_ids", None) or []
        if cids:
            qs = qs.filter(
                Q(client_id__in=cids) | Q(operating_company_id__in=cids)
            )
        else:
            cid = getattr(self.request, "_portal_client_id", None)
            if cid:
                qs = qs.filter(Q(client_id=cid) | Q(operating_company_id=cid))
        # Filtros opcionales útiles en el front (por OC, brand, estado)
        oc_id    = self.request.query_params.get("oc_id")
        brand_id = self.request.query_params.get("brand_id")
        estado   = self.request.query_params.get("estado")
        if oc_id:    qs = qs.filter(oc_id=oc_id)
        if brand_id: qs = qs.filter(brand_id=brand_id)
        if estado:   qs = qs.filter(estado=estado)
        return qs.order_by("-last_event_at", "-created_at")

    def retrieve(self, request, *args, **kwargs):
        try:
            exp = self.get_queryset().get(pk=kwargs.get("pk"))
        except Expediente.DoesNotExist:
            return Response(
                {"detail": "Expediente no encontrado o fuera de scope."},
                status=status.HTTP_404_NOT_FOUND,
            )
        data = self.get_serializer(exp).data

        # Firmar URLs de documentos (best-effort)
        for d in (data.get("documentos") or []):
            raw_key = d.get("storage_url")
            if not raw_key:
                continue
            try:
                from apps.storage.services import generate_signed_url  # noqa: PLC0415
                signed = generate_signed_url(key=raw_key, kind="get", ttl=900)
                d["storage_url"]         = signed.get("url") or raw_key
                d["signed_url_ttl_sec"]  = 900
            except Exception:
                d["signed_url_ttl_sec"] = 0

        _record_audit(
            user_id=getattr(request.user, "id", None),
            email=getattr(request.user, "email", None),
            action="VIEW", resource_type="portal_expediente",
            resource_id=str(exp.id), resource_label=exp.codigo,
            request=request, status_code=200,
        )
        return Response(data)

    # ── Bloqueo explícito de writes (403 > 405) ──────────────────
    def _forbidden_write(self, request, *args, **kwargs):
        _record_audit(
            user_id=getattr(request.user, "id", None),
            email=getattr(request.user, "email", None),
            action="UPDATE", resource_type="portal_expediente",
            resource_id=kwargs.get("pk"),
            resource_label="blocked_write_attempt",
            request=request, status_code=403,
            payload={"method": request.method},
        )
        return Response(
            {"detail": "El portal B2B es read-only para expedientes."},
            status=status.HTTP_403_FORBIDDEN,
        )

    create         = _forbidden_write
    update         = _forbidden_write
    partial_update = _forbidden_write
    destroy        = _forbidden_write
