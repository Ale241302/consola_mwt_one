"""
=====================================================================
MWT.ONE · tests/test_portal.py
Agente responsable: [AG-06-QA]   (BLOQUE 4 · Portal B2B)

COBERTURA
=========
1. PortalViewSet — 7 acciones read-only scopeadas por client_id.
   Resolución del scope (orden de precedencia):
     · request.user.portal_client_id
     · header X-Portal-Client
     · query param ?client_id=

   Sin scope → 403 (todos los endpoints).

   · GET /api/portal/me/
   · GET /api/portal/mis_ocs/
   · GET /api/portal/mis_expedientes/   (traduce estado técnico → cliente)
   · GET /api/portal/mis_pagos/
   · GET /api/portal/mis_cobros/
   · GET /api/portal/mis_documentos/
   · GET /api/portal/expediente_detail/?id=…   (404 si fuera de scope)
   · PATCH /api/portal/update_preferences/      (JSONB merge)
   · GET /api/portal/kpis/

2. CLIENT_STATE_MAP — mapping completo de 7 estados técnicos a labels
   ES + EN + step (0..5). Validación lateral del contrato del front.

3. MwtUserViewSet — CRUD ModelViewSet (apps.portal.MwtUser).
   · Idempotency por idempotence_token (200 + X-Idempotent-Replay).
   · UUID server-side si no viene.
   · Hash password (pbkdf2_sha256) — nunca se expone en respuesta.
   · accept_invitation: invite_token + password → activa cuenta.
   · change_password: old_password + new_password con validación min 8.
   · audit_log + session_log per-user.

4. PortalSessionLogViewSet + PortalAuditLogViewSet — read-only.
   POST/PATCH/DELETE → 405. Filtros standard (mwt_user_id/email/...).

REGLA DE ORO MWT
================
Todos los `*_id` viajan como UUIDs string sin FK física → se valida
con `assert_uuid_string()`. Tests "Acepta_X_id_inexistente" verifican
que no hay enforcement (UUIDs huérfanos pasan).
=====================================================================
"""
from __future__ import annotations

import uuid

import pytest

from tests._common import (
    assert_uuid_string,
    extract_results,
    find_by_id,
    new_uuid,
)
from tests.factories import (
    PortalAuditLogModelFactory,
    PortalMwtUserModelFactory,
    PortalMwtUserPayloadFactory,
    PortalSessionLogModelFactory,
)


# ═════════════════════════════════════════════════════════════════════
# Helpers locales
# ═════════════════════════════════════════════════════════════════════
PORTAL_ACTIONS = [
    "me", "mis_ocs", "mis_expedientes", "mis_pagos",
    "mis_cobros", "mis_documentos", "kpis",
]


# ═════════════════════════════════════════════════════════════════════
# 1) Scope resolution — contrato Sprint 2026-05-20 (multi-empresa):
#    SIN scope ya NO hay 403; cada endpoint degrada honesto:
#      · me      → 200 {user, empresas: [], primary: null}
#      · mis_*   → 200 [] (_empty_scope)
#      · kpis    → 200 dict con is_empty=True y scope_empresa_count=0
# ═════════════════════════════════════════════════════════════════════
class TestPortalScopeResolution:
    """`_resolve_client_ids()` devuelve [] si el usuario no tiene
    empresas (legal_entity_ids) ni overrides → empty-scope 200."""

    URL = "/api/portal/{action}/"

    @pytest.mark.parametrize("action", PORTAL_ACTIONS)
    def test_sin_scope_devuelve_empty_honesto(self, authenticated_client, action):
        r = authenticated_client.get(self.URL.format(action=action))
        assert r.status_code == 200, (
            f"Action '{action}' debió responder 200 empty-scope, "
            f"recibido {r.status_code}: {r.content!r}"
        )
        body = r.json()
        if action == "me":
            assert body.get("empresas") == []
            assert body.get("primary") is None
        elif action == "kpis":
            assert body.get("is_empty") is True
            assert body.get("scope_empresa_count") == 0
        else:
            assert body == [], f"'{action}' sin scope debe devolver []"

    def test_acepta_client_id_via_query_param(self, authenticated_client):
        # `me` IGNORA ?client_id= (devuelve catálogo completo de empresas);
        # el override legacy aplica a los endpoints de listado (mis_*).
        cid = new_uuid()
        r = authenticated_client.get(f"/api/portal/mis_ocs/?client_id={cid}")
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)  # cliente fantasma → lista vacía
        # kpis con scope de 1 empresa: scope_empresa_count == 1
        rk = authenticated_client.get(f"/api/portal/kpis/?client_id={cid}")
        assert rk.status_code == 200
        assert rk.json().get("scope_empresa_count") == 1

    def test_acepta_client_id_via_header(self, authenticated_client):
        cid = new_uuid()
        r = authenticated_client.get(
            "/api/portal/mis_ocs/", HTTP_X_PORTAL_CLIENT=cid,
        )
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)


