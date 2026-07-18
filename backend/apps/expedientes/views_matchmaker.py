"""
=====================================================================
MWT.ONE · apps.expedientes.views_matchmaker
Agente responsable: [AG-BACKEND]

Sprint Document Matchmaker · 2026-04-29.

Dos endpoints:

  POST /api/expedientes/{id}/upload-match/
       Recibe un archivo (multipart) + document_type. Sube a MinIO,
       inserta artifact_instance, llama a la IA (gpt-5-nano) para
       extraer las líneas, cruza vs expedientes.linea, persiste el
       resultado en expedientes.document_match_log y devuelve el
       mismatch_payload completo + log_id.

  POST /api/expedientes/{id}/resolve-match/
       Recibe la decisión del usuario (acciones aplicadas) y marca
       el log como resuelto. Acciones permitidas:
         · ADD_LINE      → inserta nueva línea al expediente
         · UPDATE_QTY    → ajusta qty en expedientes.linea
         · ATTACH_SAP    → setea sap en expedientes.linea
         · DELETE_LINE   → soft-delete (is_active=FALSE)
         · MANUAL        → no-op (sólo registra en payload)

Visibilidad: ambos endpoints son admin-facing. CLIENT B2B → 403.
Sin FK física entre tablas (R6).
=====================================================================
"""
from __future__ import annotations

import json
import logging
import uuid
from decimal import Decimal

from django.db import connection, transaction
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .document_matchmaker import extract_document, cross_match
from .models import Expediente
from .views import _deny_client_mutation

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# Constantes
# ─────────────────────────────────────────────────────────────────────
ALLOWED_DOC_TYPES = {"ART-01_OC", "ART-02_PROFORMA", "ART-04_SAP"}
MAX_FILE_BYTES    = 25 * 1024 * 1024  # 25 MB hard cap

ARTIFACT_KIND_BY_TYPE = {
    "ART-01_OC":       "OC Cliente",
    "ART-02_PROFORMA": "Proforma MWT",
    "ART-04_SAP":      "Confirmación SAP",
}


# ═════════════════════════════════════════════════════════════════════
# G3 · adelanto del correlativo de OC con el PO leído por la IA
# ═════════════════════════════════════════════════════════════════════
def _bump_oc_correlativo(client_id, po_number) -> None:
    """Sprint 2026-07-18 (G3) · si la IA leyó un número de PO del
    documento, sube el piso de la serie del cliente:

        oc_correlativo = GREATEST(COALESCE(oc_correlativo, 0), po)

    La próxima OC auto-numerada del wizard saldrá en po + 1. Solo POs
    puramente numéricos (p.ej. SonDel 505244); los alfanuméricos y los
    OC-AUTO-* no alimentan la serie. Nunca la baja. Best-effort: un
    error aquí jamás rompe el upload-match (warning y sigue).
    """
    if not client_id or not po_number:
        return
    digits = str(po_number).strip()
    if not digits.isdigit():
        return
    try:
        with connection.cursor() as c:
            c.execute(
                """
                UPDATE clientes.cliente
                   SET oc_correlativo = GREATEST(COALESCE(oc_correlativo, 0), %s)
                 WHERE id = %s::uuid
                """,
                [int(digits), str(client_id)],
            )
    except Exception as e:
        log.warning("[matchmaker] bump oc_correlativo falló (cliente %s, po %s): %s",
                    client_id, po_number, e)


