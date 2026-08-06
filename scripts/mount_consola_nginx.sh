#!/usr/bin/env bash
# =====================================================================
# Consola MWT.ONE · mount_consola_nginx.sh
# Agente responsable: [AG-DEVOPS]
#
# Monta `infra/nginx/consola.conf` DENTRO del contenedor existente
# `mwt-nginx` (pertenece al stack vecino `mwt_builder`, es el que tiene
# los puertos 80/443 del VPS) y conecta ese contenedor a la red
# `consola-mwt-one-net` para que pueda resolver los upstreams
# `consola-mwt-one-django` / `consola-mwt-one-frontend`.
#
# Es IDEMPOTENTE: se puede correr N veces; solo recarga nginx si el
# archivo cambió o si la conexión de red no estaba ya presente.
#
# Uso (en el VPS):
#   ssh -p 2222 root@187.77.218.102 \
#     'bash /opt/consola-mwt-one/scripts/mount_consola_nginx.sh'
# =====================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/consola-mwt-one}"
NGINX_CTR="${NGINX_CTR:-mwt-nginx}"
CONSOLA_NET="${CONSOLA_NET:-consola-mwt-one-net}"
MCP_GATEWAY_NET="${MCP_GATEWAY_NET:-mcp-gateway-net}"
SRC_CONF="$APP_DIR/infra/nginx/consola.conf"
DST_PATH="/etc/nginx/conf.d/consola.conf"

# ── Preflight ─────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
    echo "[ERR] docker no encontrado en PATH" >&2
    exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$NGINX_CTR"; then
    echo "[ERR] contenedor '$NGINX_CTR' no está corriendo. Arranca el stack vecino primero." >&2
    exit 1
fi
if [[ ! -f "$SRC_CONF" ]]; then
    echo "[ERR] no existe $SRC_CONF" >&2
    exit 1
fi

# ── Conectar a redes Docker necesarias ──────────────────────────────
connect_network() {
    local net="$1"
    if docker network inspect "$net" >/dev/null 2>&1; then
        connected="$(docker network inspect "$net" \
                     --format '{{range $_, $c := .Containers}}{{$c.Name}} {{end}}' \
                     | tr ' ' '\n' | grep -x "$NGINX_CTR" || true)"
        if [[ -z "$connected" ]]; then
            echo "==> conectando $NGINX_CTR a $net"
            docker network connect "$net" "$NGINX_CTR" || true
        else
            echo "==> $NGINX_CTR ya está en $net (skip)"
        fi
    else
        echo "[WARN] red '$net' no existe — omitiendo (puede ser el stack mcp-gateway aún no levantado)" >&2
    fi
}

connect_network "$CONSOLA_NET"
connect_network "$MCP_GATEWAY_NET"

# ── Copiar consola.conf al contenedor ─────────────────────────────
needs_reload=0

current_md5="$(docker exec "$NGINX_CTR" sh -c "md5sum $DST_PATH 2>/dev/null | awk '{print \$1}'" || true)"
new_md5="$(md5sum "$SRC_CONF" | awk '{print $1}')"

if [[ "$current_md5" != "$new_md5" ]]; then
    echo "==> copiando consola.conf → $NGINX_CTR:$DST_PATH"
    docker cp "$SRC_CONF" "$NGINX_CTR:$DST_PATH"
    needs_reload=1
else
    echo "==> consola.conf ya está sincronizado (md5 $new_md5) — skip"
fi

# ── Validar + reload si hizo falta ────────────────────────────────
echo "==> nginx -t (validación)"
docker exec "$NGINX_CTR" nginx -t

if [[ "$needs_reload" -eq 1 ]]; then
    echo "==> nginx -s reload"
    docker exec "$NGINX_CTR" nginx -s reload
else
    # Sprint 2026-07-22 · reload SIEMPRE, aunque consola.conf no cambie:
    # nginx resuelve los upstreams (consola-mwt-one-frontend/django) al
    # arrancar y cachea su IP; al recrearse los contenedores la IP cambia
    # y sin reload el upstream queda "connection refused" → 503 público.
    # El reload es graceful (sin downtime) y fuerza re-resolución DNS.
    echo "==> consola.conf sin cambios, pero reload igual (re-resolver IPs de upstream)"
    docker exec "$NGINX_CTR" nginx -s reload
fi

echo "==> done"
echo "    host público: https://consola.mwt.one"
echo "    upstreams   : consola-mwt-one-django:8000 · consola-mwt-one-frontend:80"
