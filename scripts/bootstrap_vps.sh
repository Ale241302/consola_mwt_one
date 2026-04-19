#!/usr/bin/env bash
# =====================================================================
# Consola MWT.ONE · bootstrap_vps.sh
# Agente responsable: [AG-DEVOPS]
#
# Se ejecuta UNA SOLA VEZ en el VPS (root). Deja:
#   · docker + compose instalado
#   · /opt/consola-mwt-one clonado desde GitHub
#   · .env con SECRET_KEY aleatorio
#   · docker compose up -d --build funcionando
#   · firewall ufw permitiendo 22/80/443/3100/8100
#
# Uso remoto (desde tu PC):
#   ssh -p 2222 root@187.77.218.102 \
#     'curl -fsSL https://raw.githubusercontent.com/Ale241302/consola_mwt_one/main/scripts/bootstrap_vps.sh | bash'
# =====================================================================
set -euo pipefail

APP_DIR="/opt/consola-mwt-one"
REPO_URL="https://github.com/Ale241302/consola_mwt_one.git"
BRANCH="main"

echo "======================================================================"
echo " Consola MWT.ONE · bootstrap"
echo " Destino: $APP_DIR"
echo " Repo:    $REPO_URL ($BRANCH)"
echo "======================================================================"

# --------------------------------------------------------------------
# 1) Paquetes base
# --------------------------------------------------------------------
if command -v apt-get >/dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y ca-certificates curl git ufw openssl
fi

# --------------------------------------------------------------------
# 2) Docker Engine + compose plugin
# --------------------------------------------------------------------
if ! command -v docker >/dev/null; then
    echo "==> Instalando Docker..."
    curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version >/dev/null

# --------------------------------------------------------------------
# 3) Clonar o actualizar el repo
# --------------------------------------------------------------------
if [ ! -d "$APP_DIR/.git" ]; then
    echo "==> Clonando $REPO_URL en $APP_DIR..."
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
    echo "==> $APP_DIR ya existe, actualizando..."
    cd "$APP_DIR"
    git fetch --all --prune
    git reset --hard "origin/$BRANCH"
fi

cd "$APP_DIR"

# --------------------------------------------------------------------
# 4) .env con SECRET_KEY aleatorio si no existe
# --------------------------------------------------------------------
if [ ! -f .env ]; then
    cp .env.example .env
    SECRET=$(openssl rand -hex 48)
    sed -i "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=${SECRET}|" .env
    echo "==> .env creado con SECRET_KEY aleatorio."
else
    echo "==> .env ya existe, lo respeto."
fi

# --------------------------------------------------------------------
# 5) Firewall básico (idempotente)
# --------------------------------------------------------------------
if command -v ufw >/dev/null; then
    ufw --force enable >/dev/null
    ufw allow 22/tcp   >/dev/null || true
    ufw allow 2222/tcp >/dev/null || true   # puerto SSH no-standard
    ufw allow 80/tcp   >/dev/null || true
    ufw allow 443/tcp  >/dev/null || true
    ufw allow 3100/tcp >/dev/null || true   # frontend
    ufw allow 8100/tcp >/dev/null || true   # backend
fi

# --------------------------------------------------------------------
# 6) docker compose up
# --------------------------------------------------------------------
echo "==> docker compose up -d --build"
docker compose up -d --build --remove-orphans

# --------------------------------------------------------------------
# 7) Espera a que Postgres esté healthy
# --------------------------------------------------------------------
echo "==> esperando a que postgres esté healthy..."
for i in $(seq 1 24); do
    status=$(docker inspect --format='{{.State.Health.Status}}' consola-mwt-one-postgres 2>/dev/null || echo "missing")
    if [ "$status" = "healthy" ]; then
        echo "   postgres healthy (intento $i)"
        break
    fi
    echo "   postgres: $status (intento $i/24)"
    sleep 5
done

docker compose ps

echo ""
echo "======================================================================"
echo "[OK] Consola MWT.ONE desplegada"
echo ""
echo "  Frontend:  http://$(curl -s ifconfig.me):3100"
echo "  API:       http://$(curl -s ifconfig.me):8100/api/"
echo ""
echo "  Credenciales de admin sembradas por database/02_auth_admin.sql:"
echo "    Email:    alejandro@muitowork.com"
echo "    Password: MuitoWork2026?"
echo ""
echo "  Logs en vivo:"
echo "    docker compose -f $APP_DIR/docker-compose.yml logs -f django"
echo "======================================================================"