# ═════════════════════════════════════════════════════════════════════
# Renombrar OC-AUTO-* con el PO real leído por la IA
# ═════════════════════════════════════════════════════════════════════
def _rename_oc_auto(exp, po_number) -> None:
    """Sprint 2026-07-18 · si la OC del expediente quedó con codigo
    OC-AUTO-* (creada sin número de PO en el wizard) y la IA leyó el PO
    real del documento, renumbramos con ese PO:

      · expedientes.oc.codigo            → <po>          (p.ej. 505244)
      · expedientes.expediente.codigo    → EXP-<po>      (dedup -2, -3…)
      · expedientes.documento R4 (sin archivo, 'PO OC-AUTO-*') → 'PO <po>'

    No toca display_label (alias manual del usuario manda) ni OCs que
    ya tienen codigo real. Best-effort: un fallo no rompe el upload-match.
    """
    po = str(po_number or "").strip()
    if not po:
        return
    try:
        with connection.cursor() as c:
            c.execute("SELECT codigo FROM expedientes.oc WHERE id = %s::uuid",
                      [str(exp.oc_id)])
            row = c.fetchone()
            if not row or not (row[0] or "").startswith("OC-AUTO-"):
                return
            c.execute("UPDATE expedientes.oc SET codigo = %s WHERE id = %s::uuid",
                      [po, str(exp.oc_id)])
            # expediente.codigo es único → dedup con sufijo como el wizard
            base = f"EXP-{po}"
            c.execute(
                "SELECT COUNT(*) FROM expedientes.expediente "
                "WHERE codigo = %s OR codigo LIKE %s",
                [base, base + "-%"],
            )
            dups = int((c.fetchone() or [0])[0] or 0)
            new_code = base if dups == 0 else f"{base}-{dups + 1}"
            c.execute("UPDATE expedientes.expediente SET codigo = %s "
                      "WHERE id = %s::uuid", [new_code, str(exp.id)])
            c.execute(
                """UPDATE expedientes.documento
                      SET codigo = %s
                    WHERE oc_id = %s::uuid AND kind = 'OC' AND is_active = TRUE
                      AND codigo LIKE 'PO OC-AUTO-%%'""",
                [f"PO {po}", str(exp.oc_id)],
            )
        log.info("[matchmaker] OC-AUTO renombrada con PO real: exp=%s po=%s",
                 exp.id, po)
    except Exception as e:
        log.warning("[matchmaker] rename OC-AUTO falló (exp %s, po %s): %s",
                    exp.id, po_number, e)


