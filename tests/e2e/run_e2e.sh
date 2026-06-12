#!/bin/bash
# =====================================================================
# MWT.ONE · tests/e2e/run_e2e.sh — Orquestador de la suite E2E
#
# 1. Arranca el servidor Django real (runserver, bajo `timeout` para que
#    nunca quede colgado en el sandbox).
# 2. Espera readiness (POST /api/auth/login/ {} → 400 = server vivo).
# 3. Ejecuta tests/e2e/test_full_flows.py (F0..F7, commits reales).
# 4. F8 · LIMPIEZA GARANTIZADA: pase lo que pase con los flujos, corre
#    `db_guard.py purge` + `verify` contra el snapshot PRE-EXISTENTE
#    (tests/.db_guard_snapshot.json — jamas se regenera aqui).
# 5. Propaga exit code: flujos primero, guard despues.
#
# Uso:  bash tests/e2e/run_e2e.sh [F1 F2 ...]   (sin args = todos)
# =====================================================================
set -u

export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5432}"
export DB_NAME="${DB_NAME:-mwt_one}"
export DB_USER="${DB_USER:-mwt}"
export DB_PASSWORD="${DB_PASSWORD:-mwt}"

WORK=/tmp/work
SRV_LOG=/tmp/srv.log
SRV_SECONDS="${E2E_SERVER_SECONDS:-34}"   # vida maxima del server (sandbox: llamadas <45s)

# ── 1. Server Django real (background, auto-muere por timeout) ──────
cd "$WORK/backend"
# --nostatic: config.settings no define STATIC_URL y el handler de
# staticfiles aborta runserver (ImproperlyConfigured). El API no sirve
# estaticos, asi que el flag es inocuo para el E2E.
( timeout "$SRV_SECONDS" python3 manage.py runserver 127.0.0.1:8000 --noreload --nostatic \
    > "$SRV_LOG" 2>&1 & )

# ── 2. Readiness: login sin body → 400 (la vista responde) ──────────
ready=0
for _ in $(seq 1 50); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
         http://127.0.0.1:8000/api/auth/login/ \
         -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true)
  if [ "$code" = "400" ] || [ "$code" = "405" ]; then ready=1; break; fi
  sleep 0.4
done
if [ "$ready" -ne 1 ]; then
  echo "❌ El servidor Django nunca respondio. Ultimas lineas de $SRV_LOG:"
  tail -20 "$SRV_LOG" 2>/dev/null
  exit 2
fi

# ── 3. Flujos E2E ────────────────────────────────────────────────────
python3 "$WORK/tests/e2e/test_full_flows.py" "$@"
rc=$?

# ── 4. F8 · Limpieza garantizada (corre SIEMPRE) ─────────────────────
pkill -f "manage.py runserver" 2>/dev/null
sleep 0.5
echo ""
echo "F8 LIMPIEZA — db_guard purge + verify"
cd "$WORK"
python3 tests/db_guard.py purge
purge_rc=$?
python3 tests/db_guard.py verify
verify_rc=$?

if [ "$purge_rc" -eq 0 ] && [ "$verify_rc" -eq 0 ]; then
  echo "F8 LIMPIEZA ✅ (purge + verify exit 0)"
else
  echo "F8 LIMPIEZA ❌ (purge=$purge_rc verify=$verify_rc)"
fi

# ── 5. Exit code: flujos primero, guard despues ──────────────────────
if [ "$rc" -ne 0 ]; then exit "$rc"; fi
if [ "$purge_rc" -ne 0 ]; then exit "$purge_rc"; fi
exit "$verify_rc"
