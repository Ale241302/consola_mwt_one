"""
=====================================================================
MWT.ONE · apps.expedientes.financials
Agente responsable: [AG-BACKEND]

Ola 5 · 2026-11-03 · **Una sola definición de dinero por expediente.**

Problema que resuelve: el listado devolvía `total_cost / total_invoiced /
total_paid / balance` desde columnas del modelo que ningún flujo actualiza
(siempre 0), mientras el detalle los calculaba en vivo con 4-6 queries por
fila. El frontend tapaba el hueco con `total_invoiced > 0 ? ... : total_client`
y así mostraba "facturado" = valor de pedido (mentira de negocio: 2473 salía
+4.325 USD y 2472 −14.494 USD).

Reglas (únicas, documentadas acá y usadas por lista, detalle y OC):

  · invoiced  = snapshot de la Factura Comercial (ART-13, `field-0118`)
                prorrateado por valor de línea del artefacto. Si el
                expediente NO tiene factura → 0 y `invoiced_source="NONE"`.
                Nunca se sustituye por el valor de pedido.
  · lines_value = Σ qty × (unit_price_client si > 0, si no unit_price).
                Es "valor de pedido", NO facturación.
  · paid      = Σ finance.payment.monto_usd de pagos CONFIRMADOS.
  · balance   = max(invoiced − paid, 0).
  · cost      = Σ transfers.cost_line.amount_usd en scope del expediente
                (con FX recalculado si la línea quedó en 1.0).

Todas las funciones son batcheadas (`= ANY(%s)`) para no hacer N+1.
=====================================================================
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from django.db import connection

log = logging.getLogger(__name__)

CONFIRMED_STATES = ("CONFIRMADO_AI", "CONFIRMADO_HUMANO")


def _ids(expediente_ids: Iterable[Any]) -> list[str]:
    out: list[str] = []
    for x in expediente_ids or []:
        s = str(x or "").strip()
        if s and s not in out:
            out.append(s)
    return out


def _empty() -> dict:
    return {
        "invoiced": 0.0,
        "invoiced_source": "NONE",
        "paid": 0.0,
        "cost": 0.0,
        "balance": 0.0,
        "lines_value": 0.0,
    }


def _invoiced_by_exp(ids: list[str]) -> dict[str, float]:
    """Factura comercial (ART-13) prorrateada por expediente, en una query."""
    if not ids:
        return {}
    sql = """
        WITH art AS (
            SELECT bai.id AS instance_id,
                   COALESCE(NULLIF(bai.data->>'field-0118','')::numeric, 0) AS f0118,
                   COALESCE(SUM(bal.qty * COALESCE(l.unit_price_client, l.unit_price, 0)), 0) AS art_val
              FROM nodos.builder_artifact_instance bai
              JOIN nodos.builder_artifact_line bal
                ON bal.builder_artifact_instance_id = bai.id AND bal.is_active = TRUE
              LEFT JOIN expedientes.linea l
                ON l.expediente_id = bal.expediente_id
               AND l.producto_id   = bal.producto_id
               AND l.size          = bal.talla
               AND l.is_active     = TRUE
             WHERE bai.template_id = 13 AND bai.is_active = TRUE
             GROUP BY bai.id, bai.data
        ), exp_art AS (
            SELECT bal.expediente_id AS eid,
                   bai.id            AS instance_id,
                   COALESCE(SUM(bal.qty * COALESCE(l.unit_price_client, l.unit_price, 0)), 0) AS exp_val
              FROM nodos.builder_artifact_instance bai
              JOIN nodos.builder_artifact_line bal
                ON bal.builder_artifact_instance_id = bai.id AND bal.is_active = TRUE
              LEFT JOIN expedientes.linea l
                ON l.expediente_id = bal.expediente_id
               AND l.producto_id   = bal.producto_id
               AND l.size          = bal.talla
               AND l.is_active     = TRUE
             WHERE bai.template_id = 13 AND bai.is_active = TRUE
               AND bal.expediente_id = ANY(%s::uuid[])
             GROUP BY bal.expediente_id, bai.id
        )
        SELECT e.eid::text,
               COALESCE(SUM(
                   CASE WHEN a.art_val > 0
                        THEN ROUND((e.exp_val / a.art_val) * a.f0118, 2)
                        ELSE e.exp_val
                   END
               ), 0)
          FROM exp_art e
          JOIN art a ON a.instance_id = e.instance_id
         GROUP BY e.eid
    """
    try:
        with connection.cursor() as cur:
            cur.execute(sql, [ids])
            return {row[0]: float(row[1] or 0) for row in cur.fetchall()}
    except Exception as exc:  # noqa: BLE001 - nunca romper el listado
        log.exception("[financials] invoiced falló: %s", exc)
        return {}


def _paid_by_exp(ids: list[str]) -> dict[str, float]:
    if not ids:
        return {}
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT expediente_id::text, COALESCE(SUM(monto_usd), 0)
                  FROM finance.payment
                 WHERE is_active = TRUE
                   AND expediente_id = ANY(%s::uuid[])
                   AND estado = ANY(%s)
                 GROUP BY expediente_id
                """,
                [ids, list(CONFIRMED_STATES)],
            )
            return {row[0]: float(row[1] or 0) for row in cur.fetchall()}
    except Exception as exc:  # noqa: BLE001
        log.exception("[financials] paid falló: %s", exc)
        return {}


