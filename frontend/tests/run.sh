#!/usr/bin/env bash
# =====================================================================
# tests/run.sh — compila los bundles de src/lib (esbuild, mismas
# versiones que usa el proyecto) y corre la suite con el runner nativo
# de Node (node --test). Devuelve el exit code real del runner.
# Uso:  cd frontend && bash tests/run.sh
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ESBUILD="npx -y esbuild@0.21.5"
DEFINES_BASE='--define:import.meta.env.VITE_API_BASE="/api"'
OUT=tests/.build
mkdir -p "$OUT"

# api.js usa import.meta.env (Vite) → se testea el bundle, no el fuente.
$ESBUILD src/lib/api.js           --bundle --format=esm --log-level=error \
  $DEFINES_BASE --define:import.meta.env.VITE_USE_MOCKS='"0"' --outfile="$OUT/api.real.mjs"
$ESBUILD src/lib/api.js           --bundle --format=esm --log-level=error \
  $DEFINES_BASE --define:import.meta.env.VITE_USE_MOCKS='"1"' --outfile="$OUT/api.mock.mjs"
$ESBUILD src/lib/errorReporter.js --bundle --format=esm --log-level=error \
  $DEFINES_BASE --define:import.meta.env.VITE_USE_MOCKS='"0"' --outfile="$OUT/errorReporter.mjs"
$ESBUILD src/lib/cronogramaData.js --bundle --format=esm --log-level=error \
  $DEFINES_BASE --define:import.meta.env.VITE_USE_MOCKS='"0"' --outfile="$OUT/cronogramaData.mjs"
$ESBUILD src/lib/clientDashMetrics.js --bundle --format=esm --log-level=error \
  $DEFINES_BASE --define:import.meta.env.VITE_USE_MOCKS='"0"' --outfile="$OUT/clientDashMetrics.mjs"

exec node --test "tests/*.test.mjs"
