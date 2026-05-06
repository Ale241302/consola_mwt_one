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
from decimal import Decimal

from django.db import connection, transaction
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from apps.core.constants import MWT_OPERATING_CLIENT_ID
from apps.storage.services import delete_object as _storage_delete

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
      · is_superuser → False (Admin total).
      · role_default que empieza con CLIENT_* → True.
      · rol legacy `client` / `cliente` / `client_b2b` → True.
    """
    user = getattr(request, "user", None)
    if user is None:
        return False
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
        return Response(OcSerializer(o).data)

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

        # Sprint 2026-05-06 · Aislamiento de visibilidad por rol.
        # Para CLIENT_*: solo expedientes cuyo client_id u
        # operating_company_id estén en su pool de empresas
        # (legal_entity_ids). Admin/CEO/staff: sin filtro.
        if _is_client_viewer(request):
            user_companies = list(getattr(request.user, "legal_entity_ids", None) or [])
            if user_companies:
                qs = qs.filter(
                    Q(client_id__in=user_companies) |
                    Q(operating_company_id__in=user_companies)
                )
            else:
                # Sin scope → no ve nada (defensivo).
                qs = qs.none()
        return Response(ExpedienteListSerializer(qs, many=True).data)

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
        return Response(ExpedienteSerializer(e).data)

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
        """KPIs globales del dashboard CEO."""
        out = {
            "total": 0, "activos": 0, "bloqueados": 0,
            "total_invoiced": 0.0, "total_paid": 0.0, "receivables": 0.0,
            "credit_60_75": 0, "credit_75_plus": 0, "factory_delayed": 0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO')),
                      COUNT(*) FILTER (WHERE is_blocked = TRUE),
                      COALESCE(SUM(total_invoiced),0),
                      COALESCE(SUM(total_paid),0),
                      COALESCE(SUM(balance),0),
                      COUNT(*) FILTER (WHERE credit_days > 60 AND credit_days <= 75),
                      COUNT(*) FILTER (WHERE credit_days > 75),
                      COUNT(*) FILTER (WHERE factory_delay = TRUE)
                    FROM expedientes.expediente
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out = {
                    "total":            r[0],
                    "activos":          r[1],
                    "bloqueados":       r[2],
                    "total_invoiced":   float(r[3]),
                    "total_paid":       float(r[4]),
                    "receivables":      float(r[5]),
                    "credit_60_75":     r[6],
                    "credit_75_plus":   r[7],
                    "factory_delayed":  r[8],
                }
            except Exception:
                pass
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

        # Validación contra catálogo de transiciones
        try:
            t = TransicionCat.objects.get(
                fase_from=exp.estado, fase_to=fase_to, is_active=True,
            )
        except TransicionCat.DoesNotExist:
            return Response({
                "detail": f"Transición inválida: {exp.estado} → {fase_to}",
                "current_state": exp.estado,
                "requested_state": fase_to,
            }, status=409)

        if t.requiere_documento and not documento_id:
            return Response({
                "detail": f"Transición requiere documento {t.requiere_documento}",
                "required_doc": t.requiere_documento,
            }, status=400)

        previous_state  = exp.estado
        correlation_id  = uuid.uuid4()
        event_id        = uuid.uuid4()
        emitter_id      = getattr(request.user, "id", None)
        emitter_id      = str(emitter_id) if emitter_id else None
        emitter_role    = ("admin" if t.is_rollback else
                           (getattr(request.user, "role", None) or "system"))

        payload = {
            "from":         previous_state,
            "to":           fase_to,
            "label":        t.label,
            "is_rollback":  t.is_rollback,
            "note":         note,
            "documento_id": documento_id,
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
        if not fecha_fabricacion:
            return Response({"detail": "fecha_fabricacion requerida"}, status=400)

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
                            """, [str(exp.id), f"ART-04 · {sap_id}%"])
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
                                    f"ART-04 · {sap_id}",
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

                    # 5. Sombra legacy en expedientes.documento para compat
                    #    con el historial ya existente (la UI de documentos
                    #    legacy lee de allí).
                    c.execute("""
                        INSERT INTO expedientes.documento (
                            id, oc_id, expediente_id, kind, codigo,
                            file_ext, file_size_bytes, storage_url,
                            author, fecha, is_active
                        ) VALUES (
                            %s, %s, %s, 'Confirmación SAP', %s,
                            %s, %s, %s,
                            %s, %s, TRUE
                        )
                    """, [
                        str(uuid.uuid4()),
                        str(exp.oc_id) if exp.oc_id else None,
                        str(exp.id),
                        sap_id,
                        file_ext, file_size_bytes, storage_url,
                        (getattr(request.user, "email", None) or "system"),
                        fabricacion_dt,
                    ])

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
                            """, [str(exp.id), f"ART-04 · {sap_id}%"])
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
                                    f"ART-04 · {sap_id}",
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
        s = LineaSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
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
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        denied = _deny_client_mutation(request, action_label="linea.destroy")
        if denied is not None: return denied
        Linea.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Documento
# ════════════════════════════════════════════════════════════
class DocumentoViewSet(viewsets.ViewSet):
    # Sprint 2026-05-01: accept multipart para subir el archivo en el create.
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def list(self, request):
        qs = Documento.objects.filter(is_active=True).order_by("-fecha", "-created_at")
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

        # Prioridad: storage_url persistido en el upload (forma canónica
        # vigente), luego bucket_key (compat futura), luego fallback legacy.
        key = (
            getattr(d, "storage_url", None)
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
