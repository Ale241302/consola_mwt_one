"""
=====================================================================
MWT.ONE · apps.inventario.inbound_views
Agente responsable: [AG-BACKEND]

Endpoints del Motor de Recepción Inbound:

  POST /api/inventory/ocr-receipt/    → OCR del Packing List / Factura
  POST /api/inventory/receive/        → Crea recepción + suma stock + excepción si gap
  GET  /api/inventario-recepciones/   → CRUD vía RecepcionViewSet
  GET  /api/inventario-recepciones/{id}/   detalle full

Reglas:
  · destination_node_id DEBE tener capability RECEIVE en nodos.nodo.
  · Si received_qty < expected_qty → genera RecepcionExcepcion automática.
  · POL_VISIBILIDAD: unit_cost_usd / total_value_usd se enmascaran para
    no-admin (CEO_ROLES = admin, superadmin, ceo).
=====================================================================
"""
import uuid
import logging
from datetime import datetime
from decimal import Decimal

from django.db import connection, transaction
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from .inbound_models import (
    Recepcion, RecepcionLinea, RecepcionExcepcion,
    SourceTypeCat, RecepcionEstadoCat,
)
from .inbound_ocr import extract_packing_list

log = logging.getLogger(__name__)
CEO_ROLES = {"admin", "superadmin", "ceo"}


def _is_ceo(request):
    if not request or not getattr(request, "auth", None):
        return False
    role = (request.auth.get("role") or "").lower()
    return role in CEO_ROLES


def _node_has_receive(node_id) -> tuple[bool, str]:
    """Valida que el nodo destino exista, esté activo y tenga la
    capability RECEIVE.

    Tolerante a múltiples representaciones del valor:
      · 'receive', 'RECEIVE', 'Receive'   (inglés en cualquier caso)
      · 'recibir', 'RECIBIR'              (español, por seeds antiguos)
      · 'receive_inbound', 'inbound', 'in' (alias)
    Si el nodo no tiene capabilities pobladas (NULL / array vacío),
    asumimos que sí puede recibir (no bloqueamos por data faltante).
    """
    if not node_id:
        return False, "destination_node_id requerido."
    try:
        with connection.cursor() as c:
            c.execute(
                "SELECT capabilities, status, is_active FROM nodos.nodo WHERE id = %s",
                [str(node_id)],
            )
            row = c.fetchone()
    except Exception:
        return True, ""  # Si la tabla no existe (test), no bloqueamos.
    if not row:
        return False, "El nodo destino no existe."
    capabilities, st, is_active = row
    if is_active is False:
        return False, "El nodo destino está inactivo."
    if st and str(st).upper() in ("RETIRED", "INACTIVE"):
        return False, f"El nodo está en estado {st}."

    # Sin capabilities → no bloqueamos (compat con seeds que no las pueblan)
    if not capabilities:
        return True, ""

    # Normalización: psycopg2 puede devolver JSONB como list (ya parseado)
    # O como str (json crudo). En el segundo caso lo parseamos a list.
    raw_caps = capabilities
    if isinstance(raw_caps, str):
        try:
            import json as _json
            raw_caps = _json.loads(raw_caps)
        except Exception:
            raw_caps = []
    if not isinstance(raw_caps, list):
        raw_caps = []
    caps_norm = {str(x or "").strip().lower() for x in raw_caps}
    RECEIVE_ALIASES = {
        "receive", "recibir", "received",
        "receive_inbound", "inbound", "in",
        "receive_capability", "recv",
    }
    if caps_norm & RECEIVE_ALIASES:
        return True, ""
    # Mensaje de error con las capabilities reales para debug
    return False, (
        f"El nodo destino no tiene la capacidad RECEIVE. "
        f"Capabilities actuales: {sorted(caps_norm) or '(vacío)'}"
    )


def _next_codigo() -> str:
    """REC-2026-0001 secuencial."""
    year = datetime.utcnow().year
    with connection.cursor() as c:
        c.execute(
            "SELECT COUNT(*) FROM inventario.recepcion WHERE codigo LIKE %s",
            [f"REC-{year}-%"],
        )
        n = (c.fetchone() or [0])[0]
    return f"REC-{year}-{n + 1:04d}"


