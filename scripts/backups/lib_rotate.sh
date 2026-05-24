#!/usr/bin/env bash
# =====================================================================
# scripts/backups/lib_rotate.sh
# Consola MWT.ONE · rotación Grandfather-Father-Son (GFS).
#
# Política:
#   · daily/    — uno por día, se conservan KEEP_DAILY días.
#   · weekly/   — se promueve el daily del DOMINGO al weekly,
#                 se conservan KEEP_WEEKLY semanas.
#   · monthly/  — se promueve el weekly del PRIMER DOMINGO del mes
#                 (o el daily del día 1) al monthly,
#                 se conservan KEEP_MONTHLY meses.
#
# Las promociones se hacen por HARDLINK cuando es posible (mismo
# filesystem) para no duplicar espacio. Si falla (cross-device), cae a
# copia recursiva.
#
# Este archivo se `source` desde backup_consola.sh; depende de
# lib_common.sh ya estar cargado (LOG_*, BACKUP_ROOT, etc.).
# =====================================================================

# Copia recursiva con hardlinks (preserva timestamps + permisos).
# Si falla por cross-device, cae a cp -a.
_link_or_copy_tree() {
    local src="$1" dst="$2"
    mkdir -p "$(dirname "${dst}")"
    if cp -al "${src}" "${dst}" 2>/dev/null; then
        return 0
    fi
    log_warn "hardlink falló (¿cross-device?), copiando ${src} → ${dst}"
    cp -a "${src}" "${dst}"
}

# Promueve el snapshot diario del día a weekly si hoy es domingo.
promote_to_weekly_if_sunday() {
    local dow
    dow="$(date -u +%u)"  # 1=lun ... 7=dom
    if [[ "${dow}" -ne 7 ]]; then
        log_info "Hoy no es domingo (DOW=${dow}); skip promoción weekly."
        return 0
    fi
    if [[ -d "${WEEKLY_DIR}" ]]; then
        log_info "Weekly ${TS_WEEK} ya existe; skip."
        return 0
    fi
    if [[ ! -d "${DAILY_DIR}" ]]; then
        log_warn "No hay daily ${TS_DAY} para promover a weekly."
        return 0
    fi
    log_info "Promoviendo daily ${TS_DAY} → weekly ${TS_WEEK}"
    _link_or_copy_tree "${DAILY_DIR}" "${WEEKLY_DIR}"
    log_ok "Weekly ${TS_WEEK} creado."
}

# Promueve a monthly si hoy es día 1 (o primer domingo del mes — usamos
# día 1 por simplicidad y determinismo).
promote_to_monthly_if_first() {
    local dom
    dom="$(date -u +%d)"
    if [[ "${dom}" != "01" ]]; then
        log_info "Hoy no es día 1 (DOM=${dom}); skip promoción monthly."
        return 0
    fi
    if [[ -d "${MONTHLY_DIR}" ]]; then
        log_info "Monthly ${TS_MONTH} ya existe; skip."
        return 0
    fi
    if [[ ! -d "${DAILY_DIR}" ]]; then
        log_warn "No hay daily ${TS_DAY} para promover a monthly."
        return 0
    fi
    log_info "Promoviendo daily ${TS_DAY} → monthly ${TS_MONTH}"
    _link_or_copy_tree "${DAILY_DIR}" "${MONTHLY_DIR}"
    log_ok "Monthly ${TS_MONTH} creado."
}

# Purga snapshots viejos según KEEP_*.
# Ordena por nombre (ISO date → lexicográfico == cronológico) y borra
# todo lo que esté más allá del top-N.
_purge_tier() {
    local tier_dir="$1" keep="$2" label="$3"
    if [[ ! -d "${tier_dir}" ]]; then return 0; fi
    local count
    count="$(find "${tier_dir}" -mindepth 1 -maxdepth 1 -type d | wc -l)"
    if [[ "${count}" -le "${keep}" ]]; then
        log_info "${label}: ${count} snapshots ≤ ${keep}; no hay nada que purgar."
        return 0
    fi
    log_info "${label}: ${count} snapshots > ${keep}; purgando los más viejos."
    # shellcheck disable=SC2012
    ls -1 "${tier_dir}" | sort | head -n "-${keep}" | while read -r old; do
        log_info "  rm -rf ${tier_dir}/${old}"
        rm -rf "${tier_dir:?}/${old}"
    done
}

purge_old_backups() {
    _purge_tier "${BACKUP_ROOT}/daily"   "${KEEP_DAILY}"   "daily"
    _purge_tier "${BACKUP_ROOT}/weekly"  "${KEEP_WEEKLY}"  "weekly"
    _purge_tier "${BACKUP_ROOT}/monthly" "${KEEP_MONTHLY}" "monthly"
}

# Purga logs viejos (mantener 30 días).
purge_old_logs() {
    if [[ ! -d "${LOG_DIR}" ]]; then return 0; fi
    find "${LOG_DIR}" -type f -name 'backup-*.log' -mtime +30 -delete 2>/dev/null || true
}
