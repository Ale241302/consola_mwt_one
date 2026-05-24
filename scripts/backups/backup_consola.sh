#!/usr/bin/env bash
# =====================================================================
# scripts/backups/backup_consola.sh
# Consola MWT.ONE · backup diario completo.
#
# Qué respalda (en este orden):
#   1. PostgreSQL — pg_dump custom format (-Fc) del container
#                   consola-mwt-one-postgres, comprimido.
#   2. Media de Django — tar.gz de /opt/consola-mwt-one/backend/media/
#                        (PDFs subidos, OCR de inventario, adjuntos).
#   3. Volúmenes Docker — tar.gz de redis-data y celerybeat
#                          (estado del cache + schedule del cron).
#   4. Configuración — tar.gz de .env, docker-compose.yml, infra/,
#                       scripts/, database/ (todo lo no-código necesario
#                       para reconstruir el VPS desde cero).
#   5. manifest.json — metadata del run (tamaños, checksums, duraciones).
#
# Política GFS:
#   · 7 daily + 4 weekly + 3 monthly  (configurable en lib_common.sh)
#   · domingo: promueve a weekly
#   · día 1 del mes: promueve a monthly
#
# Uso normal (vía systemd):
#   systemctl start consola-backup.service
#
# Uso manual (debug):
#   sudo /opt/consola-mwt-one/scripts/backups/backup_consola.sh
#
# Exit codes:
#   0  = todo OK
#   2  = no es root
#   3  = docker no responde
#   4  = container postgres caído
#   5  = directorio requerido falta
#   6  = sin espacio en disco
#   10 = pg_dump falló
#   11 = backup de media falló
#   12 = backup de volúmenes falló
#   13 = backup de config falló
#   14 = dump postgres más pequeño que MIN_POSTGRES_DUMP_BYTES (sospechoso)
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=lib_common.sh
source "${SCRIPT_DIR}/lib_common.sh"
# shellcheck source=lib_rotate.sh
source "${SCRIPT_DIR}/lib_rotate.sh"

# ---------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------
require_root
require_docker_running
require_container "${POSTGRES_CONTAINER}"
require_dir "${PROJECT_DIR}"
ensure_backup_dirs
require_disk_space  # 2 GB libres mínimo

log_info "=========================================================="
log_info "Backup consola-mwt-one · run ${TS_FULL}"
log_info "PROJECT_DIR=${PROJECT_DIR}"
log_info "BACKUP_ROOT=${BACKUP_ROOT}"
log_info "DAILY_DIR=${DAILY_DIR}"
log_info "Retención: ${KEEP_DAILY}d + ${KEEP_WEEKLY}w + ${KEEP_MONTHLY}m"
log_info "=========================================================="

