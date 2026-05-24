#!/usr/bin/env bash
# =====================================================================
# scripts/backups/restore_consola.sh
# Consola MWT.ONE · restore guiado desde un snapshot de backup.
#
# Un backup que nunca se restaura no es un backup — es una ilusión.
# Este script existe para que el restore en producción sea aburrido
# y predecible, no una crisis.
#
# Uso:
#   sudo ./restore_consola.sh                       # interactivo, lista snapshots
#   sudo ./restore_consola.sh 2026-05-24            # restore del daily indicado
#   sudo ./restore_consola.sh weekly 2026-W21       # restore de un weekly
#   sudo ./restore_consola.sh monthly 2026-04       # restore de un monthly
#   sudo ./restore_consola.sh /path/to/snapshot     # restore de un path absoluto
#
# Flags:
#   --dry-run         No toca nada, solo enseña qué haría.
#   --only-postgres   Restore SOLO de la DB (no media, no config).
#   --only-media      Restore SOLO de media.
#   --skip-confirm    No pide confirmación (PELIGROSO; para automatización).
#
# Qué hace, en orden:
#   1. Verifica checksums del snapshot.
#   2. Pide confirmación (dos veces si vas a sobreescribir la DB).
#   3. Restaura postgres con pg_restore --clean --if-exists.
#   4. Restaura media (tar -xzf sobre backend/media/).
#   5. (Opcional) Extrae config a /tmp para inspección manual — NUNCA
#      sobreescribe .env automáticamente, ese es un cambio consciente.
#   6. Verifica post-restore (count de tablas clave).
# =====================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib_common.sh
source "${SCRIPT_DIR}/lib_common.sh"

DRY_RUN=0
ONLY_POSTGRES=0
ONLY_MEDIA=0
SKIP_CONFIRM=0
SNAPSHOT_DIR=""

# ---------------------------------------------------------------------
# Parse args
# ---------------------------------------------------------------------
ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)       DRY_RUN=1; shift ;;
        --only-postgres) ONLY_POSTGRES=1; shift ;;
        --only-media)    ONLY_MEDIA=1; shift ;;
        --skip-confirm)  SKIP_CONFIRM=1; shift ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^#//' | head -40
            exit 0
            ;;
        *) ARGS+=("$1"); shift ;;
    esac
done

