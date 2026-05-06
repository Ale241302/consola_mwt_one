"""
=====================================================================
MWT.ONE · apps.expedientes.views_sap_analyze
Agente responsable: [AG-BACKEND]

Sprint 2026-05-04 · endpoint dedicado al ANÁLISIS PREVIO de
Confirmación SAP — se invoca ANTES del confirm-sap/upsert-sap, desde
el drawer "Agregar SAP" del frontend, para pre-poblar y validar los
datos del documento contra las líneas reales del expediente.

  POST /api/expedientes/{id}/analyze-sap-confirmation/
       Body multipart:
         · file: xlsx | xls | csv | pdf  (≤ 25 MB)
       Response:
         {
           ok, kind, filename, sap_id, sap_count, all_saps,
           lineas:        [{ sap_doc, sku, talla, qty, descripcion,
                            raw_material, match: { matched, line_id,
                            qty_exp, qty_diff, name_match, ... } }],
           discrepancies: [{ kind, severity, sku, talla, qty_doc,
                            qty_exp, descripcion, ... }],
           summary:       { lines_in_doc, lines_matched,
                            lines_unmatched, discrepancies_count,
                            perfect_match }
         }

Visibilidad: CEO/ADMIN-only (CLIENT_* → 403).

NO persiste nada — es un análisis stateless. El usuario decide en
el drawer qué líneas agregar al SAP, y luego el confirm-sap /
upsert-sap final hace la persistencia.
=====================================================================
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal

from django.db import connection, transaction
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Expediente
from .sap_extractor import analyze_sap_document
from .views import _deny_client_mutation
# Sprint 2026-05-04 (AG-03) · reusamos helpers del matchmaker:
#   _resolve_add_line_pricing → cascada doc → CPA cliente → precio_lista
#   _apply_update_qty         → UPDATE qty en expedientes.linea
#   _apply_attach_sap         → setea sap en expedientes.linea
from .views_matchmaker import (
    _resolve_add_line_pricing,
    _apply_update_qty,
    _apply_attach_sap,
)

log = logging.getLogger(__name__)

MAX_FILE_BYTES = 25 * 1024 * 1024  # 25 MB
ALLOWED_EXT = (".xlsx", ".xlsm", ".xls", ".pdf", ".csv")


class AnalyzeSapConfirmationView(APIView):
    """Analiza un documento de Confirmación SAP (xlsx / pdf / csv) y
    devuelve el cruce contra expedientes.linea sin persistir."""

    permission_classes = [IsAuthenticated]
    parser_classes     = [MultiPartParser, FormParser]

    def post(self, request, expediente_id=None):
        denied = _deny_client_mutation(
            request, action_label="expediente.analyze_sap_confirmation",
        )
        if denied is not None:
            return denied

        f = request.FILES.get("file") or request.FILES.get("documento_sap")
        if not f:
            return Response(
                {"detail": "Falta el archivo. Esperado bajo el campo 'file'."},
                status=400,
            )

        filename     = f.name or "documento"
        content_type = (getattr(f, "content_type", None) or
                        "application/octet-stream")

        fname_lower = filename.lower()
        if not any(fname_lower.endswith(ext) for ext in ALLOWED_EXT):
            return Response(
                {"detail": f"Extensión no soportada. Permitidas: {ALLOWED_EXT}"},
                status=400,
            )

        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe."}, status=404)

        file_bytes = b"".join(chunk for chunk in f.chunks())
        if len(file_bytes) > MAX_FILE_BYTES:
            return Response(
                {"detail": f"Archivo > {MAX_FILE_BYTES // (1024 * 1024)} MB."},
                status=413,
            )

        try:
            result = analyze_sap_document(
                file_bytes=file_bytes,
                filename=filename,
                content_type=content_type,
                expediente_id=str(exp.id),
            )
        except Exception as e:
            log.exception("[analyze-sap] extractor falló")
            return Response(
                {"detail": "extractor_failed", "error": str(e)},
                status=500,
            )

        # Auditable: log breve. NO persistimos en BD — esta vista es
        # stateless por diseño (el confirm-sap/upsert-sap es quien
        # persiste con el ART-04 final).
        log.info(
            "[analyze-sap] expediente=%s filename=%s kind=%s sap_id=%s "
            "lines=%d matched=%d disc=%d",
            exp.id, filename, result.get("kind"), result.get("sap_id"),
            (result.get("summary") or {}).get("lines_in_doc", 0),
            (result.get("summary") or {}).get("lines_matched", 0),
            (result.get("summary") or {}).get("discrepancies_count", 0),
        )

        return Response({
            "ok":               bool(result.get("ok")),
            "expediente_id":    str(exp.id),
            "filename":         result.get("filename") or filename,
            "kind":             result.get("kind"),
            "sap_id":           result.get("sap_id"),
            "sap_count":        result.get("sap_count") or 0,
            "all_saps":         result.get("all_saps") or [],
            # Sprint 2026-05-06 · BUG FIX: el Response usaba un whitelist
            # de campos y `fecha_fabricacion` (extraída de col H "Data do
            # documento") quedaba descartada → el frontend siempre veía
            # null y el chip caía al fallback manual con todayISO.
            "fecha_fabricacion": result.get("fecha_fabricacion"),
            "lineas":           result.get("lineas") or [],
            "discrepancies":    result.get("discrepancies") or [],
            "summary":          result.get("summary") or {},
            "error":            result.get("error"),
        }, status=200)


# ═════════════════════════════════════════════════════════════════════
# POST /api/expedientes/{id}/sync-sap-discrepancies/
# Aplica las discrepancias detectadas por analyze-sap-confirmation
# (botón "Sincronizar" del drawer) — igual al flujo del matchmaker
# OC/Proforma pero adaptado al universo SAP.
# ═════════════════════════════════════════════════════════════════════
class SyncSapDiscrepanciesView(APIView):
    """Aplica acciones derivadas del análisis IA del SAP:

      · ADD_LINE   → inserta nueva línea en expedientes.linea con
                     unit_price resuelto (doc → CPA cliente →
                     precio_lista). Útil para `MISSING_IN_EXPEDIENTE`.
      · UPDATE_QTY → ajusta qty + total_price en expedientes.linea.
                     Útil para `QTY_DIFF`.
      · ATTACH_SAP → setea sap en expedientes.linea (raro en este
                     flujo — el confirm-sap final lo hace, pero lo
                     soportamos por consistencia con resolve-match).

    Body JSON:
      {
        "actions": [
          {
            "kind":         "ADD_LINE" | "UPDATE_QTY" | "ATTACH_SAP",
            "sku":          "700728",
            "talla":        "37",
            "qty":          10,
            "qty_doc":      10,        # alias de qty
            "unit_price":   19.35,     # opcional, override del precio
            "descripcion":  "75BPR29-MSMC-CPAP-ST",
            "line_id":      "<uuid>",  # requerido para UPDATE_QTY/ATTACH_SAP
            "sap_doc":      "269486"   # opcional, sólo informativo
          }, ...
        ]
      }

    Respuesta:
      {
        "ok":          true,
        "applied":     [...],
        "errors":      [...],
        "new_lines":   [{ id, sku, size, qty, unit_price, descripcion }, ...],
        "updated_lines": [{ line_id, qty }, ...]
      }
    """
    permission_classes = [IsAuthenticated]
    parser_classes     = [JSONParser]

    def post(self, request, expediente_id=None):
        denied = _deny_client_mutation(
            request, action_label="expediente.sync_sap_discrepancies",
        )
        if denied is not None:
            return denied

        actions = request.data.get("actions") or []
        if not isinstance(actions, list):
            return Response(
                {"detail": "actions debe ser lista."}, status=400,
            )
        if not actions:
            return Response(
                {"detail": "actions vacío — nada que sincronizar."},
                status=400,
            )

        try:
            exp = Expediente.objects.get(pk=expediente_id, is_active=True)
        except Expediente.DoesNotExist:
            return Response({"detail": "Expediente no existe."}, status=404)

        author_email = (
            getattr(request.user, "email", None)
            or getattr(request.user, "username", None)
            or "system"
        )

        applied        = []
        errors         = []
        new_lines      = []  # detalle completo de líneas insertadas
        updated_lines  = []  # detalle de qty actualizadas
        notify_extras  = []  # Sprint 2026-05-06: kind=NOTIFY_CLIENT — extras
                             # confirmados por la fábrica que NO se sincronizan
                             # al expediente; al final disparamos email al cliente.

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
                                row = _sap_apply_add_line(
                                    c, exp, act, author_email,
                                )
                                if row:
                                    new_lines.append(row)
                            elif kind == "UPDATE_QTY":
                                _apply_update_qty(c, exp, act)
                                updated_lines.append({
                                    "line_id": act.get("line_id"),
                                    "qty": int(
                                        act.get("qty_doc")
                                        or act.get("qty") or 0
                                    ),
                                })
                            elif kind == "ATTACH_SAP":
                                _apply_attach_sap(c, exp, act)
                            elif kind == "NOTIFY_CLIENT":
                                # Sprint 2026-05-06 (AG-03): extras confirmados
                                # por Marluvas que NO estaban en la OC del cliente.
                                # NO insertamos línea — solo recolectamos para
                                # disparar email al cliente DESPUÉS del commit.
                                # `nombre_producto` se resuelve desde el catálogo
                                # si no viene en el payload.
                                extra = _build_notify_extra(c, act)
                                if extra:
                                    notify_extras.append(extra)
                            else:
                                errors.append({
                                    "idx": idx,
                                    "error": f"kind desconocido: {kind}",
                                })
                                continue
                            applied.append({**act, "applied_at": "NOW()"})
                        except Exception as e:
                            log.warning(
                                "[sync-sap] action %s falló: %s", kind, e,
                            )
                            errors.append({
                                "idx": idx, "kind": kind, "error": str(e),
                            })
        except Exception as e:
            log.exception("[sync-sap] atomic falló")
            return Response(
                {"detail": "transaction_failed", "error": str(e)},
                status=500,
            )

        # ── Disparar emails (post-commit, fuera de la transacción) ──
        # Agrupamos los extras por sap_doc — un email por SAP. Si el
        # broker está caído, el helper enqueue cae a sync.
        emails_queued = []
        if notify_extras:
            try:
                from apps.notifications.tasks import enqueue_sap_extra_unit_notice
                buckets: dict = {}
                for e in notify_extras:
                    bucket = e.get("sap_number") or "—"
                    buckets.setdefault(bucket, []).append({
                        "sku":             e.get("sku"),
                        "nombre_producto": e.get("nombre_producto") or "",
                        "talla":           e.get("talla"),
                        "qty":             e.get("qty"),
                    })
                user_id = getattr(request.user, "id", None)
                for sap_number, bucket in buckets.items():
                    mode = enqueue_sap_extra_unit_notice(
                        expediente_id          = str(exp.id),
                        sap_number             = sap_number,
                        extras                 = bucket,
                        registrado_por_user_id = str(user_id) if user_id else None,
                    )
                    emails_queued.append({
                        "sap_number": sap_number,
                        "n_extras":   len(bucket),
                        "mode":       mode,
                    })
            except Exception as e:
                log.exception(
                    "[sync-sap] enqueue email cliente falló · expediente=%s · err=%s",
                    exp.id, e,
                )

        log.info(
            "[sync-sap] expediente=%s actions=%d applied=%d errors=%d "
            "new=%d updated=%d notify_extras=%d emails_queued=%d",
            exp.id, len(actions), len(applied), len(errors),
            len(new_lines), len(updated_lines),
            len(notify_extras), len(emails_queued),
        )

        return Response({
            "ok":             len(errors) == 0,
            "expediente_id":  str(exp.id),
            "applied_count":  len(applied),
            "errors_count":   len(errors),
            "applied":        applied,
            "errors":         errors,
            "new_lines":      new_lines,
            "updated_lines":  updated_lines,
            # Sprint 2026-05-06: para que el frontend muestre confirmación
            # tipo "Notificamos al cliente sobre N unidades extra".
            "notify_extras":  notify_extras,
            "emails_queued":  emails_queued,
        }, status=200)


# ─────────────────────────────────────────────────────────────────────
# Helpers privados
# ─────────────────────────────────────────────────────────────────────
def _sap_apply_add_line(c, exp, act, author_email):
    """Variante de `_apply_add_line` (matchmaker) que devuelve la línea
    insertada con todos los campos que el frontend necesita renderizar:
    id, sku, size, qty, unit_price, descripcion (nombre del producto),
    sap.

    Misma cascada de pricing: doc → CPA cliente → precio_lista.
    """
    sku = (act.get("sku") or "").strip().upper()
    talla = (act.get("talla") or "").strip().upper()
    qty = int(act.get("qty_doc") or act.get("qty") or 0)
    sap = act.get("sap_doc") or None

    if not sku:
        raise ValueError("sku vacío en ADD_LINE")
    if not talla:
        raise ValueError("talla vacía en ADD_LINE")

    oc_id = getattr(exp, "oc_id", None)
    if not oc_id:
        raise ValueError(
            "expediente sin oc_id — no puedo insertar línea (oc_id NOT NULL)",
        )

    sku_upper = sku[:64]
    talla_upper = talla[:16]
    unit_price, producto_id = _resolve_add_line_pricing(
        c, exp, sku_upper, act.get("unit_price"),
    )
    total_price = round(float(unit_price) * qty, 2)
    new_id = str(uuid.uuid4())

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
        new_id, str(oc_id), str(exp.id), producto_id,
        sku_upper, talla_upper,
        Decimal(str(qty)),
        Decimal(str(unit_price)),
        Decimal(str(total_price)),
        (sap or "")[:64] if sap else None,
    ])

    # Buscar el nombre real del producto para devolverlo
    descripcion = (act.get("descripcion") or "").strip() or None
    if not descripcion and producto_id:
        try:
            c.execute(
                "SELECT nombre FROM productos.producto WHERE id = %s LIMIT 1",
                [producto_id],
            )
            row = c.fetchone()
            if row:
                descripcion = row[0]
        except Exception:
            pass
    if not descripcion:
        descripcion = sku_upper

    return {
        "id":           new_id,
        "sku":          sku_upper,
        "size":         talla_upper,
        "qty":          qty,
        "unit_price":   float(unit_price),
        "total_price":  total_price,
        "sap":          (sap or None),
        "descripcion":  descripcion,
        "producto_id":  producto_id,
    }


# ─────────────────────────────────────────────────────────────────────
# Sprint 2026-05-06 (AG-03) · NOTIFY_CLIENT helper
# ─────────────────────────────────────────────────────────────────────
def _build_notify_extra(c, act: dict) -> dict | None:
    """Construye el payload de un extra para notificación al cliente.

    El frontend manda:
      kind:        "NOTIFY_CLIENT"
      sku:         "701340"
      talla:       "46"
      qty | qty_doc: 10
      sap_doc:     "263360"
      descripcion: opcional — si no viene, lo resolvemos del catálogo

    Devuelve dict con sku, nombre_producto, talla, qty, sap_number.
    """
    sku   = (act.get("sku") or "").strip().upper()
    talla = (act.get("talla") or "").strip().upper()
    qty   = int(act.get("qty_doc") or act.get("qty") or 0)
    sap_number = (act.get("sap_doc") or act.get("sap_number") or "").strip() or None

    if not sku or not talla or qty <= 0:
        log.warning(
            "[notify-extra] payload incompleto · sku=%s talla=%s qty=%s",
            sku, talla, qty,
        )
        return None

    nombre_producto = (act.get("descripcion") or "").strip()
    if not nombre_producto:
        try:
            c.execute(
                """
                SELECT nombre FROM productos.producto
                 WHERE UPPER(sku) = %s
                   AND COALESCE(is_active, TRUE) = TRUE
                 LIMIT 1
                """,
                [sku],
            )
            row = c.fetchone()
            if row and row[0]:
                nombre_producto = row[0]
        except Exception as e:
            log.warning("[notify-extra] lookup nombre_producto falló: %s", e)

    return {
        "sku":             sku,
        "nombre_producto": nombre_producto or sku,
        "talla":           talla,
        "qty":             qty,
        "sap_number":      sap_number,
    }
