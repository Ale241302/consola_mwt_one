"""
=====================================================================
MWT.ONE · apps.transfers.views
Agente responsable: [AG-BACKEND]

Expone:
  /api/transferencias/          (TransferenciaViewSet)
  /api/transfer-lineas/         (LineaViewSet)
  /api/transfer-eventos/        (EventoViewSet)
  /api/transfer-documentos/     (TransferenciaDocumentoViewSet)

Reglas:
  - Soft-delete: is_active = FALSE.
  - State machine validada contra transfers.transicion_cat.
  - Idempotencia: idempotence_token en evento.
  - Discrepancia: recalculada al receive() usando tolerancia_pct.
  - DISCREPANCY → RECONCILED requiere reconciled_by_id.
=====================================================================
"""
import uuid
import logging
from decimal import Decimal
from django.db import connection, transaction, IntegrityError, DataError
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

log = logging.getLogger(__name__)

from apps.storage.services import delete_object as _storage_delete

from .models import (
    Transferencia, Linea, Evento, TransferenciaDocumento,
    EstadoTransferCat, LegalContextCat, TransicionCat,
    CostLine, CostKindCat,
)
from .serializers import (
    TransferenciaSerializer, TransferenciaListSerializer,
    LineaSerializer, EventoSerializer, TransferenciaDocumentoSerializer,
    CostLineSerializer, CostKindCatSerializer,
)
from . import services as transfer_services
from . import ocr_customs
from . import liquidation as liquidation_engine


# ════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════
def _validate_transition(estado_from, estado_to, legal_context=None):
    """Valida que (from → to) esté permitido en transicion_cat."""
    qs = TransicionCat.objects.filter(
        estado_from=estado_from, estado_to=estado_to, is_active=True,
    )
    exact = qs.filter(legal_context=legal_context).first()
    if exact:
        return exact
    # fallback: regla sin legal_context explícito (válida en cualquier contexto)
    generic = qs.filter(legal_context__isnull=True).first()
    return generic


def _resolve_trf(pk):
    """Resuelve una Transferencia a partir de pk, aceptando UUID o codigo.
    Sprint 2026-04-30: el FE puede navegar a /transferencias/{codigo} (URL
    legible TRF-YYYY-NNNN) y todas las acciones detail-level deben seguir
    funcionando. Si pk no es UUID, intentamos lookup por codigo.
    """
    if pk is None:
        raise Transferencia.DoesNotExist()
    s = str(pk)
    # ¿Parece UUID?
    import re as _re
    UUID_RE = _re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", _re.I)
    if UUID_RE.match(s):
        try:
            return Transferencia.objects.get(pk=s, is_active=True)
        except Transferencia.DoesNotExist:
            pass
    # Fallback codigo (ej. TRF-2026-0024)
    return Transferencia.objects.get(codigo=s, is_active=True)


def _confidence_to_pct(level):
    """Convierte 'HIGH'/'MEDIUM'/'LOW' del SKILL_OCR_ADUANAS en un %."""
    if level is None:
        return None
    if isinstance(level, (int, float)):
        try:
            v = float(level)
            return v if v <= 100 else 100.0
        except Exception:
            return None
    s = str(level).upper().strip()
    return {"HIGH": 90.0, "MEDIUM": 70.0, "LOW": 45.0}.get(s)


def _recompute_line_discrepancy(linea):
    """OK / WITHIN_TOLERANCE / OVER / UNDER según qty_received vs qty_transfer."""
    if linea.qty_received is None:
        return "PENDING_REVIEW"
    qt = int(linea.qty_transfer or 0)
    qr = int(linea.qty_received or 0)
    if qt == 0:
        return "OK" if qr == 0 else "OVER"
    delta_pct = abs(qr - qt) * 100.0 / qt
    tol = float(linea.tolerancia_pct or 0)
    if qr == qt:
        return "OK"
    if delta_pct <= tol:
        return "WITHIN_TOLERANCE"
    return "OVER" if qr > qt else "UNDER"


# ════════════════════════════════════════════════════════════
# Pricing por línea (precio MWT vs precio Cliente)
# ════════════════════════════════════════════════════════════
def _resolve_line_pricing(t, lineas):
    """Resuelve, por cada Linea de transferencia, el precio congelado en
    expedientes.linea (unit_price_mwt / unit_price_client) y el
    operating_company_id del expediente al que pertenece.

    Reutiliza el mismo enriquecimiento en 2 pasos que TransferenciaViewSet
    .retrieve(): assignment → expediente_id/operating_company_id, y luego
    query directo a expedientes.linea por (expediente_id, producto_id,
    size). Devuelve:

        { str(linea.id): {
            "unit_price_mwt": float|None,
            "unit_price_client": float|None,
            "operating_company_id": str|None,
            "expediente_codigo": str|None,
            "proforma_codigo": str|None,
        }, ... }

    Si algo falla, devuelve {} — el caller cae al snapshot unit_value.
    """
    out = {}
    try:
        from django.db import connection as _conn
        # Paso 0: mapa producto_id+talla → expediente_id/operating_company.
        exp_map = {}
        _PF_JOIN = """
            LEFT JOIN LATERAL (
                SELECT d.codigo
                FROM expedientes.documento d
                WHERE d.expediente_id = e.id
                  AND d.kind          = 'PROFORMA'
                  AND d.is_active     = TRUE
                  AND d.codigo IS NOT NULL
                  AND d.codigo <> ''
                ORDER BY d.created_at DESC
                LIMIT 1
            ) pf ON TRUE
        """
        with _conn.cursor() as c:
            c.execute(
                f"""
                SELECT a.producto_id,
                       COALESCE(a.talla,'')      AS talla_norm,
                       a.expediente_id,
                       e.codigo                  AS expediente_codigo,
                       pf.codigo                 AS proforma_codigo,
                       e.operating_company_id    AS operating_company_id
                FROM inventario.expediente_nodo_assignment a
                LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
                {_PF_JOIN}
                WHERE a.transferencia_id = %(trf_id)s::uuid
                  AND a.is_active = TRUE
                  AND a.nodo_id   = %(dest_id)s::uuid
                """,
                {"trf_id": str(t.id), "dest_id": str(t.destino_id)},
            )
            rows = c.fetchall()
            if not rows:
                # Fallback legacy por notas (transferencia_id NULL).
                c.execute(
                    f"""
                    SELECT a.producto_id,
                           COALESCE(a.talla,'')      AS talla_norm,
                           a.expediente_id,
                           e.codigo                  AS expediente_codigo,
                           pf.codigo                 AS proforma_codigo,
                           e.operating_company_id    AS operating_company_id
                    FROM inventario.expediente_nodo_assignment a
                    LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
                    {_PF_JOIN}
                    WHERE a.is_active = TRUE
                      AND a.nodo_id   = %(dest_id)s::uuid
                      AND a.notas ILIKE %(notas_pat)s
                    """,
                    {"dest_id": str(t.destino_id),
                     "notas_pat": f"%transfer from {t.id}%"},
                )
                rows = c.fetchall()
            for r in rows:
                key = (str(r[0]), r[1] or "")
                exp_map.setdefault(key, {
                    "expediente_id":        str(r[2]) if r[2] else None,
                    "expediente_codigo":    r[3],
                    "proforma_codigo":      r[4],
                    "operating_company_id": str(r[5]) if r[5] else None,
                })

        # Paso 1: por cada linea, encontrar su expediente via exp_map.
        per_line_exp = {}  # linea.id → exp_map dict
        for l in lineas:
            key = (str(l.producto_id or ""), (l.size or ""))
            m = exp_map.get(key)
            if m:
                per_line_exp[str(l.id)] = m

        # Paso 2: query directo a expedientes.linea por
        # (expediente_id, producto_id, size).
        linea_keys = []
        seen = set()
        for l in lineas:
            m = per_line_exp.get(str(l.id))
            eid = m["expediente_id"] if m else None
            pid = str(l.producto_id) if l.producto_id else None
            if not eid or not pid:
                continue
            sz = str(l.size or "")
            lk = (eid, pid, sz)
            if lk not in seen:
                seen.add(lk)
                linea_keys.append(lk)

        price_info = {}  # (eid, pid, size) → dict
        if linea_keys:
            placeholders = ",".join(["(%s::uuid, %s::uuid, %s)"] * len(linea_keys))
            params = [v for lk in linea_keys for v in lk]
            with _conn.cursor() as c:
                c.execute(
                    f"""
                    SELECT expediente_id, producto_id,
                           COALESCE(size, '') AS size_norm,
                           unit_price_mwt, unit_price_client
                      FROM expedientes.linea
                     WHERE (expediente_id, producto_id, COALESCE(size,''))
                        IN ({placeholders})
                       AND is_active = TRUE
                    """,
                    params,
                )
                for r in c.fetchall():
                    k = (str(r[0]), str(r[1]), r[2] or "")
                    price_info[k] = {
                        "unit_price_mwt":    float(r[3]) if r[3] is not None else None,
                        "unit_price_client": float(r[4]) if r[4] is not None else None,
                    }

        for l in lineas:
            m = per_line_exp.get(str(l.id))
            eid = m["expediente_id"] if m else None
            pid = str(l.producto_id) if l.producto_id else None
            sz = str(l.size or "")
            pinfo = price_info.get((eid, pid, sz)) if (eid and pid) else None
            out[str(l.id)] = {
                "unit_price_mwt":       pinfo["unit_price_mwt"]    if pinfo else None,
                "unit_price_client":    pinfo["unit_price_client"] if pinfo else None,
                "operating_company_id": m["operating_company_id"]  if m else None,
                "expediente_id":        m["expediente_id"]         if m else None,
                "expediente_codigo":    m["expediente_codigo"]     if m else None,
                "proforma_codigo":      m["proforma_codigo"]       if m else None,
            }
    except Exception:
        log.exception("[_resolve_line_pricing] enrichment failed trf=%s", getattr(t, "id", None))
        return {}
    return out