# ---------------------------------------------------------------------
# Resolver SNAPSHOT_DIR
# ---------------------------------------------------------------------
resolve_snapshot() {
    if [[ "${#ARGS[@]}" -eq 0 ]]; then
        list_snapshots_interactive
        # shellcheck disable=SC2317  # defensivo: list_snapshots_interactive hoy hace exit, pero quizas no manana
        return
    fi

    local first="${ARGS[0]}"
    # Path absoluto
    if [[ "${first}" == /* ]] && [[ -d "${first}" ]]; then
        SNAPSHOT_DIR="${first}"
        return
    fi

    # Tier explícito
    if [[ "${first}" == "daily" || "${first}" == "weekly" || "${first}" == "monthly" ]]; then
        local tier="${first}"
        local id="${ARGS[1]:-}"
        if [[ -z "${id}" ]]; then
            log_error "Falta el ID. Ej: $0 ${tier} 2026-05-24"
            exit 1
        fi
        SNAPSHOT_DIR="${BACKUP_ROOT}/${tier}/${id}"
        return
    fi

    # Por defecto, asumimos daily
    SNAPSHOT_DIR="${BACKUP_ROOT}/daily/${first}"
}

# shellcheck disable=SC2317  # hace exit 0; el `return` en resolve_snapshot es defensivo
list_snapshots_interactive() {
    log_info "Snapshots disponibles en ${BACKUP_ROOT}:"
    for tier in daily weekly monthly; do
        echo
        echo "  [${tier}]"
        if [[ -d "${BACKUP_ROOT}/${tier}" ]]; then
            # shellcheck disable=SC2012
            ls -1 "${BACKUP_ROOT}/${tier}" 2>/dev/null | sort -r | head -10 | sed 's/^/    /'
        else
            echo "    (vacío)"
        fi
    done
    echo
    echo "Uso: $0 <fecha>            (daily)"
    echo "     $0 weekly <ID>"
    echo "     $0 monthly <ID>"
    exit 0
}

# ---------------------------------------------------------------------
# Confirmación
# ---------------------------------------------------------------------
confirm() {
    local prompt="$1"
    if [[ "${SKIP_CONFIRM}" -eq 1 ]]; then
        log_warn "--skip-confirm activo; asumo 'sí' para: ${prompt}"
        return 0
    fi
    read -r -p "${prompt} [escriba YES para continuar]: " ans
    if [[ "${ans}" != "YES" ]]; then
        log_warn "Cancelado por el operador."
        exit 1
    fi
}

# ---------------------------------------------------------------------
# Restore Postgres
# ---------------------------------------------------------------------
restore_postgres() {
    local dump="${SNAPSHOT_DIR}/postgres.dump"
    if [[ ! -f "${dump}" ]]; then
        log_error "No hay postgres.dump en ${SNAPSHOT_DIR}"
        exit 2
    fi

    log_info "----- Restore PostgreSQL -----"
    log_info "Source: ${dump} ($(file_size_h "${dump}"))"
    log_info "Target: container=${POSTGRES_CONTAINER}, db=${DB_NAME}, user=${DB_USER}"
    confirm "Esto va a SOBREESCRIBIR la DB '${DB_NAME}' en ${POSTGRES_CONTAINER}. ¿Continuar?"

    if [[ "${DRY_RUN}" -eq 1 ]]; then
        log_warn "[DRY-RUN] pg_restore --clean --if-exists ${dump}"
        return 0
    fi

    local pwd_val
    pwd_val="$(grep -E '^DB_PASSWORD=' "${PROJECT_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo mwt)"

    # Copia el dump dentro del container y restaura con pg_restore.
    docker cp "${dump}" "${POSTGRES_CONTAINER}":/tmp/restore.dump
    docker exec -e PGPASSWORD="${pwd_val}" "${POSTGRES_CONTAINER}" \
        pg_restore \
            -U "${DB_USER}" \
            -d "${DB_NAME}" \
            --clean \
            --if-exists \
            --no-owner \
            --no-privileges \
            --jobs=2 \
            --verbose \
            /tmp/restore.dump 2>&1 | tail -20 || {
                log_error "pg_restore terminó con errores. Revisa logs completos en docker logs."
                exit 10
            }
    docker exec "${POSTGRES_CONTAINER}" rm -f /tmp/restore.dump
    log_ok "Restore Postgres completado."
}

# ---------------------------------------------------------------------
# Restore Media
# ---------------------------------------------------------------------
restore_media() {
    local tarball="${SNAPSHOT_DIR}/media.tar.gz"
    if [[ ! -f "${tarball}" ]]; then
        log_error "No hay media.tar.gz en ${SNAPSHOT_DIR}"
        exit 2
    fi
    log_info "----- Restore Media -----"
    log_info "Source: ${tarball} ($(file_size_h "${tarball}"))"
    log_info "Target: ${PROJECT_DIR}/backend/media/"
    confirm "Esto va a SOBREESCRIBIR ${PROJECT_DIR}/backend/media/. ¿Continuar?"

    if [[ "${DRY_RUN}" -eq 1 ]]; then
        log_warn "[DRY-RUN] tar -xzf ${tarball} -C ${PROJECT_DIR}/backend/"
        return 0
    fi

    # Backup de seguridad por si el restore va mal.
    if [[ -d "${PROJECT_DIR}/backend/media" ]]; then
        local safety="${PROJECT_DIR}/backend/media.pre-restore.${TS_FULL}"
        log_info "Guardando media actual en ${safety} (por si acaso)"
        mv "${PROJECT_DIR}/backend/media" "${safety}"
    fi
    tar -xzf "${tarball}" -C "${PROJECT_DIR}/backend/"
    log_ok "Restore Media completado."
}

# ---------------------------------------------------------------------
# Extrae config a /tmp (NUNCA sobreescribe automáticamente)
# ---------------------------------------------------------------------
extract_config() {
    local tarball="${SNAPSHOT_DIR}/config.tar.gz"
    if [[ ! -f "${tarball}" ]]; then
        log_warn "No hay config.tar.gz en ${SNAPSHOT_DIR}; skip."
        return 0
    fi
    local out="/tmp/consola-config-restore-${TS_FULL}"
    mkdir -p "${out}"
    tar -xzf "${tarball}" -C "${out}"
    log_info "Config extraído en: ${out}"
    log_info "Revisa manualmente .env y compose antes de aplicar sobre producción."
}

# ---------------------------------------------------------------------
# Verificación post-restore
# ---------------------------------------------------------------------
verify_postgres() {
    log_info "----- Verificación post-restore -----"
    local pwd_val
    pwd_val="$(grep -E '^DB_PASSWORD=' "${PROJECT_DIR}/.env" 2>/dev/null | cut -d= -f2- || echo mwt)"
    docker exec -e PGPASSWORD="${pwd_val}" "${POSTGRES_CONTAINER}" \
        psql -U "${DB_USER}" -d "${DB_NAME}" -At -c \
        "SELECT schemaname, COUNT(*) FROM pg_stat_user_tables GROUP BY schemaname ORDER BY 1;" \
        | sed 's/|/ tables: /' | sed 's/^/  /'
}

# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------
require_root
require_docker_running

resolve_snapshot
require_dir "${SNAPSHOT_DIR}"

log_info "Snapshot a restaurar: ${SNAPSHOT_DIR}"
log_info "Verificando integridad (SHA256)..."
if ! verify_checksums "${SNAPSHOT_DIR}"; then
    log_error "Checksums NO coinciden. Aborto."
    exit 9
fi
log_ok "Checksums OK."

if [[ -f "${SNAPSHOT_DIR}/manifest.json" ]]; then
    log_info "Manifest:"
    cat "${SNAPSHOT_DIR}/manifest.json" | sed 's/^/  /'
fi

require_container "${POSTGRES_CONTAINER}"

if [[ "${ONLY_MEDIA}" -ne 1 ]]; then
    restore_postgres
fi
if [[ "${ONLY_POSTGRES}" -ne 1 ]]; then
    restore_media
    extract_config
fi
if [[ "${ONLY_MEDIA}" -ne 1 ]]; then
    verify_postgres
fi
log_ok "Restore completado. Revisa la aplicacion: docker compose ps; curl http://localhost:8100/api/auth/login/ -X OPTIONS"