# ═════════════════════════════════════════════════════════════════════
# POST /api/expedientes/{id}/upload-match/
# ═════════════════════════════════════════════════════════════════════
class UploadMatchView(APIView):
    """Sube documento → IA → cruce → persiste log → devuelve dashboard."""
    permission_classes = [IsAuthenticated]
    parser_classes     = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, expediente_id=None):
        denied = _deny_client_mutation(request, action_label="expediente.upload_match")
        if denied is not None:
            return denied

        # ── 1. Validaciones de input ─────────────────────────
        document_type = (request.data.get("document_type") or "").strip().upper()
        if document_type not in ALLOWED_DOC_TYPES:
            return Response(
                {"detail": f"document_type inválido. Esperado: {sorted(ALLOWED_DOC_TYPES)}"},
                status=400,
            )

        f = request.FILES.get("file") or request.FILES.get("document")
        if not f:
            return Response(
                {"detail": "Falta el archivo. Esperado bajo el campo 'file' (multipart)."},
                status=400,
            )

        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe."}, status=404)

        file_bytes = b"".join(chunk for chunk in f.chunks())
        if len(file_bytes) > MAX_FILE_BYTES:
            return Response(
                {"detail": f"Archivo > {MAX_FILE_BYTES // (1024*1024)} MB."},
                status=413,
            )

        filename     = f.name or "documento"
        content_type = (getattr(f, "content_type", None) or "application/octet-stream")
        file_ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else None

        # ── 2. Subir a MinIO (best-effort) + artifact_instance ──
        artifact_id = uuid.uuid4()
        log_id      = uuid.uuid4()
        storage_url = None
        signed_get  = None

        try:
            from apps.storage.services import (
                generate_signed_url, put_object_stream,
            )
            key = f"expedientes/{exp.id}/match-{document_type.lower()}-{artifact_id}.{file_ext or 'bin'}"
            try:
                import io as _io
                put_object_stream(
                    key=key,
                    file_stream=_io.BytesIO(file_bytes),
                    content_type=content_type,
                    length=len(file_bytes),
                )
            except Exception as e:
                log.warning("[matchmaker] put_object_stream falló: %s", e)
            try:
                signed_put = generate_signed_url(key=key, kind="get", ttl=24 * 3600)
                signed_get = signed_put
                storage_url = signed_put.get("url") if signed_put else None
            except Exception:
                storage_url = None
        except ImportError:
            log.warning("[matchmaker] storage.services no disponible — sigo sin MinIO")

        # ── 3. Llamada IA ───────────────────────────────────
        # Sprint 2026-05-02 (AG-03): pasamos `expediente_id` para que el
        # extractor de PROFORMA pueda cargar las líneas BD del expediente
        # como contexto de anclaje del modelo vision. La OC ignora este
        # parámetro (path intacto, riesgo cero).
        ai_payload = extract_document(
            file_bytes    = file_bytes,
            filename      = filename,
            content_type  = content_type,
            document_type = document_type,
            expediente_id = str(exp.id),
        )

        # ── 3b. G3 · adelantar el correlativo de OC del cliente ──
        # Sprint 2026-07-18: si la IA leyó un PO numérico del documento
        # (p.ej. 505300), la serie del cliente sube a ese piso y la
        # próxima OC auto-numerada del wizard sale en po + 1. Además,
        # si la OC quedó como OC-AUTO-* (creada sin PO), se renombra
        # con el PO real (expediente + documento R4 incluidos).
        if document_type == "ART-01_OC":
            _bump_oc_correlativo(getattr(exp, "client_id", None),
                                 ai_payload.get("client_po_number"))
            _rename_oc_auto(exp, ai_payload.get("client_po_number"))

        # ── 4. Cruce IA vs BD ───────────────────────────────
        mismatch_payload = cross_match(ai_payload, str(exp.id))

        summary = mismatch_payload.get("summary") or {}
        coverage_pct        = summary.get("coverage_pct") or 0
        discrepancies_count = summary.get("discrepancies_count") or 0
        is_perfect_match    = bool(summary.get("perfect_match"))
        # Sprint 2026-05-06 (AG-03): si la IA falló (timeout, JSON inválido,
        # etc.), `cross_match` retorna ai_failed=True con discrepancias
        # vacías. Persistimos el log con coverage=0 y discrepancies_count=0
        # para que match-history no contamine las métricas con runs fallidos
        # ni le mienta al usuario diciéndole que hay "N discrepancias".
        ai_failed = bool(mismatch_payload.get("ai_failed"))
        if ai_failed:
            coverage_pct        = 0
            discrepancies_count = 0
            is_perfect_match    = False

        # ── 5. Persistir en BD (artifact_instance + match_log) ─
        author_email = (
            getattr(request.user, "email", None)
            or getattr(request.user, "username", None)
            or "system"
        )
        author_id = getattr(request.user, "id", None)
        author_id = str(author_id) if author_id else None

        try:
            with transaction.atomic():
                with connection.cursor() as c:
                    # 5a. artifact_instance (best-effort: no rompemos si la
                    #     tabla evolucionó)
                    try:
                        c.execute("""
                            INSERT INTO expedientes.artifact_instances (
                                id, expediente_id, oc_id,
                                artifact_code, kind, codigo,
                                file_ext, file_size_bytes, storage_url,
                                ocr_status, ocr_engine, ocr_confidence, ocr_payload,
                                action_source, correlation_id,
                                author, fecha, visibility_tier, is_active
                            ) VALUES (
                                %s, %s, %s,
                                %s, %s, %s,
                                %s, %s, %s,
                                'DONE', 'gpt-5-nano', 0.85, %s::jsonb,
                                'MATCHMAKER', %s,
                                %s, NOW(), 'INTERNAL', TRUE
                            )
                        """, [
                            str(artifact_id), str(exp.id),
                            str(exp.oc_id) if getattr(exp, "oc_id", None) else None,
                            document_type,
                            ARTIFACT_KIND_BY_TYPE.get(document_type, document_type),
                            (filename or "")[:128],
                            file_ext, len(file_bytes), storage_url,
                            json.dumps(ai_payload),
                            str(log_id),
                            author_email,
                        ])
                    except Exception as e:
                        log.warning("[matchmaker] no pude insertar artifact_instance: %s", e)

                    # 5b. document_match_log (la tabla canónica del sprint)
                    c.execute("""
                        INSERT INTO expedientes.document_match_log (
                            id, expediente_id, artifact_instance_id, oc_id,
                            document_type, document_filename,
                            document_size_bytes, document_content_type,
                            ai_model, ai_raw_payload, mismatch_payload,
                            coverage_pct, discrepancies_count, is_perfect_match,
                            is_resolved,
                            created_by_id, created_by_name,
                            is_active, created_at, updated_at
                        ) VALUES (
                            %s, %s, %s, %s,
                            %s, %s,
                            %s, %s,
                            %s, %s::jsonb, %s::jsonb,
                            %s, %s, %s,
                            FALSE,
                            %s, %s,
                            TRUE, NOW(), NOW()
                        )
                    """, [
                        str(log_id), str(exp.id), str(artifact_id),
                        str(exp.oc_id) if getattr(exp, "oc_id", None) else None,
                        document_type, (filename or "")[:255],
                        len(file_bytes), (content_type or "")[:64],
                        (ai_payload.get("model") or "gpt-5-nano")[:48],
                        json.dumps(ai_payload),
                        json.dumps(mismatch_payload),
                        Decimal(str(coverage_pct)),
                        int(discrepancies_count),
                        is_perfect_match,
                        author_id, author_email[:128],
                    ])
        except Exception as e:
            log.exception("[matchmaker] persistencia falló: %s", e)
            return Response(
                {
                    "detail":           "persistence_failed",
                    "error":            str(e),
                    "ai_payload":       ai_payload,
                    "mismatch_payload": mismatch_payload,
                },
                status=500,
            )

        return Response(
            {
                "ok":                True,
                "log_id":            str(log_id),
                "artifact_id":       str(artifact_id),
                "expediente_id":     str(exp.id),
                "document_type":     document_type,
                "document_filename": filename,
                "storage_url":       storage_url,
                "ai_payload":        ai_payload,
                "mismatch_payload":  mismatch_payload,
                "summary":           summary,
                "is_perfect_match":  is_perfect_match,
                # Sprint 2026-05-06 (AG-03): el frontend usa este flag para
                # mostrar "Reintenta el análisis IA" en vez de "N discrepancias".
                "ai_failed":         ai_failed,
                "ai_error":          mismatch_payload.get("ai_error") or ai_payload.get("error"),
            },
            status=200,
        )


