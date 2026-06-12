#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=====================================================================
MWT.ONE · tests/e2e/test_full_flows.py — Suite E2E de flujos completos
Agente responsable: [AG-QA-E2E]

ARQUITECTURA DEL E2E
====================
A diferencia de la suite pytest (APIClient in-process + rollback por
transaccion), este script golpea un servidor Django REAL por HTTP
(http://127.0.0.1:8000) con la libreria `requests`. Eso implica:

  · COMMITS REALES en PostgreSQL → la limpieza NO es automatica.
    La garantiza run_e2e.sh ejecutando `tests/db_guard.py purge`
    + `verify` al final (snapshot pre-existente en
    tests/.db_guard_snapshot.json — NO regenerarlo despues de sembrar).
  · AUTH REAL: no hay force_authenticate. F0 siembra dos usuarios QA
    directamente en core.users via psycopg y el resto de flujos hace
    login JWT de verdad (access + refresh).
  · CONTRATOS REALES: los shapes de payload replican los de
    backend/tests/factories.py (la referencia canonica de la suite
    pytest reparada). `id` es server-side en todos los POST
    (read_only_fields — contrato Fable5-QA).

NOTA SOBRE EL HASH DEL PASSWORD (F0)
====================================
El seed real (database/02_auth_admin.sql) usa hash_kind='sha256'
(hex lower de SHA-256). Su propia cabecera documenta que "el backend
ya tolera ambos formatos (hash_kind prefix)": _verify_password() en
apps/core/auth_views.py delega en django check_password() cuando
hash_kind empieza con 'pbkdf2'. Como la mision exige generar el hash
con django.contrib.auth.hashers.make_password (que produce
pbkdf2_sha256$...), sembramos hash_kind='pbkdf2_sha256' — un valor
del dominio declarado por el propio seed (sha256 | pbkdf2_sha256 |
bcrypt | argon2) y verificable por el codigo real de login.

FLUJOS
======
  F0 SEED        usuarios QA admin + cliente (SQL directo, upsert)
  F1 AUTH        login ok / me / refresh / password incorrecta=401
  F2 CLIENTES    POST → GET detalle → PATCH razon_social → listado
  F3 PRODUCTOS   POST → GET ?ids= (batch) → DELETE (hard) → 404
  F4 EXP+FUSION  2 OCs + 2 expedientes → fusionar → listado → label → desfusionar
  F5 COBROS      cobro 1000 → pago VERIFICADO 400 → pagado=400 / pendiente=600
  F6 R3          rol cliente: listado capado (sin proformas/saps) + POST=403
  F7 OBSERVAB.   client-errors: POST cliente=201 / GET admin=200 / GET cliente=403

USO:  python3 test_full_flows.py [F1 F2 ...]   (sin args = todos)
Limpieza (F8) → la orquesta run_e2e.sh con db_guard purge+verify.
=====================================================================
"""
from __future__ import annotations

import json
import os
import sys
import uuid

import psycopg
import requests

BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:8000")

ADMIN_EMAIL   = "qa-e2e-admin@mwt.test"
CLIENTE_EMAIL = "qa-e2e-cliente@mwt.test"
PASSWORD      = "QaE2e-MuitoWork-2026!"

# Sufijo unico de esta corrida para no chocar con UNIQUEs preexistentes
RUN = uuid.uuid4().hex[:8].upper()


def _dsn() -> str:
    return (
        f"host={os.environ.get('DB_HOST', '127.0.0.1')} "
        f"port={os.environ.get('DB_PORT', '5432')} "
        f"dbname={os.environ.get('DB_NAME', 'mwt_one')} "
        f"user={os.environ.get('DB_USER', 'mwt')} "
        f"password={os.environ.get('DB_PASSWORD', 'mwt')}"
    )


# ─────────────────────────────────────────────────────────────────────
# Infraestructura de asserts por flujo
# ─────────────────────────────────────────────────────────────────────
class FlowFailure(Exception):
    pass


class Ctx:
    """Acumulador de asserts del flujo en curso (reporte rico al fallar)."""

    def __init__(self, name: str):
        self.name = name
        self.asserts = 0

    def check(self, cond: bool, msg: str, resp: requests.Response | None = None):
        self.asserts += 1
        if cond:
            return
        detail = msg
        if resp is not None:
            body = resp.text[:600]
            detail = f"{msg}\n    → HTTP {resp.status_code} {resp.request.method} {resp.request.url}\n    → body: {body}"
        raise FlowFailure(detail)


def _body(resp: requests.Response):
    try:
        return resp.json()
    except ValueError:
        return {"_raw": resp.text[:300]}


def _rows(payload):
    """Tolera lista cruda o paginado DRF {results: []} / {data: []}."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("results", "data"):
            if isinstance(payload.get(k), list):
                return payload[k]
    raise FlowFailure(f"Shape de listado inesperado: {str(payload)[:200]}")


def api(method: str, path: str, token: str | None = None, payload=None) -> requests.Response:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.request(method, f"{BASE}{path}", headers=headers,
                            json=payload, timeout=10)


def login(email: str, password: str) -> requests.Response:
    return api("POST", "/api/auth/login/", payload={"usuario": email, "password": password})


# ─────────────────────────────────────────────────────────────────────
# F0 · SEED — usuarios QA en core.users (SQL directo, upsert)
# ─────────────────────────────────────────────────────────────────────
def f0_seed(ctx: Ctx):
    # make_password exige settings de Django: configuracion MINIMA en
    # memoria (solo PASSWORD_HASHERS), sin tocar config.settings ni la DB.
    import django  # noqa: F401  (necesario para que hashers resuelva settings)
    from django.conf import settings as dj_settings
    if not dj_settings.configured:
        dj_settings.configure(
            PASSWORD_HASHERS=["django.contrib.auth.hashers.PBKDF2PasswordHasher"],
            USE_TZ=True,
        )
    from django.contrib.auth.hashers import make_password

    pw_hash = make_password(PASSWORD)  # → 'pbkdf2_sha256$...'
    ctx.check(pw_hash.startswith("pbkdf2_sha256$"),
              f"make_password debe producir pbkdf2_sha256, produjo: {pw_hash[:30]}")

    # Columnas segun database/02_auth_admin.sql (mismo INSERT del seed real).
    sql = """
        INSERT INTO core.users
               (email, email_plain, password_hash, hash_kind,
                full_name, role, is_active, is_staff)
        VALUES (%(e)s::citext, %(e)s::varchar, %(h)s, 'pbkdf2_sha256',
                %(n)s, %(r)s, TRUE, %(st)s)
        ON CONFLICT (email_plain) DO UPDATE
            SET password_hash = EXCLUDED.password_hash,
                hash_kind     = EXCLUDED.hash_kind,
                role          = EXCLUDED.role,
                is_active     = TRUE,
                is_staff      = EXCLUDED.is_staff,
                deleted_at    = NULL,
                updated_at    = NOW()
    """
    with psycopg.connect(_dsn()) as conn, conn.cursor() as cur:
        cur.execute(sql, {"e": ADMIN_EMAIL, "h": pw_hash,
                          "n": "QA E2E Admin", "r": "admin", "st": True})
        # Rol cliente SIN legal_entity_ids (no se crea fila en users.mwtuser):
        # scoped_querysets → qs.none() (defensa R3 por defecto).
        cur.execute(sql, {"e": CLIENTE_EMAIL, "h": pw_hash,
                          "n": "QA E2E Cliente", "r": "cliente", "st": False})
        conn.commit()
        cur.execute("SELECT role, is_active FROM core.users WHERE email_plain IN (%s, %s) ORDER BY role",
                    (ADMIN_EMAIL, CLIENTE_EMAIL))
        rows = cur.fetchall()
    ctx.check(len(rows) == 2, f"Deben existir 2 usuarios QA, hay {len(rows)}")
    ctx.check(rows[0][0] == "admin" and rows[1][0] == "cliente",
              f"Roles sembrados incorrectos: {rows}")


# ─────────────────────────────────────────────────────────────────────
# F1 · AUTH — login / me / refresh / credencial invalida
# ─────────────────────────────────────────────────────────────────────
def f1_auth(ctx: Ctx, state: dict):
    r = login(ADMIN_EMAIL, PASSWORD)
    ctx.check(r.status_code == 200, "Login admin debe ser 200", r)
    body = _body(r)
    ctx.check(bool(body.get("access")), "Login debe devolver access", r)
    ctx.check(bool(body.get("refresh")), "Login debe devolver refresh", r)
    ctx.check(body.get("user", {}).get("email") == ADMIN_EMAIL,
              f"user.email debe ser {ADMIN_EMAIL}", r)
    ctx.check(body.get("user", {}).get("role") == "admin", "user.role debe ser admin", r)
    state["admin_token"]  = body["access"]
    state["admin_refresh"] = body["refresh"]

    r = api("GET", "/api/auth/me/", token=state["admin_token"])
    ctx.check(r.status_code == 200, "/api/auth/me/ con Bearer debe ser 200", r)
    ctx.check(_body(r).get("email") == ADMIN_EMAIL, "me.email debe coincidir", r)

    r = api("POST", "/api/auth/refresh/", payload={"refresh": state["admin_refresh"]})
    ctx.check(r.status_code == 200, "refresh debe ser 200", r)
    ctx.check(bool(_body(r).get("access")), "refresh debe devolver un access nuevo", r)

    r = login(ADMIN_EMAIL, "password-incorrecta-123")
    ctx.check(r.status_code == 401, "Login con password incorrecta debe ser 401", r)


# ─────────────────────────────────────────────────────────────────────
# F2 · CLIENTES — POST → GET → PATCH → listado
# ─────────────────────────────────────────────────────────────────────
def f2_clientes(ctx: Ctx, state: dict):
    tok = state["admin_token"]
    # Shape segun tests/factories.py::ClientePayloadFactory
    payload = {
        "razon_social":     f"Cliente E2E SRL {RUN}",
        "nombre_comercial": f"ClienteE2E{RUN}",
        "tax_id":           f"30-{RUN}-7",
        "tipo":             "B2B",
        "segmento":         "B",
        "pais_iso2":        "AR",
        "ciudad":           "Buenos Aires",
        "direccion":        "Av. Corrientes 1234",
        "moneda":           "USD",
        "credito_aprobado": "50000.00",
        "credito_usado":    "10000.00",
        "dias_credito":     30,
        "contacto_nombre":  "QA E2E",
        "contacto_email":   "qa@e2e-cliente.test",
        "estado":           "ACTIVO",
        "nodo_asignado_id": str(uuid.uuid4()),   # REGLA DE ORO: UUID sin fila padre
        "responsable_id":   str(uuid.uuid4()),
        "visibility_tier":  "INTERNAL",
        "canal":            "DIRECTO",
        "incoterm":         "DAP",
        "medio_pago":       "TRANSFERENCIA",
    }
    r = api("POST", "/api/clientes/", token=tok, payload=payload)
    ctx.check(r.status_code == 201, "POST /api/clientes/ debe ser 201", r)
    cid = str(_body(r).get("id") or "")
    uuid.UUID(cid)  # id server-side valido
    ctx.check(bool(cid), "El cliente creado debe traer id (server-side)", r)

    r = api("GET", f"/api/clientes/{cid}/", token=tok)
    ctx.check(r.status_code == 200, "GET detalle cliente debe ser 200", r)
    ctx.check(_body(r).get("razon_social") == payload["razon_social"],
              "razon_social debe persistir", r)

    nueva_razon = f"Cliente E2E Renombrado {RUN}"
    r = api("PATCH", f"/api/clientes/{cid}/", token=tok,
            payload={"razon_social": nueva_razon})
    ctx.check(r.status_code == 200, "PATCH razon_social debe ser 200", r)

    r = api("GET", "/api/clientes/", token=tok)
    ctx.check(r.status_code == 200, "GET listado clientes debe ser 200", r)
    rows = _rows(_body(r))
    fila = next((x for x in rows if str(x.get("id")) == cid), None)
    ctx.check(fila is not None, f"El cliente {cid} debe aparecer en el listado", r)
    ctx.check(fila.get("razon_social") == nueva_razon,
              f"El listado debe reflejar el PATCH (vi: {fila.get('razon_social')!r})", r)
    state["cliente_id"] = cid


# ─────────────────────────────────────────────────────────────────────
# F3 · PRODUCTOS — POST → batch ?ids= → DELETE (hard) → 404
# ─────────────────────────────────────────────────────────────────────
def f3_productos(ctx: Ctx, state: dict):
    tok = state["admin_token"]
    # Shape segun tests/factories.py::ProductoPayloadFactory
    payload = {
        "sku":                f"E2E-SKU-{RUN}",
        "nombre":             f"Producto E2E {RUN}",
        "descripcion":        "Producto generado por la suite E2E QA",
        "marca_id":           str(uuid.uuid4()),
        "categoria":          "CALZADO",
        "subcategoria":       "BOTAS",
        "unidad":             "PAR",
        "moneda":             "USD",
        "costo_estandar":     "25.50",
        "precio_lista":       "78.00",
        "precio_distribuidor": "62.40",
        "precio_mwt":         "55.00",
        "especificaciones":   {"tipo_puntera": "acero"},
        "peso_kg":            "0.850",
        "volumen_m3":         "0.0042",
        "tallas":             ["40", "41", "42"],
        "colores":            ["NEGRO"],
        "estado":             "ACTIVO",
        "proveedor_principal_id": str(uuid.uuid4()),
        "pais_origen_iso2":   "BR",
        "hs_code":            "640340",
        "stock_minimo":       "20.000",
        "stock_maximo":       "500.000",
        "visibility_tier":    "INTERNAL",
    }
    r = api("POST", "/api/productos/", token=tok, payload=payload)
    ctx.check(r.status_code == 201, "POST /api/productos/ debe ser 201", r)
    pid = str(_body(r).get("id") or "")
    ctx.check(bool(pid), "El producto creado debe traer id", r)

    # Endpoint batch nuevo: GET /api/productos/?ids=<uuid>[,<uuid>...]
    r = api("GET", f"/api/productos/?ids={pid}", token=tok)
    ctx.check(r.status_code == 200, "GET /api/productos/?ids= debe ser 200", r)
    rows = _rows(_body(r))
    ids_devueltos = {str(x.get("id")) for x in rows}
    ctx.check(pid in ids_devueltos, "El batch ?ids= debe contener el producto creado", r)
    ctx.check(ids_devueltos <= {pid},
              f"El batch ?ids= solo debe devolver los ids pedidos (vi: {ids_devueltos})", r)

    # Contrato vigente: HARD DELETE (la fila desaparece, el SKU se libera)
    r = api("DELETE", f"/api/productos/{pid}/", token=tok)
    ctx.check(r.status_code == 204, "DELETE producto debe ser 204 (hard delete)", r)

    r = api("GET", f"/api/productos/{pid}/", token=tok)
    ctx.check(r.status_code == 404, "GET detalle tras hard delete debe ser 404", r)


# ─────────────────────────────────────────────────────────────────────
# F4 · EXPEDIENTES + FUSION — 2 OCs, 2 expedientes, fusionar/label/desfusionar
# ─────────────────────────────────────────────────────────────────────
def _oc_payload(n: int, client_id: str) -> dict:
    # Shape segun tests/factories.py::OcPayloadFactory
    # Contrato ACTUAL (ver tests/test_expedientes.py): OcSerializer
    # (fields="__all__", sin read_only para id) EXIGE `id` en el body,
    # aunque el ViewSet luego lo reemplaza con s.save(id=uuid.uuid4()).
    return {
        "id":              str(uuid.uuid4()),
        "codigo":          f"OC-E2E-{RUN}-{n}",
        "client_id":       client_id,
        "brand_id":        str(uuid.uuid4()),
        "proforma":        f"PRF-E2E-{RUN}-{n}",
        "estado":          "EMITIDA",
        "moneda":          "USD",
        "issued_at":       "2026-06-11",
        "total_value":     "12500.00",
        "total_invoiced":  "0.00",
        "total_paid":      "0.00",
        "balance":         "12500.00",
        "coverage_pct":    "0.0000",
        "lines_count":     0,
        "lines_with_sap":  0,
        "air_pct":         "0.0000",
        "sea_pct":         "1.0000",
        "credit_days_max": 60,
        "credit_band":     "NORMAL",
        "notas":           "OC E2E QA",
        "visibility_tier": "INTERNAL",
    }


def _exp_payload(n: int, oc_id: str, client_id: str) -> dict:
    # Shape segun tests/factories.py::ExpedientePayloadFactory
    return {
        "codigo":              f"EXP-E2E-{RUN}-{n}",
        "oc_id":               oc_id,
        "client_id":           client_id,
        "brand_id":            str(uuid.uuid4()),
        "estado":              "REGISTRO",
        "modo_operacion":      "FULL",
        "incoterm":            "FOB",
        "freight_mode":        "SEA",
        "dispatch_mode":       "FCL",
        "origin":              "Sao Paulo",
        "destination":         "Buenos Aires",
        "origin_country":      "BR",
        "destination_country": "AR",
        "container_count":     1,
        "product_count":       4,
        "moneda":              "USD",
        "total_cost":          "9800.00",
        "total_invoiced":      "0.00",
        "total_paid":          "0.00",
        "balance":             "9800.00",
        "commission_pct":      "0.0500",
        "dai_pct":             "0.1800",
        "iva_pct":             "0.2100",
        "credit_days":         45,
        "credit_band":         "NORMAL",
        "artifacts_done":      0,
        "artifacts_total":     6,
        "baseline_days":       10,
        "visibility_tier":     "INTERNAL",
        "notas":               "Expediente E2E QA",
    }


def f4_expedientes_fusion(ctx: Ctx, state: dict):
    tok = state["admin_token"]
    client_id = state.get("cliente_id") or str(uuid.uuid4())

    exp_ids = []
    for n in (1, 2):
        r = api("POST", "/api/ocs/", token=tok, payload=_oc_payload(n, client_id))
        ctx.check(r.status_code == 201, f"POST /api/ocs/ #{n} debe ser 201", r)
        oc_id = str(_body(r)["id"])
        r = api("POST", "/api/expedientes/", token=tok,
                payload=_exp_payload(n, oc_id, client_id))
        ctx.check(r.status_code == 201, f"POST /api/expedientes/ #{n} debe ser 201", r)
        exp_ids.append(str(_body(r)["id"]))

    # Fusionar
    label = f"PO-E2E-{RUN}"
    r = api("POST", "/api/expedientes/fusionar/", token=tok,
            payload={"expediente_ids": exp_ids, "label": label})
    ctx.check(r.status_code == 200, "POST fusionar debe ser 200", r)
    body = _body(r)
    ctx.check(body.get("members") == 2, "fusionar debe reportar members=2", r)
    ctx.check(body.get("fusion_label") == label, "fusionar debe devolver el label", r)
    fid = str(body.get("fusion_id") or "")
    uuid.UUID(fid)
    ctx.check(bool(fid), "fusionar debe devolver fusion_id", r)

    # fusion_id compartido en el listado
    r = api("GET", "/api/expedientes/", token=tok)
    ctx.check(r.status_code == 200, "GET listado expedientes debe ser 200", r)
    rows = _rows(_body(r))
    for eid in exp_ids:
        fila = next((x for x in rows if str(x.get("id")) == eid), None)
        ctx.check(fila is not None, f"Expediente {eid} debe estar en el listado", r)
        ctx.check(str(fila.get("fusion_id")) == fid,
                  f"fusion_id debe viajar en el listado (vi: {fila.get('fusion_id')})", r)

    # Renombrar el grupo
    r = api("POST", "/api/expedientes/fusion-label/", token=tok,
            payload={"fusion_id": fid, "label": f"Renombrada-{RUN}"})
    ctx.check(r.status_code == 200, "POST fusion-label debe ser 200", r)
    ctx.check(_body(r).get("members") == 2, "fusion-label debe afectar 2 miembros", r)
    ctx.check(_body(r).get("fusion_label") == f"Renombrada-{RUN}",
              "fusion-label debe devolver el nuevo label", r)

    # Desfusionar
    r = api("POST", "/api/expedientes/desfusionar/", token=tok,
            payload={"fusion_id": fid})
    ctx.check(r.status_code == 200, "POST desfusionar debe ser 200", r)
    ctx.check(_body(r).get("unfused") == 2, "desfusionar debe limpiar 2 miembros", r)

    r = api("GET", "/api/expedientes/", token=tok)
    rows = _rows(_body(r))
    for eid in exp_ids:
        fila = next((x for x in rows if str(x.get("id")) == eid), None)
        ctx.check(fila is not None and not fila.get("fusion_id"),
                  f"Tras desfusionar, fusion_id debe quedar vacio en {eid}", r)
    state["exp_ids"] = exp_ids


# ─────────────────────────────────────────────────────────────────────
# F5 · COBROS — cobro 1000 → pago VERIFICADO 400 → pendiente 600 (GENERATED)
# ─────────────────────────────────────────────────────────────────────
def f5_cobros(ctx: Ctx, state: dict):
    tok = state["admin_token"]
    # Shape segun tests/factories.py::CobroPayloadFactory
    # (monto_pendiente es columna GENERATED + read_only en el serializer:
    #  NO se manda — la calcula la DB como monto_total - monto_pagado)
    cobro_payload = {
        "codigo":            f"COB-E2E-{RUN}",
        "oc_id":             str(uuid.uuid4()),
        "expediente_id":     str(uuid.uuid4()),
        "client_id":         state.get("cliente_id") or str(uuid.uuid4()),
        "moneda":            "USD",
        "monto_total":       "1000.00",
        "monto_pagado":      "0.00",
        "fecha_vencimiento": "2026-07-15",
        "dias_credito":      30,
        "estado":            "PENDIENTE",
        "notas":             "Cobro E2E QA",
        "visibility_tier":   "INTERNAL",
        "collection_stage":  "NONE",
    }
    r = api("POST", "/api/cobros/", token=tok, payload=cobro_payload)
    ctx.check(r.status_code == 201, "POST /api/cobros/ debe ser 201", r)
    cobro_id = str(_body(r)["id"])

    # Pago VERIFICADO 400 → PagoViewSet._aplicar_delta_cobro suma al cobro
    pago_payload = {
        "codigo":             f"PAG-E2E-{RUN}",
        "direccion":          "INGRESO",
        "cobro_id":           cobro_id,
        "oc_id":              str(uuid.uuid4()),
        "client_id":          cobro_payload["client_id"],
        "metodo":             "TRANSFERENCIA",
        "referencia_externa": f"REF-E2E-{RUN}",
        "banco_origen":       "Banco E2E Origen",
        "banco_destino":      "Banco E2E Destino",
        "moneda":             "USD",
        "monto":              "400.00",
        "fx_rate":            "1.000000",
        "monto_usd":          "400.00",
        "estado":             "VERIFICADO",
        "fecha_operacion":    "2026-06-11",
        "visibility_tier":    "INTERNAL",
        "fx_source":          "MANUAL",
        "withholding_usd":    "0.00",
        "fees_bank_usd":      "0.00",
    }
    r = api("POST", "/api/pagos/", token=tok, payload=pago_payload)
    ctx.check(r.status_code == 201, "POST /api/pagos/ VERIFICADO debe ser 201", r)

    r = api("GET", f"/api/cobros/{cobro_id}/", token=tok)
    ctx.check(r.status_code == 200, "GET detalle cobro debe ser 200", r)
    body = _body(r)
    pagado    = float(body.get("monto_pagado") or 0)
    pendiente = float(body.get("monto_pendiente") or 0)
    ctx.check(abs(pagado - 400.0) < 0.005,
              f"monto_pagado debe ser 400.00 (vi {body.get('monto_pagado')!r})", r)
    ctx.check(abs(pendiente - 600.0) < 0.005,
              f"monto_pendiente (GENERATED en DB) debe ser 600.00 (vi {body.get('monto_pendiente')!r})", r)


# ─────────────────────────────────────────────────────────────────────
# F6 · R3 VISIBILIDAD — rol cliente: scope capado + mutaciones 403
# ─────────────────────────────────────────────────────────────────────
def f6_r3_visibilidad(ctx: Ctx, state: dict):
    r = login(CLIENTE_EMAIL, PASSWORD)
    ctx.check(r.status_code == 200, "Login del rol cliente debe ser 200", r)
    tok = _body(r)["access"]
    ctx.check(_body(r)["user"]["role"] == "cliente", "role debe ser cliente", r)
    state["cliente_token"] = tok

    # Cliente SIN legal_entity_ids → filter_by_user_clients → qs.none()
    # (defense-in-depth: jamas exponer data a un user sin empresas asignadas)
    r = api("GET", "/api/expedientes/", token=tok)
    ctx.check(r.status_code == 200, "GET expedientes como cliente debe ser 200", r)
    rows = _rows(_body(r))
    ctx.check(len(rows) == 0,
              f"Cliente sin legal_entity_ids NO debe ver filas ajenas (vio {len(rows)})", r)
    # R3 dura: aunque hubiera filas, proformas/saps jamas pueden viajar poblados
    for fila in rows:
        ctx.check(not fila.get("proforma_codigo"),
                  f"R3 VIOLADA: proforma_codigo expuesto: {fila.get('proforma_codigo')!r}", r)
        ctx.check(not fila.get("proforma_codigos"),
                  f"R3 VIOLADA: proforma_codigos expuestos: {fila.get('proforma_codigos')!r}", r)
        ctx.check(not fila.get("sap_codigos"),
                  f"R3 VIOLADA: sap_codigos expuestos: {fila.get('sap_codigos')!r}", r)

    # Mutaciones: _deny_client_mutation → 403 SIEMPRE para rol cliente
    r = api("POST", "/api/expedientes/", token=tok,
            payload=_exp_payload(99, str(uuid.uuid4()), str(uuid.uuid4())))
    ctx.check(r.status_code == 403, "POST expediente como cliente debe ser 403", r)

    r = api("POST", "/api/expedientes/fusionar/", token=tok,
            payload={"expediente_ids": [str(uuid.uuid4()), str(uuid.uuid4())]})
    ctx.check(r.status_code == 403, "POST fusionar como cliente debe ser 403", r)

    r = api("POST", "/api/ocs/", token=tok, payload=_oc_payload(99, str(uuid.uuid4())))
    ctx.check(r.status_code == 403, "POST OC como cliente debe ser 403", r)


# ─────────────────────────────────────────────────────────────────────
# F7 · OBSERVABILIDAD — client-errors (escribe cualquiera, lee solo staff)
# ─────────────────────────────────────────────────────────────────────
def f7_observabilidad(ctx: Ctx, state: dict):
    cli_tok = state["cliente_token"]
    adm_tok = state["admin_token"]
    msg = f"E2E QA: crash sintetico {RUN}"

    r = api("POST", "/api/analytics/client-errors/", token=cli_tok,
            payload={"message": msg, "stack": "at render (Portal.jsx:7)",
                     "path": "/portal"})
    ctx.check(r.status_code == 201, "POST client-errors como cliente debe ser 201", r)
    ctx.check(_body(r).get("ok") is True, "POST debe devolver {ok: true}", r)

    r = api("GET", "/api/analytics/client-errors/", token=adm_tok)
    ctx.check(r.status_code == 200, "GET client-errors como admin debe ser 200", r)
    rows = _rows(_body(r))
    ctx.check(any(x.get("message") == msg for x in rows),
              "El error reportado debe aparecer en el listado staff", r)

    r = api("GET", "/api/analytics/client-errors/", token=cli_tok)
    ctx.check(r.status_code == 403, "GET client-errors como cliente debe ser 403", r)
    ctx.check(_body(r).get("detail") == "forbidden", "detail debe ser 'forbidden'", r)


# ─────────────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────────────
FLOWS = [
    ("F0 SEED",           f0_seed,               False),
    ("F1 AUTH",           f1_auth,               True),
    ("F2 CLIENTES",       f2_clientes,           True),
    ("F3 PRODUCTOS",      f3_productos,          True),
    ("F4 EXP+FUSION",     f4_expedientes_fusion, True),
    ("F5 COBROS",         f5_cobros,             True),
    ("F6 R3 VISIBILIDAD", f6_r3_visibilidad,     True),
    ("F7 OBSERVABILIDAD", f7_observabilidad,     True),
]


def main() -> int:
    seleccion = {a.upper() for a in sys.argv[1:]}
    state: dict = {}
    fallos = 0
    for name, fn, takes_state in FLOWS:
        codigo = name.split()[0]
        # F0 corre SIEMPRE (los demas flujos dependen de los usuarios QA)
        if seleccion and codigo != "F0" and codigo not in seleccion:
            continue
        ctx = Ctx(name)
        try:
            fn(ctx, state) if takes_state else fn(ctx)
            print(f"{name} ✅ ({ctx.asserts} asserts)")
        except FlowFailure as e:
            fallos += 1
            print(f"{name} ❌ tras {ctx.asserts} asserts:\n    {e}")
        except Exception as e:  # error de plumbing (conexion, etc.)
            fallos += 1
            print(f"{name} ❌ error inesperado tras {ctx.asserts} asserts: {type(e).__name__}: {e}")
    total = sum(1 for n, _, _ in FLOWS if not seleccion or n.split()[0] == "F0" or n.split()[0] in seleccion)
    print(f"\n{'🟢' if fallos == 0 else '🔴'} E2E: {total - fallos}/{total} flujos OK")
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
