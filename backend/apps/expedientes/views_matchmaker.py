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
        ai_payload = extract_document(
            file_bytes   = file_bytes,
            filename     = filename,
            content_type = content_type,
            document_type= document_type,
        )

        # ── 4. Cruce IA vs BD ───────────────────────────────
        mismatch_payload = cross_match(ai_payload, str(exp.id))

        summary = mismatch_payload.get("summary") or {}
        coverage_pct        = summary.get("coverage_pct") or 0
        discrepancies_count = summary.get("discrepancies_count") or 0
        is_perfect_match    = bool(summary.get("perfect_match"))

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
def _apply_add_line(c, exp, act, author_email):
    # Schema real (70_expedientes.sql): columnas son `size` (no `talla`)
    # y NO existe `product_label`. oc_id es NOT NULL — usamos exp.oc_id
    # o levantamos error si no hay OC vinculada.
    sku   = (act.get("sku") or "").strip()
    talla = (act.get("talla") or "").strip()
    qty   = act.get("qty_doc") or act.get("qty") or 0
    sap   = act.get("sap_doc") or None
    if not sku:
        raise ValueError("sku vacío en ADD_LINE")
    oc_id = getattr(exp, "oc_id", None)
    if not oc_id:
        raise ValueError("expediente sin oc_id — no puedo insertar línea (oc_id NOT NULL)")
    c.execute("""
        INSERT INTO expedientes.linea (
            id, oc_id, expediente_id,
            sku, size, qty, sap,
            estado, is_active, created_at, updated_at
        ) VALUES (
            %s, %s, %s,
            %s, %s, %s, %s,
            'PENDIENTE_SAP', TRUE, NOW(), NOW()
        )
    """, [
        str(uuid.uuid4()), str(oc_id), str(exp.id),
        sku.upper()[:64], (talla or "").upper()[:16],
        Decimal(str(qty or 0)),
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