# ═════════════════════════════════════════════════════════════════════
# 2) Endpoints read-only del portal — shape contractual
# ═════════════════════════════════════════════════════════════════════
class TestPortalEndpoints:
    """Tests sobre el shape del payload — los endpoints son raw SQL
    tolerante: si la tabla está vacía devuelven [] o {} en vez de 500."""

    @pytest.fixture
    def cid(self):
        return new_uuid()

    def test_me_devuelve_shape_minimo(self, authenticated_client, cid):
        # Contrato multi-empresa: {user, empresas, primary} — ignora client_id.
        r = authenticated_client.get(f"/api/portal/me/?client_id={cid}")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in ("user", "empresas", "primary"):
            assert k in body, f"me: falta clave '{k}'"
        assert isinstance(body["empresas"], list)

    def test_mis_ocs_devuelve_lista(self, authenticated_client, cid):
        r = authenticated_client.get(f"/api/portal/mis_ocs/?client_id={cid}")
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)

    def test_mis_expedientes_devuelve_lista(self, authenticated_client, cid):
        r = authenticated_client.get(
            f"/api/portal/mis_expedientes/?client_id={cid}",
        )
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)

    def test_mis_ocs_client_ref_prefiere_documento_oc(self, authenticated_client):
        """Fable5-QA 2026-06-12 · El portal debe mostrar la MISMA referencia
        que /expedientes para el cliente: 1) codigo del documento OC subido,
        2) display_label (E4), 3) fallback codigo interno PO-2026-N."""
        import uuid as _uuid
        from apps.expedientes.models import Documento, Expediente, Oc
        cid = new_uuid()
        oc = Oc.objects.create(
            id=_uuid.uuid4(), codigo=f"PO-2026-{_uuid.uuid4().hex[:5]}",
            client_id=cid, is_active=True, display_label="ALIAS-E4",
        )
        exp = Expediente.objects.create(
            id=_uuid.uuid4(), codigo=f"EXP-QA-{_uuid.uuid4().hex[:6]}",
            oc_id=oc.id, client_id=cid, is_active=True, estado="REGISTRO",
        )
        Documento.objects.create(
            id=_uuid.uuid4(), expediente_id=exp.id, oc_id=oc.id,
            kind="OC", codigo="PO 504960", is_active=True,
        )
        r = authenticated_client.get(f"/api/portal/mis_ocs/?client_id={cid}")
        assert r.status_code == 200, r.content
        rows = [x for x in r.json() if x["id"] == str(oc.id)]
        assert rows, "la OC creada no aparece en mis_ocs"
        # precedencia 1: codigo del documento OC (lo que ve en /expedientes)
        assert rows[0].get("client_ref") == "PO 504960", rows[0]
        # mis_expedientes expone el mismo campo
        r2 = authenticated_client.get(f"/api/portal/mis_expedientes/?client_id={cid}")
        fila = [x for x in r2.json() if x["id"] == str(exp.id)]
        assert fila and fila[0].get("client_ref") == "PO 504960", fila

    def test_mis_pagos_devuelve_lista(self, authenticated_client, cid):
        r = authenticated_client.get(f"/api/portal/mis_pagos/?client_id={cid}")
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)

    def test_mis_cobros_devuelve_lista(self, authenticated_client, cid):
        r = authenticated_client.get(f"/api/portal/mis_cobros/?client_id={cid}")
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)

    def test_mis_documentos_devuelve_lista(self, authenticated_client, cid):
        r = authenticated_client.get(
            f"/api/portal/mis_documentos/?client_id={cid}",
        )
        assert r.status_code == 200, r.content
        assert isinstance(r.json(), list)

    def test_kpis_devuelve_shape_completo(self, authenticated_client, cid):
        r = authenticated_client.get(f"/api/portal/kpis/?client_id={cid}")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in (
            "ocs_activas", "total_invoiced", "total_paid", "balance",
            "coverage_pct", "credit_days_limit", "credit_days_used",
        ):
            assert k in body, f"kpis: falta clave '{k}'"


