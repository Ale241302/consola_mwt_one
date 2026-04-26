"""
=====================================================================
MWT.ONE · apps.transfers.services
Agente responsable: [AG-BACKEND]

Efectos en `inventario.stock` cuando una transferencia transita por
sus estados. Funciones idempotentes por (transferencia_id, motivo) —
si el movimiento ya fue registrado, no se vuelve a aplicar.

Reglas:
  · IN_TRANSIT (despacho) → outbound del nodo origen
        cantidad_disponible -= qty_transfer
        cantidad_en_transito += qty_transfer
        Movimiento(tipo='OUT', motivo='TRANSFER_OUT', referencia=transfer.id)

  · RECEIVED / RECONCILED  (recepción) → inbound al nodo destino
        cantidad_disponible += (qty_received OR qty_transfer)
        Movimiento(tipo='IN',  motivo='TRANSFER_IN',  referencia=transfer.id)
        + cierre del en_transito en origen:
        cantidad_en_transito -= qty_transfer

Limitaciones conocidas (TODOs):
  · La línea de transferencia no rastrea `lote`. El inbound entra al
    lote '' (vacío) en el destino. Si el origen tenía L-2026-XX-XX,
    al recibir aparecerá como un lote separado en el destino.
    Solución: añadir `lote_origen` a transfers.linea (otro sprint).
  · Si la línea no tiene producto_id, intentamos resolverlo por SKU
    contra productos.producto. Si tampoco match → skip + log.
  · No validamos que cantidad_disponible no quede negativa en el origen
    (por compatibilidad con el flujo actual que no valida stock al crear
    la transferencia). Queda el saldo negativo visible para corrección
    operacional.
=====================================================================
"""
import uuid
import logging
from decimal import Decimal
from django.db import connection, transaction

log = logging.getLogger(__name__)

MOTIVO_OUT = "TRANSFER_OUT"
MOTIVO_IN  = "TRANSFER_IN"
REF_TIPO   = "TRANSFER"


def _resolve_producto_id(linea):
    """Devuelve linea.producto_id, o lo busca por SKU. None si no hay match."""
    if linea.producto_id:
        return str(linea.producto_id)
    if not linea.sku:
        return None
    with connection.cursor() as c:
        c.execute(
            "SELECT id FROM productos.producto WHERE sku = %s LIMIT 1",
            [linea.sku],
        )
        row = c.fetchone()
        return str(row[0]) if row else None


def _movimiento_existe(transferencia_id, motivo):
    """Idempotencia: ¿ya hay un movimiento con esa (referencia, motivo)?"""
    with connection.cursor() as c:
        c.execute(
            """
            SELECT 1 FROM inventario.movimiento
             WHERE referencia_tipo = %s
               AND referencia_id::text = %s
               AND motivo = %s
               AND is_active = TRUE
             LIMIT 1
            """,
            [REF_TIPO, str(transferencia_id), motivo],
        )
        return c.fetchone() is not None


def _upsert_stock(nodo_id, producto_id, lote, delta_disponible=Decimal("0"),
                  delta_en_transito=Decimal("0"), costo=None):
    """
    Upsert atómico sobre inventario.stock por (nodo_id, producto_id, lote).
    Si la fila no existe la crea (con delta como cantidad inicial); si existe
    la actualiza sumando los deltas (pueden ser negativos).
    """
    with connection.cursor() as c:
        c.execute(
            """
            INSERT INTO inventario.stock
                (id, nodo_id, producto_id, lote,
                 cantidad_disponible, cantidad_en_transito,
                 costo_unitario_usd, last_movement_at,
                 is_active, created_at, updated_at)
            VALUES (%s, %s, %s, %s,
                    GREATEST(%s, 0), GREATEST(%s, 0),
                    COALESCE(%s, 0), CURRENT_TIMESTAMP,
                    TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (nodo_id, producto_id, lote) DO UPDATE
              SET cantidad_disponible  = inventario.stock.cantidad_disponible  + EXCLUDED.cantidad_disponible
                                       + CASE WHEN %s < 0 THEN %s ELSE 0 END,  -- restas explícitas
                  cantidad_en_transito = inventario.stock.cantidad_en_transito + EXCLUDED.cantidad_en_transito
                                       + CASE WHEN %s < 0 THEN %s ELSE 0 END,
                  last_movement_at     = CURRENT_TIMESTAMP,
                  updated_at           = CURRENT_TIMESTAMP
            """,
            [
                str(uuid.uuid4()), str(nodo_id), str(producto_id), lote or "",
                delta_disponible, delta_en_transito, costo,
                delta_disponible, delta_disponible,
                delta_en_transito, delta_en_transito,
            ],
        )


