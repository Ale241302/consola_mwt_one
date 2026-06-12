#!/usr/bin/env bash
# =====================================================================
# MWT.ONE · tests/run_all.sh — Runner unificado de la suite QA
#
# Orquesta las 4 capas en orden y GARANTIZA la limpieza de datos:
#   1. db_guard snapshot      (foto de TODOS los PKs de la base)
#   2. tests de base de datos (estructura: solo lectura)
#   3. suite backend pytest   (DB real + rollback transaccional)
#   4. suite frontend         (node --test, sin DB)
#   5. E2E flujos completos   (servidor real, commits reales)
#   6. db_guard purge+verify  (borra residuos y exige base idéntica)
#
# Exit 0 SOLO si todo pasa Y la base quedó exactamente igual.
#
# Uso:
#   bash tests/run_all.sh            # todo
#   bash tests/run_all.sh --sin-e2e  # omite E2E (no levanta servidor)
# Env: DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (mismas que Django)
# =====================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FALLOS=0
paso() { echo; echo "════════ $* ════════"; }

paso "1/6 · db_guard snapshot"
python3 tests/db_guard.py snapshot || exit 2

paso "2/6 · Tests estructurales de base de datos"
python3 -m pytest tests/db/ -q --no-header -p no:cacheprovider || FALLOS=$((FALLOS+1))

paso "3/6 · Suite backend (pytest, rollback transaccional)"
( cd backend && python3 -m pytest tests/ -q --no-header -p no:cacheprovider ) || FALLOS=$((FALLOS+1))

paso "4/6 · Suite frontend (node --test)"
( cd frontend && bash tests/run.sh ) || FALLOS=$((FALLOS+1))

if [[ "${1:-}" != "--sin-e2e" ]]; then
  paso "5/6 · E2E flujos completos (servidor real)"
  bash tests/e2e/run_e2e.sh || FALLOS=$((FALLOS+1))
else
  paso "5/6 · E2E omitido (--sin-e2e)"
fi

paso "6/6 · db_guard purge + verify (limpieza garantizada)"
python3 tests/db_guard.py purge || FALLOS=$((FALLOS+1))

echo
if [[ $FALLOS -eq 0 ]]; then
  echo "🟢 SUITE COMPLETA EN VERDE — base de datos intacta."
else
  echo "🔴 $FALLOS capa(s) con fallos — revisar arriba. (La base igual quedó purgada.)"
fi
exit $FALLOS