def _lines_by_exp(ids: list[str]) -> dict[str, float]:
    """Valor de pedido por líneas (no es facturación)."""
    if not ids:
        return {}
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT expediente_id::text,
                       COALESCE(SUM(qty * COALESCE(NULLIF(unit_price_client, 0), unit_price, 0)), 0)
                  FROM expedientes.linea
                 WHERE is_active = TRUE AND expediente_id = ANY(%s::uuid[])
                 GROUP BY expediente_id
                """,
                [ids],
            )
            return {row[0]: float(row[1] or 0) for row in cur.fetchall()}
    except Exception as exc:  # noqa: BLE001
        log.exception("[financials] lines falló: %s", exc)
        return {}


def _cost_by_exp(ids: list[str]) -> dict[str, float]:
    """Costo landed (transfers.cost_line) en scope del expediente."""
    if not ids:
        return {}
    try:
        from apps.core.fx_service import get_fx_to_usd
    except ImportError:  # pragma: no cover
        get_fx_to_usd = None
    try:
        with connection.cursor() as cur:
            # DISTINCT (expediente, cost_line): una transferencia puede tener
            # varias asignaciones (una por nodo) al MISMO expediente y sin el
            # DISTINCT el costo se multiplicaba por la cantidad de nodos.
            cur.execute(
                """
                SELECT DISTINCT ON (a.expediente_id, cl.id)
                       a.expediente_id::text,
                       cl.amount, cl.currency, cl.fx_to_usd, cl.amount_usd
                  FROM transfers.cost_line cl
                  JOIN inventario.expediente_nodo_assignment a
                    ON a.transferencia_id = cl.transferencia_id
                   AND a.is_active = TRUE
                 WHERE cl.is_active = TRUE
                   AND a.expediente_id = ANY(%s::uuid[])
                   AND (
                        cl.scope_json IS NULL
                        OR (cl.scope_json->>'applies_to_all')::bool = TRUE
                        OR EXISTS (
                            SELECT 1 FROM jsonb_array_elements_text(
                                COALESCE(cl.scope_json->'expediente_ids', '[]'::jsonb)
                            ) AS s(eid)
                            WHERE s.eid = a.expediente_id::text
                        )
                   )
                """,
                [ids],
            )
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001
        log.exception("[financials] cost falló: %s", exc)
        return {}

    fx_cache: dict[str, float] = {}
    out: dict[str, float] = {}
    for eid, amount, currency, fx_stored, amount_usd in rows:
        ccy = (currency or "USD").upper()
        amt = float(amount or 0)
        fx_s = float(fx_stored or 1)
        aus = float(amount_usd or 0)
        if ccy != "USD" and abs(fx_s - 1.0) < 1e-9 and amt > 0 and get_fx_to_usd:
            if ccy not in fx_cache:
                try:
                    fx_cache[ccy] = float(get_fx_to_usd(ccy) or 1)
                except Exception:  # noqa: BLE001
                    fx_cache[ccy] = 1.0
            val = amt * fx_cache[ccy]
        else:
            val = aus
        out[eid] = out.get(eid, 0.0) + val
    return {k: round(v, 2) for k, v in out.items()}


def totals_for(expediente_ids: Iterable[Any]) -> dict[str, dict]:
    """Totales por expediente con UNA sola definición (batch).

    Devuelve `{expediente_id: {invoiced, invoiced_source, paid, cost,
    balance, lines_value}}`. `invoiced_source`:
      · "INVOICE" → hay factura comercial (snapshot ART-13)
      · "NONE"    → no hay factura (invoiced = 0; el valor de pedido va aparte)
    """
    ids = _ids(expediente_ids)
    if not ids:
        return {}
    invoiced = _invoiced_by_exp(ids)
    paid = _paid_by_exp(ids)
    cost = _cost_by_exp(ids)
    lines = _lines_by_exp(ids)
    out: dict[str, dict] = {}
    for eid in ids:
        inv = round(float(invoiced.get(eid, 0) or 0), 2)
        pd = round(float(paid.get(eid, 0) or 0), 2)
        out[eid] = {
            "invoiced": inv,
            "invoiced_source": "INVOICE" if inv > 0 else "NONE",
            "paid": pd,
            "cost": round(float(cost.get(eid, 0) or 0), 2),
            "balance": round(max(inv - pd, 0.0), 2),
            "lines_value": round(float(lines.get(eid, 0) or 0), 2),
        }
    return out
