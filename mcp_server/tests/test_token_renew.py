"""Tests de `token_renew.py` — auto-renovación de la vigencia del ServiceToken.

El fallo que motivó esto: el token del MCP vencía a los 90 días, `list_tools`
caía a fail-closed y Claude mostraba "el conector no tiene herramientas".
"""
from __future__ import annotations

from unittest import mock

from mwt_mcp import token_renew


class _FakeSettings:
    def __init__(self, api_base="https://consola.mwt.one/api", token="abc123"):
        self.api_base = api_base
        self.token = token


def _resp(status_code=200, payload=None, text=""):
    r = mock.Mock()
    r.status_code = status_code
    r.json.return_value = payload or {}
    r.text = text
    return r


def test_renew_once_sin_token_no_llama():
    with mock.patch.object(token_renew, "settings", _FakeSettings(token="")), \
         mock.patch.object(token_renew.httpx, "post") as post:
        assert token_renew.renew_once() is False
    post.assert_not_called()


def test_renew_once_ok_devuelve_true():
    with mock.patch.object(token_renew, "settings", _FakeSettings()), \
         mock.patch.object(token_renew.httpx, "post",
                           return_value=_resp(200, {"expires_at": "2027-02-04T09:21:06"})) as post:
        assert token_renew.renew_once() is True

    args, kwargs = post.call_args
    assert args[0] == "https://consola.mwt.one/api/auth/service-token/renew/"
    assert kwargs["headers"]["Authorization"] == "ServiceToken abc123"


def test_renew_once_403_no_lanza_y_devuelve_false():
    body = '{"detail":"no renovable","code":"AUTO_RENEW_OFF"}'
    with mock.patch.object(token_renew, "settings", _FakeSettings()), \
         mock.patch.object(token_renew.httpx, "post", return_value=_resp(403, text=body)):
        assert token_renew.renew_once() is False


def test_renew_once_error_de_red_no_lanza():
    with mock.patch.object(token_renew, "settings", _FakeSettings()), \
         mock.patch.object(token_renew.httpx, "post", side_effect=OSError("sin red")):
        assert token_renew.renew_once() is False


def test_start_renewer_sin_token_no_arranca_hilo():
    with mock.patch.object(token_renew, "settings", _FakeSettings(token="")):
        assert token_renew.start_renewer() is None


def test_start_renewer_arranca_hilo_daemon():
    with mock.patch.object(token_renew, "settings", _FakeSettings()), \
         mock.patch.object(token_renew.threading, "Thread") as thread_cls:
        thread = thread_cls.return_value
        result = token_renew.start_renewer(interval_seconds=3600)

    assert result is thread
    thread.start.assert_called_once()
    assert thread_cls.call_args.kwargs["daemon"] is True


def test_backoff_crece_y_se_capa():
    """Un fallo transitorio reintenta en minutos, no en 12 h."""
    retry = token_renew.RETRY_BASE_SECONDS
    for _ in range(12):
        retry, delay = token_renew._next_delay(False, retry, 12 * 3600)
        assert delay <= token_renew.RETRY_MAX_SECONDS
    assert retry == token_renew.RETRY_MAX_SECONDS


def test_tras_exito_vuelve_a_la_cadencia_normal():
    retry, delay = token_renew._next_delay(True, 1200, 12 * 3600)
    assert retry == token_renew.RETRY_BASE_SECONDS
    assert delay == 12 * 3600