# ════════════════════════════════════════════════════════════
# Transferencia
# ════════════════════════════════════════════════════════════
class TransferenciaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Transferencia.objects.filter(is_active=True).order_by("-created_at")
        for p, f in (("origen", "origen_id"), ("destino", "destino_id"),
                     ("estado", "estado"), ("legal_context", "legal_context")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        needs = request.query_params.get("needs_approval")
        if needs in ("1", "true", "True"):
            qs = qs.filter(needs_approval=True)
        has_disc = request.query_params.get("has_discrepancy")
        if has_disc in ("1", "true", "True"):
            qs = qs.filter(has_discrepancy=True)
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(codigo__icontains=q)
        return Response(TransferenciaListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        data = TransferenciaSerializer(t).data
        lineas_data = LineaSerializer(
            Linea.objects.filter(transferencia_id=t.id, is_active=True), many=True
        ).data
        # Sprint 2026-05-13 · Fase 10 — enriquecer cada linea con
        # expediente_id/expediente_codigo. La tabla transfers.linea no
        # tiene expediente_id (la transferencia es agnóstica al
        # expediente), pero inventario.expediente_nodo_assignment sí lo
        # tiene cuando la fila fue creada por POST /transfer/. Mapeamos
        # por (producto_id, COALESCE(talla,'')) restringiendo al
        # transferencia_id en curso.
        # Sprint 2026-05-14 · Fase 11 — el enrichment intenta primero
        # con `transferencia_id` (filas creadas tras el deploy de 65c).
        # Si no encuentra match (transferencias legacy con
        # transferencia_id NULL), cae a un parse del campo `notas`
        # ('transfer from {uuid}'). Si tampoco hay match, deja la fila
        # con expediente = "—" en el FE.
        # Sprint 2026-05-17 · Enrichment en 2 pasos (más robusto que JOIN
        # LATERAL):
        #   PASO 1: assignment → expediente_id, codigo, operating_company_id,
        #           proforma_codigo.
        #   PASO 2: para cada (expediente_id, producto_id, size) de las
        #           líneas de la transferencia → query directo a
        #           expedientes.linea para sacar id + unit_price_mwt/client.
        # Esto evita el problema de matching frágil entre
        # `expediente_nodo_assignment.talla` y `expedientes.linea.size`.
        try:
            from django.db import connection as _conn
            exp_map = {}
            _PF_JOIN = """
                LEFT JOIN LATERAL (
                    SELECT d.codigo
                    FROM expedientes.documento d
                    WHERE d.expediente_id = e.id
                      AND d.kind          = 'PROFORMA'
                      AND d.is_active     = TRUE
                      AND d.codigo IS NOT NULL
                      AND d.codigo <> ''
                    ORDER BY d.created_at DESC
                    LIMIT 1
                ) pf ON TRUE
            """
            with _conn.cursor() as c:
                # 1) Path principal: por transferencia_id (post-65c).
                c.execute(
                    f"""
                    SELECT a.producto_id,
                           COALESCE(a.talla,'')      AS talla_norm,
                           a.expediente_id,
                           e.codigo                  AS expediente_codigo,
                           pf.codigo                 AS proforma_codigo,
                           e.operating_company_id    AS operating_company_id
                    FROM inventario.expediente_nodo_assignment a
                    LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
                    {_PF_JOIN}
                    WHERE a.transferencia_id = %(trf_id)s::uuid
                      AND a.is_active = TRUE
                      AND a.nodo_id   = %(dest_id)s::uuid
                    """,
                    {"trf_id": str(t.id), "dest_id": str(t.destino_id)},
                )
                for r in c.fetchall():
                    key = (str(r[0]), r[1] or "")
                    exp_map.setdefault(key, {
                        "expediente_id":        str(r[2]) if r[2] else None,
                        "expediente_codigo":    r[3],
                        "proforma_codigo":      r[4],
                        "operating_company_id": str(r[5]) if r[5] else None,
                    })
                # 2) Fallback legacy: parse de `notas LIKE %transfer from
                #    <uuid>%`. Sólo si el path 1 quedó vacío (o sea, las
                #    rows de este destino no tienen transferencia_id).
                if not exp_map:
                    c.execute(
                        f"""
                        SELECT a.producto_id,
                               COALESCE(a.talla,'')      AS talla_norm,
                               a.expediente_id,
                               e.codigo                  AS expediente_codigo,
                               pf.codigo                 AS proforma_codigo,
                               e.operating_company_id    AS operating_company_id
                        FROM inventario.expediente_nodo_assignment a
                        LEFT JOIN expedientes.expediente e ON e.id = a.expediente_id
                        {_PF_JOIN}
                        WHERE a.is_active = TRUE
                          AND a.nodo_id   = %(dest_id)s::uuid
                          AND a.notas ILIKE %(notas_pat)s
                        """,
                        {"dest_id": str(t.destino_id),
                         "notas_pat": f"%transfer from {t.id}%"},
                    )
                    for r in c.fetchall():
                        key = (str(r[0]), r[1] or "")
                        exp_map.setdefault(key, {
                            "expediente_id":        str(r[2]) if r[2] else None,
                            "expediente_codigo":    r[3],
                            "proforma_codigo":      r[4],
                            "operating_company_id": str(r[5]) if r[5] else None,
                        })

            # Primer pass: inyectar expediente_id / codigo / proforma /
            # operating_company_id en cada línea.
            for ln in lineas_data:
                key = (str(ln.get("producto_id") or ""),
                       (ln.get("size") or ""))
                m = exp_map.get(key)
                if m:
                    ln["expediente_id"]        = m["expediente_id"]
                    ln["expediente_codigo"]    = m["expediente_codigo"]
                    ln["proforma_codigo"]      = m["proforma_codigo"]
                    ln["operating_company_id"] = m["operating_company_id"]

            # Segundo pass: query directo a expedientes.linea por
            # (expediente_id, producto_id, size) de cada línea. Esto saca
            # linea_id, unit_price_mwt y unit_price_client SIN depender del
            # JOIN LATERAL frágil.
            linea_keys = []
            seen_lk    = set()
            for ln in lineas_data:
                eid = ln.get("expediente_id")
                pid = ln.get("producto_id")
                if not eid or not pid:
                    continue
                sz  = str(ln.get("size") or "")
                lk  = (str(eid), str(pid), sz)
                if lk not in seen_lk:
                    seen_lk.add(lk)
                    linea_keys.append(lk)

            linea_info = {}  # (eid_str, pid_str, size_str) → dict
            if linea_keys:
                # Construir IN con tuplas para batch query.
                placeholders = ",".join(
                    ["(%s::uuid, %s::uuid, %s)"] * len(linea_keys)
                )
                params = [v for lk in linea_keys for v in lk]
                with _conn.cursor() as c:
                    c.execute(
                        f"""
                        SELECT expediente_id, producto_id,
                               COALESCE(size, '') AS size_norm,
                               id, unit_price_mwt, unit_price_client
                          FROM expedientes.linea
                         WHERE (expediente_id, producto_id, COALESCE(size,''))
                            IN ({placeholders})
                           AND is_active = TRUE
                        """,
                        params,
                    )
                    for r in c.fetchall():
                        k = (str(r[0]), str(r[1]), r[2] or "")
                        linea_info[k] = {
                            "linea_id_expediente": str(r[3]) if r[3] else None,
                            "unit_price_mwt":      float(r[4]) if r[4] is not None else None,
                            "unit_price_client":   float(r[5]) if r[5] is not None else None,
                        }

            # Inyectar precios + linea_id en cada línea (None si no match).
            for ln in lineas_data:
                eid = ln.get("expediente_id")
                pid = ln.get("producto_id")
                sz  = str(ln.get("size") or "")
                info = (linea_info.get((str(eid), str(pid), sz))
                        if (eid and pid) else None)
                ln["linea_id_expediente"] = info["linea_id_expediente"] if info else None
                ln["unit_price_mwt"]      = info["unit_price_mwt"]      if info else None
                ln["unit_price_client"]   = info["unit_price_client"]   if info else None

            # Diagnostico estructurado (visible en docker compose logs django).
            try:
                n_total = len(lineas_data)
                n_with_eid    = sum(1 for x in lineas_data if x.get("expediente_id"))
                n_with_op     = sum(1 for x in lineas_data if x.get("operating_company_id"))
                n_with_lid    = sum(1 for x in lineas_data if x.get("linea_id_expediente"))
                n_with_prices = sum(1 for x in lineas_data
                                    if x.get("unit_price_mwt") is not None
                                    or x.get("unit_price_client") is not None)
                log.info(
                    "[trf.retrieve enrich] trf=%s lines=%s eid=%s op=%s "
                    "lid=%s prices=%s",
                    t.id, n_total, n_with_eid, n_with_op, n_with_lid, n_with_prices,
                )
            except Exception:  # noqa: BLE001 — logging is best-effort
                pass

        except Exception:
            # Si falla el enriquecimiento, no rompemos el endpoint —
            # la tabla del FE simplemente muestra "—" en la columna.
            log.exception("retrieve · expediente enrichment failed")
        data["lineas"] = lineas_data
        data["eventos"] = EventoSerializer(
            Evento.objects.filter(transferencia_id=t.id).order_by("-created_at"), many=True
        ).data
        data["documentos"] = TransferenciaDocumentoSerializer(
            TransferenciaDocumento.objects.filter(transferencia_id=t.id, is_active=True),
            many=True,
        ).data
        # Sprint Transfer Engine v2 — costos asociados.
        data["cost_lines"] = CostLineSerializer(
            CostLine.objects.filter(transferencia_id=t.id, is_active=True).order_by("kind"),
            many=True,
        ).data
        return Response(data)

    def create(self, request):
        data = {**request.data}
        # Compat retro: el FE viejo enviaba `nodo_*_id`. Normalizamos.
        if "nodo_origen_id"  in data and "origen_id"  not in data:
            data["origen_id"]  = data.pop("nodo_origen_id")
        if "nodo_destino_id" in data and "destino_id" not in data:
            data["destino_id"] = data.pop("nodo_destino_id")
        data.pop("has_discrepancy", None)

        # Sprint Transfer Engine v2 — el FE manda 'lineas' y 'cost_lines'
        # inline en el mismo POST. Las separamos del payload de transferencia.
        inline_lineas     = data.pop("lineas",     None) or data.pop("transfer_lines", None) or []
        inline_cost_lines = data.pop("cost_lines", None) or []

        new_id = uuid.uuid4()
        log.info("[transferencia.create] payload normalizado=%s lineas=%d costs=%d",
                 dict(data), len(inline_lineas), len(inline_cost_lines))
        try:
            s = TransferenciaSerializer(data=data)
            s.is_valid(raise_exception=True)
            with transaction.atomic():
                s.save(id=new_id)
                Transferencia.objects.filter(pk=new_id).update(
                    snapshot_created_at=timezone.now(),
                )
                Evento.objects.create(
                    id               = uuid.uuid4(),
                    transferencia_id = new_id,
                    estado_prev      = None,
                    estado_nuevo     = s.data.get("estado", "PLANNED"),
                    actor_id         = data.get("created_by_id"),
                    actor_name       = data.get("created_by_name"),
                    notes            = "Creación",
                )
                # Persistir líneas de producto inline (si vinieron).
                for raw in inline_lineas:
                    line_data = {**raw, "transferencia_id": str(new_id)}
                    line_data.pop("id", None)
                    ls = LineaSerializer(data=line_data)
                    ls.is_valid(raise_exception=True)
                    ls.save(id=uuid.uuid4())
                # Persistir cost lines inline (trigger SQL recalcula total_cost_usd).
                for raw in inline_cost_lines:
                    cost_data = {**raw, "transferencia_id": str(new_id)}
                    cost_data.pop("id", None)
                    cost_data.pop("amount_usd", None)
                    cs = CostLineSerializer(data=cost_data)
                    cs.is_valid(raise_exception=True)
                    cs.save(id=uuid.uuid4())
        except (IntegrityError, DataError) as e:
            log.warning("[transferencia.create] DB error payload=%s : %s", dict(data), e)
            return Response({"detail": str(e)}, status=400)
        except Exception as e:
            log.exception("[transferencia.create] unexpected error payload=%s", dict(data))
            return Response(
                {"detail": f"{type(e).__name__}: {e}"},
                status=500,
            )
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        prev_estado = t.estado
        nuevo_estado = request.data.get("estado", prev_estado)

        if nuevo_estado != prev_estado:
            if not _validate_transition(prev_estado, nuevo_estado, t.legal_context):
                return Response(
                    {"detail": f"Transición ilegal: {prev_estado} → {nuevo_estado}"},
                    status=400,
                )

        s = TransferenciaSerializer(t, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        with transaction.atomic():
            s.save()
            t.refresh_from_db()
            if t.estado != prev_estado:
                Evento.objects.create(
                    id               = uuid.uuid4(),
                    transferencia_id = t.id,
                    estado_prev      = prev_estado,
                    estado_nuevo     = t.estado,
                    actor_id         = request.data.get("actor_id"),
                    actor_name       = request.data.get("actor_name"),
                    notes            = request.data.get("notes") or f"{prev_estado} → {t.estado}",
                    idempotence_token= request.data.get("idempotence_token"),
                )
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        Transferencia.objects.filter(pk=t.id).update(is_active=False)
        return Response(status=204)

    # ── Selects ────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def select_estados(self, request):
        return Response([{"codigo": e.codigo, "label": e.label, "color": e.color}
                         for e in EstadoTransferCat.objects.filter(is_active=True)])

    @action(detail=False, methods=["get"])
    def select_legal_contexts(self, request):
        return Response([{"codigo": c.codigo, "label": c.label, "descripcion": c.descripcion}
                         for c in LegalContextCat.objects.filter(is_active=True)])

    @action(detail=False, methods=["get"], url_path="select_cost_kinds")
    def select_cost_kinds(self, request):
        """Catálogo de tipos de costo (DAI, IVA, ALMACENAJE, FLETE, etc.)."""
        return Response(CostKindCatSerializer(
            CostKindCat.objects.filter(is_active=True), many=True
        ).data)

    # ── OCR Aduanal — extracción con gpt-5-nano ───────────────
    # POST /api/transferencias/ocr_customs/
    # Recibe: multipart con `file` (PDF / imagen).
    # Devuelve: {lines: [{kind, label, amount, currency, confidence}], ...}
    @action(detail=False, methods=["post"], url_path="ocr_customs")
    def ocr_customs(self, request):
        f = request.FILES.get("file") or request.FILES.get("upload")
        if not f:
            return Response(
                {"detail": "Falta el archivo. Usa multipart con campo `file`."},
                status=400,
            )
        if f.size > 25 * 1024 * 1024:
            return Response(
                {"detail": "Archivo > 25MB. Comprime el PDF antes de subirlo."},
                status=413,
            )
        try:
            payload = ocr_customs.extract_customs_costs(
                file_bytes   = f.read(),
                filename     = f.name,
                content_type = f.content_type or "application/octet-stream",
            )
        except Exception as e:
            log.exception("[ocr_customs] uncaught error file=%s", f.name)
            return Response({"detail": f"OCR falló: {type(e).__name__}: {e}"}, status=500)

        # Auditoría: si vino un transferencia_id en el form, persistimos
        # el payload en transferencia_documento.ocr_payload_json.
        trf_id = (request.data.get("transferencia_id") or
                  request.data.get("transfer_id"))
        doc_id = request.data.get("document_id")
        if trf_id and doc_id:
            try:
                TransferenciaDocumento.objects.filter(
                    pk=doc_id, transferencia_id=trf_id,
                ).update(
                    ocr_processed_at = timezone.now(),
                    ocr_payload_json = payload,
                )
            except Exception:
                log.exception("[ocr_customs] no pude persistir payload en doc=%s", doc_id)

        return Response(payload)

    # ── Cost lines CRUD inline (sub-recurso de transferencia) ──
    # GET    /api/transferencias/{id}/cost-lines/
    # POST   /api/transferencias/{id}/cost-lines/
    # DELETE /api/transferencias/{id}/cost-lines/{cost_id}/
    @action(detail=True, methods=["get", "post"], url_path="cost-lines")
    def cost_lines(self, request, pk=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        if request.method.upper() == "GET":
            qs = CostLine.objects.filter(
                transferencia_id=t.id, is_active=True
            ).order_by("kind", "created_at")
            return Response(CostLineSerializer(qs, many=True).data)
        body = {**request.data, "transferencia_id": str(t.id)}
        body.pop("id", None)
        body.pop("amount_usd", None)
        s = CostLineSerializer(data=body)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())
        return Response(s.data, status=201)

    @action(detail=True, methods=["delete", "patch"], url_path=r"cost-lines/(?P<cost_id>[^/.]+)")
    def cost_line_detail(self, request, pk=None, cost_id=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        if request.method.upper() == "DELETE":
            updated = CostLine.objects.filter(
                pk=cost_id, transferencia_id=t.id, is_active=True
            ).update(is_active=False)
            if not updated:
                return Response({"detail": "Cost line no encontrada"}, status=404)
            return Response(status=204)

        # PATCH
        try:
            instance = CostLine.objects.get(pk=cost_id, transferencia_id=t.id, is_active=True)
        except CostLine.DoesNotExist:
            return Response({"detail": "Cost line no encontrada"}, status=404)

        s = CostLineSerializer(instance, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)

    # ── OCR de costos sobre la transferencia ya creada ─────────────
    # POST /api/transferencias/{id}/upload-cost-ocr/
    # multipart con `file` (PDF/imagen del DUA, factura aduanal, etc.).
    # Llama a SKILL_OCR_ADUANAS, parsea el JSON {cost_lines: [...]} y
    # hace MERGE inteligente:
    #   · Si ya existe una CostLine con (kind, currency) match → SUMA al amount.
    #   · Si no existe → crea una nueva CostLine source=OCR_DUA.
    # Devuelve el listado actualizado + un summary { added, merged }.
    @action(detail=True, methods=["post"], url_path="upload-cost-ocr")
    def upload_cost_ocr(self, request, pk=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)

        f = request.FILES.get("file") or request.FILES.get("upload")
        if not f:
            return Response({"detail": "Falta el archivo (`file`)."}, status=400)
        if f.size > 25 * 1024 * 1024:
            return Response({"detail": "Archivo > 25MB."}, status=413)

        try:
            payload = ocr_customs.extract_customs_costs(
                file_bytes   = f.read(),
                filename     = f.name,
                content_type = f.content_type or "application/octet-stream",
            )
        except Exception as e:
            log.exception("[upload_cost_ocr] OCR failed file=%s", f.name)
            return Response({"detail": f"OCR falló: {type(e).__name__}: {e}"}, status=500)

        # Estructura esperada del OCR (per SKILL_OCR_ADUANAS):
        #   {
        #     "document_reference": "...",
        #     "cost_lines": [
        #       {"cost_type": "arancel_aduana", "amount": 1250.50,
        #        "currency": "USD", "description": "..."},
        #       ...
        #     ],
        #     "confidence": "HIGH|MEDIUM|LOW",
        #     "gaps_detected": [...]
        #   }
        # Aceptamos también el shape antiguo (kind/label) por compat.
        proposed = []
        for c in (payload.get("cost_lines") or []):
            kind = (c.get("cost_type") or c.get("kind") or "").strip()
            label = c.get("description") or c.get("label") or payload.get("document_reference") or ""
            try:
                amount = float(c.get("amount") or 0)
            except Exception:
                amount = 0.0
            currency = (c.get("currency") or "USD").upper()[:3]
            if not kind or amount <= 0:
                continue
            proposed.append({
                "kind": kind, "label": label,
                "amount": amount, "currency": currency,
                "ocr_confidence": _confidence_to_pct(payload.get("confidence")),
            })

        existing = list(CostLine.objects.filter(
            transferencia_id=t.id, is_active=True
        ))
        added, merged = 0, 0
        with transaction.atomic():
            for p in proposed:
                # MERGE: misma kind + currency → sumamos
                match = next(
                    (e for e in existing
                     if (e.kind or "").lower() == p["kind"].lower()
                     and (e.currency or "USD").upper() == p["currency"]),
                    None,
                )
                if match:
                    new_amount = float(match.amount or 0) + p["amount"]
                    CostLine.objects.filter(pk=match.id).update(
                        amount=new_amount,
                        # Si la nota actual no tiene la referencia OCR, agregamos
                        notes=(match.notes or "") + (
                            f"\n[OCR {payload.get('document_reference','')}] +{p['amount']} {p['currency']}"
                            if p["amount"] else ""
                        ),
                        ocr_confidence=p["ocr_confidence"] or match.ocr_confidence,
                    )
                    merged += 1
                else:
                    # Nueva línea source=OCR_DUA
                    new_cost = {
                        "transferencia_id": str(t.id),
                        "kind": p["kind"],
                        "label": p["label"][:160],
                        "amount": p["amount"],
                        "currency": p["currency"],
                        "fx_to_usd": 1.0 if p["currency"] == "USD" else 1.0,
                        "source": "OCR_DUA",
                        "ocr_confidence": p["ocr_confidence"],
                    }
                    new_cost.pop("amount_usd", None)
                    cs = CostLineSerializer(data=new_cost)
                    cs.is_valid(raise_exception=True)
                    cs.save(id=uuid.uuid4())
                    added += 1

        # Devolver el listado fresco + summary
        fresh = CostLine.objects.filter(
            transferencia_id=t.id, is_active=True
        ).order_by("kind", "created_at")
        return Response({
            "summary": {
                "added":  added,
                "merged": merged,
                "skipped": len(payload.get("cost_lines") or []) - added - merged,
                "document_reference": payload.get("document_reference"),
                "confidence":         payload.get("confidence"),
                "gaps_detected":      payload.get("gaps_detected") or [],
            },
            "cost_lines": CostLineSerializer(fresh, many=True).data,
        })

    # ── Notas (ledger JSONB) ─────────────────────────────────────
    # POST   /api/transferencias/{id}/notes/
    #        body: { text: "..." }                → agrega
    # DELETE /api/transferencias/{id}/notes/{note_id}/  → elimina por id
    @action(detail=True, methods=["get", "post"], url_path="notes")
    def notes_action(self, request, pk=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)

        if request.method.upper() == "GET":
            return Response({"notes_log": t.notes_log or []})

        text = (request.data.get("text") or "").strip()
        if not text:
            return Response({"detail": "Texto vacío."}, status=400)
        new_note = {
            "id":              str(uuid.uuid4()),
            "text":            text[:2000],
            "created_at":      timezone.now().isoformat(),
            "created_by_id":   str(getattr(request.user, "id", "") or ""),
            "created_by_name": (
                getattr(request.user, "full_name", None)
                or getattr(request.user, "email", None)
                or request.data.get("actor_name")
                or ""
            ),
        }
        log_arr = list(t.notes_log or [])
        log_arr.append(new_note)
        Transferencia.objects.filter(pk=t.id).update(notes_log=log_arr)
        return Response({"note": new_note, "notes_log": log_arr}, status=201)

    @action(detail=True, methods=["delete"], url_path=r"notes/(?P<note_id>[^/.]+)")
    def notes_delete(self, request, pk=None, note_id=None):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        log_arr = [n for n in (t.notes_log or []) if n.get("id") != note_id]
        if len(log_arr) == len(t.notes_log or []):
            return Response({"detail": "Nota no encontrada"}, status=404)
        Transferencia.objects.filter(pk=t.id).update(notes_log=log_arr)
        return Response({"notes_log": log_arr})

    # Liquidacion / Landed Cost (sprint Transfer Engine v3)
    # GET  /api/transferencias/{id}/liquidation_report/  preview (no persiste)
    # POST /api/transferencias/{id}/liquidate/           ejecuta y persiste
    @action(detail=True, methods=["get"], url_path="liquidation_report")
    def liquidation_report(self, request, pk=None):
        """Devuelve el reporte (factura interna) sin persistir cambios."""
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        report = liquidation_engine.calcular_liquidacion(t, persist=False)
        return Response(report)

    @action(detail=True, methods=["post"], url_path="liquidate")
    def liquidate(self, request, pk=None):
        """Ejecuta el calculo de Landed Cost y persiste por linea."""
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        method = (request.data.get("method") or "BY_VALUE").upper()
        if method not in ("BY_VALUE", "BY_QUANTITY", "BY_VOLUME"):
            return Response({"detail": f"method invalido: {method}"}, status=400)
        Transferencia.objects.filter(pk=t.id).update(liquidation_method=method)
        t.refresh_from_db()

        actor_id = request.data.get("actor_id") or (
            getattr(request.user, "id", None) if request.user else None
        )
        actor_name = request.data.get("actor_name") or (
            getattr(request.user, "full_name", "") or
            getattr(request.user, "username", "") or
            getattr(request.user, "email", "")
        )
        try:
            report = liquidation_engine.calcular_liquidacion(
                t, persist=True,
                actor_id=actor_id, actor_name=actor_name,
            )
        except Exception as e:
            log.exception("[liquidate] error transfer=%s", pk)
            return Response({"detail": f"{type(e).__name__}: {e}"}, status=500)

        landed = report["summary"]["landed_total_usd"]
        Evento.objects.create(
            id               = uuid.uuid4(),
            transferencia_id = t.id,
            estado_prev      = t.estado,
            estado_nuevo     = t.estado,
            actor_id         = actor_id,
            actor_name       = (actor_name or "")[:128],
            notes            = "Liquidacion ejecutada (method=%s, landed_total=$%.2f)." % (method, landed),
        )
        return Response(report, status=200)

    @action(detail=False, methods=["get"])
    def select_transiciones(self, request):
        """Devuelve el grafo completo de transiciones activas."""
        qs = TransicionCat.objects.filter(is_active=True).order_by("orden")
        return Response([
            {
                "estado_from":    t.estado_from,
                "estado_to":      t.estado_to,
                "needs_approval": t.needs_approval,
                "legal_context":  t.legal_context,
                "descripcion":    t.descripcion,
            }
            for t in qs
        ])

    # ── KPIs ──────────────────────────────────────────
    @action(detail=False, methods=["get"])
    def kpis(self, request):
        out = {
            "total": 0, "planned": 0, "approved": 0,
            "in_transit": 0, "received": 0, "reconciled": 0,
            "cancelled": 0, "closed": 0,
            "needs_approval": 0, "discrepancies_active": 0,
            "value_usd_active": 0.0,
        }
        with connection.cursor() as c:
            try:
                c.execute("""
                    SELECT
                      COUNT(*),
                      COUNT(*) FILTER (WHERE estado = 'PLANNED'),
                      COUNT(*) FILTER (WHERE estado = 'APPROVED'),
                      COUNT(*) FILTER (WHERE estado = 'IN_TRANSIT'),
                      COUNT(*) FILTER (WHERE estado = 'RECEIVED'),
                      COUNT(*) FILTER (WHERE estado = 'RECONCILED'),
                      COUNT(*) FILTER (WHERE estado = 'CANCELLED'),
                      COUNT(*) FILTER (WHERE estado = 'CLOSED'),
                      COUNT(*) FILTER (WHERE needs_approval = TRUE AND estado = 'PLANNED'),
                      COUNT(*) FILTER (WHERE has_discrepancy = TRUE AND estado <> 'CLOSED'),
                      COALESCE(SUM(value_usd) FILTER (WHERE estado NOT IN ('CANCELLED','CLOSED')), 0)
                    FROM transfers.transferencia
                    WHERE is_active = TRUE
                """)
                r = c.fetchone()
                out = {
                    "total":                r[0],
                    "planned":              r[1],
                    "approved":             r[2],
                    "in_transit":           r[3],
                    "received":             r[4],
                    "reconciled":           r[5],
                    "cancelled":            r[6],
                    "closed":               r[7],
                    "needs_approval":       r[8],
                    "discrepancies_active": r[9],
                    "value_usd_active":     float(r[10]),
                }
            except Exception:
                pass
        return Response(out)

    # ── Approve / Dispatch / Receive / Reconcile / Close ─
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self._transition(request, pk, "APPROVED", "Aprobada")

    # ⚠️ NO renombrar a `dispatch`: shadow del método core de DRF
    # (View.dispatch) → rompe TODO el ViewSet con AssertionError
    # ".accepted_renderer not set on Response" → HTTP 500 mudo.
    # Mantener `url_path="dispatch"` para compatibilidad con el frontend.
    @action(detail=True, methods=["post"], url_path="dispatch")
    def mark_dispatched(self, request, pk=None):
        resp = self._transition(request, pk, "IN_TRANSIT", "Despachada")
        # Side-effect en stock: descontar del nodo origen.
        if resp.status_code == 200:
            try:
                t = _resolve_trf(pk)
                lineas = list(Linea.objects.filter(transferencia_id=t.id, is_active=True))
                transfer_services.apply_outbound_at_origin(t, lineas)
            except Exception:
                log.exception("[mark_dispatched] efecto stock falló transfer=%s", pk)
        return resp

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        """
        Cierra recepción, recalcula discrepancias por línea y setea el estado.
        Body opcional:
          { lineas: [{id, qty_received}], actor_id, actor_name, idempotence_token }
        """
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)

        body           = request.data or {}
        lineas_payload = {str(x.get("id")): x for x in (body.get("lineas") or []) if x.get("id")}

        with transaction.atomic():
            discrepancy_count = 0
            for l in Linea.objects.filter(transferencia_id=t.id, is_active=True):
                patch = lineas_payload.get(str(l.id))
                if patch and "qty_received" in patch:
                    try:
                        l.qty_received = int(patch.get("qty_received"))
                    except Exception:
                        pass
                estado_disc = _recompute_line_discrepancy(l)
                Linea.objects.filter(pk=l.id).update(
                    qty_received        = l.qty_received,
                    estado_discrepancia = estado_disc,
                )
                if estado_disc in ("OVER", "UNDER"):
                    discrepancy_count += 1

            nuevo_estado = "DISCREPANCY" if discrepancy_count > 0 else "RECEIVED"
            if not _validate_transition(t.estado, nuevo_estado, t.legal_context):
                # si la transición real no es legal, se deja en RECEIVED para permitir conciliación
                nuevo_estado = "RECEIVED"

            Transferencia.objects.filter(pk=t.id).update(
                estado            = nuevo_estado,
                received_at       = body.get("received_at") or timezone.now().date(),
                received_by_id    = body.get("received_by_id"),
                received_by_name  = body.get("received_by_name"),
                discrepancy_count = discrepancy_count,
            )
            Evento.objects.create(
                id                = uuid.uuid4(),
                transferencia_id  = t.id,
                estado_prev       = t.estado,
                estado_nuevo      = nuevo_estado,
                actor_id          = body.get("actor_id") or body.get("received_by_id"),
                actor_name        = body.get("actor_name") or body.get("received_by_name"),
                notes             = body.get("notes") or f"Recepción ({discrepancy_count} discrepancias)",
                idempotence_token = body.get("idempotence_token"),
            )

        # Side-effect en stock: sumar al destino + cerrar en_tránsito en origen.
        try:
            t.refresh_from_db()
            lineas = list(Linea.objects.filter(transferencia_id=t.id, is_active=True))
            transfer_services.apply_inbound_at_destination(t, lineas)
        except Exception:
            log.exception("[receive] efecto stock falló transfer=%s", t.id)

        t.refresh_from_db()
        return Response(TransferenciaSerializer(t).data)

    @action(detail=True, methods=["post"], url_path="apply-to-stock")
    def apply_to_stock(self, request, pk=None):
        """
        Endpoint de mantenimiento: re-aplica los efectos de stock para una
        transferencia que ya pasó por sus estados sin haber actualizado
        inventario.stock (caso de transferencias creadas antes de que el
        side-effect estuviera implementado, o tras una excepción silenciosa).

        Es idempotente — si los movimientos ya existen, no duplica.
        """
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)

        lineas = list(Linea.objects.filter(transferencia_id=t.id, is_active=True))
        out_count = 0
        in_count  = 0

        # Outbound aplica si pasó por IN_TRANSIT alguna vez (o ya está más adelante)
        if t.estado in ("IN_TRANSIT", "RECEIVED", "DISCREPANCY", "RECONCILED", "CLOSED"):
            out_count = transfer_services.apply_outbound_at_origin(t, lineas)

        # Inbound aplica si ya fue recibida
        if t.estado in ("RECEIVED", "DISCREPANCY", "RECONCILED", "CLOSED"):
            in_count = transfer_services.apply_inbound_at_destination(t, lineas)

        return Response({
            "transferencia_id": str(t.id),
            "codigo":           t.codigo,
            "estado":           t.estado,
            "outbound_lineas_aplicadas": out_count,
            "inbound_lineas_aplicadas":  in_count,
            "detail": ("Efectos aplicados (idempotente: 0 = ya estaba al día)."),
        })

    @action(detail=True, methods=["post"])
    def reconcile(self, request, pk=None):
        """
        Firma la conciliación. Requiere reconciled_by_id si hay discrepancias.
        Body: { reconciled_by_id, reconciled_by_name, reconciled_note,
                actor_id, actor_name, idempotence_token }
        """
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)

        body = request.data or {}
        if t.has_discrepancy and not body.get("reconciled_by_id"):
            return Response(
                {"detail": "reconciled_by_id requerido cuando hay discrepancias"},
                status=400,
            )
        # Sprint v4 — REGLA DURA: si hay gap contable (has_discrepancy),
        # se exige exception_document_id o crear documento inline + gap_justification.
        if t.has_discrepancy:
            exc_doc_id = body.get("exception_document_id") or t.exception_document_id
            gap_just   = (body.get("gap_justification") or "").strip()
            if not exc_doc_id and not gap_just:
                return Response(
                    {"detail":
                        "Gap contable detectado. Para reconciliar, adjuntá un acta "
                        "de excepción (exception_document_id) o registrá una "
                        "justificación (gap_justification).",
                     "code": "EXCEPTION_DOC_REQUIRED",
                     "discrepancy_count": int(t.discrepancy_count or 0)},
                    status=409,
                )
            # Si vino justificación pero no doc, persistimos solo la justif.
        if not _validate_transition(t.estado, "RECONCILED", t.legal_context):
            return Response(
                {"detail": f"Transición ilegal: {t.estado} → RECONCILED"},
                status=400,
            )

        with transaction.atomic():
            Transferencia.objects.filter(pk=t.id).update(
                estado                = "RECONCILED",
                reconciled_by_id      = body.get("reconciled_by_id"),
                reconciled_by_name    = body.get("reconciled_by_name"),
                reconciled_at         = timezone.now(),
                reconciled_note       = body.get("reconciled_note"),
                exception_document_id = body.get("exception_document_id") or t.exception_document_id,
                gap_justification     = body.get("gap_justification") or t.gap_justification,
            )
            Evento.objects.create(
                id                = uuid.uuid4(),
                transferencia_id  = t.id,
                estado_prev       = t.estado,
                estado_nuevo      = "RECONCILED",
                actor_id          = body.get("actor_id") or body.get("reconciled_by_id"),
                actor_name        = body.get("actor_name") or body.get("reconciled_by_name"),
                notes             = body.get("notes") or body.get("reconciled_note") or "Conciliada",
                idempotence_token = body.get("idempotence_token"),
            )

        t.refresh_from_db()
        return Response(TransferenciaSerializer(t).data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        return self._transition(request, pk, "CLOSED", "Cerrada (read-only)")

    # Sprint v4 — advance unificado: ejecuta la siguiente transición segun estado.
    @action(detail=True, methods=["post"], url_path="advance")
    def advance(self, request, pk=None):
        """Wrapper que despacha a la transicion correcta segun el estado actual.
        Body: { actor_id, actor_name, ...payload de la transicion correspondiente }
        """
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        st = (t.estado or "").upper()
        if st == "PLANNED":
            return self.approve(request, pk)
        if st == "APPROVED":
            return self.mark_dispatched(request, pk)
        if st == "IN_TRANSIT":
            return self.receive(request, pk)
        if st == "RECEIVED":
            return self.reconcile(request, pk)
        if st == "RECONCILED":
            return self.close(request, pk)
        return Response(
            {"detail": f"Estado {st} no admite avance automatico."},
            status=400,
        )

    # Sprint v4 — payload JSON de factura/remision para PDF en frontend.
    @action(detail=True, methods=["get"], url_path="invoice_payload")
    def invoice_payload(self, request, pk=None):
        """Devuelve JSON estructurado para renderizar la factura/remision."""
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        try:
            report = liquidation_engine.calcular_liquidacion(t, persist=False)
        except Exception:
            report = None
        is_dist = (t.legal_context or "").upper() == "DISTRIBUTION"
        ctx = t.context_data or {}
        tp_amount = float(ctx.get("transfer_pricing_amount") or 0)
        tp_currency = ctx.get("transfer_pricing_currency") or "USD"

        lineas = list(Linea.objects.filter(transferencia_id=t.id, is_active=True).order_by("created_at"))
        # Sprint 2026-06-01 · Factura/Remisión por audiencia. Resolvemos el
        # precio congelado por línea (MWT vs Cliente) + operating_company del
        # expediente, para que el FE pueda emitir el documento al destinatario
        # correcto con el precio correcto.
        line_pricing = _resolve_line_pricing(t, lineas)
        from apps.core.constants import MWT_OPERATING_CLIENT_ID as _MWT_OC_ID
        _op_ids = {
            (line_pricing.get(str(l.id), {}) or {}).get("operating_company_id")
            for l in lineas
        }
        _op_ids.discard(None)
        # operated_by_mwt: TODAS las líneas con operating_company resuelto
        # pertenecen al operador MWT. Si no se pudo resolver, default False.
        operated_by_mwt = bool(_op_ids) and all(
            str(x).lower() == str(_MWT_OC_ID).lower() for x in _op_ids
        )
        operating_company_id = next(iter(_op_ids), None) if _op_ids else None
        operating_company_label = (
            "Muito Work Limitada" if operated_by_mwt else "Cliente final"
        )
        # proforma_codigo (MWT) + oc_codigo (cliente) para el nombre del
        # archivo de la factura generada en el FE.
        _pf_codigo = next(
            (v.get("proforma_codigo") for v in line_pricing.values() if v.get("proforma_codigo")),
            None,
        )
        _exp_ids_ref = sorted({
            v.get("expediente_id") for v in line_pricing.values() if v.get("expediente_id")
        })
        _oc_codigo = None
        if _exp_ids_ref:
            try:
                from django.db import connection as _conn_ref
                with _conn_ref.cursor() as c:
                    c.execute(
                        r"""
                        SELECT codigo FROM expedientes.documento
                        WHERE expediente_id = ANY(%(ids)s::uuid[])
                          AND kind ~* '^OC(\s|_|$)'
                          AND is_active = TRUE AND codigo IS NOT NULL AND codigo <> ''
                        ORDER BY (audience = 'CLIENT') DESC, created_at DESC LIMIT 1
                        """,
                        {"ids": _exp_ids_ref},
                    )
                    r = c.fetchone()
                    if r:
                        _oc_codigo = r[0]
                    if not _oc_codigo:
                        c.execute(
                            """
                            SELECT o.codigo FROM expedientes.oc o
                            JOIN expedientes.expediente e ON e.oc_id = o.id
                            WHERE e.id = ANY(%(ids)s::uuid[]) AND o.is_active = TRUE
                              AND o.codigo IS NOT NULL AND o.codigo <> '' LIMIT 1
                            """,
                            {"ids": _exp_ids_ref},
                        )
                        r = c.fetchone()
                        if r:
                            _oc_codigo = r[0]
            except Exception:
                log.exception("[invoice_payload] proforma/oc ref lookup failed trf=%s", t.id)
        # Metadata de envío (AWB/BL) y empaque (Packing) desde builder-artifacts.
        try:
            from apps.expedientes.shipping_meta import resolve_shipping_packing
            _ship_pack = resolve_shipping_packing(_exp_ids_ref)
        except Exception:
            log.exception("[invoice_payload] shipping/packing resolve failed trf=%s", t.id)
            _ship_pack = {"shipping": {}, "packing": {}}
        # NCM por producto (productos.producto.especificaciones->>'ncm') para
        # impuestos dinámicos de nacionalización en la factura (Sprint 2026-06-01).
        ncm_map = {}
        try:
            prod_ids = list({str(l.producto_id) for l in lineas if l.producto_id})
            if prod_ids:
                from django.db import connection as _conn
                with _conn.cursor() as c:
                    c.execute(
                        "SELECT id, especificaciones->>'ncm' "
                        "FROM productos.producto WHERE id = ANY(%s::uuid[])",
                        [prod_ids],
                    )
                    for r in c.fetchall():
                        ncm_map[str(r[0])] = r[1]
        except Exception:
            log.exception("[invoice_payload] ncm lookup failed trf=%s", t.id)
        cost_lines = list(CostLine.objects.filter(transferencia_id=t.id, is_active=True).order_by("kind"))
        documentos = list(TransferenciaDocumento.objects.filter(transferencia_id=t.id, is_active=True))
        eventos = list(Evento.objects.filter(transferencia_id=t.id).order_by("-created_at")[:30])

        def doc_brief(d):
            if not d:
                return None
            return {
                "id": str(d.id),
                "tipo": d.tipo,
                "titulo": d.titulo,
                "numero_ref": d.numero_ref,
                "fecha_emision": d.fecha_emision.isoformat() if d.fecha_emision else None,
            }
        def find_doc(uid):
            for d in documentos:
                if str(d.id) == str(uid): return d
            return None

        return Response({
            "kind": "FACTURA_INTERNA" if is_dist else "REMISION_INTERNA",
            "transferencia": {
                "id":            str(t.id),
                "codigo":        t.codigo,
                "legal_context": t.legal_context,
                "estado":        t.estado,
                "ref_tracking":  t.ref_tracking,
                "value_usd":     float(t.value_usd or 0),
                "total_cost_usd": float(t.total_cost_usd or 0),
                "context_data":  ctx,
            },
            "origen": {
                "id":    str(t.origen_id) if t.origen_id else None,
                "label": t.origen_label or "",
            },
            "destino": {
                "id":    str(t.destino_id) if t.destino_id else None,
                "label": t.destino_label or "",
            },
            "fechas": {
                "created_at":     t.created_at.isoformat() if t.created_at else None,
                "approved_at":    t.approved_at.isoformat() if t.approved_at else None,
                "dispatched_at":  t.dispatched_at.isoformat() if t.dispatched_at else None,
                "received_at":    t.received_at.isoformat() if t.received_at else None,
                "reconciled_at":  t.reconciled_at.isoformat() if t.reconciled_at else None,
                "liquidated_at":  t.liquidated_at.isoformat() if t.liquidated_at else None,
            },
            "personas": {
                "created_by_name":    t.created_by_name or "",
                "approved_by_name":   t.approved_by_name or "",
                "received_by_name":   t.received_by_name or "",
                "reconciled_by_name": t.reconciled_by_name or "",
            },
            "documentos": {
                "factura":        doc_brief(next((d for d in documentos if d.tipo == "FACTURA"), None)),
                "dua":            doc_brief(find_doc(t.dua_document_id) or next((d for d in documentos if d.tipo == "DUA"), None)),
                "bl_awb":         doc_brief(find_doc(t.awb_document_id) or next((d for d in documentos if d.tipo in ("BL","AWB")), None)),
                "remision":       doc_brief(next((d for d in documentos if d.tipo == "REMISION"), None)),
                "despacho":       doc_brief(find_doc(t.dispatch_document_id) or next((d for d in documentos if d.tipo == "DESPACHO"), None)),
                "acta_recepcion": doc_brief(find_doc(t.receipt_document_id) or next((d for d in documentos if d.tipo == "ACTA_RECEPCION"), None)),
                "excepcion":      doc_brief(find_doc(t.exception_document_id) or next((d for d in documentos if d.tipo == "EXCEPCION"), None)),
            },
            "transfer_pricing": {
                "applies":  is_dist and tp_amount > 0,
                "amount":   tp_amount,
                "currency": tp_currency,
                "basis":    ctx.get("transfer_pricing_basis") or "PER_UNIT",
                "requires_tp_approval": bool(ctx.get("requires_tp_approval")),
            },
            "operating_company": {
                "operated_by_mwt":         operated_by_mwt,
                "operating_company_id":    operating_company_id,
                "operating_company_label": operating_company_label,
                "mwt_operating_client_id": str(_MWT_OC_ID),
                "mwt_operator_name":       "Muito Work Limitada",
            },
            "proforma_codigo": _pf_codigo,
            "oc_codigo":       _oc_codigo or _pf_codigo,
            "shipping":        _ship_pack.get("shipping") or {},
            "packing":         _ship_pack.get("packing") or {},
            "lineas": [dict({
                "sku":              l.sku or "",
                "product_label":    l.product_label or "",
                "size":             l.size or "",
                "producto_id":      str(l.producto_id) if l.producto_id else None,
                "qty_planned":      int(l.qty_transfer or 0),
                "qty_dispatched":   int(l.qty_dispatched) if l.qty_dispatched is not None else None,
                "qty_received":     int(l.qty_received) if l.qty_received is not None else None,
                "unit_value_usd":   float(l.unit_value or 0),
                "unit_cost_usd":    float(l.unit_cost or 0),
                "cost_share_usd":   float(l.cost_share_usd) if l.cost_share_usd is not None else 0.0,
                "landed_cost_usd":  float(l.landed_cost_usd) if l.landed_cost_usd is not None else None,
                "estado_discrepancia": l.estado_discrepancia,
                "tp_unit_amount":   tp_amount if is_dist and (ctx.get("transfer_pricing_basis") == "PER_UNIT") else None,
                # Precios congelados por audiencia (Sprint 2026-06-01).
                "unit_price_mwt":    (line_pricing.get(str(l.id), {}) or {}).get("unit_price_mwt"),
                "unit_price_client": (line_pricing.get(str(l.id), {}) or {}).get("unit_price_client"),
                "operating_company_id": (line_pricing.get(str(l.id), {}) or {}).get("operating_company_id"),
                "expediente_codigo": (line_pricing.get(str(l.id), {}) or {}).get("expediente_codigo"),
                "proforma_codigo":   (line_pricing.get(str(l.id), {}) or {}).get("proforma_codigo"),
                "ncm":               ncm_map.get(str(l.producto_id)) if l.producto_id else None,
            }) for l in lineas],
            "cost_breakdown": [{
                "kind":       c.kind,
                "label":      c.label or "",
                "amount":     float(c.amount or 0),
                "currency":   c.currency,
                "fx_to_usd":  float(c.fx_to_usd or 1),
                "amount_usd": float(c.amount_usd or 0),
                "source":     c.source,
            } for c in cost_lines],
            "totales": {
                "fob_total_usd":         report["summary"]["fob_total_usd"]   if report else 0.0,
                "extra_costs_total_usd": report["summary"]["extra_costs_total_usd"] if report else 0.0,
                "landed_total_usd":      report["summary"]["landed_total_usd"] if report else 0.0,
                "avg_landed_per_unit_usd": report["summary"]["avg_landed_per_unit_usd"] if report else 0.0,
                "units_total":           report["summary"]["units_total"]    if report else sum(int(l.qty_transfer or 0) for l in lineas),
                "lines_count":           len(lineas),
            },
            "audit_trail": [{
                "estado_prev":  e.estado_prev,
                "estado_nuevo": e.estado_nuevo,
                "actor_name":   e.actor_name or "",
                "notes":        e.notes or "",
                "created_at":   e.created_at.isoformat() if e.created_at else None,
            } for e in eventos],
            "gap_info": {
                "has_discrepancy":      bool(t.has_discrepancy),
                "discrepancy_count":    int(t.discrepancy_count or 0),
                "exception_document":   doc_brief(find_doc(t.exception_document_id)),
                "gap_justification":    t.gap_justification or "",
            },
        })

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        # Sprint 2026-05-14 · Fase 11 — al cancelar revertimos también
        # las asignaciones de inventario que la transferencia movió. Si
        # no se revierte, el stock queda fantasma en el nodo destino y
        # el origen pierde unidades que nunca llegaron al destino.
        # La reversión se ejecuta DESPUÉS del cambio de estado para que
        # el evento de audit se cree primero. Si la reversión falla,
        # logueamos pero NO rolleamos el cancel — el operador puede
        # ajustar manualmente desde /nodos/{id}.
        resp = self._transition(request, pk, "CANCELLED", "Cancelada")
        if 200 <= resp.status_code < 300:
            try:
                self._revert_assignments_for_cancel(pk)
            except Exception:
                log.exception("cancel · revert assignments failed for trf=%s", pk)
        return resp

    def _revert_assignments_for_cancel(self, trf_id):
        """Revierte las asignaciones creadas por POST /transfer/.

        Estrategia:
          1) Encontrar las filas activas en destino con transferencia_id
             = trf_id. Cada una representa qty que se movió.
          2) Encontrar las filas residuales activas en origen con la
             misma transferencia_id (las que creamos cuando el split
             era parcial). Estas representan lo que QUEDÓ en origen
             después del split, no algo a revertir — pero su existencia
             nos dice que hubo split.
          3) Para cada (exp, prod, talla) movida:
             a) soft-delete fila destino
             b) si había residual en origen, soft-delete la residual
             c) crear UNA fila en origen con qty_total = destino + residual
                (= qty original antes de transferir)

        Esto recompone el estado pre-transferencia atómicamente. El
        audit trail queda intacto porque NO borramos físicamente — sólo
        marcamos is_active=FALSE; los SUM() de saldo activo cuadran.
        """
        from django.db import transaction as _tx
        from django.db.models import Q, Sum
        from apps.inventario.models import ExpedienteNodoAssignment

        try:
            t = _resolve_trf(trf_id)
        except Transferencia.DoesNotExist:
            return
        origen_id  = t.origen_id
        destino_id = t.destino_id
        if not origen_id or not destino_id:
            return

        with _tx.atomic():
            # Filas creadas por esta transferencia, agrupadas por
            # (exp, prod, talla) sumando qty por nodo (destino y origen
            # residual).
            destino_qs = ExpedienteNodoAssignment.objects.filter(
                is_active=True,
                transferencia_id=trf_id,
                nodo_id=destino_id,
            )
            origen_residual_qs = ExpedienteNodoAssignment.objects.filter(
                is_active=True,
                transferencia_id=trf_id,
                nodo_id=origen_id,
            )
            # Acumulamos qty por clave (exp, prod, talla) considerando
            # destino + residual = qty original antes del split.
            agg = {}  # key = (exp, prod, talla_norm) → int
            for row in destino_qs.values(
                "expediente_id", "producto_id", "talla", "qty_asignada"
            ):
                k = (row["expediente_id"], row["producto_id"],
                     row["talla"] or "")
                agg[k] = agg.get(k, 0) + int(row["qty_asignada"] or 0)
            for row in origen_residual_qs.values(
                "expediente_id", "producto_id", "talla", "qty_asignada"
            ):
                k = (row["expediente_id"], row["producto_id"],
                     row["talla"] or "")
                agg[k] = agg.get(k, 0) + int(row["qty_asignada"] or 0)

            # Soft-delete TODAS las filas creadas por la transferencia
            # (tanto destino como residual).
            destino_qs.update(is_active=False)
            origen_residual_qs.update(is_active=False)

            # Re-crear en origen la cantidad original consolidada.
            uploader = None
            for (exp_id, prod_id, talla), qty in agg.items():
                if qty <= 0:
                    continue
                ExpedienteNodoAssignment.objects.create(
                    id=uuid.uuid4(),
                    expediente_id=exp_id,
                    producto_id=prod_id,
                    talla=(talla or None),
                    nodo_id=origen_id,
                    qty_asignada=qty,
                    recepcion_id=None,
                    transferencia_id=trf_id,   # marca para audit
                    notas=f"revert-cancel from {trf_id}",
                    created_by_id=uploader,
                    is_active=True,
                )

    def _transition(self, request, pk, nuevo_estado, note):
        try:
            t = _resolve_trf(pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)

        if not _validate_transition(t.estado, nuevo_estado, t.legal_context):
            return Response(
                {"detail": f"Transición ilegal: {t.estado} → {nuevo_estado}"},
                status=400,
            )

        body = request.data or {}
        token = body.get("idempotence_token")
        if token:
            # Evento es append-only: sin is_active (ver Evento docstring)
            prev = Evento.objects.filter(idempotence_token=token).first()
            if prev:
                t.refresh_from_db()
                return Response(TransferenciaSerializer(t).data, status=200)

        prev_estado = t.estado
        with transaction.atomic():
            Transferencia.objects.filter(pk=t.id).update(estado=nuevo_estado)
            Evento.objects.create(
                id                = uuid.uuid4(),
                transferencia_id  = t.id,
                estado_prev       = prev_estado,
                estado_nuevo      = nuevo_estado,
                actor_id          = body.get("actor_id"),
                actor_name        = body.get("actor_name"),
                notes             = body.get("notes") or note,
                idempotence_token = token,
            )
        t.refresh_from_db()
        return Response(TransferenciaSerializer(t).data)

    # ── Documentos anidados ────────────────────────────
    @action(detail=True, methods=["get", "post"], url_path="documentos")
    def documentos(self, request, pk=None):
        if request.method == "GET":
            qs = TransferenciaDocumento.objects.filter(
                transferencia_id=pk, is_active=True,
            ).order_by("-created_at")
            return Response(TransferenciaDocumentoSerializer(qs, many=True).data)
        # POST
        data = {**request.data, "transferencia_id": pk}
        s = TransferenciaDocumentoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    @action(detail=True, methods=["delete"], url_path=r"documentos/(?P<doc_id>[^/.]+)")
    def documentos_delete(self, request, pk=None, doc_id=None):
        TransferenciaDocumento.objects.filter(
            pk=doc_id, transferencia_id=pk,
        ).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Línea
# ════════════════════════════════════════════════════════════
class LineaViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Linea.objects.filter(is_active=True).order_by("-created_at")
        tid = request.query_params.get("transferencia")
        if tid:
            qs = qs.filter(transferencia_id=tid)
        sku = request.query_params.get("sku")
        if sku:
            qs = qs.filter(sku__icontains=sku)
        disc = request.query_params.get("con_discrepancia")
        if disc in ("1", "true", "True"):
            qs = qs.exclude(estado_discrepancia__in=("OK", "WITHIN_TOLERANCE"))
        return Response(LineaSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            l = Linea.objects.get(pk=pk, is_active=True)
        except Linea.DoesNotExist:
            return Response({"detail": "Línea no existe"}, status=404)
        return Response(LineaSerializer(l).data)

    def create(self, request):
        data = {**request.data}
        # Snapshot de costo al crear
        if not data.get("snapshot_unit_cost") and data.get("unit_cost"):
            data["snapshot_unit_cost"]  = data["unit_cost"]
            data["snapshot_created_at"] = timezone.now().isoformat()
        s = LineaSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            l = Linea.objects.get(pk=pk)
        except Linea.DoesNotExist:
            return Response({"detail": "Línea no existe"}, status=404)
        s = LineaSerializer(l, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        # Recalcular discrepancia si se actualizó qty_received
        if "qty_received" in request.data:
            l.refresh_from_db()
            estado_disc = _recompute_line_discrepancy(l)
            Linea.objects.filter(pk=pk).update(estado_discrepancia=estado_disc)
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        Linea.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Evento (audit trail — read-only + create)
# ════════════════════════════════════════════════════════════
class EventoViewSet(viewsets.ViewSet):
    # Evento es append-only: la tabla NO tiene columna is_active
    # (ver apps.transfers.models.Evento docstring + 91_transfers_audit.sql §6).
    def list(self, request):
        qs = Evento.objects.all().order_by("-created_at")
        tid = request.query_params.get("transferencia")
        if tid:
            qs = qs.filter(transferencia_id=tid)
        return Response(EventoSerializer(qs, many=True).data)

    def create(self, request):
        data = {**request.data}
        token = data.get("idempotence_token")
        if token:
            prev = Evento.objects.filter(idempotence_token=token).first()
            if prev:
                return Response(EventoSerializer(prev).data, status=200)
        s = EventoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)


# ════════════════════════════════════════════════════════════
# Documento de transporte (genérico)
# ════════════════════════════════════════════════════════════
class TransferenciaDocumentoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = TransferenciaDocumento.objects.filter(is_active=True).order_by("-created_at")
        tid = request.query_params.get("transferencia")
        if tid:
            qs = qs.filter(transferencia_id=tid)
        tipo = request.query_params.get("tipo")
        if tipo:
            qs = qs.filter(tipo=tipo)
        return Response(TransferenciaDocumentoSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            d = TransferenciaDocumento.objects.get(pk=pk, is_active=True)
        except TransferenciaDocumento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)
        return Response(TransferenciaDocumentoSerializer(d).data)

    def create(self, request):
        s = TransferenciaDocumentoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        s.save(id=uuid.uuid4())   # bypass read_only_fields=("id",)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            d = TransferenciaDocumento.objects.get(pk=pk)
        except TransferenciaDocumento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)
        s = TransferenciaDocumentoSerializer(d, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    partial_update = update

    def destroy(self, request, pk=None):
        try:
            instance = TransferenciaDocumento.objects.get(pk=pk)
        except TransferenciaDocumento.DoesNotExist:
            return Response(status=204)
        # Capturar TODAS las keys ANTES del save/delete
        # object_key vive en el bucket explícito; url es legacy/derivado
        bucket = instance.bucket
        keys = [
            instance.object_key,
            instance.url,
        ]
        keys = [k for k in keys if k]

        with transaction.atomic():
            TransferenciaDocumento.objects.filter(pk=pk).update(is_active=False)
            # ON COMMIT: solo si la transacción de BD se confirma, borramos
            # el objeto del bucket. Evita huérfanos en caso de rollback.
            for k in keys:
                transaction.on_commit(lambda key=k, b=bucket: _storage_delete(key, bucket=b))

        return Response(status=204)
