"""
=====================================================================
MWT.ONE · apps.expedientes.views_product_ocs
Agente responsable: [AG-BACKEND]

Endpoint dedicado para el tab "Expedientes" del detalle de producto:
para un SKU dado, lista todas las OCs donde aparece como línea, con
sus líneas (tallas, cantidades, precios) + cliente.

GET /api/expedientes/products/<sku>/ocs/

Visibilidad:
  · Admin / CEO / staff MWT  → ve todas las OCs con ese SKU.
  · CLIENT_*                 → filtrado a OCs cuyo client_id = JWT
                               client_id (igual que el resto de
                               vistas comerciales).

Forma del response:
  {
    "sku": "700728",
    "count": 2,
    "ocs": [
      {
        "id": "<uuid>",
        "codigo": "OC-2026-...",
        "proforma": "PF-0942",
        "estado": "EN_PRODUCCION",
        "moneda": "USD",
        "issued_at": "2026-04-01",
        "is_operated_by_mwt": true,
        "cliente": {
          "id": "<uuid>",
          "razon_social": "Sondel S.A.",
          "nombre_comercial": null,
          "pais_iso2": "CR"
        },
        "lineas": [
          {
            "id": "<uuid>",
            "size": "37",
            "qty": 10.0,
            "unit_price_mwt": 36.46,
            "unit_price_client": 48.74,
            "total_price": 365.00,
            "sap": "263360",
            "estado": "..."
          },
          ...
        ],
        "totals": {
          "qty": 260,
          "lines": 10,
          "total_mwt": 9479.60,
          "total_client": 12672.40
        }
      }
    ]
  }
=====================================================================
"""
import logging
from decimal import Decimal

from django.db import connection
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.constants import MWT_OPERATING_CLIENT_ID

log = logging.getLogger(__name__)


def _client_id_for(request):
    """Devuelve client_id del JWT si el rol es CLIENT_*, sino None.

    Centraliza el filtrado B2B: cuando un cliente final entra al tab
    Expedientes de un producto, solo debe ver SUS OCs.
    """
    user = getattr(request, "user", None)
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    role = (getattr(user, "role_default", "") or
            getattr(user, "role", "") or "")
    try:
        role_upper = str(role).upper()
    except (TypeError, ValueError):
        return None
    if role_upper.startswith("CLIENT_") or role_upper in (
        "CLIENT", "CLIENTE", "CLIENT_B2B",
    ):
        return str(getattr(user, "client_id", "") or "") or None
    return None


def _to_float(val):
    """Decimal/None → float (o 0.0) — JSON-safe."""
    if val is None:
        return 0.0
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


