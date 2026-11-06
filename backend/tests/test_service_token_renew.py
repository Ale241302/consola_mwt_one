"""
=====================================================================
MWT.ONE · tests/test_service_token_renew.py

Auto-renovación de ServiceToken (backend/sql/N1_service_token_auto_renew.sql).

Contexto: el token del MCP vencía a los 90 días y el único síntoma era que
el conector aparecía "sin herramientas". Ahora la vigencia se corre sola:

  · `renew_due()` — barrido diario de Celery.
  · `renew_token()` — auto-curación que llama el propio MCP al arrancar.

El apagado real sigue siendo `revoked_at` / `is_active`.
=====================================================================
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

import pytest
from django.db import connection
from rest_framework.test import APIClient

from apps.core.service_tokens import renew_due, renew_token


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _ensure_auto_renew_column():
    """El esquema de tests viene de init.sql; garantiza la columna nueva.

    El ALTER corre dentro de la transacción del test, así que se revierte y
    no altera el esquema real.
    """
    with connection.cursor() as cur:
        cur.execute(
            "ALTER TABLE core.service_token "
            "ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT TRUE"
        )
    yield


def _insert_token(
    name: str,
    *,
    expires_in_days: int,
    auto_renew: bool = True,
    revoked: bool = False,
    active: bool = True,
) -> tuple[str, str]:
    """Crea un ServiceToken y devuelve (id, token_en_claro)."""
    token = uuid.uuid4().hex + uuid.uuid4().hex  # 64 hex
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    token_id = str(uuid.uuid4())
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO core.service_token
                (id, name, token_hash, role_slug, is_active, expires_at,
                 auto_renew, revoked_at, created_at, updated_at)
            VALUES (%s, %s, %s, 'service', %s,
                    now() + make_interval(days => %s), %s, %s, now(), now())
            """,
            [
                token_id, name, token_hash, active, expires_in_days,
                auto_renew,
                datetime.now(timezone.utc) if revoked else None,
            ],
        )
    return token_id, token


def _expires_in_days(token_id: str) -> float:
    with connection.cursor() as cur:
        cur.execute(
            "SELECT EXTRACT(EPOCH FROM (expires_at - now())) / 86400.0 "
            "  FROM core.service_token WHERE id = %s",
            [token_id],
        )
        return float(cur.fetchone()[0])


# ─────────────────────────────────────────────────────────────────────
# renew_token
# ─────────────────────────────────────────────────────────────────────
def test_renew_token_corre_la_vigencia():
    token_id, _ = _insert_token("qa-renew-ok", expires_in_days=3)

    result = renew_token(token_id)

    assert result["renewed"] is True
    assert result["reason"] is None
    assert _expires_in_days(token_id) > 80


def test_renew_token_rechaza_auto_renew_off():
    token_id, _ = _insert_token("qa-renew-off", expires_in_days=3, auto_renew=False)

    result = renew_token(token_id)

    assert result["renewed"] is False
    assert result["reason"] == "AUTO_RENEW_OFF"


def test_renew_token_rechaza_revocado():
    token_id, _ = _insert_token("qa-renew-revoked", expires_in_days=3, revoked=True)

    result = renew_token(token_id)

    assert result["renewed"] is False
    assert result["reason"] == "REVOKED"


def test_renew_token_rechaza_inactivo():
    token_id, _ = _insert_token("qa-renew-inactive", expires_in_days=3, active=False)

    result = renew_token(token_id)

    assert result["renewed"] is False
    assert result["reason"] == "INACTIVE"


def test_renew_token_auto_cura_dentro_de_la_gracia():
    """Un token vencido hace poco se revive: el MCP estuvo caído un tiempo."""
    token_id, _ = _insert_token("qa-renew-grace", expires_in_days=-10)

    result = renew_token(token_id)

    assert result["renewed"] is True
    assert _expires_in_days(token_id) > 80


def test_renew_token_rechaza_vencido_fuera_de_gracia():
    token_id, _ = _insert_token("qa-renew-stale", expires_in_days=-400)

    result = renew_token(token_id)

    assert result["renewed"] is False
    assert result["reason"] == "EXPIRED_BEYOND_GRACE"


