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

echo "==> conectando contenedores a la red mwt_default"
if docker network inspect mwt_default >/dev/null 2>&1; then
    docker network connect mwt_default consola-mwt-one-django || true
    docker network connect mwt_default consola-mwt-one-celery-worker || true
    echo "[OK] contenedores conectados a la red mwt_default."
else
    echo "[INFO] red mwt_default no encontrada, omitiendo."
fi

docker image prune -f >/dev/null
docker compose ps

# ── Purge de demo data (D0_purge_demo_data.sql) ────────────────────
# El entrypoint del backend aplica /sql-modules/*.sql una sola vez
# (rastreado en public._applied_sql). Cuando un nuevo archivo aparece
# en backend/sql/, se ejecuta automáticamente al reiniciar el
# contenedor django y queda marcado como aplicado.
#
# Sprint 2026-05-10 (CEO): D0_purge_demo_data.sql vacía clientes,
# expedientes, OCs, líneas, documentos, cobros, finance, inventario,
# transfers, notifications, dashboard, portal, tickets, ai y todos
# los catálogos sembrados por 99_seed.sql (brands/productos/proveedores
# /nodos). Conserva schemas, *_cat, core.users, core.roles y
# email_templates.template.
#
# Verificamos en logs de django si el purge se aplicó en este deploy.
echo "==> verificando ejecución de D0_purge_demo_data.sql en logs"
sleep 3
if docker compose logs --since=2m django 2>/dev/null | grep -qE "D0_purge_demo_data\.sql"; then
    echo "[OK] D0_purge_demo_data.sql se ejecutó en este arranque."
    docker compose logs --since=2m django 2>/dev/null \
        | grep -E "D0_purge|filas borradas|Purga completada" \
        | head -40 || true
else
    echo "[INFO] D0_purge_demo_data.sql ya estaba aplicado (idempotente)."
fi

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
