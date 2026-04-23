"""
=====================================================================
MWT.ONE · tests/test_plantillas.py
Agente responsable: [AG-06-QA]   (BLOQUE 4 · Email Templates)

COBERTURA
=========
1. TemplateViewSet — CRUD + lifecycle (DRAFT → PUBLISHED → ARCHIVED).
   · Idempotency por idempotence_token (early-return 200 con flag).
   · UUID server-side al crear.
   · Versioning automático: cada cambio en subject/body genera Version.
   · Filtros: key/language/brand/brand_id/status/is_active/q (icontains
     en name).
   · Soft-delete: DELETE → 204 + is_active=False.

2. Lifecycle:
   · publish: DRAFT → PUBLISHED, idempotente, 409 si ARCHIVED.
   · archive: → ARCHIVED + is_active=False, idempotente.

3. Template actions:
   · variables: regex Jinja2 `{{var}}` + format `{var}` → declared+detected.
   · preview: render con Jinja2 (fallback a format_map), persiste
     RenderPreviewLog.
   · test_send: envía render (encolado si no hay mailer) + 400 sin email.

4. VersionViewSet — read-only + create.
5. RenderPreviewLogViewSet — read-only + kpis (success_rate_7d).

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
    EmailTemplateModelFactory,
    EmailTemplatePayloadFactory,
    EmailTemplateVersionModelFactory,
    RenderPreviewLogModelFactory,
)


# ═════════════════════════════════════════════════════════════════════
# 1) CRUD básico TemplateViewSet
# ═════════════════════════════════════════════════════════════════════
class TestTemplateCRUD:
    URL = "/api/email-templates/"

    def test_list_devuelve_solo_activas_si_filtro_is_active(
        self, authenticated_client,
    ):
        t1 = EmailTemplateModelFactory(is_active=True)
        EmailTemplateModelFactory(is_active=False)

        r = authenticated_client.get(f"{self.URL}?is_active=true")
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        ids = [str(x["id"]) for x in items]
        assert str(t1.id) in ids
        for x in items:
            assert x.get("is_active") is True

    def test_list_filtra_por_status(self, authenticated_client):
        EmailTemplateModelFactory(status="DRAFT")
        EmailTemplateModelFactory(status="PUBLISHED")

        r = authenticated_client.get(f"{self.URL}?status=PUBLISHED")
        assert r.status_code == 200
        items = extract_results(r.json())
        for x in items:
            assert x["status"] == "PUBLISHED"

    def test_list_filtra_por_key(self, authenticated_client):
        t = EmailTemplateModelFactory(template_key="cobranza.recordatorio.t1")
        r = authenticated_client.get(f"{self.URL}?key=cobranza.recordatorio.t1")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert any(str(x["id"]) == str(t.id) for x in items)

    def test_list_filtra_por_q_substring_name(self, authenticated_client):
        t = EmailTemplateModelFactory(name="Bienvenida MWT QA")
        r = authenticated_client.get(f"{self.URL}?q=Bienvenida")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert any(str(x["id"]) == str(t.id) for x in items)

    def test_create_genera_uuid_server_side(self, authenticated_client):
        payload = EmailTemplatePayloadFactory()
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        body = r.json()
        assert_uuid_string(body["id"], "id")

    def test_create_default_status_DRAFT(self, authenticated_client):
        payload = EmailTemplatePayloadFactory()
        payload.pop("status", None)  # eliminar para validar default
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        assert r.json()["status"] == "DRAFT"

    def test_create_idempotente_por_token(self, authenticated_client):
        token = new_uuid()
        payload = EmailTemplatePayloadFactory(idempotence_token=token)

        r1 = authenticated_client.post(self.URL, data=payload, format="json")
        assert r1.status_code == 201, r1.content
        id1 = r1.json()["id"]

        # Replay: mismo token → 200 con flag idempotent
        payload2 = EmailTemplatePayloadFactory(idempotence_token=token)
        r2 = authenticated_client.post(self.URL, data=payload2, format="json")
        assert r2.status_code == 200, r2.content
        assert r2.json().get("idempotent") is True
        assert r2.json()["id"] == id1

    def test_create_acepta_brand_id_inexistente(self, authenticated_client):
        """REGLA DE ORO: brand_id es UUID string sin FK enforcement."""
        payload = EmailTemplatePayloadFactory(brand_id=new_uuid())
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content

    def test_retrieve_incluye_array_versions(self, authenticated_client):
        t = EmailTemplateModelFactory()
        EmailTemplateVersionModelFactory(template_id=t.id, change_note="v1")
        EmailTemplateVersionModelFactory(template_id=t.id, change_note="v2")

        r = authenticated_client.get(f"{self.URL}{t.id}/")
        assert r.status_code == 200, r.content
        body = r.json()
        assert "versions" in body, "retrieve debe incluir clave 'versions'"
        assert isinstance(body["versions"], list)
        assert len(body["versions"]) >= 2

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}{new_uuid()}/")
        assert r.status_code == 404

    def test_update_sin_cambios_no_genera_version(self, authenticated_client):
        from apps.email_templates.models import Version
        t = EmailTemplateModelFactory(
            subject_template="Subject inmutable",
            body_template="Body inmutable",
        )
        n_before = Version.objects.filter(template_id=t.id).count()

        # Update solo el name (no toca subject/body)
        r = authenticated_client.patch(
            f"{self.URL}{t.id}/",
            data={"name": "Renombrada"},
            format="json",
        )
        assert r.status_code == 200, r.content
        n_after = Version.objects.filter(template_id=t.id).count()
        assert n_after == n_before, (
            f"Update sin cambios en subject/body no debió crear Version "
            f"(antes={n_before}, después={n_after})"
        )

    def test_update_con_cambios_genera_version(self, authenticated_client):
        from apps.email_templates.models import Version
        t = EmailTemplateModelFactory(
            subject_template="Subject viejo",
            body_template="Body viejo",
        )
        n_before = Version.objects.filter(template_id=t.id).count()

        r = authenticated_client.patch(
            f"{self.URL}{t.id}/",
            data={
                "subject_template": "Subject nuevo",
                "change_note":      "Refactor del subject",
            },
            format="json",
        )
        assert r.status_code == 200, r.content
        n_after = Version.objects.filter(template_id=t.id).count()
        assert n_after == n_before + 1, (
            f"Cambio en subject debió generar 1 Version (antes={n_before}, "
            f"después={n_after})"
        )

    def test_destroy_marca_is_active_false(self, authenticated_client):
        t = EmailTemplateModelFactory()
        r = authenticated_client.delete(f"{self.URL}{t.id}/")
        assert r.status_code == 204

        # Filter is_active=true ya no debe incluirla
        r2 = authenticated_client.get(f"{self.URL}?is_active=true")
        ids = [str(x["id"]) for x in extract_results(r2.json())]
        assert str(t.id) not in ids

    def test_kpis_devuelve_shape_completo(self, authenticated_client):
        EmailTemplateModelFactory()
        r = authenticated_client.get(f"{self.URL}kpis/")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in ("total", "active", "disabled", "languages", "brands", "sent_30d"):
            assert k in body, f"kpis: falta clave '{k}'"


# ═════════════════════════════════════════════════════════════════════
# 2) Lifecycle — publish / archive
# ═════════════════════════════════════════════════════════════════════
class TestTemplateLifecycle:
    URL = "/api/email-templates/{id}/"

    def test_publish_draft_a_published(self, authenticated_client):
        from apps.email_templates.models import Version
        t = EmailTemplateModelFactory(status="DRAFT")
        n_before = Version.objects.filter(template_id=t.id).count()

        r = authenticated_client.post(
            f"{self.URL.format(id=t.id)}publish/", data={}, format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body["template"]["status"] == "PUBLISHED"
        assert body["template"]["is_active"] is True
        # Publish debe crear una Version snapshot
        assert Version.objects.filter(template_id=t.id).count() == n_before + 1

    def test_publish_idempotente(self, authenticated_client):
        t = EmailTemplateModelFactory(status="PUBLISHED")
        r = authenticated_client.post(
            f"{self.URL.format(id=t.id)}publish/", data={}, format="json",
        )
        assert r.status_code == 200, r.content
        assert r.json().get("idempotent") is True

    def test_publish_409_si_archivada(self, authenticated_client):
        t = EmailTemplateModelFactory(status="ARCHIVED")
        r = authenticated_client.post(
            f"{self.URL.format(id=t.id)}publish/", data={}, format="json",
        )
        assert r.status_code == 409, r.content

    def test_publish_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.post(
            f"{self.URL.format(id=new_uuid())}publish/", data={}, format="json",
        )
        assert r.status_code == 404

    def test_archive_setea_status_y_is_active_false(self, authenticated_client):
        t = EmailTemplateModelFactory(status="PUBLISHED", is_active=True)
        r = authenticated_client.post(
            f"{self.URL.format(id=t.id)}archive/",
            data={"change_note": "End of life"},
            format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body["template"]["status"] == "ARCHIVED"
        assert body["template"]["is_active"] is False

    def test_archive_idempotente(self, authenticated_client):
        t = EmailTemplateModelFactory(status="ARCHIVED")
        r = authenticated_client.post(
            f"{self.URL.format(id=t.id)}archive/", data={}, format="json",
        )
        assert r.status_code == 200, r.content
        assert r.json().get("idempotent") is True


# ═════════════════════════════════════════════════════════════════════
# 3) Variables endpoint — regex Jinja2 + format
# ═════════════════════════════════════════════════════════════════════
class TestTemplateVariables:
    URL = "/api/email-templates/{id}/variables/"

    def test_detecta_variables_jinja2(self, authenticated_client):
        t = EmailTemplateModelFactory(
            subject_template="Hola {{ nombre }}",
            body_template="Tu pedido {{ pedido_id }} llega el {{ fecha }}",
            variables_meta=["nombre", "pedido_id"],
        )
        r = authenticated_client.get(self.URL.format(id=t.id))
        assert r.status_code == 200, r.content
        body = r.json()
        assert set(body["declared"]) == {"nombre", "pedido_id"}
        # Detectadas: nombre, pedido_id, fecha
        for v in ("nombre", "pedido_id", "fecha"):
            assert v in body["detected"], f"Variable Jinja2 '{v}' no detectada"
        assert body["count_declared"] == 2
        assert body["count_detected"] >= 3

    def test_detecta_variables_format_map(self, authenticated_client):
        t = EmailTemplateModelFactory(
            subject_template="Hi {nombre}",
            body_template="Order {pedido_id}",
            variables_meta=[],
        )
        r = authenticated_client.get(self.URL.format(id=t.id))
        assert r.status_code == 200
        body = r.json()
        for v in ("nombre", "pedido_id"):
            assert v in body["detected"]

    def test_404_si_template_no_existe(self, authenticated_client):
        r = authenticated_client.get(self.URL.format(id=new_uuid()))
        assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# 4) Preview — render con persistencia en RenderPreviewLog
# ═════════════════════════════════════════════════════════════════════
class TestTemplatePreview:
    URL = "/api/email-templates/{id}/preview/"

    def test_preview_renderiza_con_jinja2(self, authenticated_client):
        t = EmailTemplateModelFactory(
            subject_template="Hola {{ nombre }}",
            body_template="Tu pedido {{ pedido_id }} está OK",
        )
        r = authenticated_client.post(
            self.URL.format(id=t.id),
            data={"variables": {"nombre": "Ana", "pedido_id": "ABC-001"}},
            format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body["render_ok"] is True
        assert "Ana" in body["subject"]
        assert "ABC-001" in body["body"]
        assert "duration_ms" in body

    def test_preview_persiste_en_render_preview_log(self, authenticated_client):
        from apps.email_templates.models import RenderPreviewLog
        t = EmailTemplateModelFactory(
            subject_template="Test {{ x }}",
            body_template="Hola {{ x }}",
        )
        n_before = RenderPreviewLog.objects.filter(template_id=t.id).count()

        r = authenticated_client.post(
            self.URL.format(id=t.id),
            data={"variables": {"x": "valor"}},
            format="json",
        )
        assert r.status_code == 200
        n_after = RenderPreviewLog.objects.filter(template_id=t.id).count()
        assert n_after == n_before + 1, (
            "preview debió persistir un render_preview_log"
        )

    def test_preview_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.post(
            self.URL.format(id=new_uuid()),
            data={"variables": {}},
            format="json",
        )
        assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# 5) Test-send — encola render aún sin mailer disponible
# ═════════════════════════════════════════════════════════════════════
class TestTemplateTestSend:
    URL = "/api/email-templates/{id}/test-send/"

    def test_400_sin_email(self, authenticated_client):
        t = EmailTemplateModelFactory()
        r = authenticated_client.post(
            self.URL.format(id=t.id), data={}, format="json",
        )
        assert r.status_code == 400, r.content

    def test_400_si_email_invalido(self, authenticated_client):
        t = EmailTemplateModelFactory()
        r = authenticated_client.post(
            self.URL.format(id=t.id),
            data={"to": "no-arroba"}, format="json",
        )
        assert r.status_code == 400, r.content

    def test_test_send_encola_aunque_no_haya_mailer(self, authenticated_client):
        """Si el service de mailing no está, se devuelve sent=False pero
        el endpoint responde 200 (no 500) — es un comportamiento contractual."""
        t = EmailTemplateModelFactory(
            subject_template="Hola {{ nombre }}",
            body_template="Tu pedido {{ pedido_id }}",
        )
        r = authenticated_client.post(
            self.URL.format(id=t.id),
            data={
                "to":        "destinatario@mwt.test",
                "variables": {"nombre": "Ana", "pedido_id": "OC-100"},
            },
            format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body.get("ok") is True
        assert body["to"] == "destinatario@mwt.test"
        assert "Ana" in body["subject"]
        assert "OC-100" in body["body"]
        # `sent` puede ser True o False según si hay mailer wired
        assert "sent" in body

    def test_test_send_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.post(
            self.URL.format(id=new_uuid()),
            data={"to": "x@y.com"}, format="json",
        )
        assert r.status_code == 404


# ═════════════════════════════════════════════════════════════════════
# 6) VersionViewSet — read-only + create
# ═════════════════════════════════════════════════════════════════════
class TestVersionViewSet:
    URL = "/api/email-template-versions/"

    def test_list_filtra_por_template(self, authenticated_client):
        t1 = EmailTemplateModelFactory()
        t2 = EmailTemplateModelFactory()
        EmailTemplateVersionModelFactory(template_id=t1.id)
        EmailTemplateVersionModelFactory(template_id=t1.id)
        EmailTemplateVersionModelFactory(template_id=t2.id)

        r = authenticated_client.get(f"{self.URL}?template={t1.id}")
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        for v in items:
            assert str(v["template_id"]) == str(t1.id)
        assert len(items) >= 2

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}{new_uuid()}/")
        assert r.status_code == 404

    def test_retrieve_devuelve_version(self, authenticated_client):
        v = EmailTemplateVersionModelFactory()
        r = authenticated_client.get(f"{self.URL}{v.id}/")
        assert r.status_code == 200, r.content
        assert_uuid_string(r.json()["id"], "id")

    def test_create_acepta_template_id_inexistente(self, authenticated_client):
        """REGLA DE ORO: template_id es UUID string sin FK enforcement."""
        payload = {
            "template_id":      new_uuid(),
            "subject_template": "Subject post",
            "body_template":    "Body post",
            "change_note":      "Manual snapshot",
        }
        r = authenticated_client.post(self.URL, data=payload, format="json")
        assert r.status_code == 201, r.content
        assert_uuid_string(r.json()["id"], "id")


# ═════════════════════════════════════════════════════════════════════
# 7) RenderPreviewLogViewSet — read-only + kpis
# ═════════════════════════════════════════════════════════════════════
class TestRenderPreviewLogViewSet:
    URL = "/api/email-preview-log/"

    def test_list_devuelve_logs_activos(self, authenticated_client):
        RenderPreviewLogModelFactory()
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        extract_results(r.json())

    def test_list_filtra_por_template(self, authenticated_client):
        t = EmailTemplateModelFactory()
        RenderPreviewLogModelFactory(template_id=t.id)
        RenderPreviewLogModelFactory()  # otra template

        r = authenticated_client.get(f"{self.URL}?template={t.id}")
        assert r.status_code == 200
        items = extract_results(r.json())
        for log in items:
            assert str(log["template_id"]) == str(t.id)

    def test_list_filtra_por_render_ok(self, authenticated_client):
        RenderPreviewLogModelFactory(render_ok=True)
        RenderPreviewLogModelFactory(render_ok=False)

        r = authenticated_client.get(f"{self.URL}?render_ok=false")
        assert r.status_code == 200
        items = extract_results(r.json())
        for log in items:
            assert log["render_ok"] is False

    def test_list_respeta_query_param_limit(self, authenticated_client):
        for _ in range(3):
            RenderPreviewLogModelFactory()
        r = authenticated_client.get(f"{self.URL}?limit=1")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) <= 1

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(f"{self.URL}{new_uuid()}/")
        assert r.status_code == 404

    def test_kpis_devuelve_shape_completo(self, authenticated_client):
        RenderPreviewLogModelFactory(render_ok=True)
        RenderPreviewLogModelFactory(render_ok=False)

        r = authenticated_client.get(f"{self.URL}kpis/")
        assert r.status_code == 200, r.content
        body = r.json()
        for k in ("total", "failed_7d", "success_rate_7d"):
            assert k in body, f"render-preview-log kpis: falta '{k}'"
        # success_rate_7d: 0..100
        assert 0.0 <= float(body["success_rate_7d"]) <= 100.0
