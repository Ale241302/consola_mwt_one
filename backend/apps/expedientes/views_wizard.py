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
import uuid
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

from django.db import connection, transaction
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.ocr.services import parse_oc_auto

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
            c.execute("""
                SELECT
                    COALESCE(credit_days, 0),
                    COALESCE(moneda_default, 'USD')
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

    # 2) Signed URL MinIO (putObject fire-and-forget)
    try:
        from apps.storage.services import generate_signed_url
        signed = generate_signed_url(key=key, kind="put", ttl=3600)
        out["storage_url"] = signed.get("url")
    except Exception as e:
        log.debug("generate_signed_url (ART-01) no disponible: %s", e)

    return out


def _idempotence_replay(token: str) -> Optional[dict]:
    """Busca un wizard_submission_log previo con este token.
    Devuelve el expediente que produjo (si alguno) o None."""
    if not token:
        return None
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT expediente_id, client_id, submitted_at, payload, status
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
    po_number = (request.data.get("po_number")
                 or po.get("number")
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

                # 7.3 — Insertar Líneas (expedientes.linea)
                # Sprint 2026-05-24 · persistir unit_price_mwt y unit_price_client
                # separados (vienen del wizard Paso 3 segun plazo de cada perspectiva).
                # unit_price (legacy) = unit_price_client si existe, sino unit_price.
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
                            total_price,
                            estado, is_active
                        ) VALUES (
                            %s, %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s,
                            'PENDIENTE', TRUE
                        )
                    """, [
                        str(line_id), str(oc_id), str(expediente_id),
                        str(ln.get("producto_id")) if ln.get("producto_id") else None,
                        ln.get("sku"), ln.get("size"),
                        str(qty),
                        str(up), str(up_client), str(up_mwt),
                        str(total_price),
                    ])

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
        "artifact_id":    str(artifact_id),
        "correlation_id": str(corr_id),
        "submission_id":  str(submission_id),
        "requires_ceo_review": is_client,
    }, status=201)