# Si ya existe el daily de hoy, lo sobreescribimos (idempotencia: si el
# operador re-corre el script el mismo día, queremos el snapshot más
# reciente, no acumular dos).
if [[ -n "$(ls -A "${DAILY_DIR}" 2>/dev/null)" ]]; then
    log_warn "Daily ${TS_DAY} ya tiene contenido; será sobreescrito."
    rm -rf "${DAILY_DIR:?}"/*
fi

T_START="$(date +%s)"

# Inicializa el manifest (lo completamos al final).
MANIFEST="${DAILY_DIR}/manifest.json"
SUMS="${DAILY_DIR}/SHA256SUMS"
: > "${SUMS}"

# ---------------------------------------------------------------------
# 1. PostgreSQL
# ---------------------------------------------------------------------
log_info "[1/4] pg_dump → postgres.dump"
PG_DUMP_FILE="${DAILY_DIR}/postgres.dump"
T0="$(date +%s)"

# pg_dump -Fc (custom format): comprimido, permite restore selectivo con
# pg_restore --table=foo, soporta --jobs en restore paralelo.
# --no-owner / --no-privileges: facilita restore en DB con otro usuario.
if ! docker exec -e PGPASSWORD="$(grep -E '^DB_PASSWORD=' "${PROJECT_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo mwt)" \
        "${POSTGRES_CONTAINER}" \
        pg_dump \
            -U "${DB_USER}" \
            -d "${DB_NAME}" \
            -Fc \
            --no-owner \
            --no-privileges \
            --compress=9 \
        > "${PG_DUMP_FILE}"; then
    log_error "pg_dump falló."
    exit 10
fi

PG_SIZE="$(file_size "${PG_DUMP_FILE}")"
if [[ "${PG_SIZE}" -lt "${MIN_POSTGRES_DUMP_BYTES}" ]]; then
    log_error "Dump de Postgres sospechosamente pequeño: ${PG_SIZE} bytes (< ${MIN_POSTGRES_DUMP_BYTES})."
    exit 14
fi
write_checksum "${PG_DUMP_FILE}"
PG_DT=$(( $(date +%s) - T0 ))
log_ok "postgres.dump: $(file_size_h "${PG_DUMP_FILE}") en ${PG_DT}s"

# ---------------------------------------------------------------------
# 2. Media de Django
# ---------------------------------------------------------------------
log_info "[2/4] tar media → media.tar.gz"
MEDIA_DIR="${PROJECT_DIR}/backend/media"
MEDIA_FILE="${DAILY_DIR}/media.tar.gz"
T0="$(date +%s)"

if [[ -d "${MEDIA_DIR}" ]] && [[ -n "$(ls -A "${MEDIA_DIR}" 2>/dev/null)" ]]; then
    if ! tar -C "${PROJECT_DIR}/backend" -czf "${MEDIA_FILE}" media 2>>"${LOG_FILE}"; then
        log_error "tar de media falló."
        exit 11
    fi
    write_checksum "${MEDIA_FILE}"
    MEDIA_DT=$(( $(date +%s) - T0 ))
    log_ok "media.tar.gz: $(file_size_h "${MEDIA_FILE}") en ${MEDIA_DT}s"
else
    log_warn "No hay media en ${MEDIA_DIR} (o está vacía). Creo tarball vacío para coherencia."
    tar -czf "${MEDIA_FILE}" -T /dev/null
    write_checksum "${MEDIA_FILE}"
    MEDIA_DT=0
fi

# ---------------------------------------------------------------------
# 3. Volúmenes Docker (redis + celerybeat)
# ---------------------------------------------------------------------
log_info "[3/4] tar volúmenes Docker → volumes/"
VOL_SUBDIR="${DAILY_DIR}/volumes"
mkdir -p "${VOL_SUBDIR}"
T0="$(date +%s)"

VOL_OK=0
VOL_FAIL=0
for vol in ${DOCKER_VOLUMES}; do
    if ! docker volume inspect "${vol}" >/dev/null 2>&1; then
        log_warn "Volumen '${vol}' no existe; skip."
        continue
    fi
    OUT="${VOL_SUBDIR}/${vol}.tar.gz"
    # Truco estándar: monta el volumen en un container alpine efímero y
    # hace tar sobre /data hacia stdout, que capturamos al host.
    if docker run --rm \
            -v "${vol}":/data:ro \
            -v "${VOL_SUBDIR}":/backup \
            alpine:3.20 \
            sh -c "cd /data && tar -czf /backup/${vol}.tar.gz . 2>/dev/null"; then
        write_checksum "${OUT}"
        log_ok "  ${vol}.tar.gz: $(file_size_h "${OUT}")"
        VOL_OK=$((VOL_OK+1))
    else
        log_error "  Falló tar del volumen ${vol}."
        VOL_FAIL=$((VOL_FAIL+1))
    fi
done

if [[ "${VOL_FAIL}" -gt 0 ]]; then
    log_error "${VOL_FAIL} volúmenes fallaron."
    exit 12
fi
VOL_DT=$(( $(date +%s) - T0 ))
log_ok "Volúmenes (${VOL_OK} OK) en ${VOL_DT}s"

# ---------------------------------------------------------------------
# 4. Configuración (.env + compose + infra + scripts + database)
# ---------------------------------------------------------------------
log_info "[4/4] tar config → config.tar.gz"
CONFIG_FILE="${DAILY_DIR}/config.tar.gz"
T0="$(date +%s)"

# Incluimos todo lo que se necesita para reconstruir el stack sin
# clonar el repo. NO incluimos node_modules, dist, pgdata, __pycache__.
CONFIG_INCLUDES=(
    .env
    docker-compose.yml
    infra
    scripts
    database
    DEPLOY.md
    CLAUDE.md
)

# Filtramos los que efectivamente existen para no romper tar.
EXISTING=()
for item in "${CONFIG_INCLUDES[@]}"; do
    if [[ -e "${PROJECT_DIR}/${item}" ]]; then
        EXISTING+=("${item}")
    fi
done

if [[ "${#EXISTING[@]}" -eq 0 ]]; then
    log_error "No hay nada que respaldar en config (¿PROJECT_DIR vacío?)."
    exit 13
fi

if ! tar -C "${PROJECT_DIR}" \
        --exclude='*/__pycache__' \
        --exclude='*/node_modules' \
        --exclude='*/dist' \
        --exclude='*/.pytest_cache' \
        -czf "${CONFIG_FILE}" \
        "${EXISTING[@]}" 2>>"${LOG_FILE}"; then
    log_error "tar de config falló."
    exit 13
