"""
=====================================================================
MWT.ONE · tests/db/test_database.py — Tests estructurales de la base
Agente responsable: [AG-DATABASE] + [AG-06-QA]

Valida la ESTRUCTURA (no los datos) de la base de negocio:
  · schemas y tablas clave de cada módulo del sidebar
  · columnas GENERATED de cobros (bug Fable5-QA corregido 2026-06-11)
  · índices de auditoría E5/E6 (N+1 fix necesita estos soportes)
  · vista de liquidación, tabla de observabilidad, _applied_sql
  · usuario admin sembrado y activo

Es pytest puro + psycopg (sin Django): corre igual en sandbox, local
y VPS. Solo LEE — no escribe nada (no necesita db_guard).

Uso:  python3 -m pytest tests/db/ -q
Env:  DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (mismas que Django)
=====================================================================
"""
import os
import pytest

try:
    import psycopg
except ImportError:
    import psycopg2 as psycopg


@pytest.fixture(scope="module")
def cur():
    conn = psycopg.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=os.environ.get("DB_PORT", "5432"),
        dbname=os.environ.get("DB_NAME", "mwt_one"),
        user=os.environ.get("DB_USER", "mwt"),
        password=os.environ.get("DB_PASSWORD", "mwt"),
    )
    c = conn.cursor()
    yield c
    conn.close()


SCHEMAS_NUCLEO = [
    "core", "users", "clientes", "productos", "proveedores", "brands",
    "nodos", "inventario", "expedientes", "pipeline", "cobros", "finance",
    "transfers", "commercial", "tickets", "notifications", "analytics",
    "email_templates", "portal", "pricing", "ai",
]

TABLAS_CLAVE = [
    ("core", "users"), ("core", "roles"), ("users", "mwtuser"),
    ("clientes", "cliente"), ("productos", "producto"),
    ("proveedores", "proveedor"), ("brands", "marca"), ("nodos", "nodo"),
    ("inventario", "stock"), ("inventario", "movimiento"),
    ("expedientes", "expediente"), ("expedientes", "linea"),
    ("expedientes", "documento"), ("expedientes", "oc"),
    ("pipeline", "event_log"),
    ("cobros", "cobro"), ("cobros", "pago"), ("cobros", "vencimiento"),
    ("finance", "payment"), ("transfers", "transferencia"),
    ("transfers", "cost_line"), ("tickets", "ticket"),
    ("notifications", "notification_log"),
    ("analytics", "client_error_log"),
    ("public", "_applied_sql"),
]

# Índices creados por E5_audit_indexes.sql + E6_observability_and_gin.sql.
# Sin FKs físicas, ESTOS índices son lo único que evita full-scans en los
# joins lógicos por UUID — si alguien los borra, el fix N+1 pierde soporte.
INDICES_AUDITORIA = [
    "idx_linea_oc_id", "idx_linea_expediente_id", "idx_linea_producto_id",
    "idx_linea_exp_sap", "idx_documento_oc_id", "idx_documento_exp_kind",
    "idx_event_log_agg_created", "idx_expediente_client_id",
    "idx_expediente_operating_company_id", "idx_expediente_oc_id",
    "idx_payment_expediente_id", "idx_ena_expediente_id",
    "idx_ena_transferencia_id", "idx_cost_line_transferencia_id",
    "idx_cost_line_scope_gin", "idx_notification_log_created",
    "idx_client_error_created",
]


def test_schemas_nucleo_existen(cur):
    cur.execute("SELECT nspname FROM pg_namespace")
    have = {r[0] for r in cur.fetchall()}
    faltan = [s for s in SCHEMAS_NUCLEO if s not in have]
    assert not faltan, f"Schemas ausentes: {faltan}"


def test_tablas_clave_existen(cur):
    cur.execute(
        "SELECT table_schema || '.' || table_name FROM information_schema.tables"
    )
    have = {r[0] for r in cur.fetchall()}
    faltan = [f"{s}.{t}" for s, t in TABLAS_CLAVE if f"{s}.{t}" not in have]
    assert not faltan, f"Tablas ausentes: {faltan}"


def test_columnas_generated_cobros(cur):
    """Las 3 columnas calculadas de cobros deben ser GENERATED ALWAYS.

    Contexto: bug Fable5-QA — los modelos Django las escribían y todo
    POST/PATCH de cobros/pagos/vencimientos devolvía 500. El modelo usa
    ahora GeneratedField; este test fija el contrato del lado DB.
    """
    cur.execute("""
        SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema='cobros' AND is_generated='ALWAYS'
    """)
    have = {(r[0], r[1]) for r in cur.fetchall()}
    esperadas = {("cobro", "monto_pendiente"), ("pago", "monto_neto_usd"),
                 ("vencimiento", "monto_pendiente_usd")}
    assert esperadas <= have, f"GENERATED ausentes: {esperadas - have}"


def test_indices_auditoria_e5_e6(cur):
    cur.execute("SELECT indexname FROM pg_indexes")
    have = {r[0] for r in cur.fetchall()}
    faltan = [i for i in INDICES_AUDITORIA if i not in have]
    assert not faltan, f"Índices E5/E6 ausentes (¿se aplicó el SQL?): {faltan}"


def test_fusion_columnas_e3(cur):
    """E3: la fusión visual vive en columnas de expediente, no en tabla."""
    cur.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_schema='expedientes' AND table_name='expediente'
           AND column_name IN ('fusion_id', 'fusion_label')
    """)
    assert len(cur.fetchall()) == 2, "Faltan fusion_id/fusion_label (E3)"


def test_vista_liquidacion_transferencias(cur):
    cur.execute(
        "SELECT 1 FROM pg_views WHERE schemaname='transfers' "
        "AND viewname='v_transfer_liquidation'"
    )
    assert cur.fetchone(), "Falta transfers.v_transfer_liquidation (91m)"


def test_observabilidad_client_error_log(cur):
    cur.execute("""
        SELECT column_name FROM information_schema.columns
         WHERE table_schema='analytics' AND table_name='client_error_log'
    """)
    have = {r[0] for r in cur.fetchall()}
    assert {"id", "user_id", "path", "message", "stack",
            "user_agent", "created_at"} <= have


def test_applied_sql_poblada(cur):
    cur.execute("SELECT count(*) FROM public._applied_sql")
    n = cur.fetchone()[0]
    assert n >= 50, f"_applied_sql casi vacía ({n}) — ¿bootstrap incompleto?"


def test_funciones_updated_at(cur):
    cur.execute("""
        SELECT n.nspname || '.' || p.proname
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE p.proname IN ('tg_set_updated_at', 'tg_touch_updated_at',
                             'touch_updated_at')
    """)
    have = {r[0] for r in cur.fetchall()}
    assert "core.tg_touch_updated_at" in have
    # Cada schema con triggers de updated_at debe conservar su función:
    for fn in ("nodos.tg_set_updated_at", "brands.tg_set_updated_at",
               "clientes.tg_set_updated_at"):
        assert fn in have, f"Función de trigger ausente: {fn}"


def test_usuario_admin_activo(cur):
    cur.execute("""
        SELECT count(*) FROM core.users
         WHERE is_active = TRUE AND deleted_at IS NULL
           AND role IN ('admin', 'superadmin')
    """)
    assert cur.fetchone()[0] >= 1, "No hay ningún admin activo en core.users"