# ═════════════════════════════════════════════════════════════════════
# POST /api/expedientes/{id}/resolve-match/
# ═════════════════════════════════════════════════════════════════════
class ResolveMatchView(APIView):
    """Marca un match_log como resuelto y aplica acciones aprobadas."""
    permission_classes = [IsAuthenticated]
    parser_classes     = [JSONParser]

    def post(self, request, expediente_id=None):
        denied = _deny_client_mutation(request, action_label="expediente.resolve_match")
        if denied is not None:
            return denied

        log_id  = (request.data.get("log_id") or "").strip()
        actions = request.data.get("actions") or []
        note    = (request.data.get("note") or "").strip() or None

        if not log_id:
            return Response({"detail": "log_id requerido."}, status=400)
        if not isinstance(actions, list):
            return Response({"detail": "actions debe ser una lista."}, status=400)

        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe."}, status=404)

        # ── Cargar log ────────────────────────────────────
        with connection.cursor() as c:
            c.execute("""
                SELECT id::text, expediente_id::text, document_type, is_resolved
                  FROM expedientes.document_match_log
                 WHERE id = %s::uuid AND is_active = TRUE
                 LIMIT 1
            """, [log_id])
            row = c.fetchone()

        if not row:
            return Response({"detail": "match_log no existe."}, status=404)
        if row[1] != str(exp.id):
            return Response(
                {"detail": "match_log no pertenece a este expediente."},
                status=409,
            )
        if row[3]:
            return Response(
                {"detail": "match_log ya estaba resuelto.", "log_id": log_id},
                status=409,
            )

        author_email = (
            getattr(request.user, "email", None)
            or getattr(request.user, "username", None)
            or "system"
        )
        author_id = getattr(request.user, "id", None)
        author_id = str(author_id) if author_id else None

        applied = []
        errors  = []

        try:
            with transaction.atomic():
                with connection.cursor() as c:
                    for idx, act in enumerate(actions):
                        if not isinstance(act, dict):
                            errors.append({"idx": idx, "error": "no es objeto"})
                            continue
                        kind = (act.get("kind") or "").upper()
                        try:
                            if kind == "ADD_LINE":
                                _apply_add_line(c, exp, act, author_email)
                            elif kind == "UPDATE_QTY":
                                _apply_update_qty(c, exp, act)
                            elif kind == "ATTACH_SAP":
                                _apply_attach_sap(c, exp, act)
                            elif kind == "DELETE_LINE":
                                _apply_delete_line(c, exp, act, author_email)
                            elif kind == "MANUAL":
                                # no-op, sólo se registra
                                pass
                            else:
                                errors.append({"idx": idx, "error": f"kind desconocido: {kind}"})
                                continue
                            applied.append({**act, "applied_at": "NOW()"})
                        except Exception as e:
                            errors.append({"idx": idx, "kind": kind, "error": str(e)})

                    # ── Marcar log como resuelto ──
                    c.execute("""
                        UPDATE expedientes.document_match_log
                           SET is_resolved        = TRUE,
                               resolved_at        = NOW(),
                               resolved_by_id     = %s,
                               resolved_by_name   = %s,
                               resolution_payload = %s::jsonb,
                               resolution_note    = %s,
                               updated_at         = NOW()
                         WHERE id = %s::uuid
                    """, [
                        author_id, author_email[:128],
                        json.dumps({
                            "actions_applied": applied,
                            "errors":          errors,
                            "actions_count":   len(actions),
                        }),
                        note,
                        log_id,
                    ])
        except Exception as e:
            log.exception("[matchmaker] resolve atomic falló: %s", e)
            return Response(
                {"detail": "transaction_failed", "error": str(e)},
                status=500,
            )

        return Response(
            {
                "ok":             True,
                "log_id":         log_id,
                "applied_count":  len(applied),
                "errors_count":   len(errors),
                "applied":        applied,
                "errors":         errors,
            },
            status=200,
        )