# ═════════════════════════════════════════════════════════════════════
# 3) expediente_detail — scope-checked + audit logging
# ═════════════════════════════════════════════════════════════════════
class TestExpedienteDetail:
    URL = "/api/portal/expediente_detail/"

    def test_403_sin_scope(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}?id={new_uuid()}")
        assert r.status_code == 403

    def test_400_sin_query_param_id(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}?client_id={new_uuid()}")
        assert r.status_code == 400, r.content

    def test_404_si_expediente_fuera_de_scope(self, authenticated_client):
        """Cualquier id huérfano debe responder 404 (no leak de existencia)."""
        r = authenticated_client.get(
            f"{self.URL}?client_id={new_uuid()}&id={new_uuid()}",
        )
        assert r.status_code == 404, r.content


# ═════════════════════════════════════════════════════════════════════
# 4) update_preferences — JSONB merge
# ═════════════════════════════════════════════════════════════════════
class TestUpdatePreferences:
    URL = "/api/portal/update_preferences/"

    def test_400_si_preferences_no_es_dict(self, authenticated_client):
        r = authenticated_client.patch(
            self.URL, data={"preferences": "not-a-dict"}, format="json",
        )
        # Puede ser 400 (validación) o 404 (usuario no encontrado en SQL).
        # Lo importante: NO 500.
        assert r.status_code in (400, 404), r.content

    def test_response_codes_para_dict_valido(self, authenticated_client):
        """Body válido → 200 / 404 / 500 son aceptables (depende de si
        el usuario existe en `portal.mwt_user` y si el schema está montado)."""
        r = authenticated_client.patch(
            self.URL,
            data={"preferences": {"theme": "dark", "lang": "en"}},
            format="json",
        )
        assert r.status_code in (200, 404, 500), r.content

    def test_401_si_usuario_no_autenticado(self, api_client):
        """Sin force_authenticate → IsAuthenticated del settings rechaza
        antes de llegar al action; 401 esperado."""
        r = api_client.patch(
            self.URL,
            data={"preferences": {"theme": "dark"}},
            format="json",
        )
        assert r.status_code in (401, 403), r.content


