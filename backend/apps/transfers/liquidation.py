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

    # Paso 2: bolsa de costos extra en USD.
    extra_costs = ZERO
    extras_breakdown = []
    for c in costs:
        amount = D(c.amount or 0)
        fx     = D(c.fx_to_usd or 1)
        usd    = (amount * fx).quantize(D("0.01"), rounding=ROUND_HALF_UP)
        extra_costs += usd
        extras_breakdown.append({
            "cost_line_id":   str(c.id),
            "kind":           c.kind,
            "label":          c.label or "",
            "amount":         float(amount),
            "currency":       c.currency,
            "fx_to_usd":      float(fx),
            "amount_usd":     float(usd),
            "source":         c.source,
            "ocr_confidence": float(c.ocr_confidence) if c.ocr_confidence is not None else None,
        })

    # Paso 3 + 4: prorrateo por valor y landed cost por línea.
    line_report = []
    landed_total = ZERO
    for (l, qty, unit_value, line_total) in line_values:
        if fob_total > 0 and line_total > 0:
            weight        = line_total / fob_total
            cost_share    = (extra_costs * weight).quantize(D("0.0001"), rounding=ROUND_HALF_UP)
        else:
            weight     = ZERO
            cost_share = ZERO
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

    report = {
        "transfer_id":           str(transferencia.id),
        "codigo":                transferencia.codigo,
        "legal_context":         transferencia.legal_context,
        "estado":                transferencia.estado,
        "origen": {
            "id":    str(transferencia.origen_id) if transferencia.origen_id else None,
            "label": transferencia.origen_label or "",
        },
        "destino": {
            "id":    str(transferencia.destino_id) if transferencia.destino_id else None,
            "label": transferencia.destino_label or "",
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
            "extra_costs_total_usd": float(extra_costs.quantize(D("0.01"))),
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
