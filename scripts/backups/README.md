# Backups — Consola MWT.ONE

Sistema de backup diario para el stack `consola-mwt-one` en el VPS Hostinger (187.77.218.102).
Diseñado para ser **aburrido, predecible y restaurable**.

---

## Resumen ejecutivo

| Aspecto         | Valor                                                                 |
|-----------------|-----------------------------------------------------------------------|
| Qué respalda    | Postgres (`mwt_one`) + media Django + volúmenes Docker + config       |
| Cuándo          | Diario, 03:00 UTC (22:00 hora Ecuador)                                |
| Dónde           | `/opt/backups/consola-mwt-one/` en el mismo VPS                       |
| Retención       | 7 daily + 4 weekly + 3 monthly (GFS)                                  |
| Trigger         | `systemd timer` (no cron — mejor logging y persistencia)              |
| Verificación    | `consola-backup-check.timer` corre 1h después (04:00 UTC)             |
| Tamaño esperado | 50-300 MB por snapshot (depende de cuántos PDFs hay en media/)        |

---

## Archivos en este directorio

```
scripts/backups/
├── README.md                          (este archivo)
├── lib_common.sh                      (variables, logging, validaciones)
├── lib_rotate.sh                      (lógica GFS)
├── backup_consola.sh                  (script master)
├── restore_consola.sh                 (restore guiado)
├── check_backups.sh                   (health check)
├── install_backup_timer.sh            (instala los units en systemd)
└── systemd/
    ├── consola-backup.service
    ├── consola-backup.timer
    ├── consola-backup-check.service
    └── consola-backup-check.timer
```

---

## Instalación (one-shot, desde el VPS)

```bash
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
git pull origin main
sudo bash scripts/backups/install_backup_timer.sh
```

Eso es todo. A partir de ese momento, cada noche a las 03:00 UTC se genera un snapshot completo y se rota.

---

## Política GFS (Grandfather-Father-Son)

Cada noche el script genera **un snapshot diario**. Adicionalmente:

- **Domingos**: el snapshot del día se promueve (hardlink, sin duplicar espacio) a `weekly/`.
- **Día 1 del mes**: el snapshot del día se promueve a `monthly/`.

Retención (configurable en `lib_common.sh`):

- `KEEP_DAILY=7`   → 7 días de snapshots diarios.
- `KEEP_WEEKLY=4`  → 4 semanas de snapshots semanales.
- `KEEP_MONTHLY=3` → 3 meses de snapshots mensuales.

Cobertura efectiva: hoy hasta hace ~3 meses, con resolución decreciente.

---

## Estructura de un snapshot

```
/opt/backups/consola-mwt-one/daily/2026-05-24/
├── postgres.dump        (pg_dump -Fc --compress=9)
├── media.tar.gz         (backend/media/)
├── config.tar.gz        (.env + docker-compose + infra + scripts + database)
├── volumes/
│   ├── consola-mwt-one-redis-data.tar.gz
│   └── consola-mwt-one-celerybeat.tar.gz
├── manifest.json        (metadata: tamaños, duraciones, checksums)
└── SHA256SUMS           (verificable con `sha256sum -c`)
```

**Por qué no respaldamos `consola-mwt-one-pgdata`:** `pg_dump` ya genera un export consistente y restorable. Un `tar` del directorio vivo de Postgres puede quedar corrupto (el WAL puede estar en medio de un commit). Para Postgres, la herramienta oficial es `pg_dump`.

---

## Operación diaria

### Lanzar un backup manualmente

```bash
sudo systemctl start consola-backup.service
journalctl -u consola-backup.service -f
```

### Ver cuándo es el próximo run

```bash
systemctl list-timers 'consola-backup*'
```

### Verificar salud del último backup

```bash
sudo bash /opt/consola-mwt-one/scripts/backups/check_backups.sh
```

### Inventario actual

```bash
ls -lah /opt/backups/consola-mwt-one/daily/
ls -lah /opt/backups/consola-mwt-one/weekly/
ls -lah /opt/backups/consola-mwt-one/monthly/
du -sh /opt/backups/consola-mwt-one/*
```

