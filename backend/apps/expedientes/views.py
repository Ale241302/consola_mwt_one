"""
=====================================================================
MWT.ONE · apps.expedientes.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/ocs/           (OcViewSet)
  /api/expedientes/   (ExpedienteViewSet)
  /api/lineas/        (LineaViewSet)
  /api/documentos/    (DocumentoViewSet)

Cada ViewSet ofrece full CRUD + select_* + kpis.

Acciones avanzadas (state machine):
  POST /api/expedientes/{id}/confirm-sap/  ·  C5 RegisterSAPConfirmation
       → genera ART-04, transiciona REGISTRO → PRODUCCION
=====================================================================
"""
import io
import json
import logging
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from apps.core.constants import MWT_OPERATING_CLIENT_ID
from apps.storage.services import delete_object as _storage_delete
from apps.core.scoped_querysets import (
    filter_by_user_clients,
    _is_bypass,
    scoped_expediente_ids,
)

from .models import (
    Oc, Expediente, Linea, Documento,
    EstadoOcCat, EstadoExpedienteCat, ModoOperacionCat, IncotermCat,
    TransicionCat, EventLog, OcrParsingLog,
)
from .serializers import (
    OcSerializer, OcListSerializer,
    ExpedienteSerializer, ExpedienteListSerializer,
    LineaSerializer, DocumentoSerializer,
    TransicionCatSerializer, EventLogSerializer, OcrParsingLogSerializer,
)

log = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════
# Guard anti-mutación para roles CLIENT_*
#
# Los endpoints de /api/expedientes/, /api/ocs/, /api/lineas/,
# /api/documentos/ SON admin-facing. El cliente B2B NUNCA debe poder
# hacer POST/PATCH/PUT/DELETE acá — sus flujos de creación van por
# /api/expedientes/create-from-oc/ (wizard, con HARD SHIELD dentro).
#
# Esta guard devuelve una Response 403 si el caller es CLIENT, o None
# (pasa a la acción original) si es staff interno.
# ══════════════════════════════════════════════════════════════════════
_CLIENT_ROLES = {"client_b2b", "cliente", "client"}


def _viewer_role_upper(request) -> str:
    """Devuelve el rol del usuario en MAYÚSCULAS (string seguro, '' si N/A)."""
    user = getattr(request, "user", None)
    if user is None:
        return ""
    role = (getattr(user, "role_default", "") or
            getattr(user, "role", "") or "")
    try:
        return str(role).upper()
    except (TypeError, ValueError):
        return ""


def _is_client_viewer(request) -> bool:
    """True si el usuario es CLIENT_* (rol del Portal B2B).

    Reglas:
      · is_superuser → False (Admin total), salvo override explícito.
      · role_default que empieza con CLIENT_* → True.
      · rol legacy `client` / `cliente` / `client_b2b` → True.
      · Header `X-Viewport-Role: CLIENT` (override desde Tweaks Panel
        en frontend, solo aplicable si el user tiene legal_entity_ids
        asignados — i.e. tiene empresas para hacer scope).
    """
    user = getattr(request, "user", None)
    if user is None:
        return False

    # Sprint 2026-05-21 · Override viewport explícito desde frontend.
    # Si el admin/CEO usa el Tweaks Panel para verse como CLIENT, el
    # frontend manda `X-Viewport-Role: CLIENT` y aquí lo respetamos —
    # SIEMPRE que el usuario tenga legal_entity_ids (sin scope, mostrar
    # como admin igual).
    hdr_viewport = (request.headers.get("X-Viewport-Role") or "").upper()
    if hdr_viewport == "CLIENT":
        leis = list(getattr(user, "legal_entity_ids", None) or [])
        if leis:
            return True

    if getattr(user, "is_superuser", False):
        return False
    role_upper = _viewer_role_upper(request)
    if role_upper.startswith("CLIENT_"):
        return True
    role_lower = role_upper.lower()
    if role_lower in _CLIENT_ROLES:
        return True
    return False


def _is_admin_viewer(request) -> bool:
    """True si el usuario es Admin / CEO / superuser.

    Sprint 2026-05-06 · audiencia ADMIN_ONLY (ART-04 SAP, etc.).
    Solo este conjunto reducido ve documentos y artefactos marcados
    como ADMIN_ONLY. Staff interno de MWT y CLIENT_* quedan fuera.
    """
    user = getattr(request, "user", None)
    if user is None:
        return False
    if getattr(user, "is_superuser", False):
        return True
    role_upper = _viewer_role_upper(request)
    return role_upper in ("ADMIN", "CEO")


def _deny_client_mutation(request, action_label: str = ""):
    """Si el usuario es CLIENT B2B, devuelve Response 403. Si no, None."""
    role = (getattr(request.user, "role", "") or "").lower()
    if role in _CLIENT_ROLES:
        log.warning(
            "Mutation denied: role=%s user=%s action=%s path=%s",
            role, getattr(request.user, "email", "?"),
            action_label, getattr(request, "path", "?"),
        )
        from rest_framework.response import Response as _Resp  # noqa: PLC0415
        return _Resp(
            {
                "detail": "El portal B2B no permite mutaciones en expedientes desde el rol CLIENT.",
                "hint":   "Usa POST /api/expedientes/create-from-oc/ desde tu portal.",
                "role":   role,
                "action": action_label,
            },
            status=403,
        )
    return None


# ════════════════════════════════════════════════════════════
# OC
# ════════════════════════════════════════════════════════════
class OcViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Oc.objects.filter(is_active=True).order_by("-issued_at", "-created_at")
        # Sprint 2026-05-22 · scope multi-tenant. OC tiene client_id pero NO
        # operating_company_id (eso se materializa en el expediente). Solo
        # filtramos por client_id; el caso "operator-sin-cliente" se cubre
        # en ExpedienteViewSet.list con scope dual.
        qs = filter_by_user_clients(qs, request.user, client_field="client_id")
        mapping = {
            "client":    "client_id",
            "brand":     "brand_id",
            "proveedor": "proveedor_id",
            "estado":    "estado",
            "moneda":    "moneda",
            "credit_band": "credit_band",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        return Response(OcListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        # Lookup tolerante: UUID o codigo. Mismo patrón que Expediente.
        o = None
        try:
            o = Oc.objects.get(pk=pk, is_active=True)
        except Oc.DoesNotExist:
            o = None
        except Exception:
            o = None
        if o is None:
            try:
                o = Oc.objects.get(codigo=pk, is_active=True)
            except Oc.DoesNotExist:
                return Response({"detail": "OC no existe"}, status=404)
        return Response(OcSerializer(o, context={"request": request}).data)

    def create(self, request):
        denied = _deny_client_mutation(request, action_label="oc.create")
        if denied is not None: return denied
        s = OcSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="oc.update")
        if denied is not None: return denied
        try:
            o = Oc.objects.get(pk=pk)
        except Oc.DoesNotExist:
            return Response({"detail": "OC no existe"}, status=404)
        s = OcSerializer(o, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="oc.destroy")
        if denied is not None: return denied
        Oc.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoOcCat.objects.all()])

    # ── KPIs globales ─────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        total = abiertas = cerradas = 0
        total_value = total_paid = 0.0
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT COUNT(*),
                           COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO','CANCELADA')),
                           COUNT(*) FILTER (WHERE estado = 'CERRADO'),
                           COALESCE(SUM(total_value),0),
                           COALESCE(SUM(total_paid),0)
                    FROM expedientes.oc
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                total, abiertas, cerradas = r[0], r[1], r[2]
                total_value, total_paid = float(r[3]), float(r[4])
            except Exception:
                pass
        return Response({
            "total":         total,
            "abiertas":      abiertas,
            "cerradas":      cerradas,
            "total_value":   total_value,
            "total_paid":    total_paid,
            "balance":       total_value - total_paid,
        })