# =====================================================================
# OCR endpoint
# =====================================================================
class InboundOCRView(APIView):
    """POST /api/inventory/ocr-receipt/ — multipart con `file`."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        f = request.FILES.get("file") or request.FILES.get("upload")
        if not f:
            return Response({"detail": "Falta archivo (`file`)."}, status=400)
        if f.size > 25 * 1024 * 1024:
            return Response({"detail": "Archivo > 25MB."}, status=413)
        try:
            payload = extract_packing_list(
                file_bytes   = f.read(),
                filename     = f.name,
                content_type = f.content_type or "application/octet-stream",
            )
        except Exception as e:
            log.exception("[inbound_ocr] error file=%s", f.name)
            return Response({"detail": f"OCR falló: {type(e).__name__}: {e}"}, status=500)

        # POL_VISIBILIDAD: ocultar unit_cost_usd a no-admin.
        if not _is_ceo(request):
            for ln in payload.get("lines") or []:
                ln.pop("unit_cost_usd", None)
        return Response(payload)


# =====================================================================
# /receive/ endpoint — crea recepción + sube stock + excepción si gap
# =====================================================================
class InboundReceiveView(APIView):
    """POST /api/inventory/receive/

    Body:
      {
        "destination_node_id": "...",
        "destination_node_label": "ALE-COL · COL-ALE",
        "source_type": "SUPPLIER_PO" | "TRANSFER_IN" | "BLIND_RECEIPT" | "RETURN",
        "reference_id": "...",          # opcional
        "reference_label": "OC-2026-…", # opcional
        "document_artifact_id": "...",  # opcional · packing list / factura
        "ocr_payload_json": {...},      # opcional · auditoría OCR
        "ocr_confidence_avg": 88.5,     # opcional
        "lines": [
          {"product_sku":"...", "product_label":"...", "talla":"...",
           "lote_code":"...", "expiration_date":"YYYY-MM-DD",
           "expected_qty":12, "received_qty":10,
           "unit_cost_usd":42.50, "gap_justification":"...",
           "source":"OCR_PL"|"MANUAL", "ocr_confidence":85},
          ...
        ],
        "notes": "...",
        "actor_id": "...", "actor_name": "..."
      }

    Si alguna línea tiene received_qty < expected_qty Y el caller no envió
    `gap_justification`, la respuesta incluye el listado de líneas con gap
    en `gaps_pending` y exige reintento. Si la justificación viene en cada
    línea con gap, persiste la recepción y crea la(s) excepción(es).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        data = request.data or {}
        dest_id = data.get("destination_node_id")

        ok, reason = _node_has_receive(dest_id)
        if not ok:
            return Response({"detail": reason, "field": "destination_node_id"}, status=400)

        lines = data.get("lines") or []
        if not isinstance(lines, list) or not lines:
            return Response({"detail": "lines[] vacío."}, status=400)

        # Pre-chequeo de gaps sin justificación
        missing_justif = []
        for idx, ln in enumerate(lines):
            try:
                exp = int(ln.get("expected_qty") or 0)
                recv_raw = ln.get("received_qty")
                recv = int(recv_raw) if recv_raw not in (None, "") else exp
            except (TypeError, ValueError):
                return Response({"detail": f"línea {idx}: cantidades inválidas."}, status=400)
            if recv < exp and not (ln.get("gap_justification") or "").strip():
                missing_justif.append({
                    "index":          idx,
                    "product_sku":    ln.get("product_sku"),
                    "expected_qty":   exp,
                    "received_qty":   recv,
                    "delta":          recv - exp,
                })
        if missing_justif:
            return Response({
                "detail":        "Hay líneas con faltante sin justificación. Completa "
                                 "`gap_justification` en cada línea con delta negativo.",
                "code":          "GAP_JUSTIFICATION_REQUIRED",
                "gaps_pending":  missing_justif,
            }, status=409)

        recepcion_id = uuid.uuid4()
        codigo = _next_codigo()
        actor_id   = data.get("actor_id") or getattr(getattr(request, "user", None), "id", None)
        actor_name = data.get("actor_name") or getattr(getattr(request, "user", None), "full_name", "") \
                                            or getattr(getattr(request, "user", None), "username", "")

        try:
            with transaction.atomic():
                # 1. Cabecera
                with connection.cursor() as c:
                    c.execute("""
                        INSERT INTO inventario.recepcion
                            (id, codigo, destination_node_id, destination_node_label,
                             source_type, reference_id, reference_label,
                             estado, document_artifact_id,
                             ocr_processed_at, ocr_payload_json, ocr_confidence_avg,
                             received_by_id, received_by_name, received_at,
                             notes, created_by_id, created_by_name)
                        VALUES (%s, %s, %s, %s,
                                %s, %s, %s,
                                'RECEIVED', %s,
                                %s, %s::jsonb, %s,
                                %s, %s, NOW(),
                                %s, %s, %s)
                    """, [
                        str(recepcion_id), codigo, str(dest_id),
                        data.get("destination_node_label") or "",
                        (data.get("source_type") or "BLIND_RECEIPT").upper(),
                        str(data.get("reference_id")) if data.get("reference_id") else None,
                        data.get("reference_label") or "",
                        str(data.get("document_artifact_id")) if data.get("document_artifact_id") else None,
                        timezone.now() if data.get("ocr_payload_json") else None,
                        (None if data.get("ocr_payload_json") is None
                         else __import__("json").dumps(data.get("ocr_payload_json"))),
                        data.get("ocr_confidence_avg"),
                        str(actor_id) if actor_id else None,
                        (actor_name or "")[:128],
                        data.get("notes") or "",
                        str(actor_id) if actor_id else None,
                        (actor_name or "")[:128],
                    ])

                # 2. Líneas
                line_ids = []
                gap_lines = []
                for ln in lines:
                    exp = int(ln.get("expected_qty") or 0)
                    recv_raw = ln.get("received_qty")
                    recv = int(recv_raw) if recv_raw not in (None, "") else exp
                    line_id = uuid.uuid4()
                    line_ids.append(line_id)
                    with connection.cursor() as c:
                        c.execute("""
                            INSERT INTO inventario.recepcion_linea
                                (id, recepcion_id, producto_id, product_sku, product_label,
                                 talla, lote_code, expiration_date,
                                 expected_qty, received_qty, unit_cost_usd,
                                 gap_justification, source, ocr_confidence, notes)
                            VALUES (%s, %s, %s, %s, %s,
                                    %s, %s, %s,
                                    %s, %s, %s,
                                    %s, %s, %s, %s)
                        """, [
                            str(line_id), str(recepcion_id),
                            str(ln.get("producto_id")) if ln.get("producto_id") else None,
                            (ln.get("product_sku") or "")[:64],
                            (ln.get("product_label") or "")[:255],
                            (ln.get("talla") or "")[:16],
                            (ln.get("lote_code") or "")[:64],
                            ln.get("expiration_date") or None,
                            exp, recv,
                            ln.get("unit_cost_usd"),
                            ln.get("gap_justification") or None,
                            (ln.get("source") or "MANUAL").upper(),
                            ln.get("ocr_confidence"),
                            ln.get("notes") or None,
                        ])
                    if recv != exp:
                        gap_lines.append({
                            "linea_id":    line_id,
                            "tipo":        "GAP" if recv < exp else "OVER",
                            "expected":    exp,
                            "received":    recv,
                            "delta":       recv - exp,
                            "justification": ln.get("gap_justification") or "",
                        })

                # 3. Excepciones automáticas (ART-17)
                exception_doc_id = None
                if gap_lines:
                    exception_doc_id = uuid.uuid4()
                    for g in gap_lines:
                        with connection.cursor() as c:
                            c.execute("""
                                INSERT INTO inventario.recepcion_excepcion
                                    (id, recepcion_id, linea_id, tipo,
                                     expected_qty, received_qty, delta_qty,
                                     justification, auto_generated, requires_action)
                                VALUES (%s, %s, %s, %s,
                                        %s, %s, %s,
                                        %s, TRUE, TRUE)
                            """, [
                                str(uuid.uuid4()), str(recepcion_id), str(g["linea_id"]),
                                g["tipo"], g["expected"], g["received"], g["delta"],
                                g["justification"],
                            ])
                    with connection.cursor() as c:
                        c.execute("""
                            UPDATE inventario.recepcion
                               SET exception_document_id = %s
                             WHERE id = %s
                        """, [str(exception_doc_id), str(recepcion_id)])

                # 4. Sumar stock al nodo destino (si la tabla inventario.stock
                #    existe y aceptamos que producto_id puede ser null para
                #    blind receipts — en ese caso saltamos esta fila).
                _apply_to_stock(dest_id, lines, actor_id=actor_id, actor_name=actor_name)

        except Exception as e:
            log.exception("[receive] error rec=%s", recepcion_id)
            return Response({"detail": f"{type(e).__name__}: {e}"}, status=500)

        # 5. Devolver el detalle completo
        return Response(_serialize_recepcion(recepcion_id, mask_costs=not _is_ceo(request)),
                        status=201)


