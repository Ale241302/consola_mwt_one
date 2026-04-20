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

# ── Ensamblar routing de consola.mwt.one en mwt-nginx ─────────────
# Monta infra/nginx/consola.conf en el contenedor mwt-nginx del stack
# vecino y conecta ese nginx a la red consola-mwt-one-net.
# Falla silenciosamente si mwt-nginx no está corriendo (dev / staging).
if docker ps --format '{{.Names}}' | grep -qx mwt-nginx; then
    echo "==> montando consola.conf en mwt-nginx"
    bash "$APP_DIR/scripts/mount_consola_nginx.sh" || {
        echo "[WARN] mount_consola_nginx.sh falló — revisa nginx logs"
    }
else
    echo "==> mwt-nginx no está corriendo; se omite mount_consola_nginx.sh"
fi
