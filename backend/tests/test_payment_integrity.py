"""Integridad del alta de pagos — C2 (`01_AJUSTES_MWT_ONE_Y_MCP.md`).

Requiere base de datos (INSERT real en `finance.payment`). El resto de los
contratos del harness está en `test_harness_contracts.py` (sin base).

C2: el 409 de `pago_registrar` decía DUPLICATE_PAYMENT_REFERENCE cuando la
colisión era otra (código correlativo, event_id). Aquí se fija que el alta se
cura sola ante un código ocupado y que el nombre de la constraint se reporta.
"""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import pytest

from apps.finance import services
from apps.finance.services import PaymentService, constraint_name


class TestC2Clasificacion:
    def test_nombre_desde_diag_psycopg(self):
        import types as _types

        exc = Exception("boom")
        exc.diag = _types.SimpleNamespace(constraint_name="payment_codigo_key")
        assert constraint_name(exc) == "payment_codigo_key"

    def test_nombre_desde_el_mensaje(self):
        exc = Exception('duplicate key value violates unique constraint "payment_codigo_key"')
        assert constraint_name(exc) == "payment_codigo_key"

    def test_sin_nombre_devuelve_none(self):
        assert constraint_name(Exception("otra cosa")) is None


@pytest.mark.django_db(transaction=True)
class TestC2CodigoRepetido:
    """Lo que el agente vivió como 'referencia duplicada' sin duplicado."""

    def test_codigo_ocupado_se_realinea_y_registra(self, monkeypatch):
        from django.db import connection

        codigo_ocupado = services._next_codigo()
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO finance.payment (
                    id, codigo, expediente_id, monto, moneda, tasa_cambio_a_usd,
                    fecha, metodo, tipo_pago, referencia, estado, event_id,
                    is_active, created_at, updated_at
                ) VALUES (
                    %s, %s, NULL, 1, 'USD', 1, CURRENT_DATE,
                    'TRANSFERENCIA_BANCARIA', 'PARCIAL', 'OCUPADO-1', 'NEEDS_REVIEW', %s,
                    TRUE, now(), now()
                )
                """,
                [str(uuid.uuid4()), codigo_ocupado, str(uuid.uuid4())],
            )

        real = services._next_codigo
        llamadas = {"n": 0}

        def _next_codigo_falso():
            llamadas["n"] += 1
            return codigo_ocupado if llamadas["n"] == 1 else real()

        monkeypatch.setattr(services, "_next_codigo", _next_codigo_falso)

        resultado = PaymentService.register(
            validated={
                "expediente_id": uuid.uuid4(),
                "monto": Decimal("10.00"),
                "moneda": "USD",
                "fecha": dt.date.today(),
                "metodo": "TRANSFERENCIA_BANCARIA",
                "tipo_pago": "PARCIAL",
                "referencia": "REPRO-C2-TEST",
                "aplicaciones": [{
                    "applicable_type": "PROFORMA",
                    "applicable_id": str(uuid.uuid4()),
                    "monto_aplicado": Decimal("10.00"),
                }],
            },
            actor_id=None,
        )

        assert resultado.payment.codigo != codigo_ocupado
        assert resultado.payment.codigo.startswith("PAY-")