### Ver logs históricos

```bash
# Log del run del día actual
tail -100 /opt/backups/consola-mwt-one/logs/backup-$(date -u +%F).log

# Logs de systemd (últimos 7 días)
journalctl -u consola-backup.service --since "7 days ago" --no-pager
```

---

## Restore — el momento de la verdad

### Caso 1: restaurar la DB completa (lo más común)

```bash
sudo bash /opt/consola-mwt-one/scripts/backups/restore_consola.sh
# El script lista snapshots disponibles y pide confirmación.

# O directo a una fecha:
sudo bash /opt/consola-mwt-one/scripts/backups/restore_consola.sh 2026-05-23
```

### Caso 2: solo Postgres (sin tocar media)

```bash
sudo bash /opt/consola-mwt-one/scripts/backups/restore_consola.sh \
  --only-postgres 2026-05-23
```

### Caso 3: solo media (sin tocar DB)

```bash
sudo bash /opt/consola-mwt-one/scripts/backups/restore_consola.sh \
  --only-media 2026-05-23
```

### Caso 4: dry-run (ver qué haría sin tocar nada)

```bash
sudo bash /opt/consola-mwt-one/scripts/backups/restore_consola.sh \
  --dry-run 2026-05-23
```

### Caso 5: reconstruir el VPS desde cero

Si pierdes el VPS entero y solo tienes los snapshots en otro lado:

1. Provisiona Ubuntu nuevo + Docker + clona el repo en `/opt/consola-mwt-one`.
2. Restaura el `.env` desde `config.tar.gz` del snapshot.
3. `docker compose up -d --build` (esto inicializa Postgres vacío).
4. Espera a que Postgres esté `healthy`.
5. Corre `restore_consola.sh /path/al/snapshot`.
6. `docker compose restart django`.

---

## Probar el restore (recomendado mensual)

> Un backup que nunca se restaura no es un backup, es una ilusión.

Ejecuta este drill al menos una vez al mes:

```bash
# 1. Crea una DB temporal en el mismo Postgres
docker exec consola-mwt-one-postgres psql -U mwt -c "CREATE DATABASE mwt_one_restore_test;"

# 2. Restaura el último dump ahí
LATEST="$(ls -1 /opt/backups/consola-mwt-one/daily | sort | tail -1)"
docker cp /opt/backups/consola-mwt-one/daily/${LATEST}/postgres.dump \
  consola-mwt-one-postgres:/tmp/test.dump
docker exec consola-mwt-one-postgres pg_restore \
  -U mwt -d mwt_one_restore_test --no-owner --no-privileges /tmp/test.dump

# 3. Verifica algunas tablas
docker exec consola-mwt-one-postgres psql -U mwt -d mwt_one_restore_test -c \
  "SELECT schemaname, COUNT(*) FROM pg_stat_user_tables GROUP BY schemaname;"

# 4. Limpia
docker exec consola-mwt-one-postgres psql -U mwt -c "DROP DATABASE mwt_one_restore_test;"
docker exec consola-mwt-one-postgres rm /tmp/test.dump
```

---

## Troubleshooting

### "Backup nunca corrió"

```bash
systemctl status consola-backup.timer
journalctl -u consola-backup.service --since "2 days ago"
```

Si el timer no aparece, re-ejecuta `install_backup_timer.sh`.

### "El dump es 0 bytes / muy pequeño"

`backup_consola.sh` aborta con exit 14 si pasa esto, justamente para que no se promueva un backup roto. Causas probables:

- Container `consola-mwt-one-postgres` no está corriendo.
- La password en `.env` no coincide con la del container.
- pgvector hace que `pg_dump` falle en algún esquema. Mira el log:
  ```bash
  cat /opt/backups/consola-mwt-one/logs/backup-$(date -u +%F).log
  ```

### "No hay espacio"

