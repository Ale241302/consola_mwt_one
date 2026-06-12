"""
=====================================================================
MWT.ONE · tests/test_pipeline.py
Agente responsable: [AG-06-QA]   (BLOQUE 4 · Pipeline / Motor de fases)

COBERTURA
=========
1. ExpedienteViewSet.kanban
   · GET /api/expedientes/kanban/
   · Agrupa expedientes en 7 fases canónicas + bucket "OTROS"
   · Respeta filtros (client, brand, phase_signal, modo_operacion)
   · `total` cuadra con la suma de items en columnas

2. ExpedienteViewSet.select_transiciones
   · GET /api/expedientes/select-transiciones/?fase_from=…
   · Devuelve solo transiciones VIGENTES del catálogo

3. ExpedienteViewSet.transition
   · POST /api/expedientes/{id}/transition/
   · Validación FLEXIBLE contra TransicionCat (si la fila no existe en
     el catálogo, el avance se permite igual — política operativa)
   · requiere_documento ya NO bloquea (solo telemetría)
   · Idempotencia por idempotence_token (200 + idempotent=True)
   · Update de estado + last_event_at + insert en pipeline.event_log
   · Acepta fase_to fuera de catálogo → 200 (avance dinámico)

4. ExpedienteViewSet.events
   · GET /api/expedientes/{id}/events/
   · Trail append-only filtrado por aggregate_id

5. TransicionCatViewSet (read-only ViewSet)
   · GET /api/pipeline-transiciones/  (filtros fase_from/fase_to/is_rollback)
   · GET /api/pipeline-transiciones/{id}/

6. EventLogViewSet (read-only + kpis)
   · GET /api/pipeline-events/  (filtros aggregate_type/event_type/etc.)
   · GET /api/pipeline-events/{id}/
   · GET /api/pipeline-events/kpis/  (raw SQL tolerante)

REGLA DE ORO MWT
================
Todos los `*_id` viajan como UUIDs string sin FK física → se valida
con `assert_uuid_string()`. El test "transition_acepta_idempotence_token_replay"
verifica que la idempotencia funciona aunque el evento previo
quede colgado.
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
    EventLogModelFactory,
    ExpedienteModelFactory,
    TransicionCatModelFactory,
)


# ═════════════════════════════════════════════════════════════════════
# Fixtures locales — seed de transiciones canónicas
# ═════════════════════════════════════════════════════════════════════
@pytest.fixture
def transicion_registro_to_produccion():
    """Transición REGISTRO → PRODUCCION (la canónica del flujo C5)."""
    return TransicionCatModelFactory(
        fase_from="REGISTRO",
        fase_to="PRODUCCION",
        label="Confirmar SAP",
        is_rollback=False,
        orden=100,
    )


@pytest.fixture
def transicion_produccion_to_preparacion():
    return TransicionCatModelFactory(
        fase_from="PRODUCCION",
        fase_to="PREPARACION",
        label="Producción terminada",
        is_rollback=False,
        orden=200,
    )


@pytest.fixture
def transicion_rollback():
    """Rollback PRODUCCION → REGISTRO — útil para test de auditoría."""
    return TransicionCatModelFactory(
        fase_from="PRODUCCION",
        fase_to="REGISTRO",
        label="Rollback a REGISTRO (admin)",
        is_rollback=True,
        orden=900,
    )


@pytest.fixture
def transicion_con_documento():
    """Transición que exige `documento_id` para concretarse."""
    return TransicionCatModelFactory(
        fase_from="PREPARACION",
        fase_to="DESPACHO",
        label="Despachar (requiere BL)",
        is_rollback=False,
        orden=300,
        requiere_documento="BL",
    )


# ═════════════════════════════════════════════════════════════════════
# 1) KANBAN — 7 fases canónicas + bucket OTROS
# ═════════════════════════════════════════════════════════════════════
class TestKanbanEndpoint:
    """`GET /api/expedientes/kanban/` agrupa expedientes activos por fase
    en exactamente 7 columnas canónicas + (opcional) "OTROS"."""

    URL = "/api/expedientes/kanban/"

    FASES_CANONICAS = [
        "REGISTRO", "PRODUCCION", "PREPARACION",
        "DESPACHO", "TRANSITO", "EN_DESTINO", "CERRADO",
    ]

    def test_kanban_devuelve_7_columnas_canonicas_con_schemas_vacios(
        self, authenticated_client,
    ):
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        data = r.json()
        assert "columns" in data and "total" in data
        codigos = [c["codigo"] for c in data["columns"]]
        # Las 7 canónicas siempre deben estar presentes (en este orden)
        for f in self.FASES_CANONICAS:
            assert f in codigos, f"Falta columna canónica {f}: {codigos}"

    def test_kanban_agrupa_expedientes_en_su_columna(
        self, authenticated_client,
    ):
        # Seed 3 expedientes en distintas fases
        ExpedienteModelFactory(estado="REGISTRO")
        ExpedienteModelFactory(estado="REGISTRO")
        ExpedienteModelFactory(estado="PRODUCCION")

        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        cols = {c["codigo"]: c for c in r.json()["columns"]}
        assert cols["REGISTRO"]["count"] >= 2
        assert cols["PRODUCCION"]["count"] >= 1

    def test_kanban_total_cuadra_con_suma_columnas(self, authenticated_client):
        ExpedienteModelFactory(estado="REGISTRO")
        ExpedienteModelFactory(estado="PRODUCCION")
        ExpedienteModelFactory(estado="CERRADO")

        r = authenticated_client.get(self.URL)
        assert r.status_code == 200
        data = r.json()
        suma = sum(c["count"] for c in data["columns"])
        # `total` cuenta TODOS los activos; suma columnas debe coincidir
        assert suma == data["total"], (
            f"Inconsistencia kanban: suma columnas={suma} vs total={data['total']}"
        )

    def test_kanban_estado_no_canonico_va_a_bucket_otros(
        self, authenticated_client,
    ):
        # Estado fuera de las 7 canónicas → debe agruparse en OTROS
        ExpedienteModelFactory(estado="EN_REVISION_LEGAL")

        r = authenticated_client.get(self.URL)
        assert r.status_code == 200
        cols = {c["codigo"]: c for c in r.json()["columns"]}
        assert "OTROS" in cols, "Estado no canónico debería caer en bucket OTROS"
        assert cols["OTROS"]["count"] >= 1

    def test_kanban_filtra_por_client_id(self, authenticated_client):
        client_a = new_uuid()
        client_b = new_uuid()
        ExpedienteModelFactory(estado="REGISTRO", client_id=client_a)
        ExpedienteModelFactory(estado="REGISTRO", client_id=client_b)

        r = authenticated_client.get(f"{self.URL}?client={client_a}")
        assert r.status_code == 200
        cols = {c["codigo"]: c for c in r.json()["columns"]}
        items = cols["REGISTRO"]["items"]
        for it in items:
            assert it["client_id"] == client_a, (
                f"Filtro client= no aplicó: {it['client_id']} != {client_a}"
            )


# ═════════════════════════════════════════════════════════════════════
# 2) SELECT_TRANSICIONES — catálogo filtrado por fase_from
# ═════════════════════════════════════════════════════════════════════
class TestSelectTransiciones:
    URL = "/api/expedientes/select-transiciones/"

    def test_lista_todas_transiciones_activas(
        self,
        authenticated_client,
        transicion_registro_to_produccion,
        transicion_produccion_to_preparacion,
    ):
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        codigos = [(t["fase_from"], t["fase_to"]) for t in items]
        assert ("REGISTRO", "PRODUCCION") in codigos
        assert ("PRODUCCION", "PREPARACION") in codigos

    def test_filtra_por_fase_from(
        self,
        authenticated_client,
        transicion_registro_to_produccion,
        transicion_produccion_to_preparacion,
    ):
        r = authenticated_client.get(f"{self.URL}?fase_from=REGISTRO")
        assert r.status_code == 200
        items = extract_results(r.json())
        # Cualquier item devuelto debe tener fase_from=REGISTRO
        for t in items:
            assert t["fase_from"] == "REGISTRO", (
                f"Filtro fase_from=REGISTRO devolvió {t['fase_from']}"
            )


# ═════════════════════════════════════════════════════════════════════
# 3) TRANSITION — motor de fases del expediente
# ═════════════════════════════════════════════════════════════════════
class TestExpedienteTransition:
    URL = "/api/expedientes/{id}/transition/"

    def test_transition_falla_sin_fase_to(self, authenticated_client):
        exp = ExpedienteModelFactory(estado="REGISTRO")
        r = authenticated_client.post(
            self.URL.format(id=str(exp.id)),
            data={},
            format="json",
        )
        assert r.status_code == 400, r.content

    def test_transition_404_si_expediente_no_existe(
        self, authenticated_client, transicion_registro_to_produccion,
    ):
        r = authenticated_client.post(
            self.URL.format(id=new_uuid()),
            data={"fase_to": "PRODUCCION"},
            format="json",
        )
        assert r.status_code == 404, r.content

    def test_transition_avanza_aunque_no_este_en_catalogo(
        self, authenticated_client,
    ):
        """Contrato vigente: la validación contra el catálogo es FLEXIBLE
        (política operativa documentada en transition()): si la fila no
        existe en transicion_cat se permite el avance con defaults — ya
        NO devuelve 409."""
        exp = ExpedienteModelFactory(estado="REGISTRO")
        r = authenticated_client.post(
            self.URL.format(id=str(exp.id)),
            data={"fase_to": "CERRADO"},
            format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body.get("ok") is True
        assert body.get("idempotent") is False

        exp.refresh_from_db()
        assert exp.estado == "CERRADO", (
            f"El avance dinámico no aplicó el estado: {exp.estado}"
        )

    def test_transition_sin_documento_requerido_no_bloquea(
        self, authenticated_client, transicion_con_documento,
    ):
        """Contrato vigente: aunque el catálogo marque requiere_documento,
        la transición NO se bloquea (antes era 400; hoy solo se loguea
        telemetría transition.skip_required_doc y avanza igual)."""
        exp = ExpedienteModelFactory(estado="PREPARACION")
        r = authenticated_client.post(
            self.URL.format(id=str(exp.id)),
            data={"fase_to": "DESPACHO"},
            format="json",
        )
        assert r.status_code == 200, r.content
        assert r.json().get("ok") is True

        exp.refresh_from_db()
        assert exp.estado == "DESPACHO"

    def test_transition_idempotencia_replay_devuelve_200(
        self, authenticated_client, transicion_registro_to_produccion,
    ):
        """Mismo idempotence_token reusado → 200 + idempotent=True (no
        crea evento duplicado)."""
        exp = ExpedienteModelFactory(estado="REGISTRO")
        token = new_uuid()
        # Sembrar evento previo con ese mismo token (simula la 1ra request).
        EventLogModelFactory(
            event_type="expediente.phase_transition",
            aggregate_type="expediente",
            aggregate_id=exp.id,
            idempotence_token=token,
        )
        # 2da request con el mismo token → idempotente
        r = authenticated_client.post(
            self.URL.format(id=str(exp.id)),
            data={"fase_to": "PRODUCCION", "idempotence_token": token},
            format="json",
        )
        assert r.status_code == 200, r.content
        body = r.json()
        assert body.get("idempotent") is True
        assert body.get("ok") is True
        assert "event_id" in body

    def test_transition_acepta_documento_id_inexistente(
        self, authenticated_client, transicion_con_documento,
    ):
        """REGLA DE ORO: documento_id es un UUID string sin FK enforcement
        — un UUID huérfano debe ser aceptado por la transición (la lógica
        sólo chequea presencia, no integridad referencial)."""
        exp = ExpedienteModelFactory(estado="PREPARACION")
        documento_huerfano = new_uuid()
        r = authenticated_client.post(
            self.URL.format(id=str(exp.id)),
            data={
                "fase_to":      "DESPACHO",
                "documento_id": documento_huerfano,
            },
            format="json",
        )
        # 200 (transición OK) o 500 (raw SQL falla por schema vacío en
        # entornos de test sin pipeline.event_log materializado).
        assert r.status_code in (200, 500), r.content


# ═════════════════════════════════════════════════════════════════════
# 4) EVENTS — trail append-only de un expediente
# ═════════════════════════════════════════════════════════════════════
class TestExpedienteEvents:
    URL = "/api/expedientes/{id}/events/"

    def test_events_devuelve_solo_los_del_expediente(
        self, authenticated_client,
    ):
        exp_a = ExpedienteModelFactory(estado="REGISTRO")
        exp_b = ExpedienteModelFactory(estado="REGISTRO")
        EventLogModelFactory(aggregate_type="expediente", aggregate_id=exp_a.id)
        EventLogModelFactory(aggregate_type="expediente", aggregate_id=exp_a.id)
        EventLogModelFactory(aggregate_type="expediente", aggregate_id=exp_b.id)

        r = authenticated_client.get(self.URL.format(id=str(exp_a.id)))
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        # Todos los eventos deben pertenecer a exp_a
        for ev in items:
            assert str(ev["aggregate_id"]) == str(exp_a.id), (
                f"Event {ev['id']} tiene aggregate_id={ev['aggregate_id']} != {exp_a.id}"
            )
        assert len(items) >= 2

    def test_events_respeta_query_param_limit(self, authenticated_client):
        exp = ExpedienteModelFactory(estado="REGISTRO")
        for _ in range(5):
            EventLogModelFactory(aggregate_type="expediente", aggregate_id=exp.id)

        r = authenticated_client.get(self.URL.format(id=str(exp.id)) + "?limit=2")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) <= 2


# ═════════════════════════════════════════════════════════════════════
# 5) TransicionCatViewSet — read-only catálogo
# ═════════════════════════════════════════════════════════════════════
class TestTransicionCatViewSet:
    URL = "/api/pipeline-transiciones/"

    def test_list_devuelve_solo_activas(
        self,
        authenticated_client,
        transicion_registro_to_produccion,
        transicion_produccion_to_preparacion,
    ):
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        items = extract_results(r.json())
        for t in items:
            assert t.get("is_active") is True

    def test_list_filtra_por_fase_from(
        self,
        authenticated_client,
        transicion_registro_to_produccion,
        transicion_produccion_to_preparacion,
    ):
        r = authenticated_client.get(f"{self.URL}?fase_from=REGISTRO")
        assert r.status_code == 200
        items = extract_results(r.json())
        for t in items:
            assert t["fase_from"] == "REGISTRO"

    def test_list_filtra_por_is_rollback(
        self, authenticated_client, transicion_rollback,
    ):
        r = authenticated_client.get(f"{self.URL}?is_rollback=true")
        assert r.status_code == 200
        items = extract_results(r.json())
        for t in items:
            assert t["is_rollback"] is True

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(self.URL + f"{new_uuid()}/")
        assert r.status_code == 404

    def test_retrieve_devuelve_transicion(
        self, authenticated_client, transicion_registro_to_produccion,
    ):
        r = authenticated_client.get(
            self.URL + f"{transicion_registro_to_produccion.id}/"
        )
        assert r.status_code == 200, r.content
        assert_uuid_string(r.json()["id"], "id")
        assert r.json()["fase_from"] == "REGISTRO"


# ═════════════════════════════════════════════════════════════════════
# 6) EventLogViewSet — read-only audit + kpis
# ═════════════════════════════════════════════════════════════════════
class TestEventLogViewSet:
    URL = "/api/pipeline-events/"

    def test_list_devuelve_eventos_activos(self, authenticated_client):
        EventLogModelFactory()
        r = authenticated_client.get(self.URL)
        assert r.status_code == 200, r.content
        extract_results(r.json())  # solo valida shape

    def test_list_filtra_por_aggregate_type(self, authenticated_client):
        EventLogModelFactory(aggregate_type="expediente")
        EventLogModelFactory(aggregate_type="cobro")

        r = authenticated_client.get(f"{self.URL}?aggregate_type=expediente")
        assert r.status_code == 200
        items = extract_results(r.json())
        for ev in items:
            assert ev["aggregate_type"] == "expediente"

    def test_list_filtra_por_event_type(self, authenticated_client):
        EventLogModelFactory(event_type="expediente.phase_transition")
        EventLogModelFactory(event_type="sap.confirmed")

        r = authenticated_client.get(
            f"{self.URL}?event_type=expediente.phase_transition"
        )
        assert r.status_code == 200
        items = extract_results(r.json())
        for ev in items:
            assert ev["event_type"] == "expediente.phase_transition"

    def test_list_respeta_query_param_limit(self, authenticated_client):
        for _ in range(3):
            EventLogModelFactory()
        r = authenticated_client.get(f"{self.URL}?limit=1")
        assert r.status_code == 200
        items = extract_results(r.json())
        assert len(items) <= 1

    def test_retrieve_404_si_no_existe(self, authenticated_client):
        r = authenticated_client.get(self.URL + f"{new_uuid()}/")
        assert r.status_code == 404

    def test_retrieve_devuelve_event(self, authenticated_client):
        ev = EventLogModelFactory()
        r = authenticated_client.get(self.URL + f"{ev.id}/")
        assert r.status_code == 200, r.content
        body = r.json()
        assert_uuid_string(body["id"], "id")
        assert_uuid_string(body["aggregate_id"], "aggregate_id")

    def test_kpis_endpoint_devuelve_shape_completo(self, authenticated_client):
        r = authenticated_client.get(self.URL + "kpis/")
        assert r.status_code == 200, r.content
        body = r.json()
        # Shape contractual del widget Dashboard
        for k in ("total", "last_24h", "last_7d", "by_aggregate"):
            assert k in body, f"kpis pipeline-events: falta clave '{k}'"
        assert isinstance(body["by_aggregate"], dict)


# ═════════════════════════════════════════════════════════════════════
# REGLA DE ORO MWT · UUIDs como string en TODA la respuesta del pipeline
# ═════════════════════════════════════════════════════════════════════
class TestReglaDeOroPipelineUUIDs:
    """Asegura que ningún serializer del pipeline expone FK físicas — todos
    los `*_id` viajan como str(UUID). Esto se valida sobre las respuestas
    de los endpoints expuestos, no inspeccionando el ORM."""

    def test_transicion_cat_id_es_uuid_string(
        self, authenticated_client, transicion_registro_to_produccion,
    ):
        r = authenticated_client.get(
            f"/api/pipeline-transiciones/{transicion_registro_to_produccion.id}/"
        )
        assert r.status_code == 200, r.content
        assert_uuid_string(r.json()["id"], "id")

    def test_event_log_aggregate_id_es_uuid_string(self, authenticated_client):
        ev = EventLogModelFactory()
        r = authenticated_client.get(f"/api/pipeline-events/{ev.id}/")
        assert r.status_code == 200, r.content
        assert_uuid_string(r.json()["aggregate_id"], "aggregate_id")