# ─────────────────────────────────────────────────────────────────────
# Aplicadores de acciones — usan raw SQL contra expedientes.linea
# ─────────────────────────────────────────────────────────────────────
def _resolve_add_line_pricing(c, exp, sku_upper, doc_unit_price):
    """Sprint 2026-05-02 (AG-03): resuelve unit_price y producto_id
    para una nueva línea ADD_LINE.

    Prioridad de precio:
      1. doc_unit_price si viene del documento y > 0
      2. producto.especificaciones.client_prices[exp.client_id]  (CPA del cliente)
      3. producto.precio_lista
      4. 0 (último fallback)

    Devuelve (unit_price, total_price, producto_id).
    """
    # 1) Buscar el producto y sus precios
    producto_id = None
    cpa_price = 0.0
    lista_price = 0.0
    client_id = getattr(exp, "client_id", None)
    try:
        c.execute("""
            SELECT id::text,
                   COALESCE((especificaciones->'client_prices'->>%s)::numeric, 0) AS cpa,
                   COALESCE(precio_lista, 0) AS lista
              FROM productos.producto
             WHERE sku = %s AND COALESCE(is_active, TRUE) = TRUE
             LIMIT 1
        """, [str(client_id) if client_id else "", sku_upper])
        row = c.fetchone()
        if row:
            producto_id = row[0]
            cpa_price = float(row[1] or 0)
            lista_price = float(row[2] or 0)
    except Exception as e:
        log.warning("[matchmaker] price lookup failed: %s", e)

    # 2) Aplicar prioridad
    doc_price = float(doc_unit_price) if doc_unit_price not in (None, "") else 0.0
    if doc_price > 0:
        unit_price = doc_price
    elif cpa_price > 0:
        unit_price = cpa_price
    elif lista_price > 0:
        unit_price = lista_price
    else:
        unit_price = 0.0
    return unit_price, producto_id