fi
write_checksum "${CONFIG_FILE}"
CONFIG_DT=$(( $(date +%s) - T0 ))
log_ok "config.tar.gz: $(file_size_h "${CONFIG_FILE}") en ${CONFIG_DT}s"

# ---------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------
TOTAL_DT=$(( $(date +%s) - T_START ))
TOTAL_BYTES="$(du -sb "${DAILY_DIR}" | cut -f1)"

# Construimos el JSON a mano para no depender de jq.
cat > "${MANIFEST}" <<EOF
{
  "run_ts_utc": "${TS_FULL}",
  "snapshot_date": "${TS_DAY}",
  "project_dir": "${PROJECT_DIR}",
  "backup_root": "${BACKUP_ROOT}",
  "postgres": {
    "container": "${POSTGRES_CONTAINER}",
    "db": "${DB_NAME}",
    "user": "${DB_USER}",
    "format": "custom (-Fc)",
    "compression": 9,
    "size_bytes": ${PG_SIZE},
    "duration_seconds": ${PG_DT}
  },
  "media": {
    "source": "${MEDIA_DIR}",
    "size_bytes": $(file_size "${MEDIA_FILE}"),
    "duration_seconds": ${MEDIA_DT}
  },
  "volumes": {
    "names": "$(echo "${DOCKER_VOLUMES}" | tr ' ' ',')",
    "count_ok": ${VOL_OK},
    "count_fail": ${VOL_FAIL},
    "duration_seconds": ${VOL_DT}
  },
  "config": {
    "size_bytes": $(file_size "${CONFIG_FILE}"),
    "includes": "$(IFS=,; echo "${EXISTING[*]}")",
    "duration_seconds": ${CONFIG_DT}
  },
  "totals": {
    "size_bytes": ${TOTAL_BYTES},
    "duration_seconds": ${TOTAL_DT}
  },
  "retention": {
    "daily": ${KEEP_DAILY},
    "weekly": ${KEEP_WEEKLY},
    "monthly": ${KEEP_MONTHLY}
  }
}
EOF
write_checksum "${MANIFEST}"

# Verificación final de integridad antes de promover y purgar.
if ! verify_checksums "${DAILY_DIR}"; then
    log_error "Verificación de checksums FALLÓ. El daily ${TS_DAY} queda como está para inspección manual."
    exit 15
fi
log_ok "Checksums verificados."

# ---------------------------------------------------------------------
# Rotación GFS
# ---------------------------------------------------------------------
log_info "----- Rotación GFS -----"
promote_to_weekly_if_sunday
promote_to_monthly_if_first
purge_old_backups
purge_old_logs

log_ok "=========================================================="
log_ok "Backup completado en ${TOTAL_DT}s · $(du -sh "${DAILY_DIR}" | cut -f1) total"
log_ok "Snapshot: ${DAILY_DIR}"
log_ok "=========================================================="
