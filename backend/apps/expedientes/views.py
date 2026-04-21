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
import json
import logging
import uuid
from datetime import date, datetime
from decimal import Decimal

from django.db import connection, transaction
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

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


# ════════════════════════════════════════════════════════════
# OC
# ════════════════════════════════════════════════════════════
class OcViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Oc.objects.filter(is_active=True).order_by("-issued_at", "-created_at")
        mapping = {
            "client":  "client_id",
            "brand":   "brand_id",
            "estado":  "estado",
            "moneda":  "moneda",
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
        try:
            o = Oc.objects.get(pk=pk, is_active=True)
        except Oc.DoesNotExist:
            return Response({"detail": "OC no existe"}, status=404)
        return Response(OcSerializer(o).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = OcSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
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
        return Response(ExpedienteListSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            e = Expediente.objects.get(pk=pk, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe"}, status=404)
        return Response(ExpedienteSerializer(e).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = ExpedienteSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
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
        Expediente.objects.filter(pk=pk).update(is_active=False)
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

        correlation_id = uuid.uuid4()
        artifact_id    = uuid.uuid4()

        # ── Subir PDF a storage (best-effort) ────────────
        storage_url = None
        paperless_task_id = None
        file_size_bytes = 0
        file_ext = None
        if documento_file:
            file_bytes = b"".join(chunk for chunk in documento_file.chunks())
            file_size_bytes = len(file_bytes)
            file_ext = (documento_file.name or "").rsplit(".", 1)[-1].lower() if "." in (documento_file.name or "") else None

            # Paperless-ngx ingest (OCR + archivo inmutable)
            try:
                from apps.storage.services import paperless_ingest, generate_signed_url
                p = paperless_ingest(
                    file_bytes=file_bytes,
                    filename=documento_file.name or f"ART-04_{exp.codigo}.pdf",
                    title=f"ART-04 · Confirmación SAP · {exp.codigo}",
                    document_type="Confirmación SAP",
                    tags=["ART-04", "SAP", "C5"],
                )
                paperless_task_id = p.get("task_id")
            except Exception as e:
                log.warning("paperless_ingest (ART-04) falló: %s", e)

            # Signed URL para ver el doc (MinIO)
            try:
                key = f"expedientes/{exp.id}/art-04-{artifact_id}.{file_ext or 'pdf'}"
                signed = generate_signed_url(key=key, kind="get", ttl=3600)
                storage_url = signed.get("url")
            except Exception:
                pass

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
                    c.execute("""
                        INSERT INTO expedientes.artifact_instances (
                            id, expediente_id, oc_id,
                            artifact_code, kind, codigo,
                            file_ext, file_size_bytes, storage_url, paperless_doc_id,
                            ocr_status, ocr_engine, ocr_confidence, ocr_payload,
                            action_source, correlation_id,
                            author, fecha, visibility_tier, is_active
                        ) VALUES (
                            %s, %s, %s,
                            'ART-04', 'Confirmación SAP', %s,
                            %s, %s, %s, %s,
                            'DONE', 'manual-upload', 1.0, %s::jsonb,
                            'C5', %s,
                            %s, %s, 'INTERNAL', TRUE
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

                    # 2. Actualizar líneas confirmadas (split/match)
                    #    Cada item: {linea_id, qty_confirmada}
                    delta_lines = []
                    for item in lineas_confirmadas:
                        linea_id = item.get("linea_id") or item.get("id")
                        qty_conf = item.get("qty_confirmada")
                        if not linea_id or qty_conf is None:
                            continue
                        try:
                            qty_conf_dec = Decimal(str(qty_conf))
                        except Exception:
                            continue

                        # Leer qty original para computar delta
                        c.execute("""
                            SELECT qty FROM expedientes.linea
                             WHERE id = %s::uuid AND expediente_id = %s::uuid AND is_active = TRUE
                             LIMIT 1
                        """, [linea_id, str(exp.id)])
                        row = c.fetchone()
                        if not row:
                            continue
                        qty_original = Decimal(str(row[0] or 0))

                        if qty_conf_dec != qty_original:
                            delta_lines.append({
                                "linea_id":      linea_id,
                                "qty_original":  float(qty_original),
                                "qty_confirmed": float(qty_conf_dec),
                                "delta":         float(qty_conf_dec - qty_original),
                            })

                        c.execute("""
                            UPDATE expedientes.linea
                               SET qty = %s,
                                   total_price = ROUND(COALESCE(unit_price, 0) * %s, 2),
                                   sap = %s,
                                   estado = CASE WHEN %s > 0 THEN 'SAP_CONFIRMADO' ELSE 'CANCELADA' END
                             WHERE id = %s::uuid
                        """, [
                            float(qty_conf_dec), float(qty_conf_dec), sap_id,
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
        data = {**request.data, "id": str(uuid.uuid4())}
        s = LineaSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
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
        Linea.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)


# ════════════════════════════════════════════════════════════
# Documento
# ════════════════════════════════════════════════════════════
class DocumentoViewSet(viewsets.ViewSet):
    def list(self, request):
        qs = Documento.objects.filter(is_active=True).order_by("-fecha", "-created_at")
        for p, f in (("oc", "oc_id"), ("expediente", "expediente_id"), ("kind", "kind")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        return Response(DocumentoSerializer(qs, many=True).data)

    def retrieve(self, request, pk=None):
        try:
            d = Documento.objects.get(pk=pk, is_active=True)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)
        return Response(DocumentoSerializer(d).data)

    def create(self, request):
        data = {**request.data, "id": str(uuid.uuid4())}
        s = DocumentoSerializer(data=data)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data, status=201)

    def update(self, request, pk=None):
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
        Documento.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    # ── Presigned URL (GET) para ver/descargar el documento ──
    @action(detail=True, methods=["get"])
    def signed_url(self, request, pk=None):
        """Devuelve una URL firmada (TTL 15min por defecto) para el objeto
        asociado al documento. Usa `bucket_key` si existe, o deriva uno
        determinista a partir de expediente_id+id si falta."""
        try:
            d = Documento.objects.get(pk=pk, is_active=True)
        except Documento.DoesNotExist:
            return Response({"detail": "Documento no existe"}, status=404)

        key = getattr(d, "bucket_key", None) or f"expedientes/{d.expediente_id}/{d.id}"
        ttl = int(request.query_params.get("ttl") or 900)

        try:
            from apps.storage.services import generate_signed_url  # noqa: PLC0415
            data = generate_signed_url(key=key, kind="get", ttl=ttl)
        except Exception as e:
            data = {"url": None, "available": False, "error": str(e), "key": key}

        data["documento_id"]  = str(d.id)
        data["expediente_id"] = str(d.expediente_id) if d.expediente_id else None
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