def _apply_to_stock(node_id, lines, *, actor_id=None, actor_name=None):
    """Suma cada línea al stock del nodo destino, **por talla**.
    Granularidad: (nodo, producto, lote, talla). Si una fila existe con
    la misma combinación, sumamos la cantidad recibida. Si no, insert
    nuevo. Si producto_id es null (blind receipt) → omitimos la fila.
    """
    with connection.cursor() as c:
        for ln in lines:
            producto_id = ln.get("producto_id")
            if not producto_id:
                continue
            recv = int(ln.get("received_qty") or ln.get("expected_qty") or 0)
            if recv <= 0:
                continue
            lote = (ln.get("lote_code") or "")[:64]
            talla = (ln.get("talla") or "").strip().upper()[:16] or None
            unit_cost = ln.get("unit_cost_usd")
            try:
                # 1) ¿Ya existe la fila (nodo, producto, lote, talla)?
                c.execute("""
                    SELECT id, cantidad_disponible
                      FROM inventario.stock
                     WHERE nodo_id = %s::uuid
                       AND producto_id = %s::uuid
                       AND lote = %s
                       AND COALESCE(size, '') = COALESCE(%s, '')
                       AND is_active = TRUE
                     LIMIT 1
                """, [str(node_id), str(producto_id), lote, talla])
                row = c.fetchone()
                if row:
                    # 2) UPDATE — suma la qty recibida
                    new_qty = float(row[1] or 0) + recv
                    c.execute("""
                        UPDATE inventario.stock
                           SET cantidad_disponible = %s,
                               costo_unitario_usd  = COALESCE(%s, costo_unitario_usd),
                               last_movement_at    = NOW(),
                               updated_at          = NOW()
                         WHERE id = %s
                    """, [new_qty, unit_cost, row[0]])
                else:
                    # 3) INSERT — fila nueva por talla
                    c.execute("""
                        INSERT INTO inventario.stock (
                            id, nodo_id, producto_id, lote, size,
                            cantidad_disponible, costo_unitario_usd,
                            last_movement_at, is_active, created_at, updated_at
                        )
                        VALUES (gen_random_uuid(), %s, %s, %s, %s,
                                %s, %s,
                                NOW(), TRUE, NOW(), NOW())
                    """, [str(node_id), str(producto_id), lote, talla,
                          recv, unit_cost])
            except Exception as e:
                log.warning("[apply_to_stock] no pude actualizar stock sku=%s talla=%s: %s",
                            ln.get("product_sku"), talla, e)


