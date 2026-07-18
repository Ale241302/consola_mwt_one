"""
=====================================================================
MWT.ONE · apps.expedientes.views_wizard
Agente responsable: [AG-BACKEND]

Orchestrator atómico del Wizard de Creación de Expedientes.

Endpoint único:
  POST /api/expedientes/create-from-oc/
    multipart/form-data:
      file            (PDF o XLSX — opcional si ya se pasó `ocr_payload`)
      ocr_payload     (JSON string — salida de /api/ocr/parse-oc/)
      brand_id        (UUID — sólo ADMIN; CLIENT lo hereda del contrato)
      client_id       (UUID — IGNORADO si role=CLIENT; forzamos JWT)
      mode            ('COMISION' | 'FULL' — sólo ADMIN; CLIENT → NULL)
      price_basis     ('FOB' | 'CIF' | 'EXW' | 'DDP' — sólo ADMIN)
      freight_mode    ('SEA' | 'AIR' — sólo ADMIN; CLIENT → NULL)
      transport_mode  ('MARITIMO' | 'AEREO' — sólo ADMIN; CLIENT → NULL)
      credit_clock_start_rule  ('ON_BL' | 'ON_ETA' | 'ON_ARRIVAL' | 'ON_INVOICE' | 'ON_PROFORMA')
      credit_days     (INT — sólo ADMIN; CLIENT hereda de clientes.cliente)
      idempotence_token  (UUID — replay-safe; si existe, devuelve el expediente previo)

Reglas de seguridad (B2B ISOLATION STRICT):
  1. Si request.user.role ∈ {client_b2b, cliente, client}:
       · client_id SIEMPRE = request.user.legal_entity_id (del JWT).
         Cualquier client_id del payload se IGNORA (silently overridden).
       · mode / freight_mode / transport_mode / price_basis / credit_days →
         se fuerzan a NULL / defaults del cliente (no del payload).
       · phase_signal='PENDING_CEO_REVIEW' + submitted_via_portal=TRUE.
       · El expediente queda esperando review manual del CEO antes de
         continuar el pipeline.
  2. Si role=ADMIN (staff interno): el payload completo se respeta.

Atómico (transaction.atomic):
  1. INSERT en expedientes.oc       (la OC origen)
  2. INSERT en expedientes.expediente (estado='REGISTRO')
  3. INSERT en expedientes.linea     (N filas del payload.lines)
  4. INSERT en expedientes.artifact_instances  (ART-01 = OC subida)
  5. INSERT en pipeline.event_log    (command=C1 OCUploadedToWizard)
  6. INSERT en expedientes.wizard_submission_log (auditoría)

Idempotencia:
  · Por `idempotence_token` en la tabla wizard_submission_log (UNIQUE).
  · Si el token ya existe, devuelve el expediente previo con 200 +
    header "X-Idempotent-Replay: true".
=====================================================================
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from django.core.mail import EmailMultiAlternatives
from django.db import connection, transaction
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.ocr.services import parse_oc_auto
# Sprint 2026-05-24 (fix v4 backend) · defense in depth: re-derivamos
# unit_price_mwt y unit_price_client del motor de pricing canonico
# (apps.commercial.services), ignorando lo que mande el frontend.
# Esto blinda el sistema contra cualquier bug del wizard (race conditions,
# bundles cacheados, etc.) — los precios siempre coinciden con la matriz.
from apps.commercial.services import get_client_price_matrix
from apps.core.constants import MWT_OPERATING_CLIENT_ID
# Sprint 2026-06-12 · PO B2B por alias de cliente (R1-R4):
#   · funciones PURAS de matching/banda/plazo/codigo en po_alias_matcher
#   · FX USD/BRL server-side (mismo servicio core.fx_service + cache del
#     endpoint /api/commercial/exchange-rate/usd-brl/) con tolerancia a
#     fallo: si no hay FX el flujo sigue con el precio que ya traiga.
from apps.expedientes.po_alias_matcher import (
    build_alias_index,
    extract_size,
    format_po_codigo,
    match_part_number,
    pick_band,
    pick_plazo_price,
)

log = logging.getLogger(__name__)

# Roles que el sistema reconoce como "cliente B2B" (aislamiento estricto).
_CLIENT_ROLES = {"client_b2b", "cliente", "client"}


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _is_client_role(role: Optional[str]) -> bool:
    return (role or "").lower() in _CLIENT_ROLES


def _safe_decimal(v: Any, default: str = "0") -> Decimal:
    try:
        if v is None or v == "":
            return Decimal(default)
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def _safe_date(v: Any) -> Optional[date]:
    if not v:
        return None
    if isinstance(v, date):
        return v
    try:
        return datetime.fromisoformat(str(v)).date()
    except ValueError:
        return None


def _load_ocr_payload(request) -> dict:
    """Obtiene el payload OCR de 3 formas (en orden de precedencia):
        1) campo `ocr_payload` (JSON string en multipart)
        2) campo `file` (procesa el PDF/XLSX con parse_oc_auto en el servidor)
        3) body JSON (si Content-Type=application/json)
    """
    raw = request.data.get("ocr_payload")
    if raw:
        if isinstance(raw, dict):
            return raw
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return {}

    f = request.FILES.get("file")
    if f:
        try:
            file_bytes = b"".join(chunk for chunk in f.chunks())
            result = parse_oc_auto(file_bytes, f.name or "oc.pdf")
            if result.get("ok"):
                return result.get("payload") or {}
        except Exception as e:
            log.warning("parse_oc_auto inline falló: %s", e)

    # Último recurso: si viene JSON
    if isinstance(request.data, dict) and "payload" in request.data:
        return request.data.get("payload") or {}

    return {}


def _resolve_client_defaults(client_id: str) -> dict:
    """Lee defaults comerciales del cliente desde clientes.cliente.
    Best-effort: tolera tabla vacía / ausente."""
    defaults: dict[str, Any] = {
        "credit_days":    None,
        "moneda":         "USD",
        "incoterm":       None,
        "freight_mode":   None,
        "transport_mode": None,
    }
    try:
        with connection.cursor() as c:
            # FIX 2026-06-12: las columnas reales de clientes.cliente son
            # `dias_credito` y `moneda` (sql/30_clientes.sql) —
            # credit_days/moneda_default no existen y el SELECT fallido
            # dejaba los defaults vacíos (y abortaba la tx en tests).
            c.execute("""
                SELECT
                    COALESCE(dias_credito, 0),
                    COALESCE(moneda, 'USD')
                FROM clientes.cliente
                WHERE id = %s AND is_active = TRUE
                LIMIT 1
            """, [client_id])
            row = c.fetchone()
            if row:
                defaults["credit_days"] = row[0] or None
                defaults["moneda"]      = row[1] or "USD"
    except Exception as e:
        log.debug("_resolve_client_defaults best-effort falló: %s", e)
    return defaults


def _store_file_bytes(file_bytes: bytes, filename: str,
                      expediente_id: str, artifact_id: str) -> dict:
    """Sube el PDF/XLSX a MinIO + Paperless (best-effort). Devuelve
    {storage_url, paperless_task_id, sha256} — cualquier campo puede ser None."""
    out = {"storage_url": None, "paperless_task_id": None, "sha256": None}
    try:
        out["sha256"] = hashlib.sha256(file_bytes).hexdigest()
    except Exception:
        pass

    if not file_bytes:
        return out

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    key = f"expedientes/{expediente_id}/art-01-{artifact_id}.{ext}"

    # 1) Paperless ingest (OCR + archivo inmutable)
    try:
        from apps.storage.services import paperless_ingest
        p = paperless_ingest(
            file_bytes=file_bytes,
            filename=filename,
            title=f"ART-01 · OC Cliente · {expediente_id}",
            document_type="Orden de Compra",
            tags=["ART-01", "OC", "Wizard", "C1"],
        )
        out["paperless_task_id"] = p.get("task_id")
    except Exception as e:
        log.debug("paperless_ingest (ART-01) no disponible: %s", e)

    # 2) Subida REAL del binario a MinIO.
    #    BUG FIX 2026-06-19 (AG-03): antes esto SOLO firmaba un PUT y guardaba
    #    la URL firmada en storage_url, pero NUNCA subía los bytes → el objeto
    #    jamás llegaba al bucket y el visor devolvía `NoSuchKey`. Ahora subimos
    #    de verdad con put_object_stream y persistimos la KEY (no una URL); el
    #    visor la resuelve por el proxy HTTPS /api/storage/download/?key=.
    try:
        import io as _io
        from apps.storage.services import put_object_stream
        content_type = {
            "pdf":  "application/pdf",
            "png":  "image/png",
            "jpg":  "image/jpeg",
            "jpeg": "image/jpeg",
            "webp": "image/webp",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls":  "application/vnd.ms-excel",
            "csv":  "text/csv",
        }.get(ext, "application/octet-stream")
        up = put_object_stream(
            key=key,
            file_stream=_io.BytesIO(file_bytes),
            content_type=content_type,
            length=len(file_bytes),
        )
        if up.get("ok"):
            out["storage_url"] = key
        else:
            log.warning("_store_file_bytes (ART-01) subida MinIO falló: %s",
                        up.get("error"))
    except Exception as e:
        log.warning("_store_file_bytes (ART-01) subida MinIO falló: %s", e)

    return out


def _fetch_client_aliases(client_id: str) -> list[dict]:
    """Filas activas de `productos.product_client_alias` para ESE cliente,
    enriquecidas con sku/marca del producto (JOIN lógico, sin FK física).
    Best-effort: devuelve [] si la tabla no existe en el entorno."""
    rows: list[dict] = []
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT pca.alias, pca.cliente_sku,
                       pca.producto_id::text,
                       p.sku, p.marca_id::text
                  FROM productos.product_client_alias pca
                  LEFT JOIN productos.producto p
                         ON p.id = pca.producto_id AND p.is_active = TRUE
                 WHERE pca.cliente_id = %s::uuid
                   AND pca.is_active = TRUE
            """, [str(client_id)])
            for r in c.fetchall():
                rows.append({
                    "alias":       r[0],
                    "cliente_sku": r[1],
                    "producto_id": r[2],
                    "sku":         r[3],
                    "marca_id":    r[4],
                })
    except Exception as e:
        log.warning("_fetch_client_aliases best-effort falló (cliente=%s): %s",
                    client_id, e)
    return rows