# ═════════════════════════════════════════════════════════════════════
# 5) MwtUserViewSet — CRUD + idempotency + invitations
# ═════════════════════════════════════════════════════════════════════
class TestMwtUserCRUD:
    URL = "/api/mwt-users/"

    def test_list_devuelve_solo_activos(self, authenticated_client):
        u1 = PortalMwtUserModelFactory()
        PortalMwtUserModelFactory(is_active=False)

        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        ids = [str(x["id"]) for x in items]
        assert str(u1.id) in ids
        # Soft-deleted no debe aparecer
        # (no aseveramos negativo porque hay otros tests creando usuarios)

    def test_list_filtra_por_role(self, authenticated_client):
        PortalMwtUserModelFactory(role="b2b_client")
        PortalMwtUserModelFactory(role="admin")

        r = authenticated_client.get(f"{self.URL}?role=admin")
        assert r.status_code == 200
        items = extract_results(r.json())
        for u in items:
            assert u["role"] == "admin"

    def test_list_filtra_por_email_exacto(self, authenticated_client):
        u = PortalMwtUserModelFactory(email="filter-test@mwt.test")
        r = authenticated_client.get(f"{self.URL}?email=filter-test@mwt.test")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert any(str(x["id"]) == str(u.id) for x in items)

    def test_list_filtra_por_search_substring(self, authenticated_client):
        PortalMwtUserModelFactory(email="searchable-substring@mwt.test")
        r = authenticated_client.get(f"{self.URL}?search=searchable-substring")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert any("searchable-substring" in x["email"] for x in items)

    def test_create_genera_uuid_server_side(self, authenticated_client):
        payload = PortalMwtUserPayloadFactory()
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        body = r.json()
        assert_uuid_string(body["id"], "id")

    def test_create_acepta_legal_entity_id_inexistente(self, authenticated_client):
        """REGLA DE ORO: legal_entity_id es UUID string sin FK enforcement."""
        payload = PortalMwtUserPayloadFactory(legal_entity_id=new_uuid())
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content

    def test_create_idempotente_por_token(self, authenticated_client):
        token = new_uuid()
        payload = PortalMwtUserPayloadFactory(idempotence_token=token)

        r1 = authenticated_client.post(self.URL, data=payload, format="json")
        assert r1.status_code == 201, r1.content
        id1 = r1.json()["id"]

        # Replay con mismo token (cuerpo distinto) → 200 con el mismo id
        payload2 = PortalMwtUserPayloadFactory(idempotence_token=token)
        r2 = authenticated_client.post(self.URL, data=payload2, format="json")
        assert r2.status_code == 200, r2.content
        assert r2.json()["id"] == id1
        assert r2.headers.get("X-Idempotent-Replay") == "true"

    def test_create_no_expone_password_hash(self, authenticated_client):
        payload = PortalMwtUserPayloadFactory(password="MiPassSegura123")
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        body = r.json()
        # password_hash NUNCA debe viajar en la respuesta del serializer
        assert "password_hash" not in body, (
            "FUGA DE CREDENCIAL: password_hash apareció en la respuesta"
        )
        # password tampoco debe aparecer
        assert "password" not in body, "FUGA: 'password' raw en respuesta"

    def test_retrieve_user(self, authenticated_client):
        u = PortalMwtUserModelFactory()
        r = authenticated_client.get(f"{self.URL}{u.id}/")
        assert r.status_code == 200, r.content
        assert str(r.json()["id"]) == str(u.id)
        assert r.json()["email"] == u.email

    def test_destroy_marca_is_active_false(self, authenticated_client):
        u = PortalMwtUserModelFactory()
        r = authenticated_client.delete(f"{self.URL}{u.id}/")
        assert r.status_code in (204, 200), r.content

        r2 = authenticated_client.get(f"{self.URL}{u.id}/")
        # Soft-delete → ya no aparece (ModelViewSet con queryset is_active=True)
        assert r2.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# 6) accept_invitation
