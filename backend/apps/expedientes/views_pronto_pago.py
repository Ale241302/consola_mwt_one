"""
=====================================================================
MWT.ONE · apps.expedientes.views_pronto_pago
Agente responsable: [AG-BACKEND]

Endpoint: POST /api/expedientes/{expediente_id}/apply-pronto-pago/

Aplica el descuento/recargo del tier de pronto pago a unit_price_client
de las líneas del expediente que correspondan a los SKU+talla extraídos
de la proforma. Por diseño:

  · SOLO modifica `unit_price_client` (vista del cliente final).
  · `unit_price_mwt` queda INTACTO (snapshot interno MWT).
  · `unit_price` (legacy = precio del operador) se actualiza solo si
    el expediente está operado por el cliente final (porque ahí
    unit_price === unit_price_client).
  · `total_price` se recalcula en línea con la fórmula:
      total_price = qty * unit_price_efectivo_del_operador.
  · Las líneas que NO aparecen en `covered_pairs` quedan sin tocar.

Idempotencia: cada llamada re-resuelve el BASE desde el catálogo
(producto.especificaciones.client_prices[client_id]) — así aplicar
el tier dos veces no acumula descuentos.

Sprint 2026-05-10 (AG-03).
=====================================================================
"""
from __future__ import annotations

import json
import logging
from decimal import Decimal, InvalidOperation

from django.db import connection, transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.constants import MWT_OPERATING_CLIENT_ID

from .views import _deny_client_mutation

log = logging.getLogger(__name__)


# ── Tiers de pronto pago (en sync con frontend wizard + proforma_renderer)
# Cambiar aquí requiere actualizar los otros dos archivos también.
PRONTO_PAGO_TIERS = {
    8:   Decimal("-0.0275"),
    30:  Decimal("-0.0175"),
    60:  Decimal("-0.0100"),
    90:  Decimal("0.0000"),
    120: Decimal("0.0100"),
}