def _match_by_sku_or_name(part_number: str) -> Optional[dict]:
    """Fallback al comportamiento de HOY: lookup exacto por SKU o por
    nombre canónico MWT. NUNCA inventa producto — None si no hay match."""
    pn = (part_number or "").strip()
    if not pn:
        return None
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT id::text, sku, marca_id::text
                  FROM productos.producto
                 WHERE is_active = TRUE
                   AND (sku = %s OR upper(nombre) = upper(%s))
                 LIMIT 1
            """, [pn, pn])
            r = c.fetchone()
            if r:
                return {"producto_id": r[0], "sku": r[1], "marca_id": r[2],
                        "matched_via": "sku_or_name"}
    except Exception as e:
        log.warning("_match_by_sku_or_name best-effort falló (%s): %s", pn, e)
    return None


def _resolve_tc_usd_brl() -> Optional[float]:
    """Cotización USD/BRL vigente, server-side. Cadena:
      1. Cache compartido del endpoint /api/commercial/exchange-rate/usd-brl/
         (key `commercial:fx:usd-brl`, lo llena MarluvasExchangeRateView).
      2. apps.core.fx_service.get_fx_to_usd("BRL") invertido (BRL→USD →
         USD/BRL), que ya trae su propia cadena Frankfurter + fallback.
      3. None — el caller deja el precio que ya traiga el flujo actual.
    NUNCA lanza."""
    try:
        from django.core.cache import cache
        cached = cache.get("commercial:fx:usd-brl")
        if isinstance(cached, dict) and cached.get("rate"):
            rate = float(cached["rate"])
            if rate > 0:
                return rate
    except Exception as e:
        log.debug("_resolve_tc_usd_brl cache falló: %s", e)
    try:
        from apps.core.fx_service import get_fx_to_usd
        brl_to_usd = get_fx_to_usd("BRL")
        if brl_to_usd and float(brl_to_usd) > 0:
            return round(1.0 / float(brl_to_usd), 4)
    except Exception as e:
        log.warning("_resolve_tc_usd_brl fx_service falló: %s", e)
    return None


def _apply_alias_matching(ocr_lines: list, client_id: str) -> dict:
    """R1/R2 · Resuelve producto_id por ALIAS DEL CLIENTE para cada línea
    de la PO. Muta `ocr_lines` in-place (solo AGREGA campos — el payload
    ADMIN completo se respeta) y devuelve stats para la respuesta.

    Por línea:
      · Si ya trae producto_id (flujo ADMIN / parse-oc previo) → intacta,
        solo completamos `size` desde el sufijo del Part Nº si faltaba.
      · Alias match (alias más largo, prefijo del Part Nº sin talla) →
        producto_id + sku MWT + marca_id + talla. El Part Nº original se
        preserva en `client_part_number`.
      · Fallback: lookup exacto por SKU/nombre (comportamiento de hoy).
      · Sin match → la línea queda SIN producto_id con
        `needs_review=True` (flag para revisión manual del CEO).
    UNA FILA POR TALLA: jamás colapsamos líneas — cada entrada de
    `ocr_lines` produce su propio INSERT en expedientes.linea.
    """
    stats = {"total": len(ocr_lines), "pre_resolved": 0,
             "matched_alias": 0, "matched_sku_or_name": 0, "unmatched": 0}
    alias_index = build_alias_index(_fetch_client_aliases(client_id))

    for ln in ocr_lines:
        if not isinstance(ln, dict):
            continue
        part = str(ln.get("client_part_number") or ln.get("sku") or "").strip()

        if ln.get("producto_id"):
            stats["pre_resolved"] += 1
            if not ln.get("size") and part:
                _, sz = extract_size(part)
                if sz:
                    ln["size"] = sz
            continue

        m = match_part_number(part, alias_index,
                              explicit_size=ln.get("size")) if part else None
        if m:
            stats["matched_alias"] += 1
            ln["producto_id"] = m["producto_id"]
            ln["client_part_number"] = part
            ln["matched_alias"] = m["alias"]
            ln["matched_via"] = "client_alias"
            if m.get("marca_id"):
                ln["marca_id"] = m["marca_id"]
            if m.get("sku"):
                ln["sku"] = m["sku"]          # SKU MWT → motor de pricing
            if not ln.get("size") and m.get("size"):
                ln["size"] = m["size"]
            ln["_notas"] = f"PO Part Nº: {part} · alias: {m['alias']}"
            continue

        fb = _match_by_sku_or_name(part)
        if fb:
            stats["matched_sku_or_name"] += 1
            ln["producto_id"] = fb["producto_id"]
            ln["client_part_number"] = part
            ln["matched_via"] = "sku_or_name"
            if fb.get("marca_id"):
                ln["marca_id"] = fb["marca_id"]
            if fb.get("sku"):
                ln["sku"] = fb["sku"]
            if not ln.get("size") and part:
                _, sz = extract_size(part)
                if sz:
                    ln["size"] = sz
            continue

        # Sin match — NUNCA inventamos producto.
        stats["unmatched"] += 1
        ln["needs_review"] = True
        ln["matched_via"] = None
        ln["client_part_number"] = part
        if not ln.get("size") and part:
            _, sz = extract_size(part)
            if sz:
                ln["size"] = sz
        ln["_notas"] = f"SIN MATCH DE PRODUCTO · PO Part Nº: {part} · requiere revisión"

    return stats


def _idempotence_replay(token: str) -> Optional[dict]:
    """Busca un wizard_submission_log previo con este token.
    Devuelve el expediente que produjo (si alguno) o None."""
    if not token:
        return None
    try:
        with connection.cursor() as c:
            c.execute("""
                -- FIX 2026-06-12: la columna real es created_at
                -- (sql/95_expediente_wizard.sql) — submitted_at no existe y el
                -- SELECT fallido rompía el replay idempotente silenciosamente.
                SELECT expediente_id, client_id, created_at, payload, status
                FROM expedientes.wizard_submission_log
                WHERE idempotence_token = %s
                LIMIT 1
            """, [token])
            row = c.fetchone()
            if not row:
                return None

            expediente_id = row[0]
            if not expediente_id:
                return {"expediente_id": None, "idempotent": True,
                        "status": row[4]}

            c.execute("""
                SELECT id, codigo, estado, client_id, brand_id,
                       modo_operacion, phase_signal, submitted_via_portal,
                       total_cost, moneda
                FROM expedientes.expediente
                WHERE id = %s::uuid AND is_active = TRUE
            """, [str(expediente_id)])
            e = c.fetchone()
            if not e:
                return {"expediente_id": str(expediente_id), "idempotent": True}
            return {
                "idempotent": True,
                "expediente": {
                    "id":                   str(e[0]),
                    "codigo":               e[1],
                    "estado":               e[2],
                    "client_id":            str(e[3]) if e[3] else None,
                    "brand_id":             str(e[4]) if e[4] else None,
                    "modo_operacion":       e[5],
                    "phase_signal":         e[6],
                    "submitted_via_portal": e[7],
                    "total_cost":           float(e[8] or 0),
                    "moneda":               e[9],
                },
            }
    except Exception as ex:
        log.debug("_idempotence_replay best-effort falló: %s", ex)
        return None


# ═════════════════════════════════════════════════════════════════════
# Helper: info de catálogo (sku, nombre, marca, visibilidad) por producto_id
# ═════════════════════════════════════════════════════════════════════
def _fetch_products_info(producto_ids: list) -> dict:
    """Por producto_id: sku, nombre, marca_id y visibilidad (visible_to_all +
    client_overrides). Una sola query (sin N+1)."""
    out = {}
    pids = [str(p) for p in producto_ids if p]
    if not pids:
        return out
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT id::text, sku, COALESCE(nombre, ''),
                       marca_id::text,
                       COALESCE(especificaciones->'visibility'->>'visible_to_all','false'),
                       COALESCE(especificaciones->'visibility'->'client_overrides','{}'::jsonb)
                  FROM productos.producto
                 WHERE id = ANY(%s::uuid[]) AND COALESCE(is_active, TRUE) = TRUE
                """,
                [pids],
            )
            for pid, sku, nombre, marca_id, vta, overrides in c.fetchall():
                if isinstance(overrides, str):
                    try:
                        overrides = json.loads(overrides)
                    except (ValueError, TypeError):
                        overrides = {}
                out[pid] = {
                    "sku":            sku,
                    "nombre":         nombre,
                    "marca_id":       marca_id,
                    "visible_to_all": str(vta).lower() == "true",
                    "overrides":      overrides or {},
                }
    except Exception as e:  # noqa: BLE001
        log.warning("_fetch_products_info best-effort falló: %s", e)
    return out