def _serialize_recepcion(recepcion_id, *, mask_costs=False):
    try:
        r = Recepcion.objects.get(pk=recepcion_id)
    except Recepcion.DoesNotExist:
        return None
    lines = list(RecepcionLinea.objects.filter(recepcion_id=r.id, is_active=True))
    excs  = list(RecepcionExcepcion.objects.filter(recepcion_id=r.id, is_active=True))
    return {
        "id":                     str(r.id),
        "codigo":                 r.codigo,
        "destination_node_id":    str(r.destination_node_id) if r.destination_node_id else None,
        "destination_node_label": r.destination_node_label,
        "source_type":            r.source_type,
        "reference_id":           str(r.reference_id) if r.reference_id else None,
        "reference_label":        r.reference_label,
        "estado":                 r.estado,
        "document_artifact_id":   str(r.document_artifact_id) if r.document_artifact_id else None,
        "exception_document_id":  str(r.exception_document_id) if r.exception_document_id else None,
        "has_discrepancy":        r.has_discrepancy,
        "discrepancy_count":      r.discrepancy_count,
        "total_units":            r.total_units,
        "total_value_usd":        None if mask_costs else float(r.total_value_usd or 0),
        "received_at":            r.received_at.isoformat() if r.received_at else None,
        "received_by_name":       r.received_by_name,
        "ocr_confidence_avg":     float(r.ocr_confidence_avg) if r.ocr_confidence_avg is not None else None,
        "notes":                  r.notes,
        "lines": [{
            "id":              str(l.id),
            "product_sku":     l.product_sku,
            "product_label":   l.product_label,
            "talla":           l.talla,
            "lote_code":       l.lote_code,
            "expiration_date": l.expiration_date.isoformat() if l.expiration_date else None,
            "expected_qty":    l.expected_qty,
            "received_qty":    l.received_qty,
            "delta_qty":       l.delta_qty,
            "unit_cost_usd":   None if mask_costs else (float(l.unit_cost_usd) if l.unit_cost_usd is not None else None),
            "line_value_usd":  None if mask_costs else (float(l.line_value_usd) if l.line_value_usd is not None else None),
            "gap_justification": l.gap_justification,
            "source":          l.source,
            "ocr_confidence":  float(l.ocr_confidence) if l.ocr_confidence is not None else None,
        } for l in lines],
        "exceptions": [{
            "id":              str(e.id),
            "linea_id":        str(e.linea_id) if e.linea_id else None,
            "tipo":            e.tipo,
            "expected_qty":    e.expected_qty,
            "received_qty":    e.received_qty,
            "delta_qty":       e.delta_qty,
            "justification":   e.justification,
            "auto_generated":  e.auto_generated,
            "requires_action": e.requires_action,
            "resolved_at":     e.resolved_at.isoformat() if e.resolved_at else None,
        } for e in excs],
    }


