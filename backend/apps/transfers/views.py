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
)
from .serializers import (
    TransferenciaSerializer, TransferenciaListSerializer,
    LineaSerializer, EventoSerializer, TransferenciaDocumentoSerializer,
)


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
            t = Transferencia.objects.get(pk=pk, is_active=True)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)
        data = TransferenciaSerializer(t).data
        data["lineas"] = LineaSerializer(
            Linea.objects.filter(transferencia_id=t.id, is_active=True), many=True
        ).data
        data["eventos"] = EventoSerializer(
            Evento.objects.filter(transferencia_id=t.id).order_by("-created_at"), many=True
        ).data
        data["documentos"] = TransferenciaDocumentoSerializer(
            TransferenciaDocumento.objects.filter(transferencia_id=t.id, is_active=True),
            many=True,
        ).data
        return Response(data)

    def create(self, request):
        import traceback
        data = {**request.data}
        # Compatibilidad: el FE envió por error `nodo_origen_id`/`nodo_destino_id`
        # antes de mapear a los nombres canónicos. Los normalizamos acá
        # silenciosamente para no romper en transición.
        if "nodo_origen_id"  in data and "origen_id"  not in data:
            data["origen_id"]  = data.pop("nodo_origen_id")
        if "nodo_destino_id" in data and "destino_id" not in data:
            data["destino_id"] = data.pop("nodo_destino_id")

        # has_discrepancy es columna generada en DB — limpiarla del payload
        # si el FE la mandó accidentalmente (vendría con default true/false).
        data.pop("has_discrepancy", None)
        # snapshot_created_at lo seteamos nosotros más abajo, así que sacarlo
        # del payload evita ambigüedad.
        data.pop("snapshot_created_at", None)

        new_id = uuid.uuid4()
        s = TransferenciaSerializer(data=data)
        try:
            s.is_valid(raise_exception=True)
        except Exception as e:
            log.warning("Transferencia.create validation error payload=%s : %s", dict(data), e)
            return Response({"detail": "Validación: " + str(e)}, status=400)

        try:
            with transaction.atomic():
                s.save(id=new_id)   # bypass read_only_fields=("id",)
                # Snapshot timestamp y primer evento
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
        except Exception as e:
            tb = traceback.format_exc()
            log.error("Transferencia.create FAIL payload=%s\nERROR: %s\nTRACE:\n%s",
                      dict(data), e, tb)
            return Response({
                "detail": str(e),
                "type":   type(e).__name__,
                "hint":   "Error al crear la transferencia. Revisar logs del backend.",
            }, status=400)
        return Response(s.data, status=201)

    def update(self, request, pk=None):
        try:
            t = Transferencia.objects.get(pk=pk)
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
        Transferencia.objects.filter(pk=pk).update(is_active=False)
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

    @action(detail=True, methods=["post"])
    def dispatch(self, request, pk=None):
        return self._transition(request, pk, "IN_TRANSIT", "Despachada")

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        """
        Cierra recepción, recalcula discrepancias por línea y setea el estado.
        Body opcional:
          { lineas: [{id, qty_received}], actor_id, actor_name, idempotence_token }
        """
        try:
            t = Transferencia.objects.get(pk=pk)
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

        t.refresh_from_db()
        return Response(TransferenciaSerializer(t).data)

    @action(detail=True, methods=["post"])
    def reconcile(self, request, pk=None):
        """
        Firma la conciliación. Requiere reconciled_by_id si hay discrepancias.
        Body: { reconciled_by_id, reconciled_by_name, reconciled_note,
                actor_id, actor_name, idempotence_token }
        """
        try:
            t = Transferencia.objects.get(pk=pk)
        except Transferencia.DoesNotExist:
            return Response({"detail": "Transferencia no existe"}, status=404)

        body = request.data or {}
        if t.has_discrepancy and not body.get("reconciled_by_id"):
            return Response(
                {"detail": "reconciled_by_id requerido cuando hay discrepancias"},
                status=400,
            )
        if not _validate_transition(t.estado, "RECONCILED", t.legal_context):
            return Response(
                {"detail": f"Transición ilegal: {t.estado} → RECONCILED"},
                status=400,
            )

        with transaction.atomic():
            Transferencia.objects.filter(pk=t.id).update(
                estado             = "RECONCILED",
                reconciled_by_id   = body.get("reconciled_by_id"),
                reconciled_by_name = body.get("reconciled_by_name"),
                reconciled_at      = timezone.now(),
                reconciled_note    = body.get("reconciled_note"),
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

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._transition(request, pk, "CANCELLED", "Cancelada")

    def _transition(self, request, pk, nuevo_estado, note):
        try:
            t = Transferencia.objects.get(pk=pk)
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
            prev = Evento.objects.filter(idempotence_token=token, is_active=True).first()
            if prev:
                t.refresh_from_db()
                return Response(TransferenciaSerializer(t).data, status=200)

        prev_estado = t.estado
        with transaction.atomic():
            Transferencia.objects.filter(pk=pk).update(estado=nuevo_estado)
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
    def list(self, request):
        qs = Evento.objects.filter(is_active=True).order_by("-created_at")
        tid = request.query_params.get("transferencia")
        if tid:
            qs = qs.filter(transferencia_id=tid)
        return Response(EventoSerializer(qs, many=True).data)

    def create(self, request):
        data = {**request.data}
        token = data.get("idempotence_token")
        if token:
            prev = Evento.objects.filter(idempotence_token=token, is_active=True).first()
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