# ════════════════════════════════════════════════════════════
# Expediente
# ════════════════════════════════════════════════════════════
class ExpedienteViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Expediente.objects.filter(is_active=True).order_by("-last_event_at", "-created_at")
        mapping = {
            "oc":             "oc_id",
            "client":         "client_id",
            "brand":          "brand_id",
            "estado":         "estado",
            "modo_operacion": "modo_operacion",
            "phase_signal":   "phase_signal",
            "credit_band":    "credit_band",
        }
        for param, field in mapping.items():
            v = request.query_params.get(param)
            if v:
                qs = qs.filter(**{field: v})
        is_blocked = request.query_params.get("is_blocked")
        if is_blocked in ("true", "false"):
            qs = qs.filter(is_blocked=(is_blocked == "true"))
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)

        # Sprint 2026-05-06 / fix 2026-05-21 / rev 2026-05-21b · Aislamiento de
        # visibilidad por rol con scope dual (client_id ∪ operating_company_id).
        #
        # Para CLIENT_*: ve expedientes donde su pool (legal_entity_ids)
        # intersecta con `client_id` (cliente final) O con `operating_company_id`
        # (operador). Admin/CEO/staff: sin filtro.
        #
        # Cambio rev 2026-05-21b (CEO directive): operadores externos que MWT
        # gestiona en su nombre tenían 0 expedientes visibles porque solo
        # aparecían como `operating_company_id`, no como `client_id`. El OR
        # corrige esto. La fuga histórica documentada (un CLIENT con MWT en su
        # pool viendo TODO lo operado por MWT) deja de aplicar porque MWT
        # nunca debe estar en `legal_entity_ids` de un CLIENT real —
        # responsabilidad del módulo /usuarios/ no asignar MWT a CLIENT_*.
        # Sprint 2026-05-22 · scope unificado (R3 · POL_VISIBILIDAD).
        # TODO rol que no sea superadmin/admin se limita a su pool
        # (manager, operator, finance, viewer, client_b2b). El helper
        # devuelve qs.none() si el user no-bypass tiene legal_entity_ids=[].
        # Scope dual: client_id ∪ operating_company_id.
        qs = filter_by_user_clients(
            qs, request.user,
            client_field="client_id",
            extra_fields=("operating_company_id",),
        )
        # Sprint 2026-06-11 · Auditoría Fable5 (N+1): precomputar las
        # referencias (proformas/OCs/SAPs) en 3-4 queries TOTALES en vez
        # de 4-5 por fila dentro del serializer.
        from .serializers import build_expediente_ref_batches
        rows = list(qs)
        ctx = {"request": request}
        ctx.update(build_expediente_ref_batches(rows))
        return Response(ExpedienteListSerializer(rows, many=True, context=ctx).data)

    def retrieve(self, request, pk=None):
        # Lookup tolerante: el `pk` puede venir como UUID (canónico) o
        # como `codigo` legible (ej. EXP-2026-0001 desde URLs guardadas).
        # 1) Intentar UUID primero. Si pk no es UUID válido, ValueError /
        #    django.core.exceptions.ValidationError saltan; los atrapamos.
        # 2) Fallback por codigo.
        e = None
        try:
            e = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            e = None
        except Exception:
            # pk no es UUID parseable (formato corto / con guiones tipo
            # codigo). Lo manejamos con el fallback por codigo.
            e = None
        if e is None:
            try:
                e = Expediente.objects.get(codigo=pk, is_active=True)
            except Expediente.DoesNotExist:
                return Response({"detail": "Expediente no existe"}, status=404)
        return Response(ExpedienteSerializer(e, context={"request": request}).data)

    def create(self, request):
        # HARD SHIELD: CLIENT B2B NUNCA crea expedientes por este endpoint
        # admin. Deben usar /api/expedientes/create-from-oc/.
        denied = _deny_client_mutation(request, action_label="expediente.create")
        if denied is not None: return denied

        # ⚠ Wrap completo: cualquier excepción inesperada se devuelve como
        # JSON 500 con detalle, NO como página HTML del Django default.
        # Esto facilita debug en el frontend (la respuesta sigue siendo
        # JSON parseable) y evita que el wizard explote con un parse error.
        try:
            return self._do_create(request)
        except Exception as e:
            log.exception("[expediente.create] unhandled exception")
            return Response({
                "detail": f"server_error: {type(e).__name__}",
                "error":  str(e)[:500],
            }, status=500)

    def _do_create(self, request):
        # Sprint Wizard Simplificado (2026-04-29):
        #   El wizard manda payload mínimo (client_id + estado + lines[])
        #   sin id ni codigo. Aquí auto-generamos ambos antes de validar
        #   y separamos las lines para crearlas después del expediente.
        payload = dict(request.data) if hasattr(request.data, "items") else {}
        # request.data puede ser QueryDict — pasarlo a dict mutable
        try:
            payload = {k: request.data.get(k) for k in request.data.keys()}
        except Exception:
            payload = dict(request.data)

        # Sprint 2026-05-06 · operador del expediente.
        # Default: MWT_OPERATING_CLIENT_ID (Muito Work Limitada). Si el
        # admin manda operating_company_id explicito en el payload, se
        # respeta. Si es CLIENT_* (no debería llegar aquí por la guard,
        # pero por defensa) forzamos al client_id del usuario.
        operating_company_id = (
            payload.get("operating_company_id") or MWT_OPERATING_CLIENT_ID
        )
        payload["operating_company_id"] = operating_company_id

        # Auto-generar codigo si no viene
        if not payload.get("codigo"):
            year = date.today().year
            with connection.cursor() as c:
                c.execute(
                    "SELECT COUNT(*) FROM expedientes.expediente WHERE codigo LIKE %s",
                    [f"EXP-{year}-%"],
                )
                n = (c.fetchone() or [0])[0]
            payload["codigo"] = f"EXP-{year}-{(n + 1):04d}"

        # Separar lines del payload del Expediente (no es campo del modelo)
        # request.data es QueryDict → toma getlist para arrays
        raw_lines = None
        if hasattr(request.data, "getlist"):
            raw_lines = request.data.getlist("lines") or None
        if raw_lines is None:
            raw_lines = payload.pop("lines", None)
        else:
            payload.pop("lines", None)

        # ── Auto-crear OC si no viene oc_id ────────────────────────
        # El wizard simplificado no pide OC explícitamente, pero la
        # jerarquía de la UI espera que cada expediente tenga una OC
        # padre (vista intermedia /expedientes/<oc_id>). Generamos una
        # OC mínima en estado EMITIDA con codigo PO-YYYY-NNNN si el
        # payload no la trae. R6 (sin FK) — el vínculo expediente.oc_id
        # es solo lógico.
        # IMPORTANTE: usamos prefijo `PO-` (Purchase Order) para mantener
        # la convención de la data legacy (PO-2026-04100, etc.) y evitar
        # split-brain de prefijos OC- vs PO-.
        if not payload.get("oc_id"):
            year = date.today().year
            with connection.cursor() as c:
                # Contamos AMBOS prefijos legacy (PO- y OC-) para el
                # secuencial siguiente, y nos quedamos con el max.
                c.execute("""
                    SELECT COALESCE(MAX(
                        CASE
                            WHEN codigo ~ '^(PO|OC)-[0-9]+-[0-9]+$'
                            THEN CAST(split_part(codigo, '-', 3) AS INTEGER)
                            ELSE 0
                        END
                    ), 0)
                    FROM expedientes.oc
                    WHERE codigo LIKE %s OR codigo LIKE %s
                """, [f"PO-{year}-%", f"OC-{year}-%"])
                n_oc = (c.fetchone() or [0])[0]
            new_oc_id = uuid.uuid4()
            new_oc_codigo = f"PO-{year}-{(n_oc + 1):05d}"
            with connection.cursor() as c:
                c.execute("""
                    INSERT INTO expedientes.oc (
                        id, codigo, client_id, brand_id,
                        estado, moneda, issued_at, notas,
                        is_active, created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s,
                        'EMITIDA', %s, NOW(), %s,
                        TRUE, NOW(), NOW()
                    )
                """, [
                    str(new_oc_id), new_oc_codigo,
                    payload.get("client_id"), payload.get("brand_id"),
                    payload.get("moneda") or "USD",
                    f"Auto-creada por wizard simplificado para expediente {payload['codigo']}",
                ])
            payload["oc_id"] = str(new_oc_id)

        s = ExpedienteSerializer(data=payload)
        s.is_valid(raise_exception=True)
        new_id = uuid.uuid4()
        s.save(id=new_id)

        # Crear las líneas (R6: sin FK; usamos raw insert defensivo)
        oc_id_val = payload.get("oc_id")
        line_count = 0
        if isinstance(raw_lines, list) and raw_lines:
            # ── Resolver precio cliente UNA VEZ por producto (frozen) ──
            # El precio se calcula con el WATERFALL COMEX (mismo que usa
            # /api/commercial/resolve_client_price/):
            #   1) CPA (Client-Product Assignment override)
            #   2) PriceListVersion + GradeItem (mejor PLV vigente)
            #   3) Early-Payment Tier (descuento por days_req)
            # Si todo falla, fallback a producto.precio_lista.
            #
            # El precio queda CONGELADO en linea.unit_price → la historia
            # de la OC es inmutable contra cambios futuros del catálogo.
            from apps.commercial.views import compute_client_price

            client_id_val = payload.get("client_id")
            # Sprint 2026-05-22 · TC USD/BRL viva (la manda el wizard portal
            # para que el backend escoja la banda Marluvas correcta al
            # resolver `unit_price_mwt` desde el snapshot del MWT.
            tc_raw = payload.get("tc_usd_brl")
            try:
                tc_usd_brl_val = float(tc_raw) if tc_raw not in (None, "", "null") else None
            except (TypeError, ValueError):
                tc_usd_brl_val = None
            paymentDays_val = 0
            try:
                paymentDays_val = int(payload.get("credit_days") or 0)
            except (TypeError, ValueError):
                paymentDays_val = 0
            # Sprint 2026-05-24 (fix v4 backend) · plazos duales separados.
            # paymentDays_val (legacy) se mantiene como espejo del cliente.
            # paymentDaysMwt_val   → plazo MWT (credit_days_mwt del payload).
            # paymentDaysClient_val → plazo cliente (credit_days_cliente).
            # Si el payload no los manda, fallback al credit_days legacy.
            paymentDaysMwt_val = 0
            try:
                paymentDaysMwt_val = int(payload.get("credit_days_mwt") or paymentDays_val or 90)
            except (TypeError, ValueError):
                paymentDaysMwt_val = paymentDays_val or 90
            paymentDaysClient_val = 0
            try:
                paymentDaysClient_val = int(payload.get("credit_days_cliente") or paymentDays_val or 90)
            except (TypeError, ValueError):
                paymentDaysClient_val = paymentDays_val or 90
            # Sprint 2026-05-06 · "snapshot dual" de precios.
            # price_map_mwt    → precio para Muito Work Limitada (visible
            #                    a Admin/CEO/staff).
            # price_map_client → precio para el cliente final del exp
            #                    (visible a CLIENT_*).
            # `price_map` (legacy) queda como alias del precio del operador
            # — si operating_company_id == MWT, apunta a price_map_mwt;
            # si es el client_id, apunta a price_map_client.
            price_map_mwt    = {}
            price_map_client = {}
            brand_by_pid     = {}   # pid → brand_id (uuid str)
            sku_by_pid       = {}   # pid → sku
            try:
                unique_pids = {str(ln.get("producto_id")) for ln in raw_lines
                               if isinstance(ln, dict) and ln.get("producto_id")}
                unique_pids = {p for p in unique_pids if isinstance(p, str) and len(p) == 36}
                if unique_pids:
                    with connection.cursor() as c:
                        placeholders = ",".join(["%s::uuid"] * len(unique_pids))
                        # BUG FIX 2026-05-06: la columna en productos.producto
                        # se llama `marca_id`, no `brand_id`. Además leemos
                        # `precio_mwt` (override CEO directo) y el JSON
                        # `especificaciones.client_prices` que es donde el
                        # ProductFormView guarda los overrides por cliente
                        # ($36.46 MWT, $47.74 SonDel, $37 Sonepar, etc.).
                        c.execute(f"""
                            SELECT id::text,
                                   sku,
                                   marca_id::text,
                                   precio_lista,
                                   precio_mwt,
                                   COALESCE(especificaciones->'client_prices', '{{}}'::jsonb) AS client_prices
                              FROM productos.producto
                             WHERE id IN ({placeholders})
                        """, list(unique_pids))

                        def _to_decimal(v):
                            try:
                                d = Decimal(str(v))
                                return d if d > 0 else None
                            except (TypeError, ValueError, ArithmeticError):
                                return None

                        for pid, sku_db, brand_id, pl, p_mwt_override, client_prices_json in c.fetchall():
                            # Sprint 2026-05-22 · acumulamos brand y sku por pid
                            # para resolver el snapshot Marluvas MWT en el loop
                            # de líneas más abajo (operatingMode='mwt').
                            if brand_id:
                                brand_by_pid[pid] = brand_id
                            if sku_db:
                                sku_by_pid[pid]   = sku_db
                            # `client_prices_json` es un dict { cliente_id: precio }
                            # (puede venir ya parseado por psycopg2 si es JSONB).
                            cp_map = client_prices_json or {}
                            if isinstance(cp_map, str):
                                try:
                                    cp_map = json.loads(cp_map)
                                except (TypeError, ValueError):
                                    cp_map = {}

                            # ── Precio MWT (perspectiva Muito Work) ──
                            # Prioridad:
                            #   1) especificaciones.client_prices[MWT_ID]   (override directo)
                            #   2) productos.producto.precio_mwt           (override CEO global)
                            #   3) waterfall COMEX con cliente=MWT
                            #   4) productos.producto.precio_lista
                            p_mwt = _to_decimal(cp_map.get(MWT_OPERATING_CLIENT_ID)
                                                or cp_map.get(str(MWT_OPERATING_CLIENT_ID)))
                            if p_mwt is None:
                                p_mwt = _to_decimal(p_mwt_override)
                            if p_mwt is None and brand_id and sku_db:
                                try:
                                    p_mwt = compute_client_price(
                                        client_id  = MWT_OPERATING_CLIENT_ID,
                                        brand_id   = brand_id,
                                        product_sku= sku_db,
                                        days_req   = 0,
                                    )
                                except Exception as e:
                                    log.warning("[expediente.create] waterfall MWT pid=%s: %s", pid, e)
                                    p_mwt = None
                            if p_mwt is not None and p_mwt > 0:
                                price_map_mwt[pid] = p_mwt
                            else:
                                try:
                                    price_map_mwt[pid] = Decimal(str(pl or 0))
                                except (TypeError, ValueError):
                                    price_map_mwt[pid] = Decimal("0")

                            # ── Precio cliente final ──
                            # Prioridad:
                            #   1) especificaciones.client_prices[client_id]
                            #   2) waterfall COMEX (CPA → PriceListVersion → EPP)
                            #   3) Fallback al precio MWT
                            p_cli = None
                            if client_id_val:
                                p_cli = _to_decimal(cp_map.get(str(client_id_val))
                                                    or cp_map.get(client_id_val))
                            if p_cli is None and client_id_val and brand_id and sku_db:
                                try:
                                    p_cli = compute_client_price(
                                        client_id  = client_id_val,
                                        brand_id   = brand_id,
                                        product_sku= sku_db,
                                        days_req   = 0,
                                    )
                                except Exception as e:
                                    log.warning("[expediente.create] waterfall CLIENT pid=%s: %s", pid, e)
                                    p_cli = None
                            if p_cli is not None and p_cli > 0:
                                price_map_client[pid] = p_cli
                            else:
                                # Fallback al precio MWT ya resuelto.
                                price_map_client[pid] = price_map_mwt[pid]
            except Exception as e:
                # Subimos a ERROR para que NO se pierda en logs si la query
                # principal del waterfall vuelve a romperse (caso brand_id
                # vs marca_id que dejó precios en 0 silenciosamente).
                log.exception("[expediente.create] price_map fetch failed: %s", e)
                price_map_mwt    = {}
                price_map_client = {}

            with connection.cursor() as c:
                for ln in raw_lines:
                    if not isinstance(ln, dict):
                        continue
                    sku   = (ln.get("sku") or "").strip().upper()[:64]
                    if not sku:
                        continue
                    talla = (ln.get("talla") or "").strip().upper()[:16] or None
                    cantidad = ln.get("cantidad") or ln.get("qty") or 0
                    try:
                        cantidad = int(cantidad)
                    except (TypeError, ValueError):
                        cantidad = 0
                    if cantidad <= 0:
                        continue
                    # Precio congelado: lookup en price_map_* por producto_id.
                    # Fallback: 0 (línea sin producto resuelto, ej. SKU libre).
                    pid = str(ln.get("producto_id")) if ln.get("producto_id") else None
                    unit_price_mwt    = (price_map_mwt.get(pid, Decimal("0"))
                                         if pid else Decimal("0"))
                    unit_price_client = (price_map_client.get(pid, Decimal("0"))
                                         if pid else Decimal("0"))

                    # Sprint 2026-05-22 · OVERRIDE del payload con snapshot dual.
                    # El wizard del portal `/portal/nueva-oc` (paso 3) resuelve
                    # el precio con el snapshot Marluvas del CLIENTE FINAL y lo
                    # manda en `lines[].unit_price`. Eso fija `unit_price_client`
                    # honesto (lo que el cliente vio en pantalla).
                    #
                    # Para `unit_price_mwt` (perspectiva CEO/MWT) necesitamos
                    # OTRO snapshot — el del cliente "Muito Work Limitada"
                    # (com_pct=0%, brl_override=144.46) que tiene precios más
                    # bajos por la ausencia de comisión. Solo aplica cuando
                    # operating_company_id == MWT_OPERATING_CLIENT_ID; si el
                    # operador es el cliente final, ambos snapshots coinciden.
                    raw_unit_price = ln.get("unit_price")
                    override_price = None
                    if raw_unit_price is not None:
                        try:
                            cand = Decimal(str(raw_unit_price))
                            if cand > 0:
                                override_price = cand
                        except (TypeError, ValueError, InvalidOperation):
                            override_price = None
                    if override_price is not None:
                        # Cliente final: el precio del payload es la fuente de verdad.
                        unit_price_client = override_price
                        # MWT: por defecto el mismo precio del cliente; si el
                        # operador es MWT intentamos leer el snapshot MWT real.
                        unit_price_mwt = override_price
                        if str(operating_company_id) == MWT_OPERATING_CLIENT_ID:
                            try:
                                from apps.commercial.services import (  # noqa: PLC0415
                                    get_client_price_matrix,
                                )
                                brand_for_line = brand_by_pid.get(pid)
                                sku_for_line   = sku_by_pid.get(pid) or sku
                                if brand_for_line and sku_for_line:
                                    mwt_matrix = get_client_price_matrix(
                                        client_id   = MWT_OPERATING_CLIENT_ID,
                                        brand_id    = brand_for_line,
                                        product_sku = sku_for_line,
                                        tc_usd_brl  = tc_usd_brl_val,
                                    )
                                    if mwt_matrix and mwt_matrix.get("ok"):
                                        # Tomar el precio del plazo seleccionado
                                        # (credit_days). Si no existe en la banda
                                        # MWT, caemos al base del snapshot MWT.
                                        plazos = mwt_matrix.get("plazos") or []
                                        # Sprint 2026-05-24 (fix v4) · usar plazo MWT, NO el del cliente.
                                        wanted = next(
                                            (p for p in plazos
                                             if int(p.get("dias") or 0) == paymentDaysMwt_val),
                                            None,
                                        )
                                        base = next(
                                            (p for p in plazos if p.get("is_base")),
                                            None,
                                        )
                                        picked = wanted or base
                                        if picked:
                                            try:
                                                cand_mwt = Decimal(str(picked.get("price")))
                                                if cand_mwt > 0:
                                                    unit_price_mwt = cand_mwt
                                            except (TypeError, ValueError, InvalidOperation):
                                                pass
                            except Exception as e:
                                log.warning(
                                    "[expediente.create] snapshot MWT falló para "
                                    "sku=%s brand=%s tc=%s plazo_mwt=%s · %s",
                                    sku, brand_by_pid.get(pid), tc_usd_brl_val,
                                    paymentDaysMwt_val, e,
                                )

                    # Legacy unit_price = el precio que le toca al OPERADOR.
                    unit_price = (unit_price_mwt
                                  if str(operating_company_id) == MWT_OPERATING_CLIENT_ID
                                  else unit_price_client)
                    total_price = (unit_price * Decimal(cantidad)).quantize(Decimal("0.01"))

                    # Schema real (70_expedientes.sql + C0_expedientes_operating_company.sql):
                    #   id, oc_id (NOT NULL), expediente_id, producto_id,
                    #   sku, size (NO 'talla'), qty, unit_cost, unit_price,
                    #   unit_price_mwt, unit_price_client (sprint 2026-05-06),
                    #   total_price, sap, transport_mode, production_date,
                    #   estado, is_active, ...
                    try:
                        c.execute("""
                            INSERT INTO expedientes.linea (
                                id, oc_id, expediente_id, producto_id,
                                sku, size, qty,
                                unit_price, unit_price_mwt, unit_price_client,
                                total_price,
                                estado, is_active, created_at, updated_at
                            ) VALUES (
                                %s, %s, %s, %s,
                                %s, %s, %s,
                                %s, %s, %s,
                                %s,
                                'PENDIENTE_SAP', TRUE, NOW(), NOW()
                            )
                        """, [
                            str(uuid.uuid4()),
                            str(oc_id_val) if oc_id_val else None,
                            str(new_id),
                            pid,
                            sku, talla, cantidad,
                            unit_price, unit_price_mwt, unit_price_client,
                            total_price,
                        ])
                        line_count += 1
                    except Exception as e:
                        log.warning("[expediente.create] no pude insertar linea sku=%s: %s", sku, e)

            # Actualizar lines_count en la OC para que el resumen sea coherente
            if oc_id_val and line_count > 0:
                try:
                    with connection.cursor() as c:
                        c.execute("""
                            UPDATE expedientes.oc
                               SET lines_count = COALESCE(lines_count, 0) + %s,
                                   updated_at  = NOW()
                             WHERE id = %s
                        """, [line_count, str(oc_id_val)])
                except Exception as e:
                    log.warning("[expediente.create] no pude actualizar OC.lines_count: %s", e)

        return Response(s.data, status=201)

    def update(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="expediente.update")
        if denied is not None: return denied
        try:
            e = Expediente.objects.get(pk=pk)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)
        s = ExpedienteSerializer(e, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        # Soft-delete: is_active=False. El listado filtra por is_active=true,
        # asi que el expediente desaparece de la UI pero queda auditable.
        denied = _deny_client_mutation(request, action_label="expediente.destroy")
        if denied is not None: return denied
        # Lookup tolerante: pk puede ser UUID o codigo (mismo patron que retrieve).
        n = 0
        try:
            n = Expediente.objects.filter(pk=pk).update(is_active=False)
        except Exception:
            n = 0
        if n == 0:
            try:
                n = Expediente.objects.filter(codigo=pk).update(is_active=False)
            except Exception:
                n = 0
        if n == 0:
            return Response({"detail": "Expediente no existe"}, status=404)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([
            {"codigo": e.codigo, "label": e.label, "color": e.color,
             "orden": e.orden, "baseline_dias": e.baseline_dias}
            for e in EstadoExpedienteCat.objects.all()
        ])

    @action(detail=False, methods=["get"])
    def select_modos(self, request):
        return Response([{"codigo": m.codigo, "label": m.label, "descripcion": m.descripcion}
                         for m in ModoOperacionCat.objects.all()])

    @action(detail=False, methods=["get"])
    def select_incoterms(self, request):
        return Response([{"codigo": i.codigo, "label": i.label}
                         for i in IncotermCat.objects.all()])

    # ── KPIs ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """KPIs del header de `/expedientes`.

        Sprint 2026-05-17:
          · Aísla por rol (R3): CLIENT_* ve solo expedientes de sus
            legal_entity_ids.
          · Agrega margen ponderado real vs proyectado y `payables` (lo que
            falta por salir a fábricas/logística).
          · Cada KPI puede ser NULL si no hay datos suficientes — el front
            oculta la tarjeta cuando es NULL (no muestra 0 fake).
        """
        is_client = _is_client_viewer(request)

        # Construcción del filtro WHERE
        where = ["is_active = TRUE"]
        params = []
        if is_client:
            scope = list(getattr(request.user, "legal_entity_ids", []) or [])
            if not scope:
                # CLIENT_* sin scope → todo NULL (no hay datos suyos)
                return Response({
                    "total": 0, "activos": 0, "bloqueados": 0,
                    "total_invoiced": None, "total_paid": None,
                    "receivables": None, "payables": None,
                    "weighted_real_margin": None, "weighted_proj_margin": None,
                    "margin_drift": None,
                    "credit_60_75": 0, "credit_75_plus": 0,
                    "factory_delayed": 0,
                })
            # Rev 2026-05-21b · Scope dual: client_id ∪ operating_company_id.
            # Alineado con ExpedienteViewSet.list(): operadores externos que
            # solo aparecen como operating_company_id ahora ven sus KPIs.
            # Responsabilidad del módulo /usuarios/ no asignar MWT a CLIENT_*.
            placeholders = ",".join(["%s"] * len(scope))
            where.append(
                f"(client_id IN ({placeholders}) OR operating_company_id IN ({placeholders}))"
            )
            params.extend(scope)
            params.extend(scope)

        where_sql = " AND ".join(where)

        out = {
            "total": 0, "activos": 0, "bloqueados": 0,
            "total_invoiced": None, "total_paid": None,
            "receivables": None, "payables": None,
            "weighted_real_margin": None, "weighted_proj_margin": None,
            "margin_drift": None,
            "credit_60_75": 0, "credit_75_plus": 0,
            "factory_delayed": 0,
        }
        with connection.cursor() as c:
            try:
                c.execute(f"""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE estado <> 'CERRADO'),
                      COUNT(*) FILTER (WHERE is_blocked = TRUE),
                      COALESCE(SUM(total_invoiced), 0),
                      COALESCE(SUM(total_paid), 0),
                      COALESCE(SUM(balance), 0),
                      COALESCE(SUM(
                        GREATEST(total_cost
                                 - LEAST(total_cost,
                                         COALESCE(pg_verified,0) + COALESCE(pg_released,0)),
                                 0)
                      ), 0),
                      COUNT(*) FILTER (WHERE credit_days > 60 AND credit_days <= 75),
                      COUNT(*) FILTER (WHERE credit_days > 75),
                      COUNT(*) FILTER (WHERE factory_delay = TRUE),
                      COALESCE(
                        SUM(real_margin * total_invoiced)
                          / NULLIF(SUM(total_invoiced), 0),
                        NULL
                      ),
                      COALESCE(
                        SUM(projected_margin * total_invoiced)
                          / NULLIF(SUM(total_invoiced), 0),
                        NULL
                      )
                    FROM expedientes.expediente
                    WHERE {where_sql}
                """, params)
                r = c.fetchone()
                total      = int(r[0] or 0)
                invoiced   = float(r[3]) if r[3] is not None else None
                paid       = float(r[4]) if r[4] is not None else None
                receiv     = float(r[5]) if r[5] is not None else None
                payables   = float(r[6]) if r[6] is not None else None
                wreal      = float(r[10]) if r[10] is not None else None
                wproj      = float(r[11]) if r[11] is not None else None
                drift      = (wreal - wproj) if (wreal is not None and wproj is not None) else None

                out = {
                    "total":               total,
                    "activos":             int(r[1] or 0),
                    "bloqueados":          int(r[2] or 0),
                    # Si el total es 0 reportamos NULL para que el front oculte
                    # las tarjetas (auto-hide cuando no hay datos).
                    "total_invoiced":      invoiced if total > 0 else None,
                    "total_paid":          paid     if total > 0 else None,
                    "receivables":         receiv   if total > 0 else None,
                    "payables":            payables if total > 0 else None,
                    "weighted_real_margin": wreal,
                    "weighted_proj_margin": wproj,
                    "margin_drift":         drift,
                    "credit_60_75":         int(r[7] or 0),
                    "credit_75_plus":       int(r[8] or 0),
                    "factory_delayed":      int(r[9] or 0),
                }
            except Exception as exc:  # noqa: BLE001 — log estructurado y degradar
                import logging
                logging.getLogger(__name__).warning(
                    "kpis() failed for role=%s err=%s",
                    "CLIENT" if is_client else "ADMIN", exc,
                )
        return Response(out)

    # ── Líneas de un expediente ───────────────────────
    @action(detail=True, methods=["get"])
    def lineas(self, request, pk=None):
        qs = Linea.objects.filter(expediente_id=pk, is_active=True).order_by("sku", "size")
        return Response(LineaSerializer(qs, many=True).data)

    # ── Documentos de un expediente ───────────────────
    @action(detail=True, methods=["get"])
    def documentos(self, request, pk=None):
        qs = Documento.objects.filter(expediente_id=pk, is_active=True).order_by("-fecha", "-created_at")
        return Response(DocumentoSerializer(qs, many=True).data)

    # ══════════════════════════════════════════════════════
    # PIPELINE · Motor de fases (BLOQUE 4)
    #   POST /api/expedientes/{id}/transition/
    #     body: { fase_to, idempotence_token?, note?, documento_id? }
    #   GET  /api/expedientes/{id}/events/
    #   GET  /api/expedientes/kanban/
    #   GET  /api/expedientes/select-transiciones/
    # ══════════════════════════════════════════════════════
    @action(detail=False, methods=["get"], url_path="select-transiciones")
    def select_transiciones(self, request):
        fase_from = request.query_params.get("fase_from")
        qs = TransicionCat.objects.filter(is_active=True)
        if fase_from:
            qs = qs.filter(fase_from=fase_from)
        return Response(TransicionCatSerializer(qs, many=True).data)

    @action(detail=True, methods=["get"])
    def events(self, request, pk=None):
        """Event log de un expediente — trail append-only (C1..C11)."""
        qs = EventLog.objects.filter(
            aggregate_type="expediente",
            aggregate_id=pk,
            is_active=True,
        ).order_by("-created_at")
        limit = int(request.query_params.get("limit") or 200)
        return Response(EventLogSerializer(qs[:limit], many=True).data)

    # ── Días por fase (override manual · Sprint 2026-06-10) ──────────
    #   GET   /api/expedientes/{id}/phase-durations/  → overrides actuales
    #   PATCH/POST                                     → guarda (ADMIN/CEO)
    # Body: {"REGISTRO": 3, "TRANSITO": 12, "PRODUCCION": null}
    #   · null / "" elimina el override de esa fase.
    #   · La duración real sigue derivándose del EventLog; esto sólo
    #     prioriza el valor manual en el detalle y en el Cronograma del
    #     Resumen de Exportación.
    _PHASE_KEYS = {
        "REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO",
        "TRANSITO", "EN_DESTINO", "CERRADO",
    }

    @action(detail=True, methods=["get", "post", "patch"], url_path="phase-durations")
    def phase_durations(self, request, pk=None):
        """Overrides manuales de días por fase del expediente."""
        from django.core.exceptions import ValidationError as _DjValidationError
        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no encontrado"}, status=404)
        except (ValueError, _DjValidationError):
            return Response({"detail": "expediente_id inválido"}, status=400)

        if request.method.upper() == "GET":
            return Response({"phase_durations": exp.phase_durations_json or {}})

        denied = _deny_client_mutation(request, action_label="expediente.phase_durations")
        if denied is not None:
            return denied

        data = request.data or {}
        if not isinstance(data, dict):
            return Response({"detail": "payload debe ser objeto {FASE: dias}"}, status=400)

        import datetime as _dt

        current = dict(exp.phase_durations_json or {})
        for k, v in data.items():
            key = str(k).strip().upper()
            if key not in self._PHASE_KEYS:
                return Response({"detail": f"fase inválida: {k}"}, status=400)
            if v is None or v == "":
                current.pop(key, None)
                continue
            # Sprint 2026-06-10 (rev2) · rango de fechas {start, end}:
            # el modal del frontend manda fechas ISO; los días se calculan
            # aquí (end - start) y se persisten junto con el rango.
            if isinstance(v, dict):
                try:
                    d0 = _dt.date.fromisoformat(str(v.get("start") or "").strip())
                    d1 = _dt.date.fromisoformat(str(v.get("end") or "").strip())
                except (TypeError, ValueError):
                    return Response({"detail": f"fechas inválidas para {key} (YYYY-MM-DD)"}, status=400)
                days = (d1 - d0).days
                if days < 0:
                    return Response({"detail": f"fecha fin anterior al inicio en {key}"}, status=400)
                if days > 365:
                    return Response({"detail": f"rango fuera de límite (365d) en {key}"}, status=400)
                current[key] = {"start": d0.isoformat(), "end": d1.isoformat(), "days": days}
                continue
            # Legacy: número de días directo.
            try:
                days = float(v)
            except (TypeError, ValueError):
                return Response({"detail": f"días inválidos para {key}"}, status=400)
            if days < 0 or days > 365:
                return Response({"detail": f"días fuera de rango (0-365) para {key}"}, status=400)
            current[key] = round(days, 1)

        exp.phase_durations_json = current
        exp.save(update_fields=["phase_durations_json", "updated_at"])
        return Response({"phase_durations": current})

    # ── Fusión visual de expedientes (Sprint 2026-06-11 · E3) ────────
    # Una PO del cliente dividida en N partes (operadores/SAP/proforma
    # distintos) se agrupa en el listado bajo un fusion_id compartido.
    # SOLO visual: cada miembro conserva su OC, SAP, proforma, documentos
    # y pipeline. Ningún otro módulo consume estos campos.
    @action(detail=False, methods=["post"], url_path="fusionar")
    def fusionar(self, request):
        """POST /api/expedientes/fusionar/ {"expediente_ids": [...], "label"?}."""
        denied = _deny_client_mutation(request, action_label="expediente.fusionar")
        if denied is not None:
            return denied
        data = request.data or {}
        raw_ids = data.get("expediente_ids") or []
        if not isinstance(raw_ids, list) or len(raw_ids) < 2:
            return Response({"detail": "se requieren al menos 2 expediente_ids"}, status=400)
        try:
            ids = [str(uuid.UUID(str(x))) for x in raw_ids]
        except (TypeError, ValueError):
            return Response({"detail": "expediente_ids inválidos"}, status=400)
        label = (str(data.get("label") or "").strip() or None)
        if label:
            label = label[:64]
        exps = list(Expediente.objects.filter(id__in=ids, is_active=True))
        if len(exps) != len(set(ids)):
            return Response(
                {"detail": f"expedientes no encontrados ({len(exps)}/{len(set(ids))})"},
                status=404,
            )
        fid = uuid.uuid4()
        # Si un miembro ya pertenecía a otra fusión, migra a la nueva
        # (re-fusionar selección = sobrescribir).
        for e in exps:
            e.fusion_id = fid
            e.fusion_label = label
            e.save(update_fields=["fusion_id", "fusion_label", "updated_at"])
        return Response({"fusion_id": str(fid), "fusion_label": label, "members": len(exps)})

    @action(detail=False, methods=["post"], url_path="fusion-label")
    def fusion_label(self, request):
        """POST /api/expedientes/fusion-label/ {"fusion_id", "label"} — renombra el grupo."""
        denied = _deny_client_mutation(request, action_label="expediente.fusion_label")
        if denied is not None:
            return denied
        data = request.data or {}
        fid = str(data.get("fusion_id") or "").strip()
        try:
            uuid.UUID(fid)
        except (TypeError, ValueError):
            return Response({"detail": "fusion_id inválido"}, status=400)
        label = (str(data.get("label") or "").strip() or None)
        if label:
            label = label[:64]
        n = 0
        for e in Expediente.objects.filter(fusion_id=fid):
            e.fusion_label = label
            e.save(update_fields=["fusion_label", "updated_at"])
            n += 1
        if n == 0:
            return Response({"detail": "fusión no encontrada"}, status=404)
        return Response({"fusion_id": fid, "fusion_label": label, "members": n})

    @action(detail=False, methods=["post"], url_path="desfusionar")
    def desfusionar(self, request):
        """POST /api/expedientes/desfusionar/ {"fusion_id"} | {"expediente_ids"}."""
        denied = _deny_client_mutation(request, action_label="expediente.desfusionar")
        if denied is not None:
            return denied
        data = request.data or {}
        fid = str(data.get("fusion_id") or "").strip()
        raw_ids = data.get("expediente_ids") or []
        if fid:
            try:
                uuid.UUID(fid)
            except (TypeError, ValueError):
                return Response({"detail": "fusion_id inválido"}, status=400)
            qs = Expediente.objects.filter(fusion_id=fid)
        elif isinstance(raw_ids, list) and raw_ids:
            try:
                ids = [str(uuid.UUID(str(x))) for x in raw_ids]
            except (TypeError, ValueError):
                return Response({"detail": "expediente_ids inválidos"}, status=400)
            qs = Expediente.objects.filter(id__in=ids)
        else:
            return Response({"detail": "se requiere fusion_id o expediente_ids"}, status=400)
        n = 0
        for e in qs:
            e.fusion_id = None
            e.fusion_label = None
            e.save(update_fields=["fusion_id", "fusion_label", "updated_at"])
            n += 1
        return Response({"unfused": n})

    # ── Estadísticas globales de días por fase (Sprint 2026-06-10) ───
    # GET /api/expedientes/phase-stats/[?client=<uuid>]
    # Promedios calculados sobre el HISTORIAL COMPLETO (EventLog), no sólo
    # el subconjunto de un export: entrada a fase → entrada a la siguiente,
    # con los overrides manuales (phase_durations_json) reemplazando la
    # duración derivada de SU fase. Bucket por método de envío del
    # expediente (freight_mode AIR→Aereo / SEA→Maritimo).
    # Respuesta: {"phase_stats": {"Aereo": {"REGISTRO": {"avg": 5.2, "n": 3},
    # ...}, "Maritimo": {...}}}
    @action(detail=False, methods=["get"], url_path="phase-stats")
    def phase_stats(self, request):
        """Promedios globales de días por fase y método de envío."""
        client = (request.query_params.get("client") or "").strip()
        client_sql = ""
        params = {}
        if client:
            try:
                uuid.UUID(client)
            except (TypeError, ValueError):
                return Response({"detail": "client inválido"}, status=400)
            client_sql = "AND e.client_id = %(client)s::uuid"
            params["client"] = client

        order = ["REGISTRO", "PRODUCCION", "PREPARACION", "DESPACHO",
                 "TRANSITO", "EN_DESTINO", "CERRADO"]
        with connection.cursor() as c:
            # OJO: sin filtrar phase_to IS NOT NULL — el evento de CREACIÓN
            # trae phase_to NULL y lo necesitamos para sintetizar REGISTRO
            # (paridad con el Cronograma del frontend).
            c.execute(f"""
                SELECT el.aggregate_id::text, el.phase_to, el.created_at
                FROM pipeline.event_log el
                JOIN expedientes.expediente e ON e.id = el.aggregate_id
                WHERE el.aggregate_type = 'expediente'
                  AND el.is_active = TRUE
                  AND e.is_active = TRUE
                  {client_sql}
                ORDER BY el.aggregate_id, el.created_at
            """, params)
            ev_rows = c.fetchall()
            c.execute(f"""
                SELECT e.id::text, COALESCE(e.freight_mode, ''),
                       COALESCE(e.phase_durations_json, '{{}}'::jsonb)
                FROM expedientes.expediente e
                WHERE e.is_active = TRUE {client_sql}
            """, params)
            exp_rows = c.fetchall()

        modo_by_exp, over_by_exp = {}, {}
        for eid, fm, pdj in exp_rows:
            fm = (fm or "").upper()
            modo_by_exp[eid] = "Aereo" if fm == "AIR" else ("Maritimo" if fm == "SEA" else "")
            # El cursor crudo puede devolver jsonb como STRING (según el
            # driver) — sin este parse los overrides se descartaban en
            # silencio y phase-stats sólo veía las muestras del EventLog.
            if isinstance(pdj, str):
                try:
                    pdj = json.loads(pdj)
                except (ValueError, TypeError):
                    pdj = {}
            over_by_exp[eid] = pdj if isinstance(pdj, dict) else {}

        # Primera entrada a cada fase por expediente + evento más antiguo.
        entries = {}
        first_ev = {}
        for eid, fase, at in ev_rows:
            if eid not in first_ev or at < first_ev[eid]:
                first_ev[eid] = at
            fase = (fase or "").upper()
            if fase not in order:
                continue
            d = entries.setdefault(eid, {})
            if fase not in d or at < d[fase]:
                d[fase] = at
        # REGISTRO sintético: el evento de creación trae phase_to NULL, así
        # que sin esto REGISTRO nunca genera muestra (el frontend ya hace
        # este mismo fallback con el evento más antiguo).
        for eid, at0 in first_ev.items():
            d = entries.setdefault(eid, {})
            if "REGISTRO" not in d:
                d["REGISTRO"] = at0

        def _ov_days(ov):
            if isinstance(ov, dict):
                try:
                    return float(ov.get("days"))
                except (TypeError, ValueError):
                    return None
            if ov in (None, ""):
                return None
            try:
                return float(ov)
            except (TypeError, ValueError):
                return None

        # "_ALL" = agregado de TODOS los expedientes (incluye los que aún no
        # tienen método de envío) — fallback para fases independientes del
        # modo (Registro/Producción/Preparación/Despacho/En destino).
        acc = {"Aereo": {}, "Maritimo": {}, "_ALL": {}}
        all_ids = set(list(entries.keys()) + list(over_by_exp.keys()))
        for eid in all_ids:
            modo = modo_by_exp.get(eid) or ""
            buckets = ["_ALL"] + ([modo] if modo in ("Aereo", "Maritimo") else [])

            def _push(fase, days):
                for b in buckets:
                    acc[b].setdefault(fase, []).append(days)

            fases = entries.get(eid) or {}
            seq = [s for s in order if s in fases]
            over = over_by_exp.get(eid) or {}
            done = set()
            # Overrides manuales: cuentan como muestra de SU fase.
            for fase, ov in over.items():
                fase = str(fase).upper()
                days = _ov_days(ov)
                if fase in order and days is not None and days >= 0:
                    _push(fase, days)
                    done.add(fase)
            # Transiciones cerradas del EventLog (sin override).
            for i in range(len(seq) - 1):
                fase = seq[i]
                if fase in done:
                    continue
                delta = fases[seq[i + 1]] - fases[fase]
                _push(fase, max(0.0, delta.total_seconds() / 86400.0))

        out = {
            m: {f: {"avg": round(sum(v) / len(v), 2), "n": len(v)}
                for f, v in acc[m].items() if v}
            for m in acc
        }
        return Response({"phase_stats": out})

    @action(detail=False, methods=["get"])
    def kanban(self, request):
        """Vista kanban: expedientes agrupados por fase (estado).
        Respeta filtros `client`, `brand`, `phase_signal` igual que list."""
        qs = Expediente.objects.filter(is_active=True)
        mapping = {
            "client":       "client_id",
            "brand":        "brand_id",
            "phase_signal": "phase_signal",
            "modo_operacion": "modo_operacion",
        }
        for p, f in mapping.items():
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})

        fases_canonicas = [
            "REGISTRO", "PRODUCCION", "PREPARACION",
            "DESPACHO", "TRANSITO", "EN_DESTINO", "CERRADO",
        ]
        buckets = {f: [] for f in fases_canonicas}
        other = []
        for e in qs.order_by("-last_event_at", "-created_at"):
            row = ExpedienteListSerializer(e).data
            key = e.estado if e.estado in buckets else None
            if key:
                buckets[key].append(row)
            else:
                other.append(row)

        columns = [
            {
                "codigo": f,
                "label":  f.replace("_", " ").title(),
                "count":  len(buckets[f]),
                "items":  buckets[f],
            }
            for f in fases_canonicas
        ]
        if other:
            columns.append({
                "codigo": "OTROS",
                "label":  "Otros",
                "count":  len(other),
                "items":  other,
            })
        return Response({"columns": columns, "total": qs.count()})

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """Transiciona el expediente a una nueva fase.
        Valida contra pipeline.transicion_cat y emite evento con
        idempotence_token.
        """
        # HARD SHIELD: CLIENT B2B NUNCA mueve la state machine.
        denied = _deny_client_mutation(request, action_label="expediente.transition")
        if denied is not None: return denied
        fase_to           = (request.data.get("fase_to") or "").strip()
        idempotence_token = request.data.get("idempotence_token")
        note              = request.data.get("note")
        documento_id      = request.data.get("documento_id")

        if not fase_to:
            return Response({"detail": "fase_to requerido"}, status=400)

        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)

        # Idempotencia: si token ya existe, early return.
        if idempotence_token:
            existing = EventLog.objects.filter(
                idempotence_token=idempotence_token,
                is_active=True,
            ).first()
            if existing:
                return Response({
                    "ok": True,
                    "idempotent": True,
                    "event_id": str(existing.id),
                    "expediente": ExpedienteSerializer(exp).data,
                }, status=200)

        # Validación flexible contra catálogo de transiciones.
        # Política operativa: el avance de estado es DINÁMICO. No se
        # exige `documento_id` aunque la fila del catálogo lo marque,
        # y si la fila no existe en `transicion_cat` permitimos
        # igualmente el avance con defaults (no es bloqueante). Esto
        # alinea el backend con el modal del frontend, que ya no
        # impone checklist obligatorio.
        t = TransicionCat.objects.filter(
            fase_from=exp.estado, fase_to=fase_to, is_active=True,
        ).first()

        t_label       = (t.label if t else f"{exp.estado} → {fase_to}")
        t_is_rollback = bool(t and t.is_rollback)
        t_required    = (t.requiere_documento if t else None)

        if t_required and not documento_id:
            # Antes era 400 bloqueante. Ahora solo logueamos para
            # mantener telemetría de cumplimiento sin frenar al CEO.
            log.info(
                "transition.skip_required_doc exp=%s from=%s to=%s required=%s",
                exp.id, exp.estado, fase_to, t_required,
            )

        previous_state  = exp.estado
        correlation_id  = uuid.uuid4()
        event_id        = uuid.uuid4()
        emitter_id      = getattr(request.user, "id", None)
        emitter_id      = str(emitter_id) if emitter_id else None
        emitter_role    = ("admin" if t_is_rollback else
                           (getattr(request.user, "role", None) or "system"))

        payload = {
            "from":         previous_state,
            "to":           fase_to,
            "label":        t_label,
            "is_rollback":  t_is_rollback,
            "note":         note,
            "documento_id": documento_id,
            "catalog_hit":  bool(t),
            "required_doc": t_required,
        }

        try:
            with transaction.atomic():
                with connection.cursor() as c:
                    c.execute("""
                        UPDATE expedientes.expediente
                           SET estado = %s,
                               last_event_at = now(),
                               phase_signal = CASE
                                   WHEN %s = 'CERRADO' THEN 'ON_TRACK'
                                   ELSE COALESCE(phase_signal, 'ON_TRACK')
                               END
                         WHERE id = %s::uuid
                    """, [fase_to, fase_to, str(exp.id)])

                    c.execute("""
                        INSERT INTO pipeline.event_log (
                            id, correlation_id, event_type, aggregate_type, aggregate_id,
                            action_source, previous_status, new_status,
                            phase_from, phase_to, payload,
                            emitted_by_id, emitted_by_role, idempotence_token, is_active
                        ) VALUES (
                            %s, %s, 'expediente.phase_transition', 'expediente', %s,
                            'C11', %s, %s,
                            %s, %s, %s::jsonb,
                            %s, %s, %s, TRUE
                        )
                    """, [
                        str(event_id), str(correlation_id), str(exp.id),
                        previous_state, fase_to,
                        previous_state, fase_to, json.dumps(payload),
                        emitter_id, emitter_role, idempotence_token,
                    ])
        except Exception as e:
            log.exception("transition atomic tx falló: %s", e)
            return Response({"detail": "transaction_failed", "error": str(e)}, status=500)

        exp.refresh_from_db()
        return Response({
            "ok": True,
            "idempotent": False,
            "event_id":      str(event_id),
            "correlation_id": str(correlation_id),
            "transition":    {"from": previous_state, "to": fase_to},
            "expediente":    ExpedienteSerializer(exp).data,
        }, status=200)

    # ══════════════════════════════════════════════════════
    # COMANDO C5 · RegisterSAPConfirmation
    #   POST /api/expedientes/{id}/confirm-sap/
    #
    #   Atomic:
    #     1. Validar estado = REGISTRO (else 409)
    #     2. Insertar ART-04 en expedientes.artifact_instances
    #     3. Actualizar cantidades confirmadas en expedientes.linea
    #        (si la fábrica recortó, la línea baja su qty; delta se
    #         registra en el payload del event_log)
    #     4. Update expediente:
    #          estado = 'PRODUCCION'
    #          numero_sap = sap_id
    #          fecha_produccion_estimada = fecha_fabricacion
    #          last_event_at = now()
    #     5. Insert 2 eventos en pipeline.event_log:
    #          · sap.confirmed         (aggregate_type='expediente')
    #          · expediente.state_changed
    # ══════════════════════════════════════════════════════
    @action(
        detail=True,
        methods=["post"],
        url_path="confirm-sap",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def confirm_sap(self, request, pk=None):
        # HARD SHIELD: confirmación SAP (C5) es CEO-ONLY.
        denied = _deny_client_mutation(request, action_label="expediente.confirm_sap")
        if denied is not None: return denied
        sap_id             = (request.data.get("sap_id") or "").strip()
        fecha_fabricacion  = (request.data.get("fecha_fabricacion") or "").strip()
        lineas_confirmadas = request.data.get("lineas_confirmadas") or "[]"
        documento_file     = request.FILES.get("documento_sap")

        # Tolerar que `lineas_confirmadas` llegue como string JSON (multipart)
        if isinstance(lineas_confirmadas, str):
            try:
                lineas_confirmadas = json.loads(lineas_confirmadas)
            except json.JSONDecodeError:
                return Response(
                    {"detail": "lineas_confirmadas no es JSON válido"},
                    status=400,
                )
        if not isinstance(lineas_confirmadas, list):
            return Response({"detail": "lineas_confirmadas debe ser lista"}, status=400)

        if not sap_id:
            return Response({"detail": "sap_id requerido"}, status=400)

        fabricacion_dt = None
        if fecha_fabricacion:
            try:
                fabricacion_dt = datetime.fromisoformat(fecha_fabricacion).date()
            except ValueError:
                return Response({"detail": "fecha_fabricacion debe ser YYYY-MM-DD"}, status=400)

        # ── Validaciones de negocio ─────────────────────
        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)

        if exp.estado != "REGISTRO":
            return Response(
                {
                    "detail": f"Transición inválida · expediente en '{exp.estado}', se esperaba 'REGISTRO'",
                    "current_state": exp.estado,
                    "expected_state": "REGISTRO",
                },
                status=409,
            )

        # ⚠ NINGÚN campo comercial es obligatorio (decisión CEO).
        # El constraint SQL ck_exp_commercial_complete_after_registro fue
        # dropeado en 98_drop_commercial_constraint.sql. La transición
        # T2 (REGISTRO→PRODUCCION) procede aunque brand_id/modo/moneda
        # queden en NULL. Se completarán después si el operador lo decide.

        correlation_id = uuid.uuid4()
        artifact_id    = uuid.uuid4()

        # ── Subir PDF a storage (best-effort) ────────────
        # Sprint 2026-05-01: subida REAL a MinIO via put_object_stream
        # (antes solo generaba signed URL sin upload).
        storage_url = None
        paperless_task_id = None
        file_size_bytes = 0
        file_ext = None
        if documento_file:
            file_bytes = b"".join(chunk for chunk in documento_file.chunks())
            file_size_bytes = len(file_bytes)
            fname = documento_file.name or f"ART-04_{exp.codigo}.pdf"
            file_ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else None
            content_type = documento_file.content_type or "application/pdf"

            try:
                from apps.storage.services import put_object_stream, paperless_ingest
                safe_name = fname.replace("/", "_").replace("\\", "_")
                key = f"expediente/{exp.id}/art-04-{artifact_id}-{safe_name}"
                up = put_object_stream(
                    key=key,
                    file_stream=io.BytesIO(file_bytes),
                    content_type=content_type,
                    length=file_size_bytes,
                )
                if up.get("ok"):
                    storage_url = key
                else:
                    log.warning("confirm_sap MinIO upload fallo: %s", up.get("error"))
            except Exception as e:
                log.warning("confirm_sap MinIO upload fallo: %s", e)

            # Paperless-ngx ingest (OCR + archivo inmutable, best-effort)
            try:
                from apps.storage.services import paperless_ingest
                p = paperless_ingest(
                    file_bytes=file_bytes,
                    filename=fname,
                    title=f"ART-04 - Confirmacion SAP - {exp.codigo}",
                    document_type="Confirmación SAP",
                    tags=["ART-04", "SAP", "C5"],
                )
                paperless_task_id = p.get("task_id")
            except Exception as e:
                log.warning("paperless_ingest (ART-04) fallo: %s", e)

        # ── Transacción atómica ──────────────────────────
        try:
            with transaction.atomic():
                with connection.cursor() as c:

                    # 1. Insertar ART-04 en artifact_instances
                    ocr_payload = {
                        "sap_id":            sap_id,
                        "fecha_fabricacion": fecha_fabricacion,
                        "expediente_code":   exp.codigo,
                        "paperless_task_id": paperless_task_id,
                        "lineas_confirmadas_count": len(lineas_confirmadas),
                    }
                    # Sprint 2026-05-06 · audience=ADMIN_ONLY:
                    # ART-04 (Confirmación SAP) NO se muestra a CLIENT_*
                    # ni a usuarios MWT staff. Solo Admin/CEO/superuser.
                    c.execute("""
                        INSERT INTO expedientes.artifact_instances (
                            id, expediente_id, oc_id,
                            artifact_code, kind, codigo,
                            file_ext, file_size_bytes, storage_url, paperless_doc_id,
                            ocr_status, ocr_engine, ocr_confidence, ocr_payload,
                            action_source, correlation_id,
                            author, fecha, visibility_tier, audience, is_active
                        ) VALUES (
                            %s, %s, %s,
                            'ART-04', 'Confirmación SAP', %s,
                            %s, %s, %s, %s,
                            'DONE', 'manual-upload', 1.0, %s::jsonb,
                            'C5', %s,
                            %s, %s, 'INTERNAL', 'ADMIN_ONLY', TRUE
                        )
                    """, [
                        str(artifact_id), str(exp.id),
                        str(exp.oc_id) if exp.oc_id else None,
                        sap_id,
                        file_ext, file_size_bytes, storage_url, paperless_task_id,
                        json.dumps(ocr_payload),
                        str(correlation_id),
                        (getattr(request.user, "email", None) or getattr(request.user, "username", None) or "system"),
                        fabricacion_dt,
                    ])

                    # Sprint 2026-05-06 · UPSERT idempotente en expedientes.documento
                    # con audience=ADMIN_ONLY → aparece en "Documentos
                    # comerciales" SOLO al rol Admin/CEO/superuser. Si ya
                    # existe un ART-04 con el mismo sap_id para este
                    # expediente (re-confirmación), lo actualizamos en
                    # lugar de duplicar.
                    if storage_url:
                        try:
                            c.execute("""
                                SELECT id FROM expedientes.documento
                                 WHERE expediente_id = %s::uuid
                                   AND kind = 'ART-04'
                                   AND codigo LIKE %s
                                   AND is_active = TRUE
                                 LIMIT 1
                            """, [str(exp.id), sap_id])
                            row_doc = c.fetchone()
                            if row_doc:
                                c.execute("""
                                    UPDATE expedientes.documento
                                       SET storage_url = %s,
                                           file_ext = %s,
                                           file_size_bytes = %s,
                                           audience = 'ADMIN_ONLY',
                                           fecha = %s,
                                           updated_at = NOW()
                                     WHERE id = %s
                                """, [
                                    storage_url, file_ext, file_size_bytes,
                                    fabricacion_dt, str(row_doc[0]),
                                ])
                            else:
                                c.execute("""
                                    INSERT INTO expedientes.documento (
                                        id, oc_id, expediente_id, kind, codigo,
                                        audience,
                                        file_ext, file_size_bytes, storage_url,
                                        author, fecha,
                                        is_active, created_at, updated_at
                                    ) VALUES (
                                        %s, %s, %s, 'ART-04', %s,
                                        'ADMIN_ONLY',
                                        %s, %s, %s,
                                        %s, %s,
                                        TRUE, NOW(), NOW()
                                    )
                                """, [
                                    str(uuid.uuid4()),
                                    str(exp.oc_id) if exp.oc_id else None,
                                    str(exp.id),
                                    sap_id,
                                    file_ext, file_size_bytes, storage_url,
                                    (getattr(request.user, "email", None)
                                     or getattr(request.user, "username", None)
                                     or "system"),
                                    fabricacion_dt,
                                ])
                        except Exception as e:
                            log.warning(
                                "[confirm_sap] upsert documento ADMIN_ONLY fallo: %s", e
                            )

                    # 2. Actualizar líneas confirmadas (split/match)
                    #    Cada item: {linea_id, qty_confirmada, unit_price?}
                    #    `unit_price` (sprint 2026-05-01) — opcional. Si
                    #    viene > 0 desde el frontend (resuelto del catálogo
                    #    via client_prices/precio_lista), se persiste en
                    #    expedientes.linea.unit_price para que el
                    #    expediente muestre el precio correcto desde el
                    #    inicio. Si la DB ya tenía precio > 0, se preserva
                    #    (no sobrescribe con 0).
                    delta_lines = []
                    for item in lineas_confirmadas:
                        linea_id      = item.get("linea_id") or item.get("id")
                        qty_conf      = item.get("qty_confirmada")
                        unit_price_in = item.get("unit_price")
                        if not linea_id or qty_conf is None:
                            continue
                        try:
                            qty_conf_dec = Decimal(str(qty_conf))
                        except Exception:
                            continue

                        c.execute("""
                            SELECT qty, COALESCE(unit_price, 0)
                              FROM expedientes.linea
                             WHERE id = %s::uuid
                               AND expediente_id = %s::uuid
                               AND is_active = TRUE
                             LIMIT 1
                        """, [linea_id, str(exp.id)])
                        row = c.fetchone()
                        if not row:
                            continue
                        qty_original  = Decimal(str(row[0] or 0))
                        unit_price_db = Decimal(str(row[1] or 0))

                        # Resolver unit_price final:
                        #   1) si frontend manda valor > 0, ese gana.
                        #   2) si DB tiene > 0, se mantiene (preserva histórico).
                        #   3) si nada, queda 0.
                        unit_price_final = unit_price_db
                        if unit_price_in is not None:
                            try:
                                u = Decimal(str(unit_price_in))
                                if u > 0:
                                    unit_price_final = u
                            except Exception:
                                pass

                        if qty_conf_dec != qty_original:
                            delta_lines.append({
                                "linea_id":      linea_id,
                                "qty_original":  float(qty_original),
                                "qty_confirmed": float(qty_conf_dec),
                                "delta":         float(qty_conf_dec - qty_original),
                            })

                        # Sprint 2026-05-01: tambien propagar production_date
                        # a la linea (antes solo se guardaba en expediente.
                        # fecha_produccion_estimada). Esto hace que el chip
                        # "Fecha de produccion" del OCDetail muestre la fecha
                        # ingresada en el modal AR-04.
                        c.execute("""
                            UPDATE expedientes.linea
                               SET qty             = %s,
                                   unit_price      = %s,
                                   total_price     = ROUND(%s * %s, 2),
                                   sap             = %s,
                                   production_date = %s,
                                   estado          = CASE WHEN %s > 0 THEN 'SAP_CONFIRMADO' ELSE 'CANCELADA' END
                             WHERE id = %s::uuid
                        """, [
                            float(qty_conf_dec),
                            float(unit_price_final),
                            float(unit_price_final), float(qty_conf_dec),
                            sap_id,
                            fabricacion_dt,
                            float(qty_conf_dec), linea_id,
                        ])

                    # 3. Update expediente → PRODUCCION
                    previous_state = exp.estado
                    c.execute("""
                        UPDATE expedientes.expediente
                           SET estado                     = 'PRODUCCION',
                               sap                        = %s,
                               numero_sap                 = %s,
                               fecha_produccion_estimada  = %s,
                               artifacts_done             = COALESCE(artifacts_done, 0) + 1,
                               last_event_at              = now(),
                               phase_signal               = 'green'
                         WHERE id = %s::uuid
                    """, [sap_id, sap_id, fabricacion_dt, str(exp.id)])

                    # 4. Eventos en pipeline.event_log (2 filas)
                    emitter_id = getattr(request.user, "id", None)
                    emitter_id = str(emitter_id) if emitter_id else None

                    ev1_payload = {
                        "sap_id":            sap_id,
                        "fecha_fabricacion": fecha_fabricacion,
                        "artifact_id":       str(artifact_id),
                        "artifact_code":     "ART-04",
                        "lineas_confirmadas_count": len(lineas_confirmadas),
                        "lineas_con_delta":  delta_lines,
                    }
                    c.execute("""
                        INSERT INTO pipeline.event_log (
                            id, correlation_id, event_type, aggregate_type, aggregate_id,
                            action_source, previous_status, new_status, payload,
                            emitted_by_id, emitted_by_role, is_active
                        ) VALUES (
                            %s, %s, 'sap.confirmed', 'expediente', %s,
                            'C5', %s, %s, %s::jsonb,
                            %s, %s, TRUE
                        )
                    """, [
                        str(uuid.uuid4()), str(correlation_id), str(exp.id),
                        previous_state, 'PRODUCCION', json.dumps(ev1_payload),
                        emitter_id, 'admin',
                    ])

                    ev2_payload = {
                        "from":         previous_state,
                        "to":           "PRODUCCION",
                        "triggered_by": "C5",
                        "artifact_id":  str(artifact_id),
                    }
                    c.execute("""
                        INSERT INTO pipeline.event_log (
                            id, correlation_id, event_type, aggregate_type, aggregate_id,
                            action_source, previous_status, new_status, payload,
                            emitted_by_id, emitted_by_role, is_active
                        ) VALUES (
                            %s, %s, 'expediente.state_changed', 'expediente', %s,
                            'C5', %s, %s, %s::jsonb,
                            %s, %s, TRUE
                        )
                    """, [
                        str(uuid.uuid4()), str(correlation_id), str(exp.id),
                        previous_state, 'PRODUCCION', json.dumps(ev2_payload),
                        emitter_id, 'admin',
                    ])

                    # Sprint 2026-05-08 · Eliminado el INSERT "sombra"
                    # legacy que creaba un segundo registro Documento
                    # con kind='Confirmación SAP'. Causaba duplicado en
                    # "Documentos comerciales". El UPSERT idempotente de
                    # arriba (kind='ART-04', audience='ADMIN_ONLY') es el
                    # único registro válido del SAP a partir de ahora.

        except Exception as e:
            log.exception("confirm_sap atomic tx falló: %s", e)
            return Response(
                {"detail": "transaction_failed", "error": str(e)},
                status=500,
            )

        # Respuesta: expediente actualizado (optimistic refresh en el front)
        exp.refresh_from_db()
        return Response({
            "ok":              True,
            "expediente":      ExpedienteSerializer(exp).data,
            "artifact_id":     str(artifact_id),
            "correlation_id":  str(correlation_id),
            "command":         "C5",
            "transition":      {"from": "REGISTRO", "to": "PRODUCCION"},
            "storage_url":     storage_url,
        }, status=200)

    # ══════════════════════════════════════════════════════
    # UPSERT SAP — editar SAP existente o agregar SAP adicional
    #
    # Diferencias con confirm_sap:
    #   · NO requiere REGISTRO; acepta PRODUCCION/DESPACHO/etc.
    #   · NO transiciona el estado del expediente.
    #   · Si ya existe ART-04 con ese sap_id, lo actualiza
    #     (reemplaza el PDF si llega uno nuevo). Si no existe,
    #     crea uno nuevo (caso "agregar SAP adicional").
    # ══════════════════════════════════════════════════════

    # ══════════════════════════════════════════════════════════
    # GET / PATCH /api/expedientes/{exp_id}/sap/{sap_id}/
    # Sprint 2026-05-06 · Editor SAP-level (Fase 2.B MVP).
    # Sprint 2026-05-07 · Fase 2.D/2.E — extensión:
    #   · GET: precarga del wizard (líneas + metadata por SAP).
    #   · PATCH: además de metadata, soporta lines_added /
    #     lines_removed / lines_updated.
    #
    # Permite cambiar metadata del SAP individual:
    #   · operating_company_id  (cambia operador → recálculo crédito)
    #   · forma_pago            ('CREDITO' | 'CONTADO')
    #   · payment_days
    #
    # NO cubre todavía:
    #   · cambio de cliente con split del expediente (Fase 2.F)
    # ══════════════════════════════════════════════════════════
    @action(
        detail=True,
        methods=["get", "patch"],
        url_path=r"sap/(?P<sap_id>[^/.]+)",
    )
    def patch_sap(self, request, pk=None, sap_id=None):
        # ── Branch GET ─────────────────────────────────────
        # GET es read-only; lo permitimos a Admin y a CLIENT_*
        # con scope (la guard de listado ya filtra por client).
        # Para CLIENT_* ocultamos `unit_price_mwt`.
        if request.method.upper() == "GET":
            return self._get_sap(request, pk=pk, sap_id=sap_id)

        denied = _deny_client_mutation(request, action_label="expediente.patch_sap")
        if denied is not None:
            return denied

        if not sap_id:
            return Response({"detail": "sap_id requerido"}, status=400)

        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)

        # Cargar el ART-04 activo de ese SAP
        try:
            with connection.cursor() as c:
                c.execute("""
                    SELECT id, operating_company_id, forma_pago, payment_days
                      FROM expedientes.artifact_instances
                     WHERE expediente_id = %s::uuid
                       AND artifact_code = 'ART-04'
                       AND codigo = %s
                       AND is_active = TRUE
                     LIMIT 1
                """, [str(exp.id), sap_id])
                row = c.fetchone()
        except Exception as e:
            log.exception("[patch_sap] lookup ART-04 failed: %s", e)
            return Response({"detail": "lookup_failed", "error": str(e)[:200]}, status=500)

        if not row:
            return Response(
                {"detail": f"No existe ART-04 activo para sap={sap_id} en este expediente."},
                status=404,
            )
        ai_id, cur_op, cur_fp, cur_pd = row

        payload = dict(request.data) if hasattr(request.data, "items") else {}
        try:
            payload = {k: request.data.get(k) for k in request.data.keys()}
        except Exception:
            payload = dict(request.data)

        # Normalizar inputs (todos opcionales)
        new_op = payload.get("operating_company_id")
        if new_op == "":
            new_op = None
        new_fp = (payload.get("forma_pago") or "").strip().upper() or None
        if new_fp and new_fp not in ("CREDITO", "CONTADO"):
            return Response({"detail": "forma_pago inválida"}, status=400)

        new_pd = payload.get("payment_days")
        if new_pd in ("", None):
            new_pd_val = None
        else:
            try:
                new_pd_val = int(new_pd)
            except (TypeError, ValueError):
                return Response({"detail": "payment_days inválido"}, status=400)
            if new_pd_val < 0:
                return Response({"detail": "payment_days no puede ser negativo"}, status=400)

        # ── Sprint 2026-05-07 · Fase 2.E ─ líneas dentro del SAP ──
        # Aceptamos tres arrays opcionales:
        #   · lines_added   = [{producto_id, sku, talla, qty}]
        #   · lines_removed = [linea_id, ...]      (soft-delete)
        #   · lines_updated = [{id, qty}]          (recalcula total_price)
        lines_added   = payload.get("lines_added")
        lines_removed = payload.get("lines_removed")
        lines_updated = payload.get("lines_updated")
        # Tolerancia a JSON crudo (form-encoded) por si llega como string.
        for _name in ("lines_added", "lines_removed", "lines_updated"):
            _val = locals()[_name]
            if isinstance(_val, str):
                try:
                    parsed = json.loads(_val) if _val.strip() else None
                except json.JSONDecodeError:
                    return Response(
                        {"detail": f"{_name} no es JSON válido"}, status=400
                    )
                if _name == "lines_added":
                    lines_added = parsed
                elif _name == "lines_removed":
                    lines_removed = parsed
                else:
                    lines_updated = parsed
        if lines_added is not None and not isinstance(lines_added, list):
            return Response({"detail": "lines_added debe ser array"}, status=400)
        if lines_removed is not None and not isinstance(lines_removed, list):
            return Response({"detail": "lines_removed debe ser array"}, status=400)
        if lines_updated is not None and not isinstance(lines_updated, list):
            return Response({"detail": "lines_updated debe ser array"}, status=400)

        has_line_ops = bool(
            (lines_added and len(lines_added) > 0)
            or (lines_removed and len(lines_removed) > 0)
            or (lines_updated and len(lines_updated) > 0)
        )

        # ── Cambio de cliente: split de expediente (Fase 2.F) ──
        # Si new_client_id != cur_client_id, generamos un nuevo expediente
        # heredando metadatos del original y migramos las líneas, el
        # artifact_instance del SAP y los documentos ART-04 asociados.
        new_client_id = payload.get("client_id")
        cur_client_id = getattr(exp, "client_id", None)
        wants_split = bool(
            new_client_id and str(new_client_id) != str(cur_client_id or "")
        )

        # Si nada vino, 400
        if (new_op is None and new_fp is None and new_pd_val is None
                and not has_line_ops and not wants_split):
            return Response({"detail": "Sin cambios — incluí al menos uno de operating_company_id, forma_pago, payment_days, lines_added, lines_removed, lines_updated, client_id"}, status=400)

        # Aplicar cambios atómicamente
        added_ids:   list = []
        removed_ids: list = []
        updated_ids: list = []
        # Defaults para split (sobrescritos abajo si wants_split).
        split_done = False
        new_exp_id = None
        new_exp_codigo = None
        lines_moved_count = 0
        # eff_exp_id es el expediente SOBRE EL QUE caen los demás cambios
        # (operating_company_id, forma_pago, payment_days, lines_*). Si hay
        # split, apuntamos al nuevo expediente; si no, al original.
        eff_exp_id = str(exp.id)
        try:
            with transaction.atomic():
                with connection.cursor() as c:
                    # ────────────────────────────────────────────────
                    # SPLIT · Fase 2.F
                    # 1) Genera nuevo expediente clonando metadatos.
                    # 2) Migra líneas, artifact_instance y documentos.
                    # 3) Recalcula total_cost del original.
                    # ────────────────────────────────────────────────
                    if wants_split:
                        new_exp_id = str(uuid.uuid4())
                        # Generar código EXP-YYYY-NNNN secuencial.
                        cur_year = datetime.utcnow().year
                        like_pat = f"EXP-{cur_year}-%"
                        c.execute(
                            "SELECT COUNT(*) FROM expedientes.expediente "
                            "WHERE codigo LIKE %s",
                            [like_pat],
                        )
                        seq = (c.fetchone() or [0])[0] + 1
                        new_exp_codigo = f"EXP-{cur_year}-{seq:04d}"

                        # operating_company_id heredado a menos que el
                        # payload mande uno nuevo (se aplica abajo igual,
                        # pero queremos que el INSERT inicial lo refleje
                        # ya correcto).
                        eff_op_for_insert = (
                            str(new_op) if new_op is not None
                            else (str(cur_op) if cur_op else None)
                        )
                        eff_fp_for_insert = new_fp or cur_fp or "CREDITO"
                        eff_cd_for_insert = (
                            new_pd_val if new_pd_val is not None
                            else (cur_pd if cur_pd is not None else 0)
                        )

                        c.execute(
                            """
                            INSERT INTO expedientes.expediente (
                                id, codigo, oc_id, client_id,
                                operating_company_id, brand_id, sap,
                                estado, modo_operacion, moneda,
                                forma_pago, credit_days,
                                total_cost, base_price,
                                is_active, created_at, updated_at
                            ) VALUES (
                                %s::uuid, %s, %s, %s::uuid,
                                %s, %s, %s,
                                'REGISTRO', %s, %s,
                                %s, %s,
                                0, 0,
                                TRUE, NOW(), NOW()
                            )
                            """,
                            [
                                new_exp_id,
                                new_exp_codigo,
                                exp.oc_id,
                                str(new_client_id),
                                eff_op_for_insert,
                                str(exp.brand_id) if exp.brand_id else None,
                                exp.sap,
                                exp.modo_operacion or "FULL",
                                exp.moneda or "USD",
                                eff_fp_for_insert,
                                eff_cd_for_insert,
                            ],
                        )

                        # Migrar líneas activas del SAP al nuevo expediente.
                        c.execute(
                            """
                            UPDATE expedientes.linea
                               SET expediente_id   = %s::uuid,
                                   sap             = NULL,
                                   production_date = NULL,
                                   estado          = 'PENDIENTE_SAP',
                                   updated_at      = NOW()
                             WHERE expediente_id = %s::uuid
                               AND sap = %s
                               AND is_active = TRUE
                            """,
                            [new_exp_id, str(exp.id), sap_id],
                        )
                        lines_moved_count = c.rowcount or 0

                        # Sprint 2026-05-08 · NO migramos artifact_instance
                        # ni documento ART-04 al nuevo expediente. El nuevo
                        # nace SIN SAP — el user va a subir uno nuevo. Los
                        # del expediente original quedan en el viejo (que
                        # se soft-borra en Caso A o queda como huerfano en
                        # Caso B; en B los soft-deletamos abajo igual).
                        # Recolectar storage_url del documento ART-04
                        # antes de marcarlo inactivo (para borrar en MinIO).
                        c.execute(
                            """
                            SELECT id, storage_url FROM expedientes.documento
                             WHERE expediente_id = %s::uuid
                               AND kind = 'ART-04'
                               AND codigo LIKE %s
                               AND is_active = TRUE
                            """,
                            [str(exp.id), sap_id],
                        )
                        _moved_sap_doc_keys = []
                        for _did, _surl in (c.fetchall() or []):
                            if _surl and not str(_surl).startswith("dynamic://"):
                                _moved_sap_doc_keys.append(str(_surl))

                        # Soft-delete del artifact_instance ART-04 del SAP.
                        c.execute(
                            """
                            UPDATE expedientes.artifact_instances
                               SET is_active = FALSE,
                                   updated_at = NOW()
                             WHERE expediente_id = %s::uuid
                               AND artifact_code = 'ART-04'
                               AND codigo = %s
                               AND is_active = TRUE
                            """,
                            [str(exp.id), sap_id],
                        )

                        # Soft-delete documento ART-04 del SAP (en el exp
                        # original; en Caso A el cleanup posterior lo
                        # cubre, en Caso B lo borramos acá).
                        c.execute(
                            """
                            UPDATE expedientes.documento
                               SET is_active = FALSE,
                                   updated_at = NOW()
                             WHERE expediente_id = %s::uuid
                               AND kind = 'ART-04'
                               AND codigo LIKE %s
                               AND is_active = TRUE
                            """,
                            [str(exp.id), sap_id],
                        )

                        # Schedule borrado en MinIO post-commit del XLSX SAP.
                        if _moved_sap_doc_keys:
                            try:
                                from apps.storage.services import delete_object as _del_obj  # noqa: PLC0415
                            except (ImportError, ModuleNotFoundError):
                                _del_obj = None
                            if _del_obj is not None:
                                for _k in _moved_sap_doc_keys:
                                    transaction.on_commit(
                                        lambda k=_k: _del_obj(key=k)
                                    )

                        # Recalcular total_cost del expediente original
                        # con las líneas activas restantes (qty * unit_price).
                        c.execute(
                            """
                            UPDATE expedientes.expediente
                               SET total_cost = COALESCE((
                                       SELECT SUM(qty * unit_price)
                                         FROM expedientes.linea
                                        WHERE expediente_id = %s::uuid
                                          AND is_active = TRUE
                                   ), 0),
                                   updated_at = NOW()
                             WHERE id = %s::uuid
                            """,
                            [str(exp.id), str(exp.id)],
                        )

                        # Setear total_cost del nuevo expediente con las
                        # líneas que acaba de recibir (antes de aplicar
                        # line ops adicionales, que se reflejan luego).
                        c.execute(
                            """
                            UPDATE expedientes.expediente
                               SET total_cost = COALESCE((
                                       SELECT SUM(qty * unit_price)
                                         FROM expedientes.linea
                                        WHERE expediente_id = %s::uuid
                                          AND is_active = TRUE
                                   ), 0),
                                   updated_at = NOW()
                             WHERE id = %s::uuid
                            """,
                            [new_exp_id, new_exp_id],
                        )

                        # Audit del split.
                        emitter_id_split = getattr(request.user, "id", None)
                        emitter_role_split = (
                            getattr(request.user, "role_default", None)
                            or getattr(request.user, "role", None)
                            or "unknown"
                        )
                        try:
                            c.execute(
                                """
                                INSERT INTO pipeline.event_log
                                  (id, correlation_id,
                                   event_type, aggregate_type, aggregate_id,
                                   payload,
                                   emitted_by_id, emitted_by_role,
                                   is_active, created_at, updated_at)
                                VALUES
                                  (%s, %s,
                                   'sap.split_expediente', 'expediente', %s::uuid,
                                   %s::jsonb,
                                   %s, %s,
                                   TRUE, NOW(), NOW())
                                """,
                                [
                                    str(uuid.uuid4()),
                                    str(uuid.uuid4()),
                                    str(exp.id),
                                    json.dumps({
                                        "old_expediente_id":  str(exp.id),
                                        "new_expediente_id":  new_exp_id,
                                        "new_expediente_codigo": new_exp_codigo,
                                        "sap_id":             sap_id,
                                        "lines_moved_count":  lines_moved_count,
                                        "old_client_id":      str(cur_client_id) if cur_client_id else None,
                                        "new_client_id":      str(new_client_id),
                                    }),
                                    str(emitter_id_split) if emitter_id_split else None,
                                    emitter_role_split,
                                ],
                            )
                        except (ValueError, TypeError) as ev_err:
                            log.warning("[patch_sap] event_log split insert failed: %s", ev_err)

                        split_done = True
                        # Re-leer el ai_id (que sigue siendo el mismo,
                        # solo se le actualizó expediente_id) para que
                        # los UPDATEs siguientes sigan apuntando bien.
                        eff_exp_id = new_exp_id

                        # Sprint 2026-05-08 · Cleanup post-split.
                        # Si el expediente original quedó SIN líneas activas
                        # tras mover las líneas del SAP, lo soft-eliminamos
                        # junto con sus documentos comerciales (Proforma,
                        # OC, Factura, etc.) y limpiamos los archivos en
                        # MinIO. Caso B (otras líneas/SAPs presentes): no
                        # tocar el expediente, solo se movió este SAP.
                        c.execute(
                            """
                            SELECT COUNT(*) FROM expedientes.linea
                             WHERE expediente_id = %s::uuid
                               AND is_active = TRUE
                            """,
                            [str(exp.id)],
                        )
                        remaining_lines = (c.fetchone() or [0])[0]
                        old_exp_emptied = bool(remaining_lines == 0)
                        if old_exp_emptied:
                            # Recolectar storage_url de los docs activos
                            # del exp original para borrarlos de MinIO
                            # tras commit (transaction.on_commit).
                            c.execute(
                                """
                                SELECT id, storage_url FROM expedientes.documento
                                 WHERE expediente_id = %s::uuid
                                   AND is_active = TRUE
                                """,
                                [str(exp.id)],
                            )
                            old_docs_rows = c.fetchall() or []
                            old_doc_keys = []
                            for _doc_id, _storage_url in old_docs_rows:
                                if not _storage_url:
                                    continue
                                # Saltamos los markers dynamic:// (no son
                                # objetos reales en MinIO).
                                if str(_storage_url).startswith("dynamic://"):
                                    continue
                                old_doc_keys.append(str(_storage_url))

                            # Soft-delete documentos del exp original.
                            c.execute(
                                """
                                UPDATE expedientes.documento
                                   SET is_active = FALSE,
                                       updated_at = NOW()
                                 WHERE expediente_id = %s::uuid
                                   AND is_active = TRUE
                                """,
                                [str(exp.id)],
                            )

                            # Soft-delete artifact_instances residuales
                            # (no debería haber, las del SAP ya se movieron).
                            c.execute(
                                """
                                UPDATE expedientes.artifact_instances
                                   SET is_active = FALSE,
                                       updated_at = NOW()
                                 WHERE expediente_id = %s::uuid
                                   AND is_active = TRUE
                                """,
                                [str(exp.id)],
                            )

                            # Soft-delete del expediente original.
                            c.execute(
                                """
                                UPDATE expedientes.expediente
                                   SET is_active = FALSE,
                                       estado    = 'CANCELADO',
                                       updated_at = NOW()
                                 WHERE id = %s::uuid
                                """,
                                [str(exp.id)],
                            )

                            # Sprint 2026-05-08 · si la OC compartida no
                            # tiene más expedientes activos, su client_id
                            # debe pasar al nuevo cliente (la OC ahora es
                            # exclusiva del nuevo expediente).
                            if exp.oc_id:
                                c.execute(
                                    """
                                    SELECT COUNT(*) FROM expedientes.expediente
                                     WHERE oc_id = %s::uuid AND is_active = TRUE
                                    """,
                                    [str(exp.oc_id)],
                                )
                                others = (c.fetchone() or [0])[0]
                                if int(others or 0) <= 1:
                                    c.execute(
                                        """
                                        UPDATE expedientes.oc
                                           SET client_id = %s::uuid,
                                               updated_at = NOW()
                                         WHERE id = %s::uuid
                                        """,
                                        [str(new_client_id), str(exp.oc_id)],
                                    )

                            # Borrado en MinIO post-commit (best-effort).
                            if old_doc_keys:
                                try:
                                    from apps.storage.services import delete_object  # noqa: PLC0415
                                except (ImportError, ModuleNotFoundError):
                                    delete_object = None
                                if delete_object is not None:
                                    for _key in old_doc_keys:
                                        transaction.on_commit(
                                            lambda k=_key: delete_object(key=k)
                                        )

                            # Audit cleanup.
                            try:
                                c.execute(
                                    """
                                    INSERT INTO pipeline.event_log
                                      (id, correlation_id,
                                       event_type, aggregate_type, aggregate_id,
                                       payload,
                                       emitted_by_id, emitted_by_role,
                                       is_active, created_at, updated_at)
                                    VALUES
                                      (%s, %s,
                                       'sap.split_old_expediente_emptied', 'expediente', %s::uuid,
                                       %s::jsonb,
                                       %s, %s,
                                       TRUE, NOW(), NOW())
                                    """,
                                    [
                                        str(uuid.uuid4()),
                                        str(uuid.uuid4()),
                                        str(exp.id),
                                        json.dumps({
                                            "old_expediente_id": str(exp.id),
                                            "new_expediente_id": new_exp_id,
                                            "sap_id":            sap_id,
                                            "docs_soft_deleted": len(old_docs_rows),
                                            "minio_keys_to_remove": len(old_doc_keys),
                                        }),
                                        str(emitter_id_split) if emitter_id_split else None,
                                        emitter_role_split,
                                    ],
                                )
                            except (ValueError, TypeError) as ev_err:
                                log.warning(
                                    "[patch_sap] event_log split-cleanup insert failed: %s",
                                    ev_err,
                                )

                    sets = []
                    args = []
                    if new_op is not None:
                        sets.append("operating_company_id = %s::uuid")
                        args.append(str(new_op))
                    if new_fp is not None:
                        sets.append("forma_pago = %s")
                        args.append(new_fp)
                    if new_pd_val is not None:
                        sets.append("payment_days = %s")
                        args.append(new_pd_val)
                    if sets:
                        sets.append("updated_at = NOW()")
                        args.append(str(ai_id))
                        c.execute(
                            "UPDATE expedientes.artifact_instances SET "
                            + ", ".join(sets)
                            + " WHERE id = %s",
                            args,
                        )

                    # ── Operaciones sobre líneas ──────────────────
                    # operating_company resolved (efectivo después del UPDATE)
                    eff_op = (
                        str(new_op) if new_op is not None
                        else (str(cur_op) if cur_op else None)
                    )
                    if has_line_ops:
                        added_ids, removed_ids, updated_ids = self._apply_sap_line_ops(
                            cursor=c,
                            exp=exp,
                            sap_id=sap_id,
                            operating_company_id=eff_op,
                            lines_added=lines_added or [],
                            lines_removed=lines_removed or [],
                            lines_updated=lines_updated or [],
                            target_exp_id=eff_exp_id if split_done else None,
                            target_client_id=(
                                str(new_client_id) if split_done else None
                            ),
                        )

                    # Si hubo split + line ops, recalculamos total_cost
                    # del nuevo expediente para reflejar el estado final.
                    if split_done and has_line_ops:
                        c.execute(
                            """
                            UPDATE expedientes.expediente
                               SET total_cost = COALESCE((
                                       SELECT SUM(qty * unit_price)
                                         FROM expedientes.linea
                                        WHERE expediente_id = %s::uuid
                                          AND is_active = TRUE
                                   ), 0),
                                   updated_at = NOW()
                             WHERE id = %s::uuid
                            """,
                            [eff_exp_id, eff_exp_id],
                        )

                    # ── Auditoría: pipeline.event_log (schema real)
                    #    Columnas: event_type, aggregate_type, aggregate_id,
                    #    payload (jsonb), emitted_by_id, emitted_by_role,
                    #    correlation_id, is_active.
                    emitter_id = getattr(request.user, "id", None)
                    emitter_role = (
                        getattr(request.user, "role_default", None)
                        or getattr(request.user, "role", None)
                        or "unknown"
                    )

                    metadata_changed = (
                        new_op is not None
                        or new_fp is not None
                        or new_pd_val is not None
                    )
                    if metadata_changed:
                        try:
                            c.execute("""
                                INSERT INTO pipeline.event_log
                                  (id, correlation_id,
                                   event_type, aggregate_type, aggregate_id,
                                   payload,
                                   emitted_by_id, emitted_by_role,
                                   is_active, created_at, updated_at)
                                VALUES
                                  (%s, %s,
                                   'sap.metadata_patched', 'sap_metadata', %s::uuid,
                                   %s::jsonb,
                                   %s, %s,
                                   TRUE, NOW(), NOW())
                            """, [
                                str(uuid.uuid4()),
                                str(uuid.uuid4()),
                                str(ai_id),
                                json.dumps({
                                    "expediente_id": str(exp.id),
                                    "sap_id": sap_id,
                                    "before": {
                                        "operating_company_id": str(cur_op) if cur_op else None,
                                        "forma_pago": cur_fp,
                                        "payment_days": cur_pd,
                                    },
                                    "after": {
                                        "operating_company_id": str(new_op) if new_op else (str(cur_op) if cur_op else None),
                                        "forma_pago": new_fp or cur_fp,
                                        "payment_days": new_pd_val if new_pd_val is not None else cur_pd,
                                    },
                                }),
                                str(emitter_id) if emitter_id else None,
                                emitter_role,
                            ])
                        except Exception as ev_err:
                            log.warning("[patch_sap] event_log metadata insert failed: %s", ev_err)

                    if has_line_ops:
                        try:
                            c.execute("""
                                INSERT INTO pipeline.event_log
                                  (id, correlation_id,
                                   event_type, aggregate_type, aggregate_id,
                                   payload,
                                   emitted_by_id, emitted_by_role,
                                   is_active, created_at, updated_at)
                                VALUES
                                  (%s, %s,
                                   'sap.lines_modified', 'sap_metadata', %s::uuid,
                                   %s::jsonb,
                                   %s, %s,
                                   TRUE, NOW(), NOW())
                            """, [
                                str(uuid.uuid4()),
                                str(uuid.uuid4()),
                                str(ai_id),
                                json.dumps({
                                    "expediente_id": str(exp.id),
                                    "sap_id": sap_id,
                                    "added":   added_ids,
                                    "removed": removed_ids,
                                    "updated": updated_ids,
                                }),
                                str(emitter_id) if emitter_id else None,
                                emitter_role,
                            ])
                        except Exception as ev_err:
                            log.warning("[patch_sap] event_log lines insert failed: %s", ev_err)
        except Exception as e:
            log.exception("[patch_sap] update failed: %s", e)
            return Response({"detail": "update_failed", "error": str(e)[:300]}, status=500)

        resp_body = {
            "ok": True,
            "expediente_id": eff_exp_id,
            "sap_id": sap_id,
            "artifact_id": str(ai_id),
            "operating_company_id": str(new_op) if new_op else (str(cur_op) if cur_op else None),
            "forma_pago": new_fp or cur_fp,
            "payment_days": new_pd_val if new_pd_val is not None else cur_pd,
            "lines_added":   added_ids,
            "lines_removed": removed_ids,
            "lines_updated": updated_ids,
        }
        if split_done:
            resp_body.update({
                "split":                 True,
                "old_expediente_id":     str(exp.id),
                "new_expediente_id":     new_exp_id,
                "new_expediente_codigo": new_exp_codigo,
                "lines_moved_count":     lines_moved_count,
                # Sprint 2026-05-08 · cleanup: True si el original quedó
                # vacío y fue soft-deleted junto con sus documentos.
                "old_expediente_emptied": bool(locals().get("old_exp_emptied", False)),
            })
        return Response(resp_body, status=200)

    # ══════════════════════════════════════════════════════════
    # GET helper · /api/expedientes/{exp_id}/sap/{sap_id}/
    # Sprint 2026-05-07 · Fase 2.D — precarga del wizard editor.
    # ══════════════════════════════════════════════════════════
    def _get_sap(self, request, pk=None, sap_id=None):
        if not sap_id:
            return Response({"detail": "sap_id requerido"}, status=400)

        # Lookup tolerante: pk puede ser UUID o codigo (mismo patrón
        # que retrieve()).
        exp = None
        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            exp = None
        except (ValueError, TypeError):
            exp = None
        if exp is None:
            try:
                exp = Expediente.objects.get(codigo=pk, is_active=True)
            except Expediente.DoesNotExist:
                return Response({"detail": "Expediente no existe"}, status=404)

        is_client = _is_client_viewer(request)

        # Visibilidad CLIENT_*: el expediente debe pertenecer a su pool
        # (consistente con list()). Rev 2026-05-21b: scope dual —
        # client_id ∪ operating_company_id (ver comentario largo en list()).
        if is_client:
            user_companies = list(getattr(request.user, "legal_entity_ids", None) or [])
            if not user_companies:
                return Response({"detail": "forbidden"}, status=403)
            pool = {str(c) for c in user_companies}
            client_ok = str(getattr(exp, "client_id", "") or "") in pool
            oc_ok     = str(getattr(exp, "operating_company_id", "") or "") in pool
            if not (client_ok or oc_ok):
                return Response({"detail": "forbidden"}, status=403)

        # 1) Lookup ART-04 metadata (puede no existir si el SAP fue
        #    creado vía OCR sin artifact_instance — degradamos a NULLs).
        ai_op = None
        ai_fp = None
        ai_pd = None
        try:
            with connection.cursor() as c:
                c.execute("""
                    SELECT operating_company_id, forma_pago, payment_days
                      FROM expedientes.artifact_instances
                     WHERE expediente_id = %s::uuid
                       AND artifact_code = 'ART-04'
                       AND codigo = %s
                       AND is_active = TRUE
                     LIMIT 1
                """, [str(exp.id), sap_id])
                row = c.fetchone()
                if row:
                    ai_op, ai_fp, ai_pd = row
        except Exception as e:
            log.warning("[get_sap] ART-04 lookup failed exp=%s sap=%s: %s",
                        exp.id, sap_id, e)

        # 2) Líneas activas con ese SAP en el expediente.
        lines_out: list = []
        sap_value_mwt    = Decimal("0")
        sap_value_client = Decimal("0")
        try:
            with connection.cursor() as c:
                c.execute("""
                    SELECT l.id::text,
                           l.producto_id::text,
                           l.sku,
                           l.size,
                           l.qty,
                           l.unit_price,
                           l.unit_price_mwt,
                           l.unit_price_client
                      FROM expedientes.linea l
                     WHERE l.expediente_id = %s::uuid
                       AND l.sap = %s
                       AND l.is_active = TRUE
                     ORDER BY l.created_at ASC, l.id ASC
                """, [str(exp.id), sap_id])
                rows = c.fetchall()
        except Exception as e:
            log.exception("[get_sap] lineas lookup failed: %s", e)
            return Response({"detail": "lookup_failed", "error": str(e)[:200]}, status=500)

        if not rows:
            return Response(
                {"detail": f"No existen líneas activas para sap={sap_id}"},
                status=404,
            )

        # 3) Resolver labels de productos (best-effort).
        product_labels: dict = {}
        try:
            pids = [r[1] for r in rows if r[1]]
            unique_pids = list({p for p in pids if p})
            if unique_pids:
                with connection.cursor() as c:
                    placeholders = ",".join(["%s::uuid"] * len(unique_pids))
                    c.execute(
                        f"""
                        SELECT id::text, nombre
                          FROM productos.producto
                         WHERE id IN ({placeholders})
                        """,
                        unique_pids,
                    )
                    for pid, nombre in c.fetchall():
                        product_labels[pid] = nombre
        except Exception as e:
            log.warning("[get_sap] product label lookup failed: %s", e)

        # 4) Resolver client_label (best-effort).
        client_label = None
        client_id_val = getattr(exp, "client_id", None)
        if client_id_val:
            try:
                with connection.cursor() as c:
                    c.execute(
                        """
                        SELECT COALESCE(razon_social, nombre)
                          FROM clientes.cliente
                         WHERE id = %s::uuid
                         LIMIT 1
                        """,
                        [str(client_id_val)],
                    )
                    cr = c.fetchone()
                    if cr:
                        client_label = cr[0]
            except Exception as e:
                log.warning("[get_sap] client label lookup failed: %s", e)

        # 5) Construir respuesta + sumas.
        for r in rows:
            (lid, pid, sku, size, qty, up_legacy, up_mwt, up_cli) = r
            try:
                qty_d  = Decimal(str(qty or 0))
                upm_d  = Decimal(str(up_mwt or 0))
                upc_d  = Decimal(str(up_cli or 0))
            except (TypeError, ValueError, ArithmeticError):
                qty_d, upm_d, upc_d = Decimal("0"), Decimal("0"), Decimal("0")
            sap_value_mwt    += (qty_d * upm_d)
            sap_value_client += (qty_d * upc_d)

            line_obj = {
                "id":                str(lid),
                "producto_id":       str(pid) if pid else None,
                "sku":               sku,
                "talla":             size,
                "qty":               int(qty_d) if qty_d == qty_d.to_integral_value() else float(qty_d),
                "unit_price_mwt":    None if is_client else float(upm_d),
                "unit_price_client": float(upc_d),
                "product_label":     product_labels.get(str(pid)) if pid else None,
            }
            lines_out.append(line_obj)

        # Fallback de metadata: si el ART-04 NO trae operator/forma/days,
        # usar los del expediente padre.
        eff_op = ai_op if ai_op else getattr(exp, "operating_company_id", None)
        eff_fp = ai_fp if ai_fp else getattr(exp, "forma_pago", None)
        eff_pd = ai_pd if ai_pd is not None else getattr(exp, "credit_days", None)

        return Response({
            "expediente_id":        str(exp.id),
            "expediente_codigo":    getattr(exp, "codigo", None),
            "sap_id":               sap_id,
            "client_id":            str(client_id_val) if client_id_val else None,
            "client_label":         client_label,
            "operating_company_id": str(eff_op) if eff_op else None,
            "forma_pago":           eff_fp,
            "payment_days":         eff_pd,
            "sap_value_mwt":        None if is_client else float(sap_value_mwt.quantize(Decimal("0.01"))),
            "sap_value_client":     float(sap_value_client.quantize(Decimal("0.01"))),
            "lines":                lines_out,
        }, status=200)

    # ══════════════════════════════════════════════════════════
    # Helper · aplicar operaciones de líneas dentro de un SAP.
    # Devuelve (added_ids, removed_ids, updated_ids).
    # ══════════════════════════════════════════════════════════
    def _apply_sap_line_ops(
        self, *, cursor, exp, sap_id, operating_company_id,
        lines_added, lines_removed, lines_updated,
        target_exp_id=None, target_client_id=None,
    ):
        # `target_exp_id` permite redirigir las operaciones a un expediente
        # distinto del original (caso split en F2.F). Si no viene,
        # operamos sobre exp.id como antes (compat hacia atrás).
        eff_exp_id = str(target_exp_id) if target_exp_id else str(exp.id)
        eff_client_id = (
            target_client_id if target_client_id is not None
            else getattr(exp, "client_id", None)
        )
        added_ids:   list = []
        removed_ids: list = []
        updated_ids: list = []

        # ── lines_removed (soft-delete) ─────────────────────────
        for raw_id in lines_removed:
            try:
                lid = str(raw_id).strip()
            except (TypeError, ValueError):
                continue
            if not lid:
                continue
            try:
                cursor.execute(
                    """
                    UPDATE expedientes.linea
                       SET is_active = FALSE,
                           updated_at = NOW()
                     WHERE id = %s::uuid
                       AND expediente_id = %s::uuid
                       AND sap = %s
                       AND is_active = TRUE
                    """,
                    [lid, eff_exp_id, sap_id],
                )
                if cursor.rowcount and cursor.rowcount > 0:
                    removed_ids.append(lid)
            except Exception as e:
                log.warning("[patch_sap] remove linea %s falló: %s", lid, e)

        # ── lines_updated (qty + recalc total_price) ────────────
        for ln in lines_updated:
            if not isinstance(ln, dict):
                continue
            lid = (ln.get("id") or "").strip() if isinstance(ln.get("id"), str) else str(ln.get("id") or "")
            if not lid:
                continue
            qraw = ln.get("qty")
            try:
                new_qty = int(qraw)
            except (TypeError, ValueError):
                log.warning("[patch_sap] qty inválido en lines_updated id=%s val=%r", lid, qraw)
                continue
            if new_qty <= 0:
                log.warning("[patch_sap] qty <=0 en lines_updated id=%s; ignorado", lid)
                continue
            try:
                cursor.execute(
                    """
                    UPDATE expedientes.linea
                       SET qty = %s,
                           total_price = ROUND(%s::numeric * unit_price, 2),
                           updated_at = NOW()
                     WHERE id = %s::uuid
                       AND expediente_id = %s::uuid
                       AND sap = %s
                       AND is_active = TRUE
                    """,
                    [new_qty, new_qty, lid, eff_exp_id, sap_id],
                )
                if cursor.rowcount and cursor.rowcount > 0:
                    updated_ids.append({"id": lid, "qty": new_qty})
            except Exception as e:
                log.warning("[patch_sap] update linea %s falló: %s", lid, e)

        # ── lines_added (insert con snapshot dual de precios) ────
        if lines_added:
            from apps.commercial.views import compute_client_price  # noqa: PLC0415

            client_id_val = eff_client_id
            oc_id_val     = getattr(exp, "oc_id", None)

            unique_pids = []
            for ln in lines_added:
                if not isinstance(ln, dict):
                    continue
                pid = ln.get("producto_id")
                if isinstance(pid, str) and len(pid) == 36:
                    unique_pids.append(pid)
            unique_pids = list(set(unique_pids))

            price_map_mwt:    dict = {}
            price_map_client: dict = {}
            if unique_pids:
                try:
                    placeholders = ",".join(["%s::uuid"] * len(unique_pids))
                    cursor.execute(
                        f"""
                        SELECT id::text,
                               sku,
                               marca_id::text,
                               precio_lista,
                               precio_mwt,
                               COALESCE(especificaciones->'client_prices', '{{}}'::jsonb) AS client_prices
                          FROM productos.producto
                         WHERE id IN ({placeholders})
                        """,
                        unique_pids,
                    )

                    def _to_decimal(v):
                        try:
                            d = Decimal(str(v))
                            return d if d > 0 else None
                        except (TypeError, ValueError, ArithmeticError):
                            return None

                    for pid, sku_db, brand_id, pl, p_mwt_override, cp_json in cursor.fetchall():
                        cp_map = cp_json or {}
                        if isinstance(cp_map, str):
                            try:
                                cp_map = json.loads(cp_map)
                            except (TypeError, ValueError):
                                cp_map = {}

                        # Precio MWT (operador interno)
                        p_mwt = _to_decimal(
                            cp_map.get(MWT_OPERATING_CLIENT_ID)
                            or cp_map.get(str(MWT_OPERATING_CLIENT_ID))
                        )
                        if p_mwt is None:
                            p_mwt = _to_decimal(p_mwt_override)
                        if p_mwt is None and brand_id and sku_db:
                            try:
                                p_mwt = compute_client_price(
                                    client_id=MWT_OPERATING_CLIENT_ID,
                                    brand_id=brand_id,
                                    product_sku=sku_db,
                                    days_req=0,
                                )
                            except (TypeError, ValueError, ArithmeticError) as e:
                                log.warning("[patch_sap] waterfall MWT pid=%s: %s", pid, e)
                                p_mwt = None
                        if p_mwt is not None and p_mwt > 0:
                            price_map_mwt[pid] = p_mwt
                        else:
                            try:
                                price_map_mwt[pid] = Decimal(str(pl or 0))
                            except (TypeError, ValueError, ArithmeticError):
                                price_map_mwt[pid] = Decimal("0")

                        # Precio cliente final
                        p_cli = None
                        if client_id_val:
                            p_cli = _to_decimal(
                                cp_map.get(str(client_id_val))
                                or cp_map.get(client_id_val)
                            )
                        if p_cli is None and client_id_val and brand_id and sku_db:
                            try:
                                p_cli = compute_client_price(
                                    client_id=client_id_val,
                                    brand_id=brand_id,
                                    product_sku=sku_db,
                                    days_req=0,
                                )
                            except (TypeError, ValueError, ArithmeticError) as e:
                                log.warning("[patch_sap] waterfall CLIENT pid=%s: %s", pid, e)
                                p_cli = None
                        if p_cli is not None and p_cli > 0:
                            price_map_client[pid] = p_cli
                        else:
                            price_map_client[pid] = price_map_mwt[pid]
                except Exception as e:
                    log.exception("[patch_sap] price_map fetch failed: %s", e)
                    price_map_mwt    = {}
                    price_map_client = {}

            # Insertar líneas nuevas
            for ln in lines_added:
                if not isinstance(ln, dict):
                    continue
                sku = (ln.get("sku") or "").strip().upper()[:64]
                if not sku:
                    continue
                talla = (ln.get("talla") or ln.get("size") or "")
                talla = (str(talla).strip().upper()[:16] or None) if talla else None
                cantidad = ln.get("cantidad") or ln.get("qty") or 0
                try:
                    cantidad = int(cantidad)
                except (TypeError, ValueError):
                    cantidad = 0
                if cantidad <= 0:
                    continue
                pid = ln.get("producto_id")
                pid = str(pid) if pid else None
                unit_price_mwt    = (price_map_mwt.get(pid, Decimal("0"))
                                     if pid else Decimal("0"))
                unit_price_client = (price_map_client.get(pid, Decimal("0"))
                                     if pid else Decimal("0"))
                # unit_price = el precio del operador (legacy).
                unit_price = (unit_price_mwt
                              if str(operating_company_id) == MWT_OPERATING_CLIENT_ID
                              else unit_price_client)
                total_price = (unit_price * Decimal(cantidad)).quantize(Decimal("0.01"))

                new_line_id = uuid.uuid4()
                try:
                    cursor.execute(
                        """
                        INSERT INTO expedientes.linea (
                            id, oc_id, expediente_id, producto_id,
                            sku, size, qty,
                            unit_price, unit_price_mwt, unit_price_client,
                            total_price,
                            sap,
                            estado, is_active, created_at, updated_at
                        ) VALUES (
                            %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s,
                            %s,
                            'PENDIENTE_SAP', TRUE, NOW(), NOW()
                        )
                        """,
                        [
                            str(new_line_id),
                            str(oc_id_val) if oc_id_val else None,
                            eff_exp_id,
                            pid,
                            sku, talla, cantidad,
                            unit_price, unit_price_mwt, unit_price_client,
                            total_price,
                            sap_id,
                        ],
                    )
                    added_ids.append(str(new_line_id))
                except Exception as e:
                    log.warning("[patch_sap] insert linea sku=%s falló: %s", sku, e)

        return added_ids, removed_ids, updated_ids


    # ══════════════════════════════════════════════════════════
    # Sprint 2026-05-31 · EDICIÓN GENERAL del expediente completo.
    # Paralelo a patch_sap pero SIN filtro por SAP: opera sobre TODAS
    # las líneas activas del expediente y cascada los metadatos
    # (operating_company_id, forma_pago, payment_days) al registro del
    # expediente + todos sus ART-04 activos. NO hace split (eso es un
    # concepto por-SAP). Reusa el mismo contrato JSON que /sap/{id}/
    # para que el wizard (?editExpFull=) hidrate y guarde con la misma
    # lógica de diffs (lines_added / lines_removed / lines_updated).
    # ══════════════════════════════════════════════════════════
    @action(
        detail=True,
        methods=["get", "patch"],
        url_path="edit-full",
    )
    def edit_full(self, request, pk=None):
        # GET es read-only (Admin + CLIENT_* con scope). PATCH es CEO-ONLY.
        if request.method.upper() == "GET":
            return self._get_full(request, pk=pk)

        denied = _deny_client_mutation(request, action_label="expediente.edit_full")
        if denied is not None:
            return denied

        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)

        try:
            payload = {k: request.data.get(k) for k in request.data.keys()}
        except Exception:
            payload = dict(request.data) if hasattr(request.data, "items") else {}

        # Normalizar inputs (todos opcionales).
        new_op = payload.get("operating_company_id")
        if new_op == "":
            new_op = None
        new_fp = (payload.get("forma_pago") or "").strip().upper() or None
        if new_fp and new_fp not in ("CREDITO", "CONTADO"):
            return Response({"detail": "forma_pago inválida"}, status=400)
        new_pd = payload.get("payment_days")
        if new_pd in ("", None):
            new_pd_val = None
        else:
            try:
                new_pd_val = int(new_pd)
            except (TypeError, ValueError):
                return Response({"detail": "payment_days inválido"}, status=400)
            if new_pd_val < 0:
                return Response({"detail": "payment_days no puede ser negativo"}, status=400)

        new_client_id = payload.get("client_id") or None

        lines_added   = payload.get("lines_added")
        lines_removed = payload.get("lines_removed")
        lines_updated = payload.get("lines_updated")
        for _name in ("lines_added", "lines_removed", "lines_updated"):
            _val = locals()[_name]
            if isinstance(_val, str):
                try:
                    parsed = json.loads(_val) if _val.strip() else None
                except json.JSONDecodeError:
                    return Response({"detail": f"{_name} no es JSON válido"}, status=400)
                if _name == "lines_added":
                    lines_added = parsed
                elif _name == "lines_removed":
                    lines_removed = parsed
                else:
                    lines_updated = parsed
        for _nm, _v in (
            ("lines_added", lines_added),
            ("lines_removed", lines_removed),
            ("lines_updated", lines_updated),
        ):
            if _v is not None and not isinstance(_v, list):
                return Response({"detail": f"{_nm} debe ser array"}, status=400)

        lines_added   = lines_added or []
        lines_removed = lines_removed or []
        lines_updated = lines_updated or []

        # operating_company efectivo (para resolver unit_price legacy de adds).
        eff_op = (
            str(new_op) if new_op is not None
            else (str(getattr(exp, "operating_company_id", "") or "") or None)
        )

        added_ids = removed_ids = updated_ids = None
        try:
            with transaction.atomic():
                with connection.cursor() as c:
                    # 1) Metadatos a nivel expediente.
                    sets, args = [], []
                    if new_op is not None:
                        sets.append("operating_company_id = %s")
                        args.append(str(new_op))
                    if new_fp is not None:
                        sets.append("forma_pago = %s")
                        args.append(new_fp)
                    if new_pd_val is not None:
                        sets.append("credit_days = %s")
                        sets.append("credit_days_cliente = %s")
                        args.append(new_pd_val)
                        args.append(new_pd_val)
                    if new_client_id and str(new_client_id) != str(getattr(exp, "client_id", "") or ""):
                        sets.append("client_id = %s::uuid")
                        args.append(str(new_client_id))
                    if sets:
                        sets.append("updated_at = NOW()")
                        c.execute(
                            f"UPDATE expedientes.expediente SET {', '.join(sets)} "
                            f"WHERE id = %s::uuid",
                            args + [str(exp.id)],
                        )

                    # 2) Cascada de metadatos a TODOS los ART-04 activos del
                    #    expediente (mantiene consistencia con la vista por-SAP).
                    art_sets, art_args = [], []
                    if new_op is not None:
                        art_sets.append("operating_company_id = %s")
                        art_args.append(str(new_op))
                    if new_fp is not None:
                        art_sets.append("forma_pago = %s")
                        art_args.append(new_fp)
                    if new_pd_val is not None:
                        art_sets.append("payment_days = %s")
                        art_args.append(new_pd_val)
                    if art_sets:
                        art_sets.append("updated_at = NOW()")
                        try:
                            c.execute(
                                f"""
                                UPDATE expedientes.artifact_instances
                                   SET {', '.join(art_sets)}
                                 WHERE expediente_id = %s::uuid
                                   AND artifact_code = 'ART-04'
                                   AND is_active = TRUE
                                """,
                                art_args + [str(exp.id)],
                            )
                        except Exception as e:
                            log.warning("[edit_full] cascade ART-04 falló: %s", e)

                    # 3) Operaciones de líneas sobre TODO el expediente.
                    added_ids, removed_ids, updated_ids = self._apply_full_line_ops(
                        cursor=c,
                        exp=exp,
                        operating_company_id=eff_op,
                        target_client_id=(str(new_client_id) if new_client_id else None),
                        lines_added=lines_added,
                        lines_removed=lines_removed,
                        lines_updated=lines_updated,
                    )

                    # 4) Recalcular total_cost del expediente.
                    c.execute(
                        """
                        UPDATE expedientes.expediente e
                           SET total_cost = COALESCE((
                                 SELECT SUM(l.total_price)
                                   FROM expedientes.linea l
                                  WHERE l.expediente_id = e.id
                                    AND l.is_active = TRUE
                               ), 0),
                               updated_at = NOW()
                         WHERE e.id = %s::uuid
                        """,
                        [str(exp.id)],
                    )

                    # 5) Auditoría (schema real de pipeline.event_log).
                    try:
                        emitter_id = getattr(request.user, "id", None)
                        emitter_role = (
                            getattr(request.user, "role_default", None)
                            or getattr(request.user, "role", None)
                            or "unknown"
                        )
                        c.execute(
                            """
                            INSERT INTO pipeline.event_log
                              (id, correlation_id,
                               event_type, aggregate_type, aggregate_id,
                               payload,
                               emitted_by_id, emitted_by_role,
                               is_active, created_at, updated_at)
                            VALUES
                              (%s, %s,
                               'expediente.edit_full', 'expediente', %s::uuid,
                               %s::jsonb,
                               %s, %s,
                               TRUE, NOW(), NOW())
                            """,
                            [
                                str(uuid.uuid4()),
                                str(uuid.uuid4()),
                                str(exp.id),
                                json.dumps({
                                    "expediente_id": str(exp.id),
                                    "operating_company_id": eff_op,
                                    "forma_pago": new_fp,
                                    "payment_days": new_pd_val,
                                    "lines_added": added_ids,
                                    "lines_removed": removed_ids,
                                    "lines_updated": updated_ids,
                                }),
                                str(emitter_id) if emitter_id else None,
                                emitter_role,
                            ],
                        )
                    except Exception as e:
                        log.warning("[edit_full] event_log falló (no-fatal): %s", e)
        except Exception as e:
            log.exception("[edit_full] patch failed: %s", e)
            return Response({"detail": "patch_failed", "error": str(e)[:200]}, status=500)

        return Response({
            "ok": True,
            "expediente_id": str(exp.id),
            "operating_company_id": eff_op,
            "forma_pago": new_fp or getattr(exp, "forma_pago", None),
            "payment_days": new_pd_val if new_pd_val is not None else getattr(exp, "credit_days", None),
            "lines_added": added_ids or [],
            "lines_removed": removed_ids or [],
            "lines_updated": updated_ids or [],
            "full": True,
        }, status=200)

    def _get_full(self, request, pk=None):
        # Lookup tolerante: pk puede ser UUID o codigo.
        exp = None
        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            exp = None
        except (ValueError, TypeError):
            exp = None
        if exp is None:
            try:
                exp = Expediente.objects.get(codigo=pk, is_active=True)
            except Expediente.DoesNotExist:
                return Response({"detail": "Expediente no existe"}, status=404)

        is_client = _is_client_viewer(request)
        if is_client:
            user_companies = list(getattr(request.user, "legal_entity_ids", None) or [])
            if not user_companies:
                return Response({"detail": "forbidden"}, status=403)
            pool = {str(c) for c in user_companies}
            client_ok = str(getattr(exp, "client_id", "") or "") in pool
            oc_ok     = str(getattr(exp, "operating_company_id", "") or "") in pool
            if not (client_ok or oc_ok):
                return Response({"detail": "forbidden"}, status=403)

        # Líneas activas del expediente (SIN filtro de SAP).
        lines_out = []
        sap_value_mwt    = Decimal("0")
        sap_value_client = Decimal("0")
        try:
            with connection.cursor() as c:
                c.execute("""
                    SELECT l.id::text,
                           l.producto_id::text,
                           l.sku,
                           l.size,
                           l.qty,
                           l.unit_price,
                           l.unit_price_mwt,
                           l.unit_price_client,
                           l.sap
                      FROM expedientes.linea l
                     WHERE l.expediente_id = %s::uuid
                       AND l.is_active = TRUE
                     ORDER BY l.created_at ASC, l.id ASC
                """, [str(exp.id)])
                rows = c.fetchall()
        except Exception as e:
            log.exception("[get_full] lineas lookup failed: %s", e)
            return Response({"detail": "lookup_failed", "error": str(e)[:200]}, status=500)

        # Labels de productos (best-effort).
        product_labels = {}
        try:
            pids = [r[1] for r in rows if r[1]]
            unique_pids = list({p for p in pids if p})
            if unique_pids:
                with connection.cursor() as c:
                    placeholders = ",".join(["%s::uuid"] * len(unique_pids))
                    c.execute(
                        f"SELECT id::text, nombre FROM productos.producto "
                        f"WHERE id IN ({placeholders})",
                        unique_pids,
                    )
                    for pid, nombre in c.fetchall():
                        product_labels[pid] = nombre
        except Exception as e:
            log.warning("[get_full] product label lookup failed: %s", e)

        # Label de cliente (best-effort).
        client_label = None
        client_id_val = getattr(exp, "client_id", None)
        if client_id_val:
            try:
                with connection.cursor() as c:
                    c.execute(
                        "SELECT COALESCE(razon_social, nombre) FROM clientes.cliente "
                        "WHERE id = %s::uuid LIMIT 1",
                        [str(client_id_val)],
                    )
                    cr = c.fetchone()
                    if cr:
                        client_label = cr[0]
            except Exception as e:
                log.warning("[get_full] client label lookup failed: %s", e)

        for r in rows:
            (lid, pid, sku, size, qty, up_legacy, up_mwt, up_cli, sapv) = r
            try:
                qty_d = Decimal(str(qty or 0))
                upm_d = Decimal(str(up_mwt or 0))
                upc_d = Decimal(str(up_cli or 0))
            except (TypeError, ValueError, ArithmeticError):
                qty_d, upm_d, upc_d = Decimal("0"), Decimal("0"), Decimal("0")
            sap_value_mwt    += (qty_d * upm_d)
            sap_value_client += (qty_d * upc_d)
            lines_out.append({
                "id":                str(lid),
                "producto_id":       str(pid) if pid else None,
                "sku":               sku,
                "talla":             size,
                "qty":               int(qty_d) if qty_d == qty_d.to_integral_value() else float(qty_d),
                "unit_price_mwt":    None if is_client else float(upm_d),
                "unit_price_client": float(upc_d),
                "product_label":     product_labels.get(str(pid)) if pid else None,
                "sap":               sapv,
            })

        return Response({
            "expediente_id":        str(exp.id),
            "expediente_codigo":    getattr(exp, "codigo", None),
            "sap_id":               None,
            "full":                 True,
            "client_id":            str(client_id_val) if client_id_val else None,
            "client_label":         client_label,
            "operating_company_id": str(getattr(exp, "operating_company_id", "") or "") or None,
            "forma_pago":           getattr(exp, "forma_pago", None),
            "payment_days":         getattr(exp, "credit_days", None),
            "sap_value_mwt":        None if is_client else float(sap_value_mwt.quantize(Decimal("0.01"))),
            "sap_value_client":     float(sap_value_client.quantize(Decimal("0.01"))),
            "lines":                lines_out,
        }, status=200)

    # ══════════════════════════════════════════════════════════
    # Helper · operaciones de líneas sobre TODO el expediente.
    # Idéntico a _apply_sap_line_ops pero SIN filtro por SAP; las
    # líneas nuevas nacen con sap = NULL (PENDIENTE_SAP).
    # Devuelve (added_ids, removed_ids, updated_ids).
    # ══════════════════════════════════════════════════════════
    def _apply_full_line_ops(
        self, *, cursor, exp, operating_company_id,
        lines_added, lines_removed, lines_updated,
        target_client_id=None,
    ):
        eff_exp_id = str(exp.id)
        eff_client_id = (
            target_client_id if target_client_id is not None
            else getattr(exp, "client_id", None)
        )
        added_ids, removed_ids, updated_ids = [], [], []

        # ── lines_removed (soft-delete, sin filtro SAP) ─────────
        for raw_id in lines_removed:
            try:
                lid = str(raw_id).strip()
            except (TypeError, ValueError):
                continue
            if not lid:
                continue
            try:
                cursor.execute(
                    """
                    UPDATE expedientes.linea
                       SET is_active = FALSE,
                           updated_at = NOW()
                     WHERE id = %s::uuid
                       AND expediente_id = %s::uuid
                       AND is_active = TRUE
                    """,
                    [lid, eff_exp_id],
                )
                if cursor.rowcount and cursor.rowcount > 0:
                    removed_ids.append(lid)
            except Exception as e:
                log.warning("[edit_full] remove linea %s falló: %s", lid, e)

        # ── lines_updated (qty + recalc total_price) ────────────
        for ln in lines_updated:
            if not isinstance(ln, dict):
                continue
            lid = (ln.get("id") or "").strip() if isinstance(ln.get("id"), str) else str(ln.get("id") or "")
            if not lid:
                continue
            try:
                new_qty = int(ln.get("qty"))
            except (TypeError, ValueError):
                continue
            if new_qty <= 0:
                continue
            try:
                cursor.execute(
                    """
                    UPDATE expedientes.linea
                       SET qty = %s,
                           total_price = ROUND(%s::numeric * unit_price, 2),
                           updated_at = NOW()
                     WHERE id = %s::uuid
                       AND expediente_id = %s::uuid
                       AND is_active = TRUE
                    """,
                    [new_qty, new_qty, lid, eff_exp_id],
                )
                if cursor.rowcount and cursor.rowcount > 0:
                    updated_ids.append({"id": lid, "qty": new_qty})
            except Exception as e:
                log.warning("[edit_full] update linea %s falló: %s", lid, e)

        # ── lines_added (insert con snapshot dual de precios, sap NULL) ──
        if lines_added:
            from apps.commercial.views import compute_client_price  # noqa: PLC0415

            client_id_val = eff_client_id
            oc_id_val     = getattr(exp, "oc_id", None)

            unique_pids = []
            for ln in lines_added:
                if not isinstance(ln, dict):
                    continue
                pid = ln.get("producto_id")
                if isinstance(pid, str) and len(pid) == 36:
                    unique_pids.append(pid)
            unique_pids = list(set(unique_pids))

            price_map_mwt, price_map_client = {}, {}
            if unique_pids:
                try:
                    placeholders = ",".join(["%s::uuid"] * len(unique_pids))
                    cursor.execute(
                        f"""
                        SELECT id::text,
                               sku,
                               marca_id::text,
                               precio_lista,
                               precio_mwt,
                               COALESCE(especificaciones->'client_prices', '{{}}'::jsonb) AS client_prices
                          FROM productos.producto
                         WHERE id IN ({placeholders})
                        """,
                        unique_pids,
                    )

                    def _to_decimal(v):
                        try:
                            d = Decimal(str(v))
                            return d if d > 0 else None
                        except (TypeError, ValueError, ArithmeticError):
                            return None

                    for pid, sku_db, brand_id, pl, p_mwt_override, cp_json in cursor.fetchall():
                        cp_map = cp_json or {}
                        if isinstance(cp_map, str):
                            try:
                                cp_map = json.loads(cp_map)
                            except (TypeError, ValueError):
                                cp_map = {}

                        p_mwt = _to_decimal(
                            cp_map.get(MWT_OPERATING_CLIENT_ID)
                            or cp_map.get(str(MWT_OPERATING_CLIENT_ID))
                        )
                        if p_mwt is None:
                            p_mwt = _to_decimal(p_mwt_override)
                        if p_mwt is None and brand_id and sku_db:
                            try:
                                p_mwt = compute_client_price(
                                    client_id=MWT_OPERATING_CLIENT_ID,
                                    brand_id=brand_id,
                                    product_sku=sku_db,
                                    days_req=0,
                                )
                            except (TypeError, ValueError, ArithmeticError) as e:
                                log.warning("[edit_full] waterfall MWT pid=%s: %s", pid, e)
                                p_mwt = None
                        if p_mwt is not None and p_mwt > 0:
                            price_map_mwt[pid] = p_mwt
                        else:
                            try:
                                price_map_mwt[pid] = Decimal(str(pl or 0))
                            except (TypeError, ValueError, ArithmeticError):
                                price_map_mwt[pid] = Decimal("0")

                        p_cli = None
                        if client_id_val:
                            p_cli = _to_decimal(
                                cp_map.get(str(client_id_val))
                                or cp_map.get(client_id_val)
                            )
                        if p_cli is None and client_id_val and brand_id and sku_db:
                            try:
                                p_cli = compute_client_price(
                                    client_id=client_id_val,
                                    brand_id=brand_id,
                                    product_sku=sku_db,
                                    days_req=0,
                                )
                            except (TypeError, ValueError, ArithmeticError) as e:
                                log.warning("[edit_full] waterfall CLIENT pid=%s: %s", pid, e)
                                p_cli = None
                        if p_cli is not None and p_cli > 0:
                            price_map_client[pid] = p_cli
                        else:
                            price_map_client[pid] = price_map_mwt[pid]
                except Exception as e:
                    log.exception("[edit_full] price_map fetch failed: %s", e)
                    price_map_mwt, price_map_client = {}, {}

            for ln in lines_added:
                if not isinstance(ln, dict):
                    continue
                sku = (ln.get("sku") or "").strip().upper()[:64]
                if not sku:
                    continue
                talla = (ln.get("talla") or ln.get("size") or "")
                talla = (str(talla).strip().upper()[:16] or None) if talla else None
                cantidad = ln.get("cantidad") or ln.get("qty") or 0
                try:
                    cantidad = int(cantidad)
                except (TypeError, ValueError):
                    cantidad = 0
                if cantidad <= 0:
                    continue
                pid = ln.get("producto_id")
                pid = str(pid) if pid else None
                unit_price_mwt    = (price_map_mwt.get(pid, Decimal("0"))
                                     if pid else Decimal("0"))
                unit_price_client = (price_map_client.get(pid, Decimal("0"))
                                     if pid else Decimal("0"))
                unit_price = (unit_price_mwt
                              if str(operating_company_id) == MWT_OPERATING_CLIENT_ID
                              else unit_price_client)
                total_price = (unit_price * Decimal(cantidad)).quantize(Decimal("0.01"))

                new_line_id = uuid.uuid4()
                try:
                    cursor.execute(
                        """
                        INSERT INTO expedientes.linea (
                            id, oc_id, expediente_id, producto_id,
                            sku, size, qty,
                            unit_price, unit_price_mwt, unit_price_client,
                            total_price,
                            sap,
                            estado, is_active, created_at, updated_at
                        ) VALUES (
                            %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s,
                            NULL,
                            'PENDIENTE_SAP', TRUE, NOW(), NOW()
                        )
                        """,
                        [
                            str(new_line_id),
                            str(oc_id_val) if oc_id_val else None,
                            eff_exp_id,
                            pid,
                            sku, talla, cantidad,
                            unit_price, unit_price_mwt, unit_price_client,
                            total_price,
                        ],
                    )
                    added_ids.append(str(new_line_id))
                except Exception as e:
                    log.warning("[edit_full] insert linea sku=%s falló: %s", sku, e)

        return added_ids, removed_ids, updated_ids

    @action(
        detail=True,
        methods=["post"],
        url_path="upsert-sap",
        parser_classes=[MultiPartParser, FormParser, JSONParser],
    )
    def upsert_sap(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="expediente.upsert_sap")
        if denied is not None:
            return denied

        sap_id             = (request.data.get("sap_id") or "").strip()
        fecha_fabricacion  = (request.data.get("fecha_fabricacion") or "").strip()
        lineas_confirmadas = request.data.get("lineas_confirmadas") or "[]"
        documento_file     = request.FILES.get("documento_sap")
        remove_documento   = (str(request.data.get("remove_documento") or "")
                              .lower() in ("true", "1", "yes"))

        if isinstance(lineas_confirmadas, str):
            try:
                lineas_confirmadas = json.loads(lineas_confirmadas)
            except json.JSONDecodeError:
                return Response({"detail": "lineas_confirmadas no es JSON valido"}, status=400)
        if not isinstance(lineas_confirmadas, list):
            return Response({"detail": "lineas_confirmadas debe ser lista"}, status=400)
        if not sap_id:
            return Response({"detail": "sap_id requerido"}, status=400)

        fabricacion_dt = None
        if fecha_fabricacion:
            try:
                fabricacion_dt = datetime.fromisoformat(fecha_fabricacion).date()
            except ValueError:
                return Response({"detail": "fecha_fabricacion debe ser YYYY-MM-DD"}, status=400)

        try:
            exp = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)

        # Subir / reemplazar PDF (best-effort) — MinIO real
        new_storage_url = None
        new_paperless_id = None
        new_file_size = 0
        new_file_ext = None
        if documento_file:
            file_bytes = b"".join(chunk for chunk in documento_file.chunks())
            new_file_size = len(file_bytes)
            fname = documento_file.name or f"ART-04_{exp.codigo}.pdf"
            new_file_ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else None
            content_type = documento_file.content_type or "application/pdf"

            try:
                from apps.storage.services import put_object_stream
                safe_name = fname.replace("/", "_").replace("\\", "_")
                key = f"expediente/{exp.id}/art-04-{sap_id}-{safe_name}"
                up = put_object_stream(
                    key=key,
                    file_stream=io.BytesIO(file_bytes),
                    content_type=content_type,
                    length=new_file_size,
                )
                if up.get("ok"):
                    new_storage_url = key
                else:
                    log.warning("upsert_sap MinIO upload fallo: %s", up.get("error"))
            except Exception as e:
                log.warning("upsert_sap MinIO upload fallo: %s", e)

            try:
                from apps.storage.services import paperless_ingest
                p = paperless_ingest(
                    file_bytes=file_bytes,
                    filename=fname,
                    title=f"ART-04 - Confirmacion SAP - {exp.codigo} - {sap_id}",
                    document_type="Confirmacion SAP",
                    tags=["ART-04", "SAP", "C5", "upsert"],
                )
                new_paperless_id = p.get("task_id")
            except Exception as e:
                log.warning("paperless_ingest (upsert_sap) fallo: %s", e)

        try:
            with transaction.atomic():
                with connection.cursor() as c:
                    # Sprint 2026-05-01 (fix): el unique index ai_unique_active_artifact
                    # garantiza UN solo ART-04 activo por expediente. Buscamos
                    # sin filtrar por codigo (sap_id) — si existe lo actualizamos
                    # (renombrando el codigo si el sap cambio). Si no existe,
                    # insertamos uno nuevo.
                    c.execute("""
                        SELECT id FROM expedientes.artifact_instances
                         WHERE expediente_id = %s::uuid
                           AND artifact_code = 'ART-04'
                           AND is_active     = TRUE
                         ORDER BY created_at DESC LIMIT 1
                    """, [str(exp.id)])
                    row = c.fetchone()
                    artifact_id = row[0] if row else uuid.uuid4()

                    ocr_payload = {
                        "sap_id":            sap_id,
                        "fecha_fabricacion": fecha_fabricacion or None,
                        "expediente_code":   exp.codigo,
                        "lineas_confirmadas_count": len(lineas_confirmadas),
                        "upsert":            True,
                    }
                    if row:
                        # Sprint 2026-05-01 (fix): renombrar codigo al nuevo sap_id
                        # si cambio (caso "editar numero SAP").
                        update_fields = ["ocr_payload = %s::jsonb",
                                         "fecha = %s",
                                         "codigo = %s"]
                        update_args   = [json.dumps(ocr_payload),
                                         fabricacion_dt,
                                         sap_id]
                        if new_storage_url:
                            update_fields += ["storage_url = %s",
                                              "paperless_doc_id = %s",
                                              "file_size_bytes = %s",
                                              "file_ext = %s"]
                            update_args   += [new_storage_url, new_paperless_id,
                                              new_file_size, new_file_ext]
                        elif remove_documento:
                            update_fields += ["storage_url = NULL",
                                              "paperless_doc_id = NULL",
                                              "file_size_bytes = 0",
                                              "file_ext = NULL"]
                        update_args.append(str(artifact_id))
                        c.execute(
                            "UPDATE expedientes.artifact_instances SET "
                            + ", ".join(update_fields)
                            + " WHERE id = %s::uuid",
                            update_args,
                        )
                    else:
                        # Sprint 2026-05-06 · audience=ADMIN_ONLY (mismo
                        # criterio que confirm_sap arriba).
                        c.execute("""
                            INSERT INTO expedientes.artifact_instances (
                                id, expediente_id, oc_id,
                                artifact_code, kind, codigo,
                                file_ext, file_size_bytes, storage_url, paperless_doc_id,
                                ocr_status, ocr_engine, ocr_confidence, ocr_payload,
                                action_source, correlation_id,
                                author, fecha, visibility_tier, audience, is_active
                            ) VALUES (
                                %s, %s, %s,
                                'ART-04', 'Confirmacion SAP', %s,
                                %s, %s, %s, %s,
                                'DONE', 'manual-upload', 1.0, %s::jsonb,
                                'C5', %s,
                                %s, %s, 'INTERNAL', 'ADMIN_ONLY', TRUE
                            )
                        """, [
                            str(artifact_id), str(exp.id),
                            str(exp.oc_id) if exp.oc_id else None,
                            sap_id,
                            new_file_ext, new_file_size, new_storage_url, new_paperless_id,
                            json.dumps(ocr_payload),
                            str(uuid.uuid4()),
                            (getattr(request.user, "email", None) or "system"),
                            fabricacion_dt,
                        ])

                    # Sprint 2026-05-06 · upsert también la fila documento
                    # con audience=ADMIN_ONLY si subió un archivo nuevo.
                    # Si ya existía documento ART-04 para este sap_id, lo
                    # actualizamos; si no, lo insertamos.
                    if new_storage_url:
                        try:
                            c.execute("""
                                SELECT id FROM expedientes.documento
                                 WHERE expediente_id = %s::uuid
                                   AND kind = 'ART-04'
                                   AND codigo LIKE %s
                                   AND is_active = TRUE
                                 LIMIT 1
                            """, [str(exp.id), sap_id])
                            row_doc = c.fetchone()
                            if row_doc:
                                c.execute("""
                                    UPDATE expedientes.documento
                                       SET storage_url = %s,
                                           file_ext = %s,
                                           file_size_bytes = %s,
                                           audience = 'ADMIN_ONLY',
                                           fecha = %s,
                                           updated_at = NOW()
                                     WHERE id = %s
                                """, [
                                    new_storage_url, new_file_ext, new_file_size,
                                    fabricacion_dt, str(row_doc[0]),
                                ])
                            else:
                                c.execute("""
                                    INSERT INTO expedientes.documento (
                                        id, oc_id, expediente_id, kind, codigo,
                                        audience,
                                        file_ext, file_size_bytes, storage_url,
                                        author, fecha,
                                        is_active, created_at, updated_at
                                    ) VALUES (
                                        %s, %s, %s, 'ART-04', %s,
                                        'ADMIN_ONLY',
                                        %s, %s, %s,
                                        %s, %s,
                                        TRUE, NOW(), NOW()
                                    )
                                """, [
                                    str(uuid.uuid4()),
                                    str(exp.oc_id) if exp.oc_id else None,
                                    str(exp.id),
                                    sap_id,
                                    new_file_ext, new_file_size, new_storage_url,
                                    (getattr(request.user, "email", None) or "system"),
                                    fabricacion_dt,
                                ])
                        except Exception as e:
                            log.warning(
                                "[upsert_sap] documento ADMIN_ONLY upsert fallo: %s", e
                            )

                    # Actualizar lineas
                    for item in lineas_confirmadas:
                        linea_id      = item.get("linea_id") or item.get("id")
                        qty_conf      = item.get("qty_confirmada")
                        unit_price_in = item.get("unit_price")
                        if not linea_id or qty_conf is None:
                            continue
                        try:
                            qty_dec = Decimal(str(qty_conf))
                        except Exception:
                            continue

                        c.execute("""
                            SELECT COALESCE(unit_price, 0)
                              FROM expedientes.linea
                             WHERE id = %s::uuid AND expediente_id = %s::uuid
                               AND is_active = TRUE LIMIT 1
                        """, [linea_id, str(exp.id)])
                        r = c.fetchone()
                        if not r:
                            continue
                        unit_db = Decimal(str(r[0] or 0))
                        unit_final = unit_db
                        if unit_price_in is not None:
                            try:
                                u = Decimal(str(unit_price_in))
                                if u > 0:
                                    unit_final = u
                            except Exception:
                                pass

                        c.execute("""
                            UPDATE expedientes.linea
                               SET qty             = %s,
                                   unit_price      = %s,
                                   total_price     = ROUND(%s * %s, 2),
                                   sap             = %s,
                                   production_date = COALESCE(%s, production_date),
                                   estado          = CASE WHEN %s > 0
                                                          THEN 'SAP_CONFIRMADO'
                                                          ELSE 'CANCELADA' END
                             WHERE id = %s::uuid
                        """, [
                            float(qty_dec),
                            float(unit_final),
                            float(unit_final), float(qty_dec),
                            sap_id,
                            fabricacion_dt,
                            float(qty_dec), linea_id,
                        ])

                    if fabricacion_dt:
                        c.execute("""
                            UPDATE expedientes.expediente
                               SET fecha_produccion_estimada = %s,
                                   last_event_at             = now()
                             WHERE id = %s::uuid
                        """, [fabricacion_dt, str(exp.id)])
                    c.execute("""
                        UPDATE expedientes.expediente
                           SET sap           = COALESCE(NULLIF(sap, ''), %s),
                               numero_sap    = COALESCE(NULLIF(numero_sap, ''), %s),
                               last_event_at = now()
                         WHERE id = %s::uuid
                    """, [sap_id, sap_id, str(exp.id)])
        except Exception as e:
            log.exception("upsert_sap atomic tx fallo: %s", e)
            return Response({"detail": "transaction_failed", "error": str(e)[:200]}, status=500)

        exp.refresh_from_db()
        return Response({
            "ok":           True,
            "expediente":   ExpedienteSerializer(exp).data,
            "artifact_id":  str(artifact_id),
            "sap_id":       sap_id,
            "command":      "C5-upsert",
            "storage_url":  new_storage_url,
        }, status=200)


# ════════════════════════════════════════════════════════════
# Línea (se expone para edición en bloque)
# ════════════════════════════════════════════════════════════
class LineaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Linea.objects.filter(is_active=True)
        # Sprint 2026-05-22 · scope multi-tenant via expediente.
        exp_ids = scoped_expediente_ids(request.user)
        if exp_ids is not None:
            qs = qs.filter(expediente_id__in=exp_ids) if exp_ids else qs.none()
        for p, f in (("oc", "oc_id"), ("expediente", "expediente_id"),
                     ("producto", "producto_id"), ("sap", "sap"),
                     ("estado", "estado")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(LineaSerializer(qs.order_by("sku", "size"), many=True).data)

    def retrieve(self, request, pk=None):
        try:
            l = Linea.objects.get(pk=pk, is_active=True)
        except Linea.DoesNotExist:
            return Response({"detail": "Línea no existe"}, status=404)
        return Response(LineaSerializer(l).data)

    def create(self, request):
        denied = _deny_client_mutation(request, action_label="linea.create")
        if denied is not None: return denied
        # Sprint 2026-06-11 (CEO) · FIX "Agregar producto no persiste":
        # `id` es PK UUID sin default y LineaSerializer (fields="__all__",
        # sin read_only_fields) lo EXIGÍA en el payload → todo POST sin id
        # moría con 400 {"id": ["Este campo es requerido."]} ANTES de
        # llegar al s.save(id=...). Lo generamos server-side; si el
        # cliente manda uno explícito, se respeta (compat).
        data = dict(request.data or {})
        if not data.get("id"):
            data["id"] = str(uuid.uuid4())
        s = LineaSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="linea.update")
        if denied is not None: return denied
        try:
            l = Linea.objects.get(pk=pk)
        except Linea.DoesNotExist:
            return Response({"detail": "Línea no existe"}, status=404)
        s = LineaSerializer(l, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        obj = s.save()

        # Sprint 2026-05-08 · Recalcular total_price si cambió qty o
        # cualquiera de los precios. Mantenemos `unit_price` (legacy)
        # alineado con el precio del operador del expediente: si el
        # admin cambió `unit_price_client` y el operador es CLIENTE,
        # también propagamos a unit_price para consistencia con vistas
        # legacy que leen unit_price.
        try:
            qty_v   = Decimal(str(obj.qty or 0))
            up_mwt  = Decimal(str(obj.unit_price_mwt or 0))
            up_cli  = Decimal(str(obj.unit_price_client or 0))
            up_leg  = Decimal(str(obj.unit_price or 0))
            # Detectar operador del expediente para propagar correctamente.
            op_id = None
            try:
                with connection.cursor() as c:
                    c.execute(
                        "SELECT operating_company_id FROM expedientes.expediente "
                        "WHERE id = %s::uuid LIMIT 1",
                        [str(obj.expediente_id)],
                    )
                    row = c.fetchone()
                    op_id = (row[0] if row else None)
            except (TypeError, ValueError):
                op_id = None
            is_mwt_op = (
                op_id is not None and
                str(op_id).lower() == MWT_OPERATING_CLIENT_ID.lower()
            )
            # Si el admin pasó unit_price_client en el payload, alinear
            # unit_price legacy con el lado del operador.
            new_legacy = up_mwt if is_mwt_op else up_cli
            new_total  = (qty_v * new_legacy).quantize(Decimal("0.01"))
            with connection.cursor() as c:
                c.execute("""
                    UPDATE expedientes.linea
                       SET unit_price  = %s,
                           total_price = %s,
                           updated_at  = NOW()
                     WHERE id = %s::uuid
                """, [str(new_legacy), str(new_total), str(obj.id)])
            obj.refresh_from_db()
            s = LineaSerializer(obj)
        except (TypeError, ValueError, ArithmeticError) as recalc_err:
            log.warning("[linea.update] recalc total_price fallo: %s", recalc_err)

        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="linea.destroy")
        if denied is not None: return denied
        Linea.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Sprint 2026-05-17 · Bulk update de precios por SKU ──────────
    @action(detail=False, methods=["post"], url_path="bulk-update-prices")
    def bulk_update_prices(self, request):
        """Actualiza unit_price_mwt y/o unit_price_client en multiples
        lineas de una sola pasada. Recalcula total_price y mantiene el
        campo legacy `unit_price` alineado con el operador del expediente
        (mismo criterio que `update()` individual).

        Sirve dos casos de uso:
          1. Replicacion por SKU: el FE busca todas las lineas del mismo
             SKU dentro del scope (expediente / transferencia) y manda un
             unico POST con N updates.
          2. Edicion masiva desde el modal 'Alcance del costo': el usuario
             cambia un precio y el FE lo propaga a todas las lineas
             afectadas en una sola llamada.

        Payload (JSON):
          {
            "updates": [
              {"linea_id": "<uuid>",
               "unit_price_mwt":    50.0,    // opcional
               "unit_price_client": 65.0},   // opcional
              ...
            ]
          }

        Response:
          {
            "updated":  [<linea serializada>, ...],
            "errors":   [{"linea_id": "...", "error": "..."}],
            "skipped":  [{"linea_id": "...", "reason": "no_changes"}]
          }

        Role gating (R3): CEO-only via _deny_client_mutation. CLIENT_*
        recibe 403 antes de procesar nada.
        """
        denied = _deny_client_mutation(request, action_label="linea.bulk_update_prices")
        if denied is not None:
            return denied

        updates = request.data.get("updates") or []
        if not isinstance(updates, list) or not updates:
            return Response(
                {"detail": "Payload invalido: falta 'updates' como array no vacio."},
                status=400,
            )

        updated, errors, skipped = [], [], []

        # Cache de operating_company_id por expediente_id (evita N queries
        # cuando muchas lineas comparten expediente — caso comun en el
        # flujo de replicacion por SKU dentro del mismo expediente).
        op_cache: dict[str, str | None] = {}

        def _get_op(exp_id):
            key = str(exp_id) if exp_id else ""
            if key in op_cache:
                return op_cache[key]
            try:
                with connection.cursor() as c:
                    c.execute(
                        "SELECT operating_company_id FROM expedientes.expediente "
                        "WHERE id = %s::uuid LIMIT 1",
                        [key],
                    )
                    row = c.fetchone()
                    op_cache[key] = (row[0] if row else None)
            except (TypeError, ValueError):
                op_cache[key] = None
            return op_cache[key]

        from django.db import transaction as _tx
        with _tx.atomic():
            for upd in updates:
                lid = upd.get("linea_id") or upd.get("id")
                if not lid:
                    errors.append({"linea_id": None, "error": "linea_id requerido"})
                    continue
                up_mwt = upd.get("unit_price_mwt", None)
                up_cli = upd.get("unit_price_client", None)
                if up_mwt is None and up_cli is None:
                    skipped.append({"linea_id": lid, "reason": "no_changes"})
                    continue
                try:
                    l = Linea.objects.get(pk=lid)
                except Linea.DoesNotExist:
                    errors.append({"linea_id": lid, "error": "linea no existe"})
                    continue
                try:
                    if up_mwt is not None:
                        l.unit_price_mwt = Decimal(str(up_mwt))
                    if up_cli is not None:
                        l.unit_price_client = Decimal(str(up_cli))
                    # Recalcular legacy unit_price alineado con operador.
                    op_id = _get_op(l.expediente_id)
                    is_mwt_op = (
                        op_id is not None and
                        str(op_id).lower() == MWT_OPERATING_CLIENT_ID.lower()
                    )
                    qty_v   = Decimal(str(l.qty or 0))
                    new_leg = (Decimal(str(l.unit_price_mwt or 0))
                               if is_mwt_op
                               else Decimal(str(l.unit_price_client or 0)))
                    new_tot = (qty_v * new_leg).quantize(Decimal("0.01"))
                    l.unit_price  = new_leg
                    l.total_price = new_tot
                    l.save(update_fields=[
                        "unit_price_mwt", "unit_price_client",
                        "unit_price", "total_price", "updated_at",
                    ])
                    updated.append(LineaSerializer(l).data)
                except (TypeError, ValueError, ArithmeticError) as exc:
                    errors.append({"linea_id": lid, "error": str(exc)})
                    log.warning("[bulk_update_prices] linea=%s err=%s", lid, exc)

        return Response({
            "updated": updated,
            "errors":  errors,
            "skipped": skipped,
            "summary": {
                "requested": len(updates),
                "updated":   len(updated),
                "errors":    len(errors),
                "skipped":   len(skipped),
            },
        })


# ════════════════════════════════════════════════════════════
# Documento
# ════════════════════════════════════════════════════════════
class DocumentoViewSet(viewsets.ViewSet):
    # Sprint 2026-05-01: accept multipart para subir el archivo en el create.
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def list(self, request):
        qs = Documento.objects.filter(is_active=True).order_by("-fecha", "-created_at")
        # Sprint 2026-05-22 · scope multi-tenant via expediente_id.
        # Aditivo al gating de audience que ya existe debajo.
        exp_ids = scoped_expediente_ids(request.user)
        if exp_ids is not None:
            qs = qs.filter(expediente_id__in=exp_ids) if exp_ids else qs.none()
        for p, f in (("oc", "oc_id"), ("expediente", "expediente_id"), ("kind", "kind")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        # Sprint 2026-05-06 · audiencia (3 niveles).
        #   · CLIENT_*               → solo audience='CLIENT'.
        #   · MWT staff (no Admin)   → 'CLIENT' + 'MWT_INTERNAL', NO ADMIN_ONLY.
        #   · Admin/CEO/superuser    → todos. Param ?audience= permite filtrar.
        if _is_client_viewer(request):
            qs = qs.filter(audience="CLIENT")
        elif not _is_admin_viewer(request):
            qs = qs.exclude(audience="ADMIN_ONLY")
        else:
            audience = request.query_params.get("audience")
            if audience:
                qs = qs.filter(audience=audience)
        return Response(DocumentoSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            d = Documento.objects.get(pk=pk, is_active=True)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)
        # Sprint 2026-05-06 · audiencia.
        #   CLIENT_*  no puede acceder a MWT_INTERNAL ni ADMIN_ONLY.
        #   MWT staff no puede acceder a ADMIN_ONLY.
        doc_aud = getattr(d, "audience", "CLIENT")
        if _is_client_viewer(request) and doc_aud != "CLIENT":
            return Response({"detail": "Documento no existe"}, status=404)
        if doc_aud == "ADMIN_ONLY" and not _is_admin_viewer(request):
            return Response({"detail": "Documento no existe"}, status=404)
        return Response(DocumentoSerializer(d).data)

    def create(self, request):
        denied = _deny_client_mutation(request, action_label="documento.create")
        if denied is not None:
            return denied

        documento_file = request.FILES.get("file") or request.FILES.get("documento_file")
        if documento_file:
            kind   = (request.data.get("kind") or "OTRO").strip().upper()
            codigo = (request.data.get("codigo") or "").strip() or documento_file.name
            oc_id  = request.data.get("oc_id") or None
            exp_id = request.data.get("expediente_id") or None
            # Sprint 2026-05-06 · audiencia (3 niveles: CLIENT, MWT_INTERNAL, ADMIN_ONLY).
            audience = (request.data.get("audience") or "CLIENT").strip().upper()
            if audience not in ("CLIENT", "MWT_INTERNAL", "ADMIN_ONLY"):
                audience = "CLIENT"
            if _is_client_viewer(request):
                # CLIENT_* nunca puede crear documentos MWT_INTERNAL ni ADMIN_ONLY.
                audience = "CLIENT"
            elif audience == "ADMIN_ONLY" and not _is_admin_viewer(request):
                # Solo Admin/CEO puede marcar un documento como ADMIN_ONLY.
                audience = "MWT_INTERNAL"
            try:
                doc_uuid   = uuid.uuid4()
                fname      = documento_file.name or f"documento_{doc_uuid}.bin"
                file_size  = documento_file.size or 0
                file_ext   = fname.rsplit(".", 1)[-1].lower() if "." in fname else None
                content_type = (documento_file.content_type or "application/octet-stream")

                # Sprint 2026-05-01: subida REAL a MinIO via put_object_stream.
                # Patron de keys analogo a productos:
                #   documento/<uuid>/<filename>
                # Anclamos por uuid del documento (evita colisiones de nombre).
                from apps.storage.services import put_object_stream, generate_signed_url
                safe_name = fname.replace("/", "_").replace("\\", "_")
                key = f"documento/{doc_uuid}/{safe_name}"
                # documento_file es UploadedFile -> compatible con file_stream.
                # Si es ImageField/InMemoryUpload, .file es el stream interno;
                # con put_object_stream con length=size todo eso es manejado.
                documento_file.seek(0)
                up = put_object_stream(
                    key=key,
                    file_stream=documento_file,
                    content_type=content_type,
                    length=file_size or -1,
                )
                if not up.get("ok"):
                    log.error("documento.create: put_object_stream fallo: %s",
                              up.get("error"))
                    return Response({
                        "detail": "minio_upload_failed",
                        "error":  up.get("error") or "unknown",
                    }, status=502)

                # Persistimos el `key` directo en storage_url. El frontend
                # arma la URL de descarga con /api/storage/download/?key=<key>
                # (mismo patron que productos).
                storage_url = key

                # Paperless ingest opcional (best-effort, no bloquea)
                paperless_doc_id = None
                try:
                    from apps.storage.services import paperless_ingest
                    documento_file.seek(0)
                    pap_bytes = documento_file.read()
                    p = paperless_ingest(
                        file_bytes=pap_bytes,
                        filename=fname,
                        title=f"{kind} - {codigo}",
                        document_type=kind,
                        tags=["documento", kind],
                    )
                    paperless_doc_id = p.get("task_id")
                except Exception as e:
                    log.warning("paperless_ingest (documento.create) fallo: %s", e)

                with connection.cursor() as c:
                    c.execute("""
                        INSERT INTO expedientes.documento (
                            id, oc_id, expediente_id,
                            kind, audience, codigo,
                            file_ext, file_size_bytes, storage_url,
                            author, fecha,
                            is_active, created_at, updated_at
                        ) VALUES (
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, CURRENT_DATE,
                            TRUE, now(), now()
                        )
                    """, [
                        str(doc_uuid),
                        oc_id  if oc_id  else None,
                        exp_id if exp_id else None,
                        kind, audience, codigo,
                        file_ext, file_size, storage_url,
                        (getattr(request.user, "email", None)
                         or getattr(request.user, "username", None)
                         or "system"),
                    ])
                d = Documento.objects.get(pk=doc_uuid)

                # Sprint 2026-05-07 · Auto-generar Proforma HTML cuando el
                # documento subido es kind='PROFORMA' y hay expediente
                # asociado. La Proforma HTML se persiste como segundo
                # documento (audience='CLIENT') con código secuencial
                # PF-YYYY-NNNN. Best-effort: si falla, no bloquea el
                # upload original — solo log warning.
                # Sprint 2026-05-08 · DOCUMENTO DINÁMICO.
                # Cuando se sube PROFORMA, creamos UN registro Documento
                # con storage_url='dynamic://proforma?codigo=PF-xxxx'.
                # NO subimos archivo a MinIO. El render se hace al vuelo
                # cada vez que el usuario abre el HTML, vía endpoint
                # GET /api/expedientes/{id}/proforma-html/?codigo=...
                # Cuando se sube OC, NO regeneramos el doc PROFORMA — el
                # endpoint dinámico ya leerá la nueva PO ref de la BD.
                if kind == "PROFORMA" and exp_id:
                    try:
                        # Validar que el render funcionará sin lanzar
                        # excepción (best-effort). Si hay líneas, cliente,
                        # etc. está OK. No usamos el HTML — solo verificamos.
                        from .proforma_renderer import render_proforma_html
                        codigo_pf = (codigo or "").strip() or None
                        _html_str, meta = render_proforma_html(
                            expediente_id=exp_id,
                            request_user=request.user,
                            codigo_override=codigo_pf,
                        )
                        if meta:
                            doc_codigo_pf = meta.get("codigo") or codigo_pf or "PF"
                            # storage_url = marker dinámico (se interpreta
                            # en signed_url para redirigir al endpoint de
                            # render on-demand, sin tocar MinIO).
                            dyn_url = f"dynamic://proforma?codigo={doc_codigo_pf}"
                            with connection.cursor() as c2:
                                c2.execute("""
                                    SELECT id FROM expedientes.documento
                                     WHERE expediente_id = %s::uuid
                                       AND kind = 'PROFORMA'
                                       AND file_ext = 'html'
                                       AND is_active = TRUE
                                     LIMIT 1
                                """, [exp_id])
                                existing = c2.fetchone()
                                if existing:
                                    # Existe — actualizamos solo el codigo
                                    # (lo nuevo es lo que el user tipeó).
                                    c2.execute("""
                                        UPDATE expedientes.documento
                                           SET storage_url = %s,
                                               codigo = %s,
                                               audience = 'CLIENT',
                                               file_size_bytes = 0,
                                               updated_at = now()
                                         WHERE id = %s
                                    """, [dyn_url, doc_codigo_pf, str(existing[0])])
                                    log.info("[documento.create] auto-Proforma HTML (dinámico) actualizada: %s",
                                             doc_codigo_pf)
                                else:
                                    new_uuid = uuid.uuid4()
                                    c2.execute("""
                                        INSERT INTO expedientes.documento (
                                            id, oc_id, expediente_id,
                                            kind, audience, codigo,
                                            file_ext, file_size_bytes, storage_url,
                                            author, fecha,
                                            is_active, created_at, updated_at
                                        ) VALUES (
                                            %s, %s, %s,
                                            'PROFORMA', 'CLIENT', %s,
                                            'html', 0, %s,
                                            %s, CURRENT_DATE,
                                            TRUE, now(), now()
                                        )
                                    """, [
                                        str(new_uuid),
                                        oc_id if oc_id else None,
                                        exp_id,
                                        doc_codigo_pf, dyn_url,
                                        (getattr(request.user, "email", None)
                                         or getattr(request.user, "username", None)
                                         or "system"),
                                    ])
                                    log.info("[documento.create] auto-Proforma HTML (dinámico) creada: %s",
                                             doc_codigo_pf)
                    except Exception as auto_err:
                        log.warning("[documento.create] auto-Proforma HTML fallo (ignorado): %s",
                                    auto_err)

                return Response(DocumentoSerializer(d).data, status=201)
            except Exception as e:
                log.exception("documento.create multipart fallo: %s", e)
                return Response({"detail": "upload_failed", "error": str(e)[:200]},
                                status=500)

        # Sprint 2026-05-06 · audiencia. Si CLIENT_* manda 'MWT_INTERNAL'
        # se ignora silenciosamente (HARD SHIELD). Default 'CLIENT'.
        body = dict(request.data) if hasattr(request.data, "items") else {}
        try:
            body = {k: request.data.get(k) for k in request.data.keys()}
        except Exception:
            body = dict(request.data)
        aud = (body.get("audience") or "CLIENT")
        try:
            aud = str(aud).strip().upper()
        except (TypeError, ValueError):
            aud = "CLIENT"
        if aud not in ("CLIENT", "MWT_INTERNAL"):
            aud = "CLIENT"
        if _is_client_viewer(request):
            aud = "CLIENT"
        body["audience"] = aud
        s = DocumentoSerializer(data=body)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="documento.update")
        if denied is not None: return denied
        try:
            d = Documento.objects.get(pk=pk)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)
        s = DocumentoSerializer(d, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="documento.destroy")
        if denied is not None: return denied
        try:
            instance = Documento.objects.get(pk=pk)
        except Documento.DoesNotExist:
            return Response(status=204)
        # Capturar TODAS las keys ANTES del save/delete
        keys = [
            instance.storage_url,
        ]
        keys = [k for k in keys if k]

        with transaction.atomic():
            Documento.objects.filter(pk=pk).update(is_active=False)
            # ON COMMIT: solo si la transacción de BD se confirma, borramos
            # el objeto del bucket. Evita huérfanos en caso de rollback.
            for k in keys:
                transaction.on_commit(lambda key=k: _storage_delete(key))

        return Response(status=204)

    # ── Presigned URL (GET) para ver/descargar el documento ──
    @action(detail=True, methods=["get"])
    def signed_url(self, request, pk=None):
        """Devuelve una URL firmada (TTL 15min por defecto) para el objeto
        asociado al documento.

        BUG FIX 2026-05-02 (AG-03): antes leía `bucket_key` (atributo
        inexistente en el modelo Documento) y caía a un fallback
        `expedientes/{exp_id}/{id}` que NUNCA es donde se guarda en
        realidad. Resultado: NoSuchKey en MinIO al pedir signed URL.

        El upload (create()) persiste la key real como
        `documento/<doc_uuid>/<safe_filename>` y la guarda en
        `Documento.storage_url`. Eso es lo único que tiene que leer
        este endpoint. Mantenemos el fallback legacy sólo para docs
        muy antiguos que pudieran existir sin storage_url poblado.
        """
        try:
            d = Documento.objects.get(pk=pk, is_active=True)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)

        # Sprint 2026-05-08 · DOCUMENTO DINÁMICO. Si el storage_url tiene
        # marcador `dynamic://...`, devolvemos la URL del endpoint que
        # renderiza on-demand (no toca MinIO).
        storage_url_raw = getattr(d, "storage_url", "") or ""
        if storage_url_raw.startswith("dynamic://proforma"):
            # Parseo simple del codigo del marker.
            from urllib.parse import urlparse, parse_qs
            try:
                parsed = urlparse(storage_url_raw)
                qs = parse_qs(parsed.query)
                codigo_param = (qs.get("codigo") or [d.codigo or ""])[0]
            except Exception:
                codigo_param = d.codigo or ""
            from urllib.parse import urlencode
            qs_str = urlencode({"codigo": codigo_param}) if codigo_param else ""
            dyn_path = f"/api/expedientes/{d.expediente_id}/proforma-html/"
            if qs_str:
                dyn_path += f"?{qs_str}"
            return Response({
                "url": dyn_path,
                "available": True,
                "dynamic": True,
                "documento_id": str(d.id),
                "expediente_id": str(d.expediente_id) if d.expediente_id else None,
            })

        # Prioridad: storage_url persistido en el upload (forma canónica
        # vigente), luego bucket_key (compat futura), luego fallback legacy.
        key = (
            storage_url_raw
            or getattr(d, "bucket_key", None)
            or f"expedientes/{d.expediente_id}/{d.id}"
        )
        ttl = int(request.query_params.get("ttl") or 900)

        try:
            from apps.storage.services import generate_signed_url  # noqa: PLC0415
            data = generate_signed_url(key=key, kind="get", ttl=ttl)
        except Exception as e:
            data = {"url": None, "available": False, "error": str(e), "key": key}

        data["documento_id"]  = str(d.id)
        data["expediente_id"] = str(d.expediente_id) if d.expediente_id else None
        data["key"]           = key  # útil para debugging
        return Response(data)


# ════════════════════════════════════════════════════════════
# PIPELINE ViewSets (schema "pipeline")
# ════════════════════════════════════════════════════════════
class TransicionCatViewSet(viewsets.ViewSet):
    """Catálogo cerrado de transiciones válidas del motor de fases."""
    def list(self, request):
        qs = TransicionCat.objects.filter(is_active=True)
        for p, f in (("fase_from", "fase_from"), ("fase_to", "fase_to")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        is_rb = request.query_params.get("is_rollback")
        if is_rb in ("true", "false"):
            qs = qs.filter(is_rollback=(is_rb == "true"))
        return Response(TransicionCatSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            t = TransicionCat.objects.get(pk=pk, is_active=True)
        except TransicionCat.DoesNotExist:
            return Response({"detail": "Transición no existe"}, status=404)
        return Response(TransicionCatSerializer(t).data)


class EventLogViewSet(viewsets.ViewSet):
    """Audit trail inmutable del pipeline (pipeline.event_log).
    Solo GET — INSERTs se hacen desde las actions de negocio."""
    def list(self, request):
        qs = EventLog.objects.filter(is_active=True)
        mapping = {
            "aggregate_type": "aggregate_type",
            "aggregate_id":   "aggregate_id",
            "event_type":     "event_type",
            "action_source":  "action_source",
            "correlation_id": "correlation_id",
            "emitted_by":     "emitted_by_id",
            "phase_from":     "phase_from",
            "phase_to":       "phase_to",
        }
        for p, f in mapping.items():
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        limit = int(request.query_params.get("limit") or 200)
        return Response(EventLogSerializer(qs.order_by("-created_at")[:limit], many=True).data)

    def retrieve(self, request, pk=None):
        try:
            e = EventLog.objects.get(pk=pk, is_active=True)
        except EventLog.DoesNotExist:
            return Response({"detail": "Event no existe"}, status=404)
        return Response(EventLogSerializer(e).data)

    @action(detail=False, methods=["get"])
    def kpis(self, request):
        """KPIs de pipeline.event_log — útil para el Dashboard widget."""
        out = {"total": 0, "last_24h": 0, "last_7d": 0, "by_aggregate": {}}
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours'),
                      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')
                    FROM pipeline.event_log
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out.update({
                    "total":    r[0],
                    "last_24h": r[1],
                    "last_7d":  r[2],
                })
                c.execute("""
                    SELECT aggregate_type, COUNT(*)
                      FROM pipeline.event_log
                     WHERE is_active = TRUE
                       AND created_at > now() - interval '7 days'
                     GROUP BY 1
                     ORDER BY 2 DESC
                """)
                out["by_aggregate"] = {row[0]: row[1] for row in c.fetchall()}
            except Exception:
                pass
        return Response(out)


class OcrParsingLogViewSet(viewsets.ViewSet):
    """Log de corridas de OCR (Paperless+Tika). GET-only desde la app.
    Los INSERTs los hace el worker de OCR."""
    def list(self, request):
        qs = OcrParsingLog.objects.filter(is_active=True)
        for p, f in (("expediente", "expediente_id"),
                     ("artifact",   "artifact_id"),
                     ("status",     "status"),
                     ("tipo",       "artifact_tipo")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        nhr = request.query_params.get("needs_human_review")
        if nhr in ("true", "false"):
            qs = qs.filter(needs_human_review=(nhr == "true"))
        limit = int(request.query_params.get("limit") or 100)
        return Response(OcrParsingLogSerializer(qs.order_by("-created_at")[:limit], many=True).data)

    def retrieve(self, request, pk=None):
        try:
            r = OcrParsingLog.objects.get(pk=pk, is_active=True)
        except OcrParsingLog.DoesNotExist:
            return Response({"detail": "OCR log no existe"}, status=404)
        return Response(OcrParsingLogSerializer(r).data)
