#!/usr/bin/env bash
# =====================================================================
# scripts/backups/lib_common.sh
# Consola MWT.ONE · utilidades compartidas para los scripts de backup.
#
# Este archivo NO se ejecuta directamente — se `source` desde los otros
# scripts. Centraliza:
#   - variables de entorno y paths
#   - logging consistente
#   - validaciones (docker corriendo, container vivo, espacio en disco)
#   - helpers de tamaño y checksum
#
# Convencion de paths:
#   PROJECT_DIR   = /opt/consola-mwt-one     (repo en el VPS)
#   BACKUP_ROOT   = /opt/backups/consola-mwt-one
#   BACKUP_ROOT/daily/YYYY-MM-DD/
#   BACKUP_ROOT/weekly/YYYY-WNN/
#   BACKUP_ROOT/monthly/YYYY-MM/
#   BACKUP_ROOT/logs/backup-YYYY-MM-DD.log
# =====================================================================

# Variables sobreescribibles por entorno (util para testing local).
: "${PROJECT_DIR:=/opt/consola-mwt-one}"
: "${BACKUP_ROOT:=/opt/backups/consola-mwt-one}"
: "${POSTGRES_CONTAINER:=consola-mwt-one-postgres}"
: "${DB_NAME:=mwt_one}"
: "${DB_USER:=mwt}"

# Politica de retencion (dias/semanas/meses).
: "${KEEP_DAILY:=7}"
: "${KEEP_WEEKLY:=4}"
: "${KEEP_MONTHLY:=3}"

# Volumenes Docker a respaldar (pgdata se omite porque pg_dump ya lo cubre,
# y un tar del filesystem vivo de Postgres puede quedar inconsistente).
: "${DOCKER_VOLUMES:=consola-mwt-one-redis-data consola-mwt-one-celerybeat}"

# Minimos de salud (bytes). Si el dump pesa menos, algo se rompio.
: "${MIN_POSTGRES_DUMP_BYTES:=10240}"

# Timestamps en UTC para evitar ambiguedad horaria en logs.
# shellcheck disable=SC2034
TS_DAY="$(date -u +%Y-%m-%d)"
# shellcheck disable=SC2034
TS_WEEK="$(date -u +%Y-W%V)"
# shellcheck disable=SC2034
TS_MONTH="$(date -u +%Y-%m)"
# shellcheck disable=SC2034
TS_FULL="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

# Paths del run actual.
LOG_DIR="${BACKUP_ROOT}/logs"
LOG_FILE="${LOG_DIR}/backup-${TS_DAY}.log"
# shellcheck disable=SC2034
DAILY_DIR="${BACKUP_ROOT}/daily/${TS_DAY}"
# shellcheck disable=SC2034
WEEKLY_DIR="${BACKUP_ROOT}/weekly/${TS_WEEK}"
# shellcheck disable=SC2034
MONTHLY_DIR="${BACKUP_ROOT}/monthly/${TS_MONTH}"

# ---------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------
log() {
    local level="$1"; shift
    local now
    now="$(date -u +%FT%TZ)"
    local msg="[${now}] [${level}] $*"
    echo "${msg}" >&2
    if [[ -d "${LOG_DIR}" ]]; then
        echo "${msg}" >> "${LOG_FILE}"
    fi
}
log_info()  { log "INFO"  "$@"; }
log_warn()  { log "WARN"  "$@"; }
log_error() { log "ERROR" "$@"; }
log_ok()    { log "OK"    "$@"; }

# ---------------------------------------------------------------------
# Validaciones de pre-flight
# ---------------------------------------------------------------------
require_root() {
    if [[ "${EUID}" -ne 0 ]]; then
        log_error "Este script debe correrse como root."
        exit 2
    fi
}

require_docker_running() {
    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon no esta accesible."
        exit 3
    fi
}

require_container() {
    local name="$1"
    if ! docker ps --format '{{.Names}}' | grep -qx "${name}"; then
        log_error "Container '${name}' no esta corriendo."
        exit 4
    fi
}

require_dir() {
    local dir="$1"
    if [[ ! -d "${dir}" ]]; then
        log_error "Directorio requerido no existe: ${dir}"
        exit 5
    fi
}

# Verifica que haya al menos N bytes libres en BACKUP_ROOT.
# Default: 2 GB.
require_disk_space() {
    local min_bytes="${1:-2147483648}"
    local target="${BACKUP_ROOT}"
    mkdir -p "${target}"
    local free
    free="$(df -B1 --output=avail "${target}" | tail -1 | tr -d ' ')"
    if [[ "${free}" -lt "${min_bytes}" ]]; then
        log_error "Espacio libre insuficiente en ${target}: ${free} bytes (minimo ${min_bytes})."
        exit 6
    fi
}

# ---------------------------------------------------------------------
# Helpers de archivo
# ---------------------------------------------------------------------
file_size() {
    local f="$1"
    if [[ -f "${f}" ]]; then
        stat -c '%s' "${f}"
    else
        echo 0
    fi
}

file_size_h() {
    local f="$1"
    if [[ -f "${f}" ]]; then
        du -h "${f}" | cut -f1
    else
        echo "0"
    fi
}

write_checksum() {
    local f="$1"
    local dir
    dir="$(dirname "${f}")"
    (cd "${dir}" && sha256sum "$(basename "${f}")" >> SHA256SUMS)
}

verify_checksums() {
    local dir="$1"
    if [[ ! -f "${dir}/SHA256SUMS" ]]; then
        log_warn "No hay SHA256SUMS en ${dir}."
        return 1
    fi
    (cd "${dir}" && sha256sum -c SHA256SUMS >/dev/null 2>&1)
}

# ---------------------------------------------------------------------
# Inicializacion de directorios
# ---------------------------------------------------------------------
ensure_backup_dirs() {
    mkdir -p "${BACKUP_ROOT}"/{daily,weekly,monthly,logs}
    mkdir -p "${DAILY_DIR}"
    chmod 700 "${BACKUP_ROOT}"
}