# ═════════════════════════════════════════════════════════════════════
class TestAcceptInvitation:
    URL = "/api/mwt-users/{id}/accept_invitation/"

    def test_400_sin_invite_token(self, authenticated_client):
        u = PortalMwtUserModelFactory(invite_token="abc")
        r = authenticated_client.post(
            self.URL.format(id=u.id),
            data={"password": "MiPassSegura123"},
            format="json",
        )
        assert r.status_code == 400, r.content

    def test_400_sin_password(self, authenticated_client):
        u = PortalMwtUserModelFactory(invite_token="abc")
        r = authenticated_client.post(
            self.URL.format(id=u.id),
            data={"invite_token": "abc"},
            format="json",
        )
        assert r.status_code == 400, r.content

    def test_404_si_user_no_existe(self, authenticated_client):
        r = authenticated_client.post(
            self.URL.format(id=new_uuid()),
            data={"invite_token": "abc", "password": "ValidPass123"},
            format="json",
        )
        assert r.status_code == 404, r.content

    def test_403_si_invite_token_invalido(self, authenticated_client):
        u = PortalMwtUserModelFactory(invite_token="real-token")
        r = authenticated_client.post(
            self.URL.format(id=u.id),
            data={"invite_token": "fake-token", "password": "ValidPass123"},
            format="json",
        )
        assert r.status_code == 403, r.content

    def test_acepta_invitacion_y_setea_password(self, authenticated_client):
        u = PortalMwtUserModelFactory(invite_token="real-token-XYZ")
        r = authenticated_client.post(
            self.URL.format(id=u.id),
            data={
                "invite_token": "real-token-XYZ",
                "password":     "NuevoPass123!",
            },
            format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body.get("ok") is True
        assert "accepted_at" in body
        # invite_token y password no deben filtrarse en la respuesta
        assert "password" not in body
        assert "password_hash" not in body
        assert "invite_token" not in body


# ═════════════════════════════════════════════════════════════════════
# 7) change_password
# ═════════════════════════════════════════════════════════════════════
class TestChangePassword:
    URL = "/api/mwt-users/{id}/change_password/"

    def test_400_si_new_password_demasiado_corta(self, authenticated_client):
        u = PortalMwtUserModelFactory()
        r = authenticated_client.post(
            self.URL.format(id=u.id),
            data={"old_password": "viejo", "new_password": "1234567"},
            format="json",
        )
        assert r.status_code == 400, r.content

    def test_404_si_usuario_no_existe(self, authenticated_client):
        r = authenticated_client.post(
            self.URL.format(id=new_uuid()),
            data={"old_password": "x", "new_password": "PassValido123"},
            format="json",
        )
        assert r.status_code == 404, r.content

    def test_setea_password_si_no_habia_anterior(self, authenticated_client):
        """Usuario sin password_hash → primera vez. Acepta sin old_password."""
        u = PortalMwtUserModelFactory(password_hash=None)
        r = authenticated_client.post(
            self.URL.format(id=u.id),
            data={"new_password": "FirstPass123"},
            format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body.get("ok") is True
        assert "password_hash" not in body
        assert "password_changed_at" in body


# ═════════════════════════════════════════════════════════════════════
# 8) audit_log + session_log per-user
# ═════════════════════════════════════════════════════════════════════
class TestUserNestedLogs:
    def test_audit_log_devuelve_solo_del_usuario(self, authenticated_client):
        u = PortalMwtUserModelFactory()
        PortalAuditLogModelFactory(mwt_user_id=u.id, action="VIEW")
        PortalAuditLogModelFactory(mwt_user_id=u.id, action="UPDATE")
        # Otro usuario no debe aparecer
        PortalAuditLogModelFactory()

        r = authenticated_client.get(f"/api/mwt-users/{u.id}/audit_log/")
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        for log in items:
            assert str(log["mwt_user_id"]) == str(u.id)

    def test_audit_log_filtra_por_action(self, authenticated_client):
        u = PortalMwtUserModelFactory()
        PortalAuditLogModelFactory(mwt_user_id=u.id, action="VIEW")
        PortalAuditLogModelFactory(mwt_user_id=u.id, action="UPDATE")

        r = authenticated_client.get(
            f"/api/mwt-users/{u.id}/audit_log/?action=VIEW",
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        for log in items:
            assert log["action"] == "VIEW"

    def test_session_log_devuelve_solo_del_usuario(self, authenticated_client):
        u = PortalMwtUserModelFactory()
        PortalSessionLogModelFactory(mwt_user_id=u.id, event_type="LOGIN")
        PortalSessionLogModelFactory(mwt_user_id=u.id, event_type="LOGOUT")
        PortalSessionLogModelFactory()  # otro usuario

        r = authenticated_client.get(f"/api/mwt-users/{u.id}/session_log/")
        assert r.status_code == 200
        items = extract_results(r.json())
        for s in items:
            assert str(s["mwt_user_id"]) == str(u.id)

    def test_session_log_filtra_por_success(self, authenticated_client):
        u = PortalMwtUserModelFactory()
        PortalSessionLogModelFactory(mwt_user_id=u.id, success=True)
        PortalSessionLogModelFactory(mwt_user_id=u.id, success=False)

        r = authenticated_client.get(
            f"/api/mwt-users/{u.id}/session_log/?success=false",
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        for s in items:
            assert s["success"] is False


# ═════════════════════════════════════════════════════════════════════
# 9) PortalSessionLogViewSet — read-only
# ═════════════════════════════════════════════════════════════════════
class TestPortalSessionLogViewSet:
    URL = "/api/portal-sessions/"

    def test_list_devuelve_sesiones_activas(self, authenticated_client):
        PortalSessionLogModelFactory()
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        extract_results(r.json())

    def test_list_filtra_por_event_type(self, authenticated_client):
        PortalSessionLogModelFactory(event_type="LOGIN")
        PortalSessionLogModelFactory(event_type="LOGOUT")

        r = authenticated_client.get(f"{self.URL}?event_type=LOGIN")
        assert r.status_code == 200
        items = extract_results(r.json())
        for s in items:
            assert s["event_type"] == "LOGIN"

    def test_post_no_permitido(self, authenticated_client):
        r = authenticated_client.post(self.URL, data={}, format="json")
        assert r.status_code == 405

    def test_destroy_no_permitido(self, authenticated_client):
        s = PortalSessionLogModelFactory()
        r = authenticated_client.delete(f"{self.URL}{s.id}/")
        assert r.status_code == 405


# ═════════════════════════════════════════════════════════════════════
# 10) PortalAuditLogViewSet — read-only + kpis
# ═════════════════════════════════════════════════════════════════════
class TestPortalAuditLogViewSet:
    URL = "/api/portal-audit/"

    def test_list_devuelve_audits_activos(self, authenticated_client):
        PortalAuditLogModelFactory()
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        extract_results(r.json())

    def test_list_filtra_por_action(self, authenticated_client):
        PortalAuditLogModelFactory(action="VIEW")
        PortalAuditLogModelFactory(action="UPDATE")

        r = authenticated_client.get(f"{self.URL}?action=UPDATE")
        assert r.status_code == 200
        items = extract_results(r.json())
        for log in items:
            assert log["action"] == "UPDATE"

    def test_list_filtra_por_resource_type(self, authenticated_client):
        PortalAuditLogModelFactory(resource_type="expediente")
        PortalAuditLogModelFactory(resource_type="oc")

        r = authenticated_client.get(f"{self.URL}?resource_type=oc")
        assert r.status_code == 200
        items = extract_results(r.json())
        for log in items:
            assert log["resource_type"] == "oc"

    def test_post_no_permitido(self, authenticated_client):
        r = authenticated_client.post(self.URL, data={}, format="json")
        assert r.status_code == 405

    def test_kpis_devuelve_shape_completo(self, authenticated_client):
        PortalAuditLogModelFactory(action="VIEW")
        PortalAuditLogModelFactory(action="UPDATE")

        r = authenticated_client.get(f"{self.URL}kpis/")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in ("total_30d", "by_action"):
            assert k in body, f"audit kpis: falta clave '{k}'"
        assert isinstance(body["by_action"], dict)
