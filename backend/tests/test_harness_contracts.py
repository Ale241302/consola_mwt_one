"""Contratos del harness — A1 y B1 (`01_AJUSTES_MWT_ONE_Y_MCP.md`).

Cada test nombra el ajuste que protege y corre sin base de datos
(`pytest.mark.no_db`), así sirve igual en local que en CI. El contrato de C2
necesita INSERT real y vive en `test_payment_integrity.py`.

A1 · leer fechas nunca escribe y el tope de 120 días no cierra nada solo.
B1 · el Client Secret de la app MCP no sale en ninguna lectura.
"""
from __future__ import annotations

import datetime as dt
import types

import pytest

from apps.expedientes import views as exp_views
from apps.expedientes.views import (
    AUTO_CLOSE_DAYS,
    check_auto_close_en_destino,
    evaluate_auto_close,
)

pytestmark = pytest.mark.no_db


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
def _fake_exp(estado="EN_DESTINO", phase_durations=None, created_at=None, save_calls=None):
    """Expediente mínimo. `save` falla si alguien intenta escribir."""

    def _save(*_a, **_k):
        if save_calls is not None:
            save_calls.append(True)
            return None
        pytest.fail("A1: una lectura no debe guardar el expediente")

    return types.SimpleNamespace(
        id="00000000-0000-0000-0000-000000000001",
        codigo="TEST-0001",
        estado=estado,
        phase_durations_json=phase_durations or {},
        created_at=created_at or dt.datetime(2026, 1, 1),
        last_event_at=None,
        phase_signal="ON_TRACK",
        save=_save,
    )


def _hace(dias: int) -> str:
    return (dt.date.today() - dt.timedelta(days=dias)).isoformat()


# ─────────────────────────────────────────────────────────────────────
# A1 · evaluación pura
# ─────────────────────────────────────────────────────────────────────
class TestA1EvaluacionPura:
    def test_tope_vencido_propone_cierre_sin_escribir(self):
        exp = _fake_exp(phase_durations={"PREPARACION_DESPACHO": {"end": _hace(AUTO_CLOSE_DAYS + 1)}})

        propuesta = evaluate_auto_close(exp)

        assert propuesta["aplica"] is True
        assert propuesta["motivo"] == "tope_vencido"
        assert propuesta["dias_tope"] == AUTO_CLOSE_DAYS
        assert propuesta["fecha_cierre"] == (
            dt.date.fromisoformat(_hace(AUTO_CLOSE_DAYS + 1)) + dt.timedelta(days=AUTO_CLOSE_DAYS)
        ).isoformat()

    def test_tope_no_vencido_no_propone(self):
        exp = _fake_exp(phase_durations={"PREPARACION_DESPACHO": {"end": _hace(10)}})

        propuesta = evaluate_auto_close(exp)

        assert propuesta["aplica"] is False
        assert propuesta["motivo"] == "tope_no_vencido"

    def test_expediente_cerrado_no_se_toca(self):
        exp = _fake_exp(estado="CERRADO", phase_durations={"PREPARACION_DESPACHO": {"end": _hace(400)}})

        assert evaluate_auto_close(exp)["aplica"] is False

    def test_leer_no_muta_el_expediente(self):
        pd = {"PREPARACION_DESPACHO": {"end": _hace(AUTO_CLOSE_DAYS + 5)}}
        exp = _fake_exp(phase_durations=dict(pd))

        evaluate_auto_close(exp)

        assert exp.estado == "EN_DESTINO"
        assert exp.phase_durations_json == pd
        assert "CERRADO" not in exp.phase_durations_json


# ─────────────────────────────────────────────────────────────────────
# A1 · el cierre exige permiso explícito y pago registrado
# ─────────────────────────────────────────────────────────────────────
class TestA1Guardas:
    def test_sin_allow_write_no_cierra(self):
        exp = _fake_exp(phase_durations={"PREPARACION_DESPACHO": {"end": _hace(AUTO_CLOSE_DAYS + 5)}})

        resultado = check_auto_close_en_destino(exp)

        assert resultado["aplicado"] is False
        assert resultado["bloqueado"] == "sin_permiso_de_escritura"

    def test_con_allow_write_pero_sin_pago_no_cierra(self, monkeypatch):
        exp = _fake_exp(phase_durations={"PREPARACION_DESPACHO": {"end": _hace(AUTO_CLOSE_DAYS + 5)}})
        monkeypatch.setattr(exp_views, "expediente_tiene_pago_registrado", lambda _exp: False)

        resultado = check_auto_close_en_destino(exp, allow_write=True)

        assert resultado["aplicado"] is False
        assert resultado["bloqueado"] == "sin_pago_registrado"
        assert exp.estado == "EN_DESTINO"

    def test_el_escritor_directo_tambien_exige_pago(self, monkeypatch):
        """Aunque se llame apply_auto_close directo, sin pago no escribe."""
        exp = _fake_exp(phase_durations={"PREPARACION_DESPACHO": {"end": _hace(AUTO_CLOSE_DAYS + 5)}})
        monkeypatch.setattr(exp_views, "expediente_tiene_pago_registrado", lambda _exp: False)

        cerrado = exp_views.apply_auto_close(exp)

        assert cerrado is False
        assert exp.estado == "EN_DESTINO"


