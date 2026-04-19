#!/usr/bin/env bash
# =====================================================================
# Consola MWT.ONE · redeploy_vps.sh
# Re-deploy manual en el VPS (útil si quieres forzar build sin empujar).
#   ssh -p 2222 root@187.77.218.102 'bash /opt/consola-mwt-one/scripts/redeploy_vps.sh'
# =====================================================================
set -euo pipefail

APP_DIR="/opt/consola-mwt-one"
cd "$APP_DIR"

echo "==> git fetch + reset"
git fetch --all --prune
git reset --hard origin/main

echo "==> docker compose up -d --build"
docker compose pull --ignore-pull-failures || true
docker compose up -d --build --remove-orphans

docker image prune -f >/dev/null
docker compose ps
