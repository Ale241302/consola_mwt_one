#!/usr/bin/env bash
# =====================================================================
# Consola MWT.ONE · backend/docker-entrypoint.sh
# 1) Espera a que Postgres responda (hasta 60s)
# 2) Si encuentra /sql/*.sql, los aplica una sola vez (marca .applied)
# 3) Lanza el proceso pasado por CMD (gunicorn por default)
# =====================================================================
set -euo pipefail

DB_HOST="${DB_HOST:-postgres}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-mwt_one}"
DB_USER="${DB_USER:-mwt}"
DB_PASSWORD="${DB_PASSWORD:-mwt}"
SQL_DIR="${SQL_DIR:-/sql}"

export PGPASSWORD="$DB_PASSWORD"

echo "[entrypoint] esperando a Postgres en ${DB_HOST}:${DB_PORT}…"
for i in $(seq 1 60); do
    if pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
        echo "[entrypoint] Postgres listo."
        break
    fi
    sleep 1
    if [ "$i" = "60" ]; then
        echo "[entrypoint] ERROR: Postgres no respondió en 60s." >&2
        exit 1
    fi
done

# Aplicar SQL crudos si están montados (init.sql + 02_auth_admin.sql).
# Se marcan como aplicados creando una tabla _applied_sql para idempotencia.
if [ -d "$SQL_DIR" ]; then
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS public._applied_sql (
    filename  TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

    for f in $(ls "$SQL_DIR"/*.sql 2>/dev/null | sort); do
        base="$(basename "$f")"
        already=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM public._applied_sql WHERE filename='${base}'")
        if [ "$already" = "1" ]; then
            echo "[entrypoint] $base ya aplicado, skip."
            continue
        fi
        echo "[entrypoint] aplicando $base…"
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
             -v ON_ERROR_STOP=1 -f "$f"
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
             -c "INSERT INTO public._applied_sql(filename) VALUES ('${base}') ON CONFLICT DO NOTHING;"
    done
fi

echo "[entrypoint] arrancando: $*"
exec "$@"