def _registrar_movimiento(tipo, motivo, producto_id, nodo_origen_id, nodo_destino_id,
                          cantidad, costo, referencia_id, notas, contexto_legal):
    """Inserta un Movimiento en audit trail (siempre append)."""
    with connection.cursor() as c:
        c.execute(
            """
            INSERT INTO inventario.movimiento
                (id, tipo, motivo, producto_id, nodo_origen_id, nodo_destino_id,
                 lote, cantidad, costo_unitario_usd,
                 referencia_tipo, referencia_id, notas,
                 contexto_legal, is_active, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s,
                    '', %s, COALESCE(%s, 0),
                    %s, %s, %s,
                    %s, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            [
                str(uuid.uuid4()), tipo, motivo, str(producto_id),
                str(nodo_origen_id) if nodo_origen_id else None,
                str(nodo_destino_id) if nodo_destino_id else None,
                cantidad, costo,
                REF_TIPO, str(referencia_id), notas, contexto_legal,
            ],
        )


def apply_outbound_at_origin(transferencia, lineas):
    """
    Aplica el efecto OUT en el nodo origen al despachar (IN_TRANSIT).
    Idempotente: si ya hay movimientos TRANSFER_OUT para esta transferencia,
    no hace nada y devuelve 0.
    """
    if not transferencia.origen_id:
        log.warning("[transfer.outbound] sin origen_id, skip transfer=%s", transferencia.id)
        return 0
    if _movimiento_existe(transferencia.id, MOTIVO_OUT):
        return 0

    affected = 0
    with transaction.atomic():
        for l in lineas:
            qty = Decimal(l.qty_transfer or 0)
            if qty <= 0:
                continue
            producto_id = _resolve_producto_id(l)
            if not producto_id:
                log.warning("[transfer.outbound] producto sin resolver sku=%s linea=%s",
                            l.sku, l.id)
                continue
            # Restar disponible, sumar en_tránsito
            _upsert_stock(
                nodo_id          = transferencia.origen_id,
                producto_id      = producto_id,
                lote             = "",
                delta_disponible = -qty,
                delta_en_transito= qty,
            )
            _registrar_movimiento(
                tipo            = "OUT",
                motivo          = MOTIVO_OUT,
                producto_id     = producto_id,
                nodo_origen_id  = transferencia.origen_id,
                nodo_destino_id = transferencia.destino_id,
                cantidad        = qty,
                costo           = l.unit_cost,
                referencia_id   = transferencia.id,
                notas           = f"Despacho transfer {transferencia.codigo}",
                contexto_legal  = transferencia.legal_context,
            )
            affected += 1
    return affected


def apply_inbound_at_destination(transferencia, lineas):
    """
    Aplica el efecto IN en el nodo destino al recibir (RECEIVED/RECONCILED).
    Cierra también el en_tránsito en origen.
    Idempotente.
    """
    if not transferencia.destino_id:
        log.warning("[transfer.inbound] sin destino_id, skip transfer=%s", transferencia.id)
        return 0
    if _movimiento_existe(transferencia.id, MOTIVO_IN):
        return 0

    affected = 0
    with transaction.atomic():
        for l in lineas:
            # Cantidad real recibida; si no hay (recepción rápida sin captura),
            # asumimos qty_transfer.
            qty_recv = l.qty_received if l.qty_received is not None else l.qty_transfer
            qty_recv = Decimal(qty_recv or 0)
            if qty_recv <= 0:
                continue
            producto_id = _resolve_producto_id(l)
            if not producto_id:
                log.warning("[transfer.inbound] producto sin resolver sku=%s linea=%s",
                            l.sku, l.id)
                continue

            # Sumar al destino
            _upsert_stock(
                nodo_id          = transferencia.destino_id,
                producto_id      = producto_id,
                lote             = "",
                delta_disponible = qty_recv,
                costo            = l.unit_cost,
            )
            # Cerrar en_tránsito en origen (solo si hubo outbound previo)
            if transferencia.origen_id and _movimiento_existe(transferencia.id, MOTIVO_OUT):
                qty_planned = Decimal(l.qty_transfer or 0)
                _upsert_stock(
                    nodo_id           = transferencia.origen_id,
                    producto_id       = producto_id,
                    lote              = "",
                    delta_en_transito = -qty_planned,
                )
            _registrar_movimiento(
                tipo            = "IN",
                motivo          = MOTIVO_IN,
                producto_id     = producto_id,
                nodo_origen_id  = transferencia.origen_id,
                nodo_destino_id = transferencia.destino_id,
                cantidad        = qty_recv,
                costo           = l.unit_cost,
                referencia_id   = transferencia.id,
                notas           = f"Recepción transfer {transferencia.codigo}",
                contexto_legal  = transferencia.legal_context,
            )
            affected += 1
    return affected