`backup_consola.sh` exige 2 GB libres mínimo antes de empezar. Si llega ahí:

```bash
df -h /opt
du -sh /opt/backups/consola-mwt-one/*
# Si necesitas liberar urgente:
rm -rf /opt/backups/consola-mwt-one/daily/<fecha-vieja>
```

O baja la retención editando `KEEP_DAILY` en `lib_common.sh` (o sobreescribiéndola por env en el `.service`).

### "El timer corre pero el check falla"

```bash
journalctl -u consola-backup-check.service -n 100
```

El check escribe qué archivo falta o qué checksum no cierra.

---

## Próximo nivel (no incluido en este sprint)

Estas mejoras quedan para cuando quieras subir el nivel de robustez:

1. **Off-site (S3 / Backblaze B2 / rclone a Drive)**: hoy los backups viven en el mismo VPS. Si pierdes el VPS, los pierdes. Añadir un `aws s3 sync` o `rclone copy` al final de `backup_consola.sh`.
2. **Notificaciones**: enviar email/Slack si `consola-backup.service` falla. Hoy solo queda en `journalctl`.
3. **Encriptación at rest**: si el snapshot va a salir del VPS, encriptar con `age` o `gpg` antes de subirlo.
4. **Backup de los otros stacks**: `mwt-postgres`, `mwt-builder-postgres`, `mwt-paperless`, `n8n`. Hoy este script solo cubre `consola-mwt-one`. La estructura es reusable: clonar `backup_consola.sh` y cambiar las constantes.
5. **Métricas en Grafana**: parsear `manifest.json` y exponer `backup_size_bytes` + `backup_duration_seconds` como métricas Prometheus para tener un panel.

---

## Diseño y decisiones

### ¿Por qué systemd timer y no cron?

- **Logs estructurados**: `journalctl -u consola-backup.service` da todo: stdout, stderr, exit code, timestamps. Cron solo manda email (o silencio).
- **`Persistent=true`**: si el VPS estaba apagado o reiniciando a las 03:00 UTC, el timer dispara al volver. Cron simplemente se pierde el run.
- **Dependencias declarativas**: `After=docker.service` garantiza que no intente antes de que docker esté arriba.
- **Reuso del unit**: `systemctl start consola-backup.service` lo lanza on-demand sin tocar la programación.

### ¿Por qué `pg_dump -Fc` y no `pg_dumpall` ni `SQL` plano?

- `-Fc` (custom format) está comprimido nativamente, soporta `pg_restore --jobs` para restore paralelo, y permite restore selectivo (`--table=foo`, `--schema=expedientes`).
- `pg_dumpall` incluye usuarios/roles globales, pero en este stack la creación de usuarios es idempotente vía `02_auth_admin.sql`. No necesitamos `pg_dumpall`.
- SQL plano es más portable pero pesa 5-10x más y tarda mucho más en restaurar DBs grandes.

### ¿Por qué no respaldar el volumen `pgdata`?

`pg_dump` ya genera un export transaccionalmente consistente. Un `tar` del filesystem vivo de Postgres puede capturar un WAL en medio de un commit y dejar el backup corrupto. La práctica estándar es:

- **Logical backup** (pg_dump): para restore "limpio" en cualquier versión compatible de Postgres. → Esto es lo que hacemos.
- **Physical backup** (pg_basebackup + WAL archiving): para PITR (point-in-time-recovery) con RPO bajo. → No lo necesitamos hoy.

### ¿Por qué hardlinks en la rotación GFS?

Promover un daily a weekly por **copia** duplicaría 300 MB por snapshot promovido. Con `cp -al` (archive + link), las entradas weekly y daily apuntan a los mismos inodos: el snapshot ocupa una sola vez en disco hasta que se borra el último.

---

## Contacto / ownership

- **Responsable**: Alejandro (alejandro@muitowork.com)
- **Agentes que pueden modificar esto**: AG-BACKEND, AG-DBA
- **Reglas de oro aplicables**: §11 (gstack — migraciones backward-compatible, catch-all es smell)