class ProductOcsView(APIView):
    """GET · OCs agrupadas que contienen el SKU pedido."""
    permission_classes = [IsAuthenticated]

    def get(self, request, sku):
        sku = (sku or "").strip()
        if not sku:
            return Response({"detail": "sku requerido."}, status=400)

        client_filter = _client_id_for(request)

        # Consulta directa: traemos líneas (con su oc_id, datos de precios,
        # talla, qty, sap, estado) + datos del OC (proforma, codigo, estado,
        # moneda, issued_at, client_id, operating_company_id) + datos del
        # cliente final del OC. Una sola pasada, ordenada por OC y por size.
        params = [sku]
        client_clause = ""
        if client_filter:
            client_clause = " AND o.client_id = %s::uuid "
            params.append(client_filter)

        sql = f"""
            SELECT
                l.id              AS linea_id,
                l.size            AS size,
                l.qty             AS qty,
                l.unit_price_mwt  AS unit_price_mwt,
                l.unit_price_client AS unit_price_client,
                l.unit_price      AS unit_price_legacy,
                l.total_price     AS total_price,
                l.sap             AS sap,
                l.estado          AS linea_estado,
                o.id              AS oc_id,
                o.codigo          AS oc_codigo,
                o.proforma        AS oc_proforma,
                o.estado          AS oc_estado,
                o.moneda          AS oc_moneda,
                o.issued_at       AS oc_issued_at,
                o.client_id       AS oc_client_id,
                o.brand_id        AS oc_brand_id,
                c.razon_social    AS cliente_razon,
                c.nombre_comercial AS cliente_nombre,
                c.pais_iso2       AS cliente_pais
            FROM expedientes.linea l
            JOIN expedientes.oc o ON o.id = l.oc_id
            LEFT JOIN clientes.cliente c ON c.id = o.client_id
            WHERE l.is_active = TRUE
              AND o.is_active = TRUE
              AND l.sku = %s
              {client_clause}
            ORDER BY o.issued_at DESC NULLS LAST, o.codigo, l.size
        """

        mwt_op_id = str(MWT_OPERATING_CLIENT_ID) if MWT_OPERATING_CLIENT_ID else None
        # NOTA: El campo operating_company_id vive en `expedientes.expediente`,
        # no en `expedientes.oc`. Un OC puede tener múltiples expedientes con
        # operadores distintos. Para el indicador `is_operated_by_mwt` usamos
        # un query secundario chico (no es bloqueante si falla).
        ocs_map = {}  # {oc_id: oc_data}
        try:
            with connection.cursor() as cur:
                cur.execute(sql, params)
                cols = [c[0] for c in cur.description]
                for row in cur.fetchall():
                    r = dict(zip(cols, row))
                    oc_id = str(r["oc_id"])
                    if oc_id not in ocs_map:
                        ocs_map[oc_id] = {
                            "id":         oc_id,
                            "codigo":     r["oc_codigo"],
                            "proforma":   r["oc_proforma"],
                            "estado":     r["oc_estado"],
                            "moneda":     r["oc_moneda"] or "USD",
                            "issued_at":  r["oc_issued_at"].isoformat()
                                          if r["oc_issued_at"] else None,
                            "brand_id":   str(r["oc_brand_id"]) if r["oc_brand_id"] else None,
                            "is_operated_by_mwt": False,  # se ajusta abajo
                            "cliente": {
                                "id": str(r["oc_client_id"]) if r["oc_client_id"] else None,
                                "razon_social":     r["cliente_razon"],
                                "nombre_comercial": r["cliente_nombre"],
                                "pais_iso2":        r["cliente_pais"],
                            },
                            "lineas": [],
                            "totals": {
                                "qty": 0.0, "lines": 0,
                                "total_mwt": 0.0, "total_client": 0.0,
                            },
                        }
                    qty = _to_float(r["qty"])
                    up_mwt = _to_float(r["unit_price_mwt"])
                    up_cli = _to_float(r["unit_price_client"])
                    up_leg = _to_float(r["unit_price_legacy"])
                    total  = _to_float(r["total_price"])
                    # Si los snapshots dual están en 0, usar el legacy como
                    # fallback (compatibilidad con líneas anteriores al
                    # sprint 2026-05-06).
                    if up_mwt == 0.0 and up_leg != 0.0: up_mwt = up_leg
                    if up_cli == 0.0 and up_leg != 0.0: up_cli = up_leg

                    ocs_map[oc_id]["lineas"].append({
                        "id":                 str(r["linea_id"]),
                        "size":               r["size"],
                        "qty":                qty,
                        "unit_price_mwt":     up_mwt,
                        "unit_price_client":  up_cli,
                        "total_price":        total,
                        "sap":                r["sap"],
                        "estado":             r["linea_estado"],
                    })
                    t = ocs_map[oc_id]["totals"]
                    t["qty"]          += qty
                    t["lines"]        += 1
                    t["total_mwt"]    += qty * up_mwt
                    t["total_client"] += qty * up_cli
        except Exception as exc:  # noqa: BLE001
            log.warning("ProductOcsView query failed: %s", exc)
            return Response({"detail": str(exc)}, status=500)

        # Calcular is_operated_by_mwt por OC (un OC puede tener N expedientes
        # con operadores distintos; aquí marcamos TRUE si al menos UNO de
        # ellos es operado por MWT). Si MWT_OPERATING_CLIENT_ID no está
        # configurado, dejamos todos en False.
        if mwt_op_id and ocs_map:
            oc_ids = list(ocs_map.keys())
            try:
                with connection.cursor() as cur:
                    cur.execute("""
                        SELECT DISTINCT oc_id
                          FROM expedientes.expediente
                         WHERE oc_id::text = ANY(%s)
                           AND operating_company_id = %s::uuid
                           AND is_active = TRUE
                    """, [oc_ids, mwt_op_id])
                    for (oc_id_val,) in cur.fetchall():
                        key = str(oc_id_val)
                        if key in ocs_map:
                            ocs_map[key]["is_operated_by_mwt"] = True
            except Exception as exc:  # noqa: BLE001
                log.debug("ProductOcsView operator lookup failed: %s", exc)

        # Redondeo final de totales para JSON.
        for oc in ocs_map.values():
            oc["totals"]["total_mwt"]    = round(oc["totals"]["total_mwt"], 2)
            oc["totals"]["total_client"] = round(oc["totals"]["total_client"], 2)
            oc["totals"]["qty"]          = round(oc["totals"]["qty"], 2)

        ocs_list = list(ocs_map.values())
        return Response({
            "sku":   sku,
            "count": len(ocs_list),
            "ocs":   ocs_list,
        }, status=200)
