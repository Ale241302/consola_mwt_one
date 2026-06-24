"""
=====================================================================
MWT.ONE · apps.transfers.liquidation
Agente responsable: [AG-BACKEND]

Motor de Landed Cost. Lógica financiera del prorrateo multidivisa.

Algoritmo (BY_VALUE — MVP):
  1. fob_total_usd = SUM(qty * unit_value) por línea.
  2. extra_costs_usd = SUM(amount * fx_to_usd) de cost_lines activas.
  3. Por cada línea:
       weight = (qty * unit_value) / fob_total_usd
       cost_share_usd = extra_costs_usd * weight
       landed_cost_usd = unit_value + (cost_share_usd / qty)
  4. Persistimos cost_share_usd y landed_cost_usd en cada línea.
  5. Marcamos la transferencia con liquidated_at / liquidated_by.

POL_VISIBILIDAD: el reporte completo es INTERNAL/CEO-ONLY. Los clientes
B2B no acceden ni a los costos ni al landed cost real.
=====================================================================
"""
from decimal import Decimal, ROUND_HALF_UP
from django.db import transaction
from django.utils import timezone

from .models import Transferencia, Linea, CostLine


D = Decimal
ZERO = D("0")


def _money(x):
    """Cuantiza a 4 decimales (precisión interna)."""
    return D(str(x or 0)).quantize(D("0.0001"), rounding=ROUND_HALF_UP)


# Tipos de costo NO capitalizables al landed cost: el IVA es crédito fiscal
# acreditable (no forma parte del costo real). DAI/Ley 6946/PROCOMER SÍ capitalizan.
NON_CAPITALIZABLE_KINDS = {"IVA"}


def _cost_in_scope(scope, producto_id, size, exp_by_key):
    """¿La línea (producto_id, size) entra en el `scope_json` de un CostLine?
    Shapes (91l_cost_line_scope.sql): None/{"applies_to_all":true} -> todo;
    {"lines":[{producto_id, talla}]} (manda sobre expediente_ids);
    {"expediente_ids":[...]}. La talla del scope se llama `talla`; en la línea es `size`."""
    if not scope:
        return True
    lines = scope.get("lines")
    if lines:
        pid = str(producto_id or "")
        sz = str(size or "")
        for sl in lines:
            slp = str(sl.get("producto_id") or "")
            slt = str(sl.get("talla") or sl.get("size") or "")
            if (not slp or slp == pid) and (not slt or slt == sz):
                return True
        return False
    exp_ids = scope.get("expediente_ids")
    if exp_ids:
        eid = exp_by_key.get((str(producto_id or ""), str(size or "")))
        return eid is not None and str(eid) in {str(x) for x in exp_ids}
    return True  # applies_to_all (true/ausente) o sin restricción


