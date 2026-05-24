#!/usr/bin/env bash
# =====================================================================
# scripts/backups/check_backups.sh
# Consola MWT.ONE · verificación de salud de los backups.
#
# Diseñado para correr como timer separado (1h después del backup) o
# manualmente. Si algo está mal, sale con exit code != 0 → systemd
# marca el unit como fallido → journalctl lo deja registrado.
#
# Qué verifica:
#   · Existe el directorio del daily de hoy (o de ayer si aún no son las 03:00).
#   · postgres.dump existe y supera MIN_POSTGRES_DUMP_BYTES.
#   · media.tar.gz existe (puede estar vacío, pero el archivo debe estar).
#   · config.tar.gz existe.
#   · SHA256SUMS verifica.
#   · manifest.json es JSON válido.
#
# Uso:
#   sudo ./check_backups.sh           # verifica el último daily
#   sudo ./check_backups.sh 2026-05-23  # verifica un día específico
#
# Exit codes:
#   0  = todo OK
#   1  = no hay daily reciente
#   2  = falta algún archivo
#   3  = checksums NO coinciden
#   4  = manifest inválido o dump sospechosamente pequeño
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib_common.sh
source "${SCRIPT_DIR}/lib_common.sh"

# Día a verificar (default: hoy UTC; si aún no hay backup hoy, intenta ayer).
TARGET_DATE="${1:-${TS_DAY}}"
TARGET_DIR="${BACKUP_ROOT}/daily/${TARGET_DATE}"

if [[ ! -d "${TARGET_DIR}" ]]; then
    # Fallback: si todavía no son las 03:00 UTC (cuando corre el backup),
    # acepta el de ayer.
    YESTERDAY="$(date -u -d "yesterday" +%Y-%m-%d 2>/dev/null || date -u -v-1d +%Y-%m-%d)"
    log_warn "No hay daily ${TARGET_DATE}. Probando con ${YESTERDAY}..."
    TARGET_DATE="${YESTERDAY}"
    TARGET_DIR="${BACKUP_ROOT}/daily/${TARGET_DATE}"
fi

if [[ ! -d "${TARGET_DIR}" ]]; then
    log_error "No hay backup reciente. Último intento: ${TARGET_DIR}"
    exit 1
fi

log_info "Verificando snapshot: ${TARGET_DIR}"

FAILURES=0

# 1. Archivos obligatorios presentes
for f in postgres.dump media.tar.gz config.tar.gz SHA256SUMS manifest.json; do
    if [[ ! -f "${TARGET_DIR}/${f}" ]]; then
        log_error "Falta ${f}"
        FAILURES=$((FAILURES+1))
    else
        log_ok "  ${f}: $(file_size_h "${TARGET_DIR}/${f}")"
    fi
done
if [[ "${FAILURES}" -gt 0 ]]; then
    exit 2
fi

# 2. Tamaño mínimo del dump
PG_SIZE="$(file_size "${TARGET_DIR}/postgres.dump")"
if [[ "${PG_SIZE}" -lt "${MIN_POSTGRES_DUMP_BYTES}" ]]; then
    log_error "postgres.dump muy pequeño: ${PG_SIZE} bytes (< ${MIN_POSTGRES_DUMP_BYTES})"
    exit 4
fi

# 3. SHA256
if ! verify_checksums "${TARGET_DIR}"; then
    log_error "SHA256SUMS no verifica."
    exit 3
fi
log_ok "Checksums OK."

# 4. manifest.json válido (parse básico: que arranque con { y cierre con })
if ! head -c 1 "${TARGET_DIR}/manifest.json" | grep -q '{'; then
    log_error "manifest.json no parece JSON válido."
    exit 4
fi

# 5. Edad del snapshot (alarma si > 48h)
SNAP_AGE_SEC=$(( $(date +%s) - $(stat -c %Y "${TARGET_DIR}/postgres.dump") ))
SNAP_AGE_HOURS=$(( SNAP_AGE_SEC / 3600 ))
if [[ "${SNAP_AGE_HOURS}" -gt 48 ]]; then
    log_error "Snapshot tiene ${SNAP_AGE_HOURS}h de antigüedad (>48h). El cron no corrió."
    exit 1
fi

log_ok "Snapshot ${TARGET_DATE} sano (edad: ${SNAP_AGE_HOURS}h, total $(du -sh "${TARGET_DIR}" | cut -f1))."

# Resumen de inventario completo
log_info "Inventario actual:"
for tier in daily weekly monthly; do
    count="$(find "${BACKUP_ROOT}/${tier}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
    size="$(du -sh "${BACKUP_ROOT}/${tier}" 2>/dev/null | cut -f1 || echo "0")"
    log_info "  ${tier}: ${count} snapshots · ${size}"
done