# ═════════════════════════════════════════════════════════════════════
# POST /api/expedientes/resolve-oc-preview/
# Preview del Paso 2 (wizard B2B): resuelve cada línea del OCR a un producto
# del catálogo por ALIAS del cliente → SKU real + nombre (descripción),
# marca asignación y trae el precio de la banda VIGENTE (base 90d) de la
# matriz congelada del cliente. NO crea expediente. CLIENT → client_id del
# JWT (R3 anti-spoofing).
# ═════════════════════════════════════════════════════════════════════
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def resolve_oc_preview(request):
    user = request.user
    is_client = _is_client_role(getattr(user, "role", None))
    body = request.data or {}
    raw_lines = body.get("lines") or []

    if is_client:
        forced_cid = (getattr(user, "legal_entity_id", None)
                      or getattr(user, "portal_client_id", None)
                      or getattr(user, "client_id", None))
        if not forced_cid:
            _leids = getattr(user, "legal_entity_ids", None) or []
            forced_cid = _leids[0] if _leids else None
        client_id = str(forced_cid) if forced_cid else None
    else:
        client_id = body.get("client_id") or None

    if not client_id:
        return Response({"ok": False, "detail": "client_id requerido"}, status=400)

    # 1) Resolución por alias del cliente (muta in-place: producto_id/sku/size).
    lines = [dict(l) for l in raw_lines if isinstance(l, dict)]
    _apply_alias_matching(lines, client_id)

    # 2) TC en vivo + banda vigente (base SIEMPRE 90d).
    tc = _resolve_tc_usd_brl()
    banda = pick_band(tc) if tc else None

    # 3) Enriquecer por línea: nombre, asignación y precio 90d de la banda.
    info_by_pid = _fetch_products_info([l.get("producto_id") for l in lines])
    matrix_cache = {}
    out = []
    cid_low = str(client_id).lower()
    for l in lines:
        pid = l.get("producto_id")
        info = info_by_pid.get(pid) if pid else None
        sku = (info or {}).get("sku") or l.get("sku")
        nombre = (info or {}).get("nombre") or ""
        assigned = False
        unit_price = None
        if info:
            ov = info.get("overrides") or {}
            assigned = bool(info.get("visible_to_all")) or bool(
                ov.get(client_id) or ov.get(cid_low) or ov.get(str(client_id))
            )
            if assigned and tc and sku:
                if sku not in matrix_cache:
                    try:
                        matrix_cache[sku] = get_client_price_matrix(
                            client_id, info.get("marca_id"), sku, tc)
                    except Exception:  # noqa: BLE001
                        matrix_cache[sku] = None
                price = pick_plazo_price(matrix_cache.get(sku), 90)
                unit_price = float(price) if price else None

        try:
            qty = float(l.get("qty") if l.get("qty") is not None else l.get("cantidad") or 0)
        except (TypeError, ValueError):
            qty = 0.0

        out.append({
            "client_part_number": l.get("client_part_number") or l.get("sku") or "",
            "producto_id":  pid,
            "sku":          sku,
            "product_label": nombre,
            "size":         l.get("size"),
            "qty":          qty,
            "assigned":     bool(assigned and unit_price is not None),
            "unit_price":   unit_price,
            "needs_review": bool(l.get("needs_review") or not pid),
        })

    return Response({"ok": True, "tc": tc, "banda_id": banda, "lines": out})