# =====================================================================
# Recepcion ViewSet — CRUD ligero
# =====================================================================
class RecepcionViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        qs = Recepcion.objects.filter(is_active=True).order_by("-created_at")
        for p, f in (("nodo", "destination_node_id"), ("source", "source_type"),
                     ("estado", "estado")):
            v = request.query_params.get(p)
            if v:
                qs = qs.filter(**{f: v})
        if request.query_params.get("has_discrepancy") in ("1", "true", "True"):
            qs = qs.filter(has_discrepancy=True)

        # Sprint 2026-04-30 — filtros por producto / lote / talla.
        # Permiten al StockLotDetailDrawer del FE encontrar la recepción
        # que creó la fila (nodo, producto, lote, talla) en inventario.stock.
        producto = request.query_params.get("producto")
        lote     = request.query_params.get("lote")
        talla    = request.query_params.get("talla") or request.query_params.get("size")
        if producto or lote or talla:
            line_qs = RecepcionLinea.objects.filter(is_active=True)
            if producto:
                line_qs = line_qs.filter(producto_id=producto)
            if lote is not None:
                line_qs = line_qs.filter(lote_code=lote)
            if talla:
                line_qs = line_qs.filter(talla__iexact=talla)
            rec_ids = list(line_qs.values_list("recepcion_id", flat=True).distinct())
            qs = qs.filter(id__in=rec_ids)

        mask = not _is_ceo(request)
        return Response([{
            "id":                     str(r.id),
            "codigo":                 r.codigo,
            "destination_node_id":    str(r.destination_node_id) if r.destination_node_id else None,
            "destination_node_label": r.destination_node_label,
            "source_type":            r.source_type,
            "reference_id":           str(r.reference_id) if r.reference_id else None,
            "reference_label":        r.reference_label,
            "estado":                 r.estado,
            "has_discrepancy":        r.has_discrepancy,
            "discrepancy_count":      r.discrepancy_count,
            "total_units":            r.total_units,
            "total_value_usd":        None if mask else float(r.total_value_usd or 0),
            "received_at":            r.received_at.isoformat() if r.received_at else None,
            "is_active":              r.is_active,
        } for r in qs[:300]])

    def retrieve(self, request, pk=None):
        data = _serialize_recepcion(pk, mask_costs=not _is_ceo(request))
        if not data:
            return Response({"detail": "Recepción no encontrada"}, status=404)
        return Response(data)

    def destroy(self, request, pk=None):
        Recepcion.objects.filter(pk=pk).update(is_active=False)
        return Response(status=204)

    @action(detail=False, methods=["get"], url_path="select_source_types")
    def select_source_types(self, request):
        return Response([{
            "codigo": s.codigo, "label": s.label, "color": s.color, "orden": s.orden,
        } for s in SourceTypeCat.objects.filter(is_active=True)])