# ─────────────────────────────────────────────────────────────────────
# renew_due (barrido de Celery)
# ─────────────────────────────────────────────────────────────────────
def test_renew_due_solo_toca_los_que_vencen_pronto_y_son_renovables():
    pronto, _ = _insert_token("qa-due-pronto", expires_in_days=5)
    lejano, _ = _insert_token("qa-due-lejano", expires_in_days=60)
    fijo, _ = _insert_token("qa-due-fijo", expires_in_days=5, auto_renew=False)

    renew_due()

    assert _expires_in_days(pronto) > 80
    assert _expires_in_days(lejano) > 50   # intacto (aún no toca)
    assert _expires_in_days(fijo) < 10     # vigencia fija: no se renueva


# ─────────────────────────────────────────────────────────────────────
# Endpoint POST /api/auth/service-token/renew/
# ─────────────────────────────────────────────────────────────────────
def test_endpoint_renueva_con_su_propio_token():
    token_id, token = _insert_token("qa-http-renew", expires_in_days=10)

    resp = APIClient().post(
        "/api/auth/service-token/renew/",
        HTTP_AUTHORIZATION=f"ServiceToken {token}",
    )

    assert resp.status_code == 200
    assert resp.json()["renewed"] is True
    assert _expires_in_days(token_id) > 80


def test_endpoint_403_si_no_es_renovable():
    _, token = _insert_token("qa-http-off", expires_in_days=10, auto_renew=False)

    resp = APIClient().post(
        "/api/auth/service-token/renew/",
        HTTP_AUTHORIZATION=f"ServiceToken {token}",
    )

    assert resp.status_code == 403
    assert resp.json()["code"] == "AUTO_RENEW_OFF"


def test_endpoint_401_sin_token():
    resp = APIClient().post("/api/auth/service-token/renew/")
    assert resp.status_code in (401, 403)


# ─────────────────────────────────────────────────────────────────────
# system-health · vigencia visible
# ─────────────────────────────────────────────────────────────────────
def _admin_client():
    from apps.core.jwt_auth import MwtUser

    user = MwtUser(
        user_id=str(uuid.uuid4()),
        email="qa-admin@mwt.test",
        full_name="QA Admin",
        role="admin",
        permissions={"modules": ["*"]},
        is_active=True,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _client_b2b_client():
    from apps.core.jwt_auth import MwtUser

    user = MwtUser(
        user_id=str(uuid.uuid4()),
        email="qa-client@mwt.test",
        full_name="QA Client",
        role="client_b2b",
        permissions={"modules": ["expedientes"]},
        is_active=True,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_token_health_clasifica_por_dias():
    from apps.core.service_tokens import token_health

    _insert_token("qa-h-ok", expires_in_days=100)
    _insert_token("qa-h-warn", expires_in_days=15)
    _insert_token("qa-h-crit", expires_in_days=3)
    _insert_token("qa-h-exp", expires_in_days=-2)

    health = token_health()
    by_name = {t["name"]: t for t in health["tokens"]}

    assert by_name["qa-h-ok"]["status"] == "OK"
    assert by_name["qa-h-warn"]["status"] == "WARN"
    assert by_name["qa-h-crit"]["status"] == "CRITICAL"
    # Los vencidos no se listan: sólo se cuentan, para no teñir el health.
    assert "qa-h-exp" not in by_name
    assert health["status"] == "CRITICAL"
    assert health["expired"] >= 1
    assert health["min_days_remaining"] <= 3
    assert "token_hash" not in by_name["qa-h-ok"]


def test_system_health_expone_vigencia_para_admin():
    _insert_token("qa-h-http", expires_in_days=3)

    resp = _admin_client().get("/api/auth/system-health/")

    assert resp.status_code == 200
    body = resp.json()
    names = {t["name"] for t in body["service_tokens"]["tokens"]}
    assert "qa-h-http" in names
    assert any(a["code"] == "SERVICE_TOKEN_EXPIRING" for a in body.get("alerts", []))
    # El health global no se degrada por un token por vencer (contrato previo).
    assert "ok" in body and "db" in body


def test_system_health_oculta_vigencia_para_cliente_b2b():
    _insert_token("qa-h-secret", expires_in_days=3)

    resp = _client_b2b_client().get("/api/auth/system-health/")

    assert resp.status_code == 200
    assert "service_tokens" not in resp.json()
