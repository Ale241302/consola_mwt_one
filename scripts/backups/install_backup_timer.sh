#!/usr/bin/env bash
# =====================================================================
# scripts/backups/install_backup_timer.sh
# Consola MWT.ONE · instala los systemd units de backup en el VPS.
#
# Idempotente: corre cuantas veces quieras. Detecta si los units ya
# existen y los recarga limpio.
#
# Qué hace:
#   1. Da permisos de ejecución a los .sh.
#   2. Copia los .service y .timer a /etc/systemd/system/.
#   3. systemctl daemon-reload.
#   4. Habilita y arranca los timers.
#   5. Muestra el estado y el next-run.
#
# Uso (desde el VPS, como root):
#   cd /opt/consola-mwt-one && git pull
#   sudo bash scripts/backups/install_backup_timer.sh
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="/etc/systemd/system"
BACKUP_ROOT_DEFAULT="/opt/backups/consola-mwt-one"

if [[ "${EUID}" -ne 0 ]]; then
    echo "ERROR: este script debe correrse como root (sudo)."
    exit 2
fi

echo "==> Verificando prerequisitos"
command -v docker     >/dev/null || { echo "ERROR: docker no instalado."; exit 3; }
command -v systemctl  >/dev/null || { echo "ERROR: systemctl no encontrado (¿no es systemd?)"; exit 3; }

echo "==> Creando ${BACKUP_ROOT_DEFAULT}/{daily,weekly,monthly,logs}"
mkdir -p "${BACKUP_ROOT_DEFAULT}"/{daily,weekly,monthly,logs}
chmod 700 "${BACKUP_ROOT_DEFAULT}"

echo "==> chmod +x sobre scripts"
chmod +x "${SCRIPT_DIR}"/*.sh

echo "==> Copiando units a ${SYSTEMD_DIR}/"
for unit in consola-backup.service consola-backup.timer \
            consola-backup-check.service consola-backup-check.timer; do
    src="${SCRIPT_DIR}/systemd/${unit}"
    dst="${SYSTEMD_DIR}/${unit}"
    if [[ ! -f "${src}" ]]; then
        echo "ERROR: no existe ${src}"
        exit 4
    fi
    cp -f "${src}" "${dst}"
    chmod 644 "${dst}"
    echo "    OK ${dst}"
done

echo "==> systemctl daemon-reload"
systemctl daemon-reload

echo "==> habilitando + arrancando timers"
systemctl enable --now consola-backup.timer
systemctl enable --now consola-backup-check.timer

echo
echo "==> Estado:"
systemctl status consola-backup.timer --no-pager --lines=0 || true
echo
systemctl status consola-backup-check.timer --no-pager --lines=0 || true
echo
echo "==> Próximas ejecuciones:"
systemctl list-timers consola-backup.timer consola-backup-check.timer --no-pager

cat <<'EOF'

==========================================================
Instalación completada.

Comandos útiles:

  # Ver cuándo es el próximo run
  systemctl list-timers 'consola-backup*'

  # Lanzar un backup AHORA (sin esperar al timer)
  sudo systemctl start consola-backup.service

  # Ver el log del último run
  journalctl -u consola-backup.service -n 200 --no-pager

  # Ver el log del último check de salud
  journalctl -u consola-backup-check.service -n 200 --no-pager

  # Inventario actual
  ls -lah /opt/backups/consola-mwt-one/daily/

  # Verificación manual
  sudo bash /opt/consola-mwt-one/scripts/backups/check_backups.sh

  # Restore (interactivo)
  sudo bash /opt/consola-mwt-one/scripts/backups/restore_consola.sh

==========================================================
EOF