def _resolve_base_unit_price_client(producto_row, client_id) -> Decimal | None:
    """Resuelve el precio BASE del cliente para un producto desde el
    catálogo. Prioridad:
      1) especificaciones.client_prices[client_id]  (override directo)
      2) precio_lista                                (fallback)
      3) None                                        (último recurso)
    """
    if not producto_row:
        return None

    _id, _sku, especificaciones_json, precio_lista = producto_row
    cp_map = especificaciones_json or {}
    if isinstance(cp_map, str):
        try:
            cp_map = json.loads(cp_map)
        except (TypeError, ValueError):
            cp_map = {}
    cp_map = cp_map.get("client_prices") if isinstance(cp_map, dict) else None
    cp_map = cp_map or {}

    val = cp_map.get(str(client_id)) or cp_map.get(client_id)
    if val is not None:
        try:
            d = Decimal(str(val))
            if d > 0:
                return d
        except (TypeError, ValueError, InvalidOperation):
            pass

    try:
        d = Decimal(str(precio_lista or 0))
        if d > 0:
            return d
    except (TypeError, ValueError, InvalidOperation):
        pass

    return None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def apply_pronto_pago(request, expediente_id):
    """POST /api/expedientes/{id}/apply-pronto-pago/

    Body JSON:
        {
          "plazo_days":   8 | 30 | 60 | 90 | 120,
          "covered_pairs": [
            {"sku": "70C32-PET-E-CPAP-PAD", "size": "39"},
            ...
          ]
        }

    Solo Admin/CEO/MWT staff. CLIENT_* recibe 403.

    Returns:
        200 OK con resumen:
            {
              "ok": true,
              "expediente_id": "...",
              "plazo_days": 8,
              "tier_pct": -2.75,
              "lines_updated": 9,
              "lines_skipped": 1,
              "updates": [{linea_id, sku, size, old_price, new_price, ...}]
            }
    """
    denied = _deny_client_mutation(request, action_label="expediente.apply_pronto_pago")
    if denied is not None:
        return denied

    # Validar body
    body = request.data if isinstance(request.data, dict) else {}
    try:
        plazo_days = int(body.get("plazo_days") or 0)
    except (TypeError, ValueError):
        return Response({"detail": "plazo_days inválido"}, status=400)

    if plazo_days not in PRONTO_PAGO_TIERS:
        return Response({
            "detail": f"plazo_days debe ser uno de {sorted(PRONTO_PAGO_TIERS.keys())}",
        }, status=400)

    covered_pairs = body.get("covered_pairs") or []
    if not isinstance(covered_pairs, list):
        return Response({"detail": "covered_pairs debe ser una lista"}, status=400)

    # Normalizar pares: (sku_upper, size_upper). Si falla, skip pero loggear.
    pairs_set: set[tuple[str, str | None]] = set()
    for item in covered_pairs:
        if not isinstance(item, dict):
            continue
        sku = (item.get("sku") or "").strip().upper()
        # Talla puede venir como `size`, `talla`, o ser None (línea sin talla).
        size_raw = item.get("size") if "size" in item else item.get("talla")
        size = (str(size_raw).strip().upper() if size_raw not in (None, "") else None)
        if not sku:
            continue
        pairs_set.add((sku, size))

    if not pairs_set:
        return Response({
            "detail": "covered_pairs vacío — nada que actualizar",
            "lines_updated": 0,
            "lines_skipped": 0,
        }, status=200)

    tier_pct  = PRONTO_PAGO_TIERS[plazo_days]
    multiplier = Decimal("1") + tier_pct

    # ── Cargar expediente: client_id + operating_company_id ─────────
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT id::text, client_id::text, operating_company_id::text
                  FROM expedientes.expediente
                 WHERE id = %s::uuid
            """, [str(expediente_id)])
            row = c.fetchone()
    except Exception as e:
        log.exception("[apply_pronto_pago] no pude leer expediente: %s", e)
        return Response({"detail": "expediente_read_failed",
                         "error": str(e)[:200]}, status=500)

    if not row:
        return Response({"detail": "Expediente no encontrado"}, status=404)

    _exp_id, client_id, operating_company_id = row
    is_mwt_operated = (
        str(operating_company_id or "").lower()
        == str(MWT_OPERATING_CLIENT_ID).lower()
    )

    # ── Cargar todas las líneas activas del expediente ─────────────
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT id::text, sku, size, qty,
                       unit_price, unit_price_mwt, unit_price_client,
                       producto_id::text
                  FROM expedientes.linea
                 WHERE expediente_id = %s::uuid
                   AND COALESCE(is_active, TRUE) = TRUE
            """, [str(expediente_id)])
            lineas = c.fetchall()
    except Exception as e:
        log.exception("[apply_pronto_pago] no pude leer líneas: %s", e)
        return Response({"detail": "lineas_read_failed",
                         "error": str(e)[:200]}, status=500)

    if not lineas:
        return Response({
            "detail": "Expediente sin líneas activas",
            "lines_updated": 0,
            "lines_skipped": 0,
        }, status=200)

    # ── Identificar líneas matched ─────────────────────────────────
    matched_lineas   = []
    unmatched_lineas = []
    for ln in lineas:
        linea_id, sku, size, qty, up, up_mwt, up_cli, producto_id = ln
        sku_norm  = (sku or "").strip().upper()
        size_norm = (str(size).strip().upper() if size else None)
        if (sku_norm, size_norm) in pairs_set:
            matched_lineas.append({
                "id": linea_id, "sku": sku, "size": size, "qty": qty,
                "unit_price": up, "unit_price_mwt": up_mwt,
                "unit_price_client": up_cli,
                "producto_id": producto_id,
            })
        else:
            unmatched_lineas.append(linea_id)

    if not matched_lineas:
        return Response({
            "ok": True,
            "detail": "Ninguna línea del expediente matchea los covered_pairs",
            "plazo_days": plazo_days,
            "tier_pct": float(tier_pct * 100),
            "lines_updated": 0,
            "lines_skipped": len(lineas),
        }, status=200)

    # ── Fetch base prices desde catálogo ────────────────────────────
    unique_pids = list({l["producto_id"] for l in matched_lineas if l["producto_id"]})
    productos_by_id = {}
    if unique_pids:
        try:
            placeholders = ",".join(["%s::uuid"] * len(unique_pids))
            with connection.cursor() as c:
                c.execute(f"""
                    SELECT id::text, sku,
                           COALESCE(especificaciones, '{{}}'::jsonb) AS espec,
                           precio_lista
                      FROM productos.producto
                     WHERE id IN ({placeholders})
                """, unique_pids)
                for r in c.fetchall():
                    productos_by_id[r[0]] = r
        except Exception as e:
            log.warning("[apply_pronto_pago] fetch productos falló: %s", e)

    # ── Calcular y aplicar updates ──────────────────────────────────
    updates = []
    try:
        with transaction.atomic():
            with connection.cursor() as c:
                for ml in matched_lineas:
                    pid = ml["producto_id"]
                    producto_row = productos_by_id.get(pid) if pid else None
                    base = _resolve_base_unit_price_client(producto_row, client_id)
                    if base is None:
                        # Sin base resoluble, fallback: usar el unit_price_client
                        # actual como "base". Esto es idempotente solo si ningún
                        # tier se aplicó antes — log warning para auditar.
                        log.warning(
                            "[apply_pronto_pago] sin base de catálogo para linea %s "
                            "(sku=%s) — uso unit_price_client actual como base",
                            ml["id"], ml["sku"],
                        )
                        try:
                            base = Decimal(str(ml["unit_price_client"] or 0))
                        except (TypeError, ValueError):
                            base = Decimal("0")

                    new_unit_price_client = (base * multiplier).quantize(Decimal("0.01"))

                    # unit_price (legacy del operador):
                    #   - MWT-operated → queda como unit_price_mwt (intacto)
                    #   - Client-operated → matchea unit_price_client (nuevo)
                    if is_mwt_operated:
                        new_unit_price = ml["unit_price_mwt"] or Decimal("0")
                    else:
                        new_unit_price = new_unit_price_client

                    qty_d = Decimal(str(ml["qty"] or 0))
                    new_total = (Decimal(str(new_unit_price)) * qty_d).quantize(Decimal("0.01"))

                    c.execute("""
                        UPDATE expedientes.linea
                           SET unit_price_client = %s,
                               unit_price        = %s,
                               total_price       = %s,
                               updated_at        = NOW()
                         WHERE id = %s::uuid
                    """, [
                        new_unit_price_client,
                        new_unit_price,
                        new_total,
                        ml["id"],
                    ])

                    updates.append({
                        "linea_id":  ml["id"],
                        "sku":       ml["sku"],
                        "size":      ml["size"],
                        "qty":       int(ml["qty"] or 0),
                        "base":      str(base),
                        "old_unit_price_client": str(ml["unit_price_client"] or 0),
                        "new_unit_price_client": str(new_unit_price_client),
                        "unit_price_mwt_unchanged": str(ml["unit_price_mwt"] or 0),
                        "new_total_price": str(new_total),
                    })
    except Exception as e:
        log.exception("[apply_pronto_pago] update falló: %s", e)
        return Response({"detail": "update_failed",
                         "error": str(e)[:200]}, status=500)

    log.info(
        "[apply_pronto_pago] expediente=%s plazo=%dd tier=%.2f%% updated=%d skipped=%d",
        str(expediente_id), plazo_days, float(tier_pct * 100),
        len(updates), len(unmatched_lineas),
    )

    return Response({
        "ok": True,
        "expediente_id":      str(expediente_id),
        "plazo_days":         plazo_days,
        "tier_pct":           float(tier_pct * 100),
        "is_mwt_operated":    is_mwt_operated,
        "lines_updated":      len(updates),
        "lines_skipped":      len(unmatched_lineas),
        "updates":            updates,
    }, status=200)