def _apply_add_line(c, exp, act, author_email):
    # Schema real (70_expedientes.sql): columnas son `size` (no `talla`)
    # y NO existe `product_label`. oc_id es NOT NULL — usamos exp.oc_id
    # o levantamos error si no hay OC vinculada.
    sku   = (act.get("sku") or "").strip()
    talla = (act.get("talla") or "").strip()
    qty   = int(act.get("qty_doc") or act.get("qty") or 0)
    sap   = act.get("sap_doc") or None
    if not sku:
        raise ValueError("sku vacío en ADD_LINE")
    oc_id = getattr(exp, "oc_id", None)
    if not oc_id:
        raise ValueError("expediente sin oc_id — no puedo insertar línea (oc_id NOT NULL)")

    # Sprint 2026-05-02 (AG-03): resolver unit_price desde doc → CPA del
    # cliente → precio_lista. Antes la línea se insertaba con unit_price=NULL
    # y el render mostraba $0.
    sku_upper = sku.upper()[:64]
    unit_price, producto_id = _resolve_add_line_pricing(
        c, exp, sku_upper, act.get("unit_price"),
    )
    total_price = round(unit_price * qty, 2)

    c.execute("""
        INSERT INTO expedientes.linea (
            id, oc_id, expediente_id, producto_id,
            sku, size, qty, unit_price, total_price, sap,
            estado, is_active, created_at, updated_at
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            'PENDIENTE_SAP', TRUE, NOW(), NOW()
        )
    """, [
        str(uuid.uuid4()), str(oc_id), str(exp.id), producto_id,
        sku_upper, (talla or "").upper()[:16],
        Decimal(str(qty or 0)),
        Decimal(str(unit_price)),
        Decimal(str(total_price)),
        (sap or "")[:64] if sap else None,
    ])


def _apply_update_qty(c, exp, act):
    line_id = act.get("line_id")
    qty     = act.get("qty_doc") or act.get("qty")
    if not line_id or qty is None:
        raise ValueError("line_id o qty faltante en UPDATE_QTY")
    c.execute("""
        UPDATE expedientes.linea
           SET qty         = %s,
               total_price = ROUND(COALESCE(unit_price, 0) * %s, 2),
               updated_at  = NOW()
         WHERE id = %s::uuid AND expediente_id = %s::uuid
    """, [Decimal(str(qty)), Decimal(str(qty)), line_id, str(exp.id)])


def _apply_attach_sap(c, exp, act):
    line_id = act.get("line_id")
    sap     = act.get("sap_doc") or act.get("sap_number")
    if not line_id or not sap:
        raise ValueError("line_id o sap_doc faltante en ATTACH_SAP")
    c.execute("""
        UPDATE expedientes.linea
           SET sap = %s, updated_at = NOW()
         WHERE id = %s::uuid AND expediente_id = %s::uuid
    """, [str(sap)[:64], line_id, str(exp.id)])


def _apply_delete_line(c, exp, act, author_email):
    line_id = act.get("line_id")
    if not line_id:
        raise ValueError("line_id faltante en DELETE_LINE")
    c.execute("""
        UPDATE expedientes.linea
           SET is_active  = FALSE,
               estado     = 'CANCELADA',
               updated_at = NOW()
         WHERE id = %s::uuid AND expediente_id = %s::uuid
    """, [line_id, str(exp.id)])


# ═════════════════════════════════════════════════════════════════════
# GET /api/expedientes/{id}/match-history/
#     Lista paginada (light) de matches anteriores para sidebar.
# ═════════════════════════════════════════════════════════════════════
class MatchHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, expediente_id=None):
        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe."}, status=404)

        rows = []
        with connection.cursor() as c:
            c.execute("""
                SELECT
                    id::text,
                    document_type,
                    document_filename,
                    coverage_pct,
                    discrepancies_count,
                    is_perfect_match,
                    is_resolved,
                    resolved_at,
                    created_at,
                    created_by_name
                  FROM expedientes.document_match_log
                 WHERE expediente_id = %s::uuid
                   AND is_active     = TRUE
                 ORDER BY created_at DESC
                 LIMIT 50
            """, [str(exp.id)])
            cols = [d[0] for d in c.description]
            for r in c.fetchall():
                rows.append(dict(zip(cols, r)))

        return Response({"results": rows, "count": len(rows)}, status=200)