# ─────────────────────────────────────────────────────────────────────
# A1 · el GET de phase-durations es una lectura (regresión del 06/11)
# ─────────────────────────────────────────────────────────────────────
class TestA1LecturaHttp:
    def test_get_phase_durations_no_guarda_ni_cierra(self, monkeypatch):
        """El GET que cerró 2478, 2465, 2466, 2478B, 2479, 2513 y 2468."""
        guardados: list[bool] = []
        exp = _fake_exp(
            phase_durations={"PREPARACION_DESPACHO": {"end": _hace(AUTO_CLOSE_DAYS + 30)}},
            save_calls=guardados,
        )

        monkeypatch.setattr(exp_views.Expediente.objects, "get", lambda **_kw: exp)

        request = types.SimpleNamespace(method="GET", data={})
        view = exp_views.ExpedienteViewSet()
        response = view.phase_durations(request, pk=str(exp.id))

        assert response.status_code == 200
        assert guardados == [], "A1: el GET no puede guardar"
        assert exp.estado == "EN_DESTINO", "A1: el GET no puede cerrar el expediente"
        assert "auto_close_propuesta" in response.data
        propuesta = response.data["auto_close_propuesta"]
        assert propuesta["aplica"] is True
        assert "aplicado" not in propuesta, "A1: una lectura solo propone, no aplica"


# ─────────────────────────────────────────────────────────────────────
# A1 · la alerta de "tope vencido sin pago" se puede leer
# ─────────────────────────────────────────────────────────────────────
class TestA1AlertaTope:
    BLOQUEADO = {
        "codigo": "EXP-2355-2025",
        "oc": "504069",
        "cliente": "Sondel",
        "fecha_tope": "2026-11-01",
        "motivo": "sin pago confirmado",
    }

    def test_resumen_nombra_expediente_oc_y_motivo(self):
        from apps.expedientes.tasks import _resumen_tope_sin_pago

        asunto, cuerpo = _resumen_tope_sin_pago([self.BLOQUEADO])

        assert "1 expediente" in asunto
        assert "sin pago confirmado" in asunto
        assert "EXP-2355-2025" in cuerpo
        assert "504069" in cuerpo
        assert "Sondel" in cuerpo
        assert "2026-11-01" in cuerpo

    def test_resumen_pluraliza(self):
        from apps.expedientes.tasks import _resumen_tope_sin_pago

        asunto, _ = _resumen_tope_sin_pago([self.BLOQUEADO, dict(self.BLOQUEADO)])
        assert "2 expedientes" in asunto

    def test_sin_bloqueados_no_arma_alerta(self):
        from apps.expedientes.tasks import _resumen_tope_sin_pago

        asunto, cuerpo = _resumen_tope_sin_pago([])
        assert "0 expedientes" in asunto
        assert "Detalle:" in cuerpo


# ─────────────────────────────────────────────────────────────────────
# B1 · el secreto de la app MCP nunca sale en una lectura
# ─────────────────────────────────────────────────────────────────────
class TestB1Secreto:
    def test_mask_secret(self):
        from apps.clientes.secrets import SECRET_MASK, mask_secret, secret_is_set

        assert mask_secret("clave-real-123") == SECRET_MASK
        assert mask_secret("") is None
        assert mask_secret(None) is None
        assert secret_is_set("clave-real-123") is True
        assert secret_is_set(None) is False

    def test_accion_mcp_app_enmascara_el_secreto(self, monkeypatch):
        from apps.clientes import views as cli_views

        app = types.SimpleNamespace(
            cliente_id="00000000-0000-0000-0000-000000000009",
            slug="mcp-imporcomp",
            nombre="Imporcomp",
            mcp_url="https://mcp.mwt.one/x/mcp",
            oauth_client_id="client-id-publico",
            oauth_client_secret="super-secreto-que-no-debe-salir",
            estado="PROVISIONED",
            created_at=None,
        )
        fake_model = types.SimpleNamespace(
            objects=types.SimpleNamespace(filter=lambda **_kw: types.SimpleNamespace(first=lambda: app))
        )

        import apps.core.models as core_models
        monkeypatch.setattr(core_models, "McpApp", fake_model)
        monkeypatch.setattr(cli_views, "_cliente_in_scope", lambda _req, _pk: True)

        request = types.SimpleNamespace(method="GET", data={})
        view = cli_views.ClienteViewSet()
        response = view.mcp_app(request, pk=app.cliente_id)

        assert response.data["oauth_client_secret"] == "***"
        assert response.data["oauth_client_secret_set"] is True
        assert "super-secreto" not in str(response.data)