# ─────────────────────────────────────────────────────────────────────
# Notificación a ADMIN cuando un CLIENTE crea un expediente
# Sprint 2026-07-15 · alerta in-app (users.activity_feed → campana 🔔)
# + email a los admins activos. Best-effort SIEMPRE: un fallo acá NUNCA
# debe romper la creación del expediente (se loggea y se sigue).
# ─────────────────────────────────────────────────────────────────────
_ADMIN_NOTIFY_ROLES = ["admin", "superadmin", "ceo"]
_NOTIFY_FALLBACK_TO = os.environ.get("CATALOG_REQUEST_FALLBACK_TO", "info@mwt.one")
_NOTIFY_FROM        = os.environ.get("DEFAULT_FROM_EMAIL", "info@mwt.one")
_NOTIFY_BASE_URL    = os.environ.get("MWT_ADMIN_BASE_URL", "https://consola.mwt.one")
_EMAIL_RE           = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _notify_admins_expediente_created(*, expediente_id, expediente_codigo,
                                      po_number, client_id, total_value,
                                      moneda, lines_count, submitted_by_email,
                                      oc_id=None, lines=None):
    """Notifica a los admins que un cliente B2B creó un expediente.

    Sprint 2026-07-15 · el enlace (email + campana) apunta al DETALLE DE LA
    OC (/expedientes/{oc_id}), no al id del expediente. Incluye un resumen
    por SKU (talla × cantidad) igual que el Paso 3 del wizard.
    """
    # 1) Nombre legible del cliente (best-effort).
    client_label = ""
    try:
        with connection.cursor() as c:
            c.execute(
                "SELECT razon_social FROM clientes.cliente WHERE id = %s",
                [str(client_id)],
            )
            row = c.fetchone()
            client_label = (row[0] or "") if row else ""
    except Exception:  # noqa: BLE001
        pass

    # 2) Admins activos (staff interno; excluye API users).
    admins = []
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT id, email_plain, full_name
                  FROM users.mwtuser
                 WHERE is_active = TRUE
                   AND COALESCE(is_api_user, FALSE) = FALSE
                   AND (lower(role_default) = ANY(%s) OR is_superuser = TRUE)
            """, [_ADMIN_NOTIFY_ROLES])
            admins = c.fetchall() or []
    except Exception:  # noqa: BLE001
        log.exception("[wizard.notify] lookup de admins falló")

    try:
        _total_txt = f"{float(total_value):,.2f}"
    except (TypeError, ValueError):
        _total_txt = str(total_value)

    # Resumen por SKU (SKU · talla × cantidad) — como el Paso 3 del wizard.
    by_sku = {}
    for ln in (lines or []):
        if not isinstance(ln, dict):
            continue
        sku_k = str(ln.get("sku") or "").strip()
        if not sku_k:
            continue
        g = by_sku.setdefault(sku_k, {"label": "", "sizes": [], "units": 0})
        if not g["label"]:
            g["label"] = ln.get("product_label") or ln.get("descripcion") or ""
        try:
            _q = int(float(ln.get("qty") if ln.get("qty") is not None
                           else ln.get("cantidad") or 0))
        except (TypeError, ValueError):
            _q = 0
        _sz = ln.get("size") or ln.get("talla") or "—"
        g["sizes"].append((str(_sz), _q))
        g["units"] += _q
    sku_count = len(by_sku)

    # El enlace SIEMPRE va al detalle de la OC (/expedientes/{oc_id}); si por
    # algún motivo no hay oc_id, caemos al id del expediente (mejor que nada).
    _link_id = str(oc_id or expediente_id)
    deep_link = f"/expedientes/{_link_id}"
    title = f"Nueva OC del portal · {client_label or 'Cliente B2B'}"
    body = (
        f"{client_label or 'Un cliente B2B'} creó el expediente "
        f"{expediente_codigo} (PO {po_number}) · {sku_count} SKU(s) · "
        f"{lines_count} línea(s) por {moneda} {_total_txt}. "
        f"Pendiente de revisión CEO."
    )

    # 3) Alerta in-app · una fila de users.activity_feed por admin.
    #    created_at tiene DEFAULT now() en la tabla (A4_users_roles.sql).
    for row in admins:
        uid = row[0]
        try:
            with connection.cursor() as c:
                c.execute("""
                    INSERT INTO users.activity_feed (
                        id, user_id, kind, title, body, icon, severity,
                        deep_link, related_type, related_id, is_active
                    ) VALUES (
                        %s, %s, 'expediente.created_portal', %s, %s,
                        'inbox', 'INFO', %s, 'expediente', %s, TRUE
                    )
                """, [
                    str(uuid.uuid4()), str(uid), title[:160], body,
                    deep_link, _link_id,
                ])
        except Exception:  # noqa: BLE001
            log.exception("[wizard.notify] activity_feed falló user=%s", uid)

    # 4) Email a los admins (un solo envío; fallback info@mwt.one).
    recipients = [r[1] for r in admins if r[1] and _EMAIL_RE.match(str(r[1]))]
    if not recipients:
        recipients = [_NOTIFY_FALLBACK_TO]
    link = f"{_NOTIFY_BASE_URL}/expedientes/{_link_id}"
    subject = (f"[MWT.ONE] Nueva OC del portal — {client_label or 'Cliente B2B'}"
               f" · PO {po_number}")
    _sku_text = ""
    for _sku_k, _g in by_sku.items():
        _tallas_txt = ", ".join(f"{_sz}×{_q}" for _sz, _q in _g["sizes"])
        _lbl = f" {_g['label']}" if _g["label"] else ""
        _sku_text += f"  · {_sku_k}{_lbl}: {_tallas_txt}  ({_g['units']} u)\n"
    text_body = (
        f"Hola Equipo MWT,\n\n"
        f"El cliente {client_label or '—'}"
        + (f" ({submitted_by_email})" if submitted_by_email else "")
        + " creó un expediente desde el Portal B2B:\n\n"
        f"  · Expediente: {expediente_codigo}\n"
        f"  · PO:         {po_number}\n"
        f"  · SKUs:       {sku_count}\n"
        f"  · Líneas:     {lines_count}\n"
        f"  · Total:      {moneda} {_total_txt}\n\n"
        f"Resumen por SKU (talla × cantidad):\n"
        f"{_sku_text}\n"
        f"El expediente quedó en estado REGISTRO, pendiente de revisión CEO:\n"
        f"  {link}\n\n"
        f"— MWT.ONE · Portal B2B"
    )
    # Bloque HTML del resumen por SKU (una tarjeta por SKU con chips talla×cant).
    sku_rows_html = ""
    for _sku_k, _g in by_sku.items():
        _chips = "".join(
            (
                '<span style="display:inline-block;padding:2px 8px;border-radius:999px;'
                'background:rgba(0,178,134,0.10);color:#0B7E8F;font-size:11px;'
                'font-weight:600;margin:2px 4px 2px 0">Talla '
                + str(_sz) + ": " + str(_q) + "</span>"
            )
            for _sz, _q in _g["sizes"]
        )
        _lbl_html = (f'<span style="font-weight:500;color:#334155;margin-left:6px">'
                     f'{_g["label"]}</span>') if _g["label"] else ""
        sku_rows_html += (
            '<div style="border:1px solid #E5E9F0;border-radius:8px;'
            'padding:10px 12px;margin-bottom:8px">'
            '<div style="display:flex;justify-content:space-between;align-items:baseline">'
            f'<div><code style="font-weight:700;color:#0B1E3A">{_sku_k}</code>{_lbl_html}</div>'
            f'<div style="color:#64748B;font-size:12px;white-space:nowrap">{_g["units"]} u</div>'
            '</div>'
            f'<div style="margin-top:6px">{_chips}</div>'
            '</div>'
        )

    html_body = f"""
    <div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0B1E3A;
                max-width:600px;margin:0 auto;padding:24px;
                background:#F8FAFC;border-radius:12px">
      <div style="background:#0B1E3A;color:#fff;padding:16px 20px;border-radius:10px;
                  margin-bottom:18px">
        <div style="font-size:11px;color:#1DE394;letter-spacing:1.5px;font-weight:700">
          NUEVA OC DESDE EL PORTAL B2B
        </div>
        <div style="font-size:18px;font-weight:700;margin-top:4px">{client_label or "Cliente B2B"}</div>
      </div>

      <p>Hola <strong>Equipo MWT</strong>,</p>
      <p>El cliente <strong>{client_label or "—"}</strong>
         {f"(<a href='mailto:{submitted_by_email}'>{submitted_by_email}</a>)" if submitted_by_email else ""}
         creó un expediente desde el Portal B2B:</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:8px;color:#64748B;font-size:11px;
                       text-transform:uppercase;letter-spacing:0.5px">Expediente</td>
            <td style="padding:8px;font-weight:700;font-family:monospace">{expediente_codigo}</td></tr>
        <tr><td style="padding:8px;color:#64748B;font-size:11px;
                       text-transform:uppercase;letter-spacing:0.5px">PO</td>
            <td style="padding:8px;font-family:monospace">{po_number}</td></tr>
        <tr><td style="padding:8px;color:#64748B;font-size:11px;
                       text-transform:uppercase;letter-spacing:0.5px">SKUs</td>
            <td style="padding:8px">{sku_count}</td></tr>
        <tr><td style="padding:8px;color:#64748B;font-size:11px;
                       text-transform:uppercase;letter-spacing:0.5px">Líneas</td>
            <td style="padding:8px">{lines_count}</td></tr>
        <tr><td style="padding:8px;color:#64748B;font-size:11px;
                       text-transform:uppercase;letter-spacing:0.5px">Total</td>
            <td style="padding:8px;font-weight:600">{moneda} {_total_txt}</td></tr>
      </table>

      <div style="font-size:11px;color:#64748B;letter-spacing:0.5px;
                  text-transform:uppercase;font-weight:700;margin:6px 0 8px">
        Resumen por SKU
      </div>
      {sku_rows_html}

      <a href="{link}"
         style="display:inline-block;background:#00B286;color:#fff;text-decoration:none;
                padding:12px 22px;border-radius:8px;font-weight:700;letter-spacing:0.3px">
        Revisar Expediente →
      </a>

      <p style="margin-top:24px;color:#64748B;font-size:12px">
        Este mensaje fue generado automáticamente por MWT.ONE.
      </p>
    </div>
    """
    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=text_body,
            from_email=_NOTIFY_FROM,
            to=recipients,
            reply_to=[submitted_by_email] if submitted_by_email else None,
        )
        msg.attach_alternative(html_body, "text/html")
        msg.send(fail_silently=True)
    except Exception:  # noqa: BLE001
        log.exception("[wizard.notify] envío de email a admins falló")


# ═════════════════════════════════════════════════════════════════════
# Correlativo de OC por cliente (G3 · Sprint 2026-07-18)
# ═════════════════════════════════════════════════════════════════════
def _next_oc_correlativo(client_id) -> Optional[str]:
    """Siguiente número de la serie de OC del cliente, o None.

    Regla:
        siguiente = GREATEST(clientes.cliente.oc_correlativo,
                             mayor expedientes.oc.codigo numérico del cliente) + 1

    · El valor persistido en clientes.cliente.oc_correlativo es el
      ÚLTIMO consumido (editable desde el form de cliente).
    · None si el cliente no tiene serie configurada NI OCs con codigo
      puramente numérico → el caller cae al fallback OC-AUTO-XXXX.
    · UPDATE atómico en UNA sola sentencia (row lock) → dos submissions
      concurrentes no pueden sacar el mismo número.
    · Corre fuera de la tx principal: si ésta hace rollback después, el
      número queda consumido con gap (mismo criterio que las series de
      facturación; la idempotencia por token evita doble consumo en
      reintentos del wizard).
    """
    sql = """
        UPDATE clientes.cliente AS cl
           SET oc_correlativo = GREATEST(
                   COALESCE(cl.oc_correlativo, 0),
                   COALESCE((
                       SELECT MAX(o.codigo::bigint)
                         FROM expedientes.oc o
                        WHERE o.client_id = cl.id
                          AND o.is_active = TRUE
                          AND o.codigo ~ '^[0-9]+$'
                   ), 0)
               ) + 1
         WHERE cl.id = %s::uuid
           AND (
                 cl.oc_correlativo IS NOT NULL
                 OR EXISTS (
                       SELECT 1 FROM expedientes.oc o
                        WHERE o.client_id = cl.id
                          AND o.is_active = TRUE
                          AND o.codigo ~ '^[0-9]+$'
                 )
           )
        RETURNING cl.oc_correlativo
    """
    try:
        with connection.cursor() as c:
            c.execute(sql, [str(client_id)])
            row = c.fetchone()
        return str(row[0]) if row else None
    except Exception as e:
        log.warning("_next_oc_correlativo falló (cliente %s): %s", client_id, e)
        return None


# ═════════════════════════════════════════════════════════════════════
# POST /api/expedientes/create-from-oc/
# ═════════════════════════════════════════════════════════════════════
@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
@permission_classes([IsAuthenticated])
def create_from_oc(request):
    """Orchestrator atómico del Wizard de Creación. Ver docstring del módulo.

    AUTORIZACIÓN:
      · Abierto a CUALQUIER usuario autenticado (IsAuthenticated). Eso incluye
        roles CLIENT_* del Portal B2B — ES INTENCIONAL: el cliente debe poder
        subir su OC desde el portal.
      · El HARD SHIELD de seguridad se hace DENTRO de la función, no a nivel
        de permission_class, porque la misma ruta sirve a ADMIN y CLIENT con
        reglas distintas (lo discrimina `_is_client_role(user.role)`).
      · Para CLIENT: client_id del JWT (no del payload), mode/freight/transport/
        dispatch/price_basis/deferred_total_price nulificados, estado='REGISTRO',
        phase_signal='PENDING_CEO_REVIEW'.
      · Para ADMIN: payload respetado.
    """
    user = request.user
    role = getattr(user, "role", None)
    is_client = _is_client_role(role)

    # ── 1. Idempotencia ─────────────────────────────────────────────
    idem_token = (request.data.get("idempotence_token") or "").strip()
    if idem_token:
        replay = _idempotence_replay(idem_token)
        if replay:
            resp = Response({"ok": True, **replay}, status=200)
            resp["X-Idempotent-Replay"] = "true"
            return resp

    # ── 2. Cargar payload OCR ───────────────────────────────────────
    ocr_payload = _load_ocr_payload(request)
    ocr_lines = ocr_payload.get("lines") or []
    if not isinstance(ocr_lines, list) or len(ocr_lines) == 0:
        return Response({
            "ok":    False,
            "error": "no_lines_in_payload",
            "hint":  "El payload OCR no contiene líneas. Ejecute /api/ocr/parse-oc/ primero.",
        }, status=400)

    # ── 3. Resolver client_id — SEGURIDAD B2B ───────────────────────
    if is_client:
        # JWT manda. Ignoramos cualquier client_id del payload (anti-spoofing).
        forced_cid = (getattr(user, "legal_entity_id", None)
                      or getattr(user, "portal_client_id", None)
                      or getattr(user, "client_id", None))
        # MwtUser (JWT real) expone `legal_entity_ids` (plural, multi-
        # empresa). Si no hay singular, usamos la empresa primaria.
        if not forced_cid:
            _leids = getattr(user, "legal_entity_ids", None) or []
            forced_cid = _leids[0] if _leids else None
        if not forced_cid:
            return Response({
                "ok":    False,
                "error": "client_scope_missing",
                "hint":  "El usuario B2B no tiene legal_entity_id en su token.",
            }, status=403)
        client_id = str(forced_cid)
        # Log silencioso si vino un client_id distinto en el payload (intento)
        payload_cid = request.data.get("client_id")
        if payload_cid and str(payload_cid) != client_id:
            log.warning(
                "B2B client_id spoof intent: user=%s forced=%s payload=%s",
                getattr(user, "email", "?"), client_id, payload_cid,
            )
    else:
        client_id = (
            request.data.get("client_id")
            or (ocr_payload.get("client") or {}).get("id")
        )
        # Fallback: primer candidate del OCR si existe
        cand = (ocr_payload.get("client") or {}).get("_candidates") or []
        if not client_id and cand:
            client_id = cand[0].get("id")

    if not client_id:
        return Response({
            "ok":    False,
            "error": "client_id_required",
            "hint":  "No se pudo resolver el cliente (ni del JWT, ni del payload, ni del OCR).",
        }, status=400)

    # ── 4. Resolver brand_id ────────────────────────────────────────
    brand_id = request.data.get("brand_id")
    if not brand_id:
        b_cand = (ocr_payload.get("brand") or {}).get("_candidates") or []
        if b_cand:
            brand_id = b_cand[0].get("id")
    # (brand_id puede quedar NULL — el CEO lo completa después en CLIENT)

    # ── 4b. R1/R2 · Match por ALIAS DEL CLIENTE (Part Nº de la PO) ──
    # Construimos el índice alias→producto de ESE cliente
    # (productos.product_client_alias) y resolvemos producto_id, SKU MWT,
    # marca y talla por línea. Fallback = lookup por SKU/nombre (hoy).
    # Líneas sin match quedan SIN producto_id con needs_review=True.
    alias_stats = _apply_alias_matching(ocr_lines, client_id)

    # Si el wizard no trajo brand_id, lo derivamos de la marca de los
    # productos matcheados cuando es ÚNICA (aditivo: antes quedaba NULL).
    if not brand_id:
        _marcas = {ln.get("marca_id") for ln in ocr_lines
                   if isinstance(ln, dict) and ln.get("marca_id")}
        if len(_marcas) == 1:
            brand_id = next(iter(_marcas))

    # ── 5. Campos comerciales/logísticos: NULL forzado para CLIENT ─
    client_defaults = _resolve_client_defaults(client_id) if is_client else {}

    # HARD SHIELD: si el caller es CLIENT, los campos comerciales y
    # logísticos se NULIFICAN SIEMPRE — aunque el payload intente colarlos.
    # El cliente NO tiene autoridad sobre:
    #    · mode                  (COMISION vs FULL — decisión CEO)
    #    · freight_mode          (SEA/AIR — logística MWT)
    #    · transport_mode        (MARITIMO/AEREO/TERRESTRE — logística MWT)
    #    · dispatch_mode         (FCL/LCL/CONSOLIDADO — logística MWT)
    #    · price_basis           (FOB/CIF/EXW/DDP — lo define el contrato)
    #    · deferred_total_price  (split de cobro diferido — gobernanza CEO)
    #    · credit_days           (lo hereda del contrato del cliente, no lo
    #                             "pide" por OC; usamos clientes.cliente)
    if is_client:
        mode                  = None
        freight_mode          = None
        transport_mode        = None
        dispatch_mode         = None
        price_basis           = None
        deferred_total_price  = None
        credit_days           = client_defaults.get("credit_days")
        # FIX 2026-06-12: estos dos solo se asignaban en la rama ADMIN →
        # UnboundLocalError en el INSERT para CLIENT (la ruta B2B moría
        # con 500). El cliente no tiene autoridad sobre plazos duales.
        credit_days_mwt       = None
        credit_days_cliente   = None
        moneda                = client_defaults.get("moneda") or (
            (ocr_payload.get("po") or {}).get("currency") or "USD"
        )
        phase_signal          = "PENDING_CEO_REVIEW"
    else:
        mode                  = request.data.get("mode")              # 'COMISION' | 'FULL' | None
        freight_mode          = request.data.get("freight_mode")      # 'SEA' | 'AIR'
        transport_mode        = request.data.get("transport_mode")    # 'MARITIMO' | 'AEREO'
        dispatch_mode         = request.data.get("dispatch_mode")     # 'FCL' | 'LCL' | 'CONSOLIDADO'
        price_basis           = request.data.get("price_basis")       # 'FOB' | 'CIF' | ...
        deferred_total_price  = request.data.get("deferred_total_price")
        credit_days           = request.data.get("credit_days")
        # Sprint 2026-05-24 · plazos duales (operador intermedio)
        credit_days_mwt       = request.data.get("credit_days_mwt")
        credit_days_cliente   = request.data.get("credit_days_cliente")
        moneda                = request.data.get("moneda") or (
            (ocr_payload.get("po") or {}).get("currency") or "USD"
        )
        phase_signal          = "ON_TRACK"

    credit_clock_start_rule = request.data.get("credit_clock_start_rule")

    # ── 6. Datos derivados ──────────────────────────────────────────
    po = ocr_payload.get("po") or {}
    # Sprint 2026-07-18 (G3) · si el wizard no trajo número de PO
    # (portal B2B sin archivo / payload sintético), auto-numeramos con
    # el correlativo del cliente. Sin serie configurada ni OCs numéricas
    # previas → fallback OC-AUTO-XXXX de siempre.
    po_number = (request.data.get("po_number")
                 or po.get("number")
                 or _next_oc_correlativo(client_id)
                 or f"OC-AUTO-{uuid.uuid4().hex[:8].upper()}")

    total_value = Decimal("0")
    for ln in ocr_lines:
        qty = _safe_decimal(ln.get("qty"))
        up  = _safe_decimal(ln.get("unit_price"))
        total_value += qty * up

    # ── 7. Transacción atómica ──────────────────────────────────────
    oc_id         = uuid.uuid4()
    expediente_id = uuid.uuid4()
    artifact_id   = uuid.uuid4()
    corr_id       = uuid.uuid4()
    submission_id = uuid.uuid4()
    expediente_codigo = f"EXP-{po_number}"

    submitted_by_id    = getattr(user, "id", None)
    submitted_by_email = getattr(user, "email", None) or getattr(user, "username", None)
    submitted_role_val = "CLIENT" if is_client else "ADMIN"

    # Si viene file físico, subimos (best-effort, fuera de la tx)
    file_meta = {"storage_url": None, "paperless_task_id": None, "sha256": None,
                 "ext": None, "size_bytes": 0, "name": None}
    f = request.FILES.get("file")
    if f:
        file_bytes = b"".join(chunk for chunk in f.chunks())
        file_meta["name"]       = f.name
        file_meta["size_bytes"] = len(file_bytes)
        file_meta["ext"]        = (f.name or "").rsplit(".", 1)[-1].lower() \
                                  if "." in (f.name or "") else None
        upload = _store_file_bytes(file_bytes, f.name or "oc.pdf",
                                   str(expediente_id), str(artifact_id))
        file_meta.update(upload)

    try:
        with transaction.atomic():
            with connection.cursor() as c:

                # Sprint 2026-06-13 · Se permiten OCs duplicadas por PO
                # (oc.codigo dejó de ser único). Pero expedientes.expediente.
                # codigo SÍ sigue siendo único, así que si el PO se re-registra
                # desambiguamos SOLO el codigo del expediente con sufijo
                # -2, -3… El número de OC/PO (po_number) se conserva tal cual.
                c.execute(
                    "SELECT COUNT(*) FROM expedientes.expediente "
                    "WHERE codigo = %s OR codigo LIKE %s",
                    [expediente_codigo, expediente_codigo + "-%"],
                )
                _exp_dups = int((c.fetchone() or [0])[0] or 0)
                if _exp_dups > 0:
                    expediente_codigo = f"{expediente_codigo}-{_exp_dups + 1}"

                # 7.1 — Insertar OC
                c.execute("""
                    INSERT INTO expedientes.oc (
                        id, codigo, client_id, brand_id,
                        estado, moneda, total_value,
                        issued_at, lines_count, is_active
                    ) VALUES (
                        %s, %s, %s, %s,
                        'PENDIENTE', %s, %s,
                        COALESCE(%s, now()), %s, TRUE
                    )
                """, [
                    str(oc_id), po_number, str(client_id),
                    str(brand_id) if brand_id else None,
                    str(moneda), str(total_value),
                    _safe_date(po.get("date")),
                    len(ocr_lines),
                ])

                # 7.2 — Insertar Expediente
                # ─────────────────────────────────────────────────────
                # HARD SHIELD EN EL INSERT:
                #   · estado = 'REGISTRO' SIEMPRE (hardcoded, no viene del payload)
                #   · dispatch_mode + deferred_total_price explícitos en el
                #     INSERT (para CLIENT quedan NULL con certeza, para ADMIN
                #     respetan el payload).
                # Nota: si el cliente intenta inyectar un `mode` o un
                # `freight_mode` en el payload, el bloque `if is_client` de
                # arriba ya los sobreescribió a None — acá solo los usamos.
                # ─────────────────────────────────────────────────────
                c.execute("""
                    INSERT INTO expedientes.expediente (
                        id, codigo, oc_id, client_id, brand_id,
                        estado, modo_operacion, freight_mode, transport_mode,
                        dispatch_mode, price_basis, credit_clock_start_rule,
                        moneda, total_cost, total_invoiced, total_paid, balance,
                        deferred_total_price,
                        credit_days, credit_days_mwt, credit_days_cliente, phase_signal,
                        submitted_by_role, submitted_by_user_id,
                        submitted_via_portal, submitted_at,
                        artifacts_done, artifacts_total,
                        last_event_at, is_active
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        'REGISTRO', %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, 0, 0, %s,
                        %s,
                        %s, %s, %s, %s,
                        %s, %s,
                        %s, now(),
                        1, 6,
                        now(), TRUE
                    )
                """, [
                    str(expediente_id), expediente_codigo,
                    str(oc_id), str(client_id),
                    str(brand_id) if brand_id else None,
                    mode, freight_mode, transport_mode,
                    dispatch_mode, price_basis, credit_clock_start_rule,
                    str(moneda), str(total_value), str(total_value),
                    str(deferred_total_price) if deferred_total_price is not None else None,
                    credit_days,
                    int(credit_days_mwt) if credit_days_mwt is not None else None,
                    int(credit_days_cliente) if credit_days_cliente is not None else None,
                    phase_signal,
                    submitted_role_val,
                    str(submitted_by_id) if submitted_by_id else None,
                    is_client,
                ])

                # 7.3 — Re-derivar precios desde el motor de pricing (defense in depth)
                # Sprint 2026-05-24 (fix v4) · NO confiamos en el unit_price_mwt
                # / unit_price_client que mande el frontend. Para cada linea
                # llamamos a get_client_price_matrix() del motor canonico y
                # usamos el precio del plazo correspondiente (credit_days_mwt
                # para MWT, credit_days_cliente para cliente).
                #
                # Si la matriz no encuentra precio para algun sku, caemos al
                # valor que vino del frontend como fallback. Asi el wizard
                # sigue funcionando aunque el motor tenga gap.
                _tc_payload = request.data.get("tc_usd_brl")
                try:
                    _tc_val = float(_tc_payload) if _tc_payload else None
                except (TypeError, ValueError):
                    _tc_val = None
                # R3 · Si el caller no mandó TC (portal B2B), lo resolvemos
                # server-side con el MISMO servicio FX (cache commercial +
                # core.fx_service). Tolerante a fallo: None → el motor usa
                # su banda default y/o se conserva el precio del payload.
                if _tc_val is None:
                    _tc_val = _resolve_tc_usd_brl()
                _banda_vigente = pick_band(_tc_val)
                # R3 (Sprint 2026-06-12) · Para el flujo CLIENT B2B el
                # precio de referencia es SIEMPRE el plazo 90d de la banda
                # vigente (la matriz congelada por contrato); los descuentos
                # por pronto pago se negocian después en el pipeline. El
                # flujo ADMIN conserva el plazo del payload (plazos duales).
                if is_client:
                    _cd_mwt    = 90
                    _cd_client = 90
                else:
                    _cd_mwt    = int(credit_days_mwt    or credit_days or 90)
                    _cd_client = int(credit_days_cliente or credit_days or 90)
                _is_mwt_op = (
                    operating_company_id_val is not None and
                    str(operating_company_id_val).lower() == str(MWT_OPERATING_CLIENT_ID).lower()
                ) if 'operating_company_id_val' in dir() else True  # default: asumir MWT operador

                # Sprint 2026-06-12 · _pick_plazo_price ahora vive como
                # función PURA en po_alias_matcher.pick_plazo_price (mismo
                # contrato, testeable). Alias local para el código de abajo.
                _pick_plazo_price = pick_plazo_price

                # Para cada SKU, hacemos UN solo lookup a la matriz y cacheamos
                # (matrix_client por sku, matrix_mwt por sku) para evitar N+1.
                _sku_cache_client = {}
                _sku_cache_mwt    = {}
                for ln in ocr_lines:
                    _sku = (ln.get("sku") or "").strip()
                    _pid = ln.get("producto_id")
                    if not (_sku and _pid):
                        continue
                    # Marca del producto (necesaria para el motor). FIX
                    # 2026-06-12: la columna real es `marca_id`
                    # (sql/40_productos.sql) — `brand_id` no existe y el
                    # SELECT fallido abortaba la transacción atómica.
                    # Si el alias-match ya resolvió la marca, no hay query.
                    _brand_id = ln.get("marca_id")
                    if not _brand_id:
                        try:
                            with connection.cursor() as _c:
                                _c.execute(
                                    "SELECT marca_id FROM productos.producto WHERE id = %s::uuid",
                                    [str(_pid)],
                                )
                                _row = _c.fetchone()
                                _brand_id = _row[0] if _row else None
                        except Exception as _e:
                            log.warning("[wizard.create] marca_id lookup falló sku=%s: %s", _sku, _e)
                    if not _brand_id:
                        continue

                    # Re-derivar precio CLIENTE (al credit_days_cliente)
                    if _sku not in _sku_cache_client:
                        try:
                            _sku_cache_client[_sku] = get_client_price_matrix(
                                client_id=client_id, brand_id=_brand_id,
                                product_sku=_sku, tc_usd_brl=_tc_val,
                            )
                        except Exception as _e:
                            log.warning("[wizard.create] matrix cliente falló sku=%s: %s", _sku, _e)
                            _sku_cache_client[_sku] = None
                    _price_client = _pick_plazo_price(_sku_cache_client.get(_sku), _cd_client)
                    if _price_client is not None:
                        ln["unit_price_client"] = str(_price_client)

                    # Re-derivar precio MWT (al credit_days_mwt) solo si hay operador intermedio
                    if _is_mwt_op:
                        if _sku not in _sku_cache_mwt:
                            try:
                                _sku_cache_mwt[_sku] = get_client_price_matrix(
                                    client_id=MWT_OPERATING_CLIENT_ID, brand_id=_brand_id,
                                    product_sku=_sku, tc_usd_brl=_tc_val,
                                )
                            except Exception as _e:
                                log.warning("[wizard.create] matrix MWT falló sku=%s: %s", _sku, _e)
                                _sku_cache_mwt[_sku] = None
                        _price_mwt = _pick_plazo_price(_sku_cache_mwt.get(_sku), _cd_mwt)
                        if _price_mwt is not None:
                            ln["unit_price_mwt"] = str(_price_mwt)
                    else:
                        # Sin operador intermedio: unit_price_mwt = unit_price_client
                        if _price_client is not None:
                            ln["unit_price_mwt"] = str(_price_client)

                # 7.3 — Insertar Líneas (expedientes.linea)
                # Sprint 2026-05-24 · persistir unit_price_mwt y unit_price_client
                # separados (vienen del wizard Paso 3 segun plazo de cada perspectiva).
                # unit_price (legacy) = unit_price_client si existe, sino unit_price.
                created_lines = []
                for ln in ocr_lines:
                    line_id = uuid.uuid4()
                    qty = _safe_decimal(ln.get("qty"))
                    up  = _safe_decimal(ln.get("unit_price"))
                    up_client = _safe_decimal(ln.get("unit_price_client") or up)
                    up_mwt    = _safe_decimal(ln.get("unit_price_mwt")    or up)
                    total_price = qty * up_client
                    c.execute("""
                        INSERT INTO expedientes.linea (
                            id, oc_id, expediente_id, producto_id,
                            sku, size, qty,
                            unit_price, unit_price_client, unit_price_mwt,
                            total_price, notas,
                            estado, is_active
                        ) VALUES (
                            %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s,
                            'PENDIENTE', TRUE
                        )
                    """, [
                        str(line_id), str(oc_id), str(expediente_id),
                        str(ln.get("producto_id")) if ln.get("producto_id") else None,
                        ln.get("sku"), ln.get("size"),
                        str(qty),
                        str(up), str(up_client), str(up_mwt),
                        str(total_price),
                        ln.get("_notas") or ln.get("notas"),
                    ])
                    created_lines.append({
                        "id":                 str(line_id),
                        "producto_id":        (str(ln.get("producto_id"))
                                               if ln.get("producto_id") else None),
                        "sku":                ln.get("sku"),
                        "client_part_number": ln.get("client_part_number"),
                        "size":               ln.get("size"),
                        "qty":                float(qty),
                        "unit_price":         float(up),
                        "unit_price_client":  float(up_client),
                        "unit_price_mwt":     float(up_mwt),
                        "matched_via":        ln.get("matched_via"),
                        "matched_alias":      ln.get("matched_alias"),
                        "needs_review":       bool(ln.get("needs_review")),
                    })

                # 7.4 — Insertar ART-01 (OC Cliente) en artifact_instances
                art01_payload = {
                    "po_number":           po_number,
                    "lines_count":         len(ocr_lines),
                    "ocr_confidence":      ocr_payload.get("confidence"),
                    "ocr_engine":          ocr_payload.get("ocr_engine"),
                    "source":              "wizard",
                    "submitted_by_role":   submitted_role_val,
                    "file_sha256":         file_meta.get("sha256"),
                    "paperless_task_id":   file_meta.get("paperless_task_id"),
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
                        'ART-01', 'OC Cliente', %s,
                        %s, %s, %s, %s,
                        'DONE', %s, %s, %s::jsonb,
                        'C1', %s,
                        %s, now(), %s, TRUE
                    )
                """, [
                    str(artifact_id), str(expediente_id), str(oc_id),
                    po_number,
                    file_meta.get("ext"), file_meta.get("size_bytes") or 0,
                    file_meta.get("storage_url"), file_meta.get("paperless_task_id"),
                    ocr_payload.get("ocr_engine") or "manual",
                    float(ocr_payload.get("confidence") or 0),
                    json.dumps(art01_payload),
                    str(corr_id),
                    submitted_by_email or "system",
                    "PARTNER_B2B" if is_client else "INTERNAL",
                ])

                # 7.4b — R4 · expedientes.documento kind='OC' con código
                # "PO <numero>" — ligado al expediente recién creado y con
                # audience='CLIENT' para que aparezca en "Documentos
                # comerciales" del detalle (el front lee _docsByKind('OC')).
                documento_id = uuid.uuid4()
                po_codigo = format_po_codigo(po_number) or f"PO {po_number}"
                c.execute("""
                    INSERT INTO expedientes.documento (
                        id, oc_id, expediente_id,
                        kind, codigo,
                        file_ext, file_size_bytes, storage_url,
                        author, fecha, audience, is_active
                    ) VALUES (
                        %s, %s, %s,
                        'OC', %s,
                        %s, %s, %s,
                        %s, CURRENT_DATE, 'CLIENT', TRUE
                    )
                """, [
                    str(documento_id), str(oc_id), str(expediente_id),
                    po_codigo,
                    file_meta.get("ext"), file_meta.get("size_bytes") or 0,
                    file_meta.get("storage_url"),
                    submitted_by_email or "system",
                ])

                # 7.5 — Event log (pipeline.event_log)
                event_payload = {
                    "po_number":           po_number,
                    "artifact_id":         str(artifact_id),
                    "artifact_code":       "ART-01",
                    "lines_count":         len(ocr_lines),
                    "submitted_via_portal": is_client,
                    "submitted_by_role":   submitted_role_val,
                    "requires_ceo_review": is_client,
                    "total_value":         float(total_value),
                }
                c.execute("""
                    INSERT INTO pipeline.event_log (
                        id, correlation_id, event_type, aggregate_type, aggregate_id,
                        action_source, previous_status, new_status,
                        phase_from, phase_to, payload,
                        emitted_by_id, emitted_by_role, idempotence_token, is_active
                    ) VALUES (
                        %s, %s, 'expediente.created_from_oc', 'expediente', %s,
                        'C1', NULL, 'REGISTRO',
                        NULL, 'REGISTRO', %s::jsonb,
                        %s, %s, %s, TRUE
                    )
                """, [
                    str(uuid.uuid4()), str(corr_id), str(expediente_id),
                    json.dumps(event_payload),
                    str(submitted_by_id) if submitted_by_id else None,
                    submitted_role_val.lower(),
                    idem_token or None,
                ])

                # 7.6 — Wizard submission log (auditoría)
                c.execute("""
                    INSERT INTO expedientes.wizard_submission_log (
                        id, expediente_id, oc_id, client_id, brand_id,
                        submitted_by_role, submitted_by_id, submitted_by_email,
                        submitted_via,
                        file_name, file_ext, file_size_bytes, file_sha256,
                        ocr_confidence, lines_extracted, lines_accepted,
                        status, idempotence_token, correlation_id, payload
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        'SUCCESS', %s, %s, %s::jsonb
                    )
                """, [
                    str(submission_id), str(expediente_id), str(oc_id),
                    str(client_id),
                    str(brand_id) if brand_id else None,
                    submitted_role_val,
                    str(submitted_by_id) if submitted_by_id else None,
                    submitted_by_email,
                    "portal" if is_client else "backoffice",
                    file_meta.get("name"), file_meta.get("ext"),
                    file_meta.get("size_bytes") or 0, file_meta.get("sha256"),
                    float(ocr_payload.get("confidence") or 0),
                    len(ocr_lines), len(ocr_lines),
                    idem_token or None, str(corr_id),
                    json.dumps({
                        "po_number":       po_number,
                        "mapped_columns":  ocr_payload.get("mapped_columns"),
                        "sheet_name":      ocr_payload.get("sheet_name"),
                        "storage_url":     file_meta.get("storage_url"),
                    }),
                ])

    except Exception as e:
        log.exception("create_from_oc atomic tx falló: %s", e)
        # Log de submission en modo CRASHED (best-effort, fuera de la tx rollbacked)
        try:
            with connection.cursor() as c:
                c.execute("""
                    INSERT INTO expedientes.wizard_submission_log (
                        id, client_id, submitted_by_role, submitted_by_id,
                        submitted_by_email, submitted_via,
                        status, rejection_reason,
                        idempotence_token, correlation_id
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s,
                        'CRASHED', %s,
                        %s, %s
                    )
                    ON CONFLICT (idempotence_token) DO NOTHING
                """, [
                    str(uuid.uuid4()), str(client_id),
                    submitted_role_val,
                    str(submitted_by_id) if submitted_by_id else None,
                    submitted_by_email,
                    "portal" if is_client else "backoffice",
                    str(e)[:250], idem_token or None, str(corr_id),
                ])
        except Exception:
            pass
        return Response({
            "ok":    False,
            "error": "transaction_failed",
            "detail": str(e),
        }, status=500)

    # ── 7.9 · Notificación a admins (portal B2B) — best-effort ─────
    # Sprint 2026-07-15 · cuando un cliente/usuario del portal crea un
    # expediente, los admins se enteran por email y por la campana del
    # sitio (users.activity_feed). Nunca rompe la creación.
    if is_client:
        try:
            _notify_admins_expediente_created(
                expediente_id=expediente_id,
                expediente_codigo=expediente_codigo,
                po_number=po_number,
                client_id=client_id,
                total_value=total_value,
                moneda=moneda,
                lines_count=len(ocr_lines),
                submitted_by_email=submitted_by_email,
                oc_id=oc_id,
                lines=ocr_lines,
            )
        except Exception:  # noqa: BLE001
            log.exception("create_from_oc: notificación a admins falló (no fatal)")

    # ── 8. Respuesta ────────────────────────────────────────────────
    return Response({
        "ok":                True,
        "command":           "C1",
        "expediente": {
            "id":                  str(expediente_id),
            "codigo":              expediente_codigo,
            "estado":              "REGISTRO",
            "client_id":           str(client_id),
            "brand_id":            str(brand_id) if brand_id else None,
            "modo_operacion":      mode,
            "freight_mode":        freight_mode,
            "transport_mode":      transport_mode,
            "dispatch_mode":       dispatch_mode,
            "price_basis":         price_basis,
            "credit_clock_start_rule": credit_clock_start_rule,
            "moneda":              moneda,
            "total_cost":          float(total_value),
            "deferred_total_price": float(deferred_total_price) if deferred_total_price is not None else None,
            "phase_signal":        phase_signal,
            "submitted_via_portal": is_client,
            "submitted_by_role":   submitted_role_val,
        },
        "oc": {
            "id":        str(oc_id),
            "codigo":    po_number,
            "lines_count": len(ocr_lines),
        },
        "document": {
            "id":       str(documento_id),
            "kind":     "OC",
            "codigo":   po_codigo,
            "audience": "CLIENT",
        },
        "lines":          created_lines,
        "alias_match": {
            **alias_stats,
            "tc_usd_brl": _tc_val,
            "banda_id":   _banda_vigente,
        },
        "artifact_id":    str(artifact_id),
        "correlation_id": str(corr_id),
        "submission_id":  str(submission_id),
        "requires_ceo_review": is_client,
    }, status=201)