def _build_exp_by_key(transferencia):
    """Mapa (producto_id, size) -> expediente_id vía inventario.expediente_nodo_assignment
    (la línea de transferencia NO guarda expediente_id). Best-effort; {} si falla."""
    out = {}
    try:
        from django.db import connection
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT a.producto_id::text, COALESCE(a.talla, ''), a.expediente_id::text
                  FROM inventario.expediente_nodo_assignment a
                 WHERE a.transferencia_id = %s AND a.is_active = TRUE
                   AND a.nodo_id = %s
                """,
                [str(transferencia.id), str(transferencia.destino_id)],
            )
            for pid, talla, eid in cur.fetchall():
                out[(str(pid), str(talla))] = eid
    except Exception:
        pass
    return out


def calcular_liquidacion(transferencia, *, persist=False, actor_id=None, actor_name=None):
    """Ejecuta el cálculo de Landed Cost.

    Args:
        transferencia: instancia de Transferencia.
        persist: si True, guarda landed_cost_usd / cost_share_usd en cada
                 Linea y marca la transferencia con liquidated_at.
        actor_id, actor_name: para audit (solo si persist=True).

    Returns:
        dict con el shape del reporte ("factura interna").
    """
    lineas = list(Linea.objects.filter(
        transferencia_id=transferencia.id, is_active=True
    ).order_by("created_at"))
    costs  = list(CostLine.objects.filter(
        transferencia_id=transferencia.id, is_active=True
    ).order_by("kind", "created_at"))

    # Paso 1: total FOB (mercadería).
    fob_total = ZERO
    line_values = []
    for l in lineas:
        qty = D(l.qty_transfer or 0)
        unit_value = D(l.unit_value or l.unit_cost or 0)
        line_total = qty * unit_value
        fob_total += line_total
        line_values.append((l, qty, unit_value, line_total))

    # Paso 2: bolsa de costos extra en USD, con SCOPE por línea/NCM y exclusión de IVA.
    # - IVA (NON_CAPITALIZABLE) NO entra al landed (es crédito fiscal acreditable).
    # - Cada costo se prorratea SOLO entre las líneas de su `scope_json` (no todo el batch).
    #   Para costos `applies_to_all` (sin scope) el resultado es idéntico al global anterior.
    needs_exp = any(
        (c.scope_json or {}).get("expediente_ids") and not (c.scope_json or {}).get("lines")
        for c in costs
    )
    exp_by_key = _build_exp_by_key(transferencia) if needs_exp else {}

    extra_costs = ZERO          # solo capitalizables (entran al landed)
    extra_costs_iva = ZERO      # IVA / no capitalizables (informativo, NO suma)
    extras_breakdown = []
    share_by_line = {l.id: ZERO for (l, _q, _uv, _lt) in line_values}
    for c in costs:
        amount = D(c.amount or 0)
        fx     = D(c.fx_to_usd or 1)
        usd    = (amount * fx).quantize(D("0.01"), rounding=ROUND_HALF_UP)
        capitalizable = (c.kind or "").upper() not in NON_CAPITALIZABLE_KINDS
        extras_breakdown.append({
            "cost_line_id":   str(c.id),
            "kind":           c.kind,
            "label":          c.label or "",
            "amount":         float(amount),
            "currency":       c.currency,
            "fx_to_usd":      float(fx),
            "amount_usd":     float(usd),
            "capitalizable":  capitalizable,
            "scope_json":     c.scope_json,
            "source":         c.source,
            "ocr_confidence": float(c.ocr_confidence) if c.ocr_confidence is not None else None,
        })
        if not capitalizable:
            extra_costs_iva += usd
            continue
        extra_costs += usd
        # Líneas dentro del scope de ESTE costo (fallback: todo el batch si el scope no resuelve).
        in_scope = [
            t for t in line_values
            if _cost_in_scope(c.scope_json, t[0].producto_id, t[0].size, exp_by_key)
        ]
        scope_total = sum((t[3] for t in in_scope), ZERO)
        if not in_scope or scope_total <= 0:
            in_scope = line_values
            scope_total = fob_total
        if scope_total > 0:
            for (l, _q, _uv, lt) in in_scope:
                if lt > 0:
                    share_by_line[l.id] += usd * (lt / scope_total)

    # Paso 3 + 4: landed cost por línea usando el cost_share por SCOPE.
    line_report = []
    landed_total = ZERO
    for (l, qty, unit_value, line_total) in line_values:
        weight     = (line_total / fob_total) if fob_total > 0 else ZERO  # informativo
        cost_share = share_by_line.get(l.id, ZERO).quantize(D("0.0001"), rounding=ROUND_HALF_UP)
        if qty > 0:
            landed_unit = (unit_value + (cost_share / qty)).quantize(
                D("0.0001"), rounding=ROUND_HALF_UP
            )
        else:
            landed_unit = unit_value
        line_landed_total = (landed_unit * qty).quantize(D("0.01"), rounding=ROUND_HALF_UP)
        landed_total += line_landed_total

        line_report.append({
            "line_id":          str(l.id),
            "sku":              l.sku or "",
            "product_label":    l.product_label or "",
            "size":             l.size or "",
            "lote":             getattr(l, "lote", None) or "",
            "qty":              int(qty),
            "unit_fob_usd":     float(unit_value),
            "fob_total_usd":    float(line_total.quantize(D("0.01"))),
            "weight_pct":       float((weight * 100).quantize(D("0.01"))) if weight > 0 else 0.0,
            "cost_share_usd":   float(cost_share),
            "landed_unit_usd":  float(landed_unit),
            "landed_total_usd": float(line_landed_total),
        })

    try:
        from apps.nodos.models import Nodo
        origen_node = Nodo.objects.filter(id=transferencia.origen_id).only("pais_iso2").first()
        origen_pais = (origen_node.pais_iso2 or "").upper() if origen_node else ""
    except Exception:
        origen_pais = ""

    try:
        from apps.nodos.models import Nodo
        destino_node = Nodo.objects.filter(id=transferencia.destino_id).only("pais_iso2").first()
        destino_pais = (destino_node.pais_iso2 or "").upper() if destino_node else ""
    except Exception:
        destino_pais = ""

    report = {
        "transfer_id":           str(transferencia.id),
        "codigo":                transferencia.codigo,
        "legal_context":         transferencia.legal_context,
        "estado":                transferencia.estado,
        "origen": {
            "id":    str(transferencia.origen_id) if transferencia.origen_id else None,
            "label": transferencia.origen_label or "",
            "pais_iso2": origen_pais,
        },
        "destino": {
            "id":    str(transferencia.destino_id) if transferencia.destino_id else None,
            "label": transferencia.destino_label or "",
            "pais_iso2": destino_pais,
        },
        "documents": {
            "dua_document_id": str(transferencia.dua_document_id) if transferencia.dua_document_id else None,
            "awb_document_id": str(transferencia.awb_document_id) if transferencia.awb_document_id else None,
            "primary_document_id": str(transferencia.document_artifact_id) if transferencia.document_artifact_id else None,
        },
        "method":                transferencia.liquidation_method or "BY_VALUE",
        "summary": {
            "lines_count":          len(lineas),
            "units_total":          sum(int(t[1]) for t in line_values),
            "fob_total_usd":        float(fob_total.quantize(D("0.01"))),
            "extra_costs_total_usd": float(extra_costs.quantize(D("0.01"))),       # solo capitalizables
            "extra_costs_iva_usd":   float(extra_costs_iva.quantize(D("0.01"))),   # IVA acreditable (NO suma)
            "landed_total_usd":     float(landed_total),
            "avg_landed_per_unit_usd": (
                float((landed_total / D(sum(int(t[1]) for t in line_values))).quantize(D("0.0001")))
                if sum(int(t[1]) for t in line_values) > 0 else 0.0
            ),
        },
        "extras": extras_breakdown,
        "lines":  line_report,
        "liquidated_at":      transferencia.liquidated_at.isoformat() if transferencia.liquidated_at else None,
        "liquidated_by_name": transferencia.liquidated_by_name or "",
    }

    if persist:
        with transaction.atomic():
            for line_data, (l, _qty, _uv, _lt) in zip(line_report, line_values):
                Linea.objects.filter(pk=l.id).update(
                    cost_share_usd  = D(str(line_data["cost_share_usd"])),
                    landed_cost_usd = D(str(line_data["landed_unit_usd"])),
                )
            Transferencia.objects.filter(pk=transferencia.id).update(
                liquidated_at      = timezone.now(),
                liquidated_by_id   = actor_id,
                liquidated_by_name = (actor_name or "")[:128],
                liquidation_method = transferencia.liquidation_method or "BY_VALUE",
            )
        # refrescar timestamps en el dict
        transferencia.refresh_from_db()
        report["liquidated_at"]      = transferencia.liquidated_at.isoformat() if transferencia.liquidated_at else None
        report["liquidated_by_name"] = transferencia.liquidated_by_name or ""

    return report
