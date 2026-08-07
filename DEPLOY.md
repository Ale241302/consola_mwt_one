# Consola MWT.ONE — Guía de despliegue en VPS Hostinger

> **Objetivo**: dejar corriendo backend + frontend + Postgres dentro de
> Docker en el VPS, con auto-rebuild cada vez que empujes a `main`.

VPS: `root@187.77.218.102:2222` → carpeta destino `/opt/consola-mwt-one`.
Repo: <https://github.com/Ale241302/consola_mwt_one> rama `main`.

---

## 1. Qué se va a desplegar

Cuatro contenedores, todos bajo el proyecto Docker Compose `consola-mwt-one`:

| Servicio  | Imagen                         | Puerto VPS | Uso                    |
|-----------|--------------------------------|------------|------------------------|
| postgres  | `pgvector/pgvector:pg16`       | 5434       | Postgres + pgvector    |
| redis     | `redis:7-alpine`               | 6380       | Cache + broker Celery  |
| django    | build local (`backend/`)       | 8100       | API DRF + JWT          |
| frontend  | build local (`frontend/`)      | 3100       | SPA Vite detrás de nginx |

La primera vez que arranca Postgres, aplica automáticamente:

1. `database/init.sql` → crea schemas (core, clientes, expedientes…) y tablas.
2. `database/02_auth_admin.sql` → crea rol Admin + usuario `alejandro@muitowork.com`.
   La contraseña inicial debe definirse antes del primer deploy (ver
   `MWT_ADMIN_SEED_PASSWORD` o `python manage.py seed_admins --password`).

Si relanzas `docker compose up` con la DB ya creada, el entrypoint del
backend verifica en `public._applied_sql` cuáles SQL ya corrieron y **no
los vuelve a aplicar** (idempotente).

---

## 2. Despliegue inicial (una sola vez)

### 2.1 Empuja el código a GitHub

Los archivos de esta guía (workflow + scripts) están dentro de `mwt-one/`,
así que basta con commitear y subir:

```bash
cd "C:\Users\ale13\Downloads\Consola MWT.ONE\mwt-one"
git add -A
git commit -m "feat(devops): CI/CD workflow + VPS bootstrap scripts"
git push origin main
```

### 2.2 Corre el script one-click desde tu PowerShell

```powershell
cd "C:\Users\ale13\Downloads\Consola MWT.ONE\mwt-one"
.\scripts\deploy_consola.ps1
```

El script:

1. Crea el `docker context` `consola-mwt-one-vps`.
2. Genera `~/.ssh/consola_mwt_one_deploy` (ed25519) si no existe.
3. Añade la pub-key al `authorized_keys` del VPS.
4. Corre en remoto `bootstrap_vps.sh`, que:
   - instala Docker + compose si faltan,
   - clona el repo en `/opt/consola-mwt-one`,
   - genera `.env` con SECRET_KEY aleatorio,
   - abre puertos 3100 / 8100 en ufw,
   - levanta los 4 contenedores (`docker compose up -d --build`),
   - espera a que Postgres esté `healthy`.

Al terminar, imprime los **valores que debes pegar** en los Secrets de
GitHub (VPS_HOST, VPS_PORT, VPS_USER, VPS_SSH_KEY).

### 2.3 Configura los Secrets en GitHub

Ve a <https://github.com/Ale241302/consola_mwt_one/settings/secrets/actions>
y crea cuatro secretos:

| Nombre        | Valor                                                                 |
|---------------|-----------------------------------------------------------------------|
| `VPS_HOST`    | `187.77.218.102`                                                      |
| `VPS_PORT`    | `2222`                                                                |
| `VPS_USER`    | `root`                                                                |
| `VPS_SSH_KEY` | contenido de `~/.ssh/consola_mwt_one_deploy` (la PRIVADA, con BEGIN/END) |

Tip: `Get-Content $HOME\.ssh\consola_mwt_one_deploy -Raw | Set-Clipboard`.

---

## 3. Auto-redeploy en cada push a `main`

El archivo `.github/workflows/deploy.yml` se dispara solo:

- en cada `git push origin main`,
- manualmente desde **Actions → Deploy → VPS Hostinger → Run workflow**.

Flujo del workflow (2–4 min típico):

1. SSH al VPS con la key del Secret.
2. `git fetch && git reset --hard origin/main`.
3. `docker compose up -d --build --remove-orphans`.
4. `docker image prune -f`.
5. Verifica healthchecks de postgres, frontend (`/healthz`) y API
   (`OPTIONS /api/auth/login/`).

### Rollback rápido

```bash
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
git log --oneline -5          # elige el SHA bueno
git reset --hard <sha>
docker compose up -d --build
```

---

## 4. Acceso y verificación

| Qué                 | URL                                           |
|---------------------|-----------------------------------------------|
| SPA Frontend        | <http://187.77.218.102:3100>                  |
| Healthcheck front   | <http://187.77.218.102:3100/healthz>          |
| API Django          | <http://187.77.218.102:8100/api/>             |
| Login endpoint      | `POST http://187.77.218.102:8100/api/auth/login/` |
| Swagger UI          | <http://187.77.218.102:8100/api/schema/swagger-ui/> |

Credenciales iniciales (sembradas por `02_auth_admin.sql` / `seed_admins`):

- Usuario: `alejandro@muitowork.com`
- Password: definir con `MWT_ADMIN_SEED_PASSWORD` o `python manage.py seed_admins --password`.
- ⚠️ Cambiar la contraseña por defecto inmediatamente después del primer login.

---

## 5. Comandos útiles en el VPS

```bash
cd /opt/consola-mwt-one

# ver todo
docker compose ps
docker compose logs -f django
docker compose logs -f frontend

# rebuild forzado
bash scripts/redeploy_vps.sh

# entrar a postgres
docker exec -it consola-mwt-one-postgres psql -U mwt -d mwt_one

# entrar al django
docker exec -it consola-mwt-one-django bash

# bajar todo
docker compose down

# bajar borrando volúmenes (CUIDADO: perderás la DB)
docker compose down -v
```

---

## 6. Problemas comunes

| Síntoma                                               | Fix                                                                                  |
|-------------------------------------------------------|--------------------------------------------------------------------------------------|
| Workflow falla en *Deploy via SSH* con `Permission denied (publickey)` | La pub-key no quedó en el VPS o el Secret `VPS_SSH_KEY` está mal. Re-ejecuta `deploy_consola.ps1`. |
| `postgres: unhealthy`                                 | Revisa `docker compose logs postgres` — normalmente es `init.sql` con error de schema existente. Haz `docker compose down -v` y relanza. |
| `django` en loop de reinicio                          | `docker compose logs django`. Casi siempre falta Postgres listo (healthcheck corrige), o hay app importada en `settings.py LOCAL_APPS` sin existir. |
| 404 al entrar a <http://ip:3100>                      | El build del frontend falló. Revisa `docker compose logs frontend`.                  |
| Quiero cambiar password de DB                         | Edita `/opt/consola-mwt-one/.env` (`DB_PASSWORD=...`) y `docker compose up -d --build`. |

---

## 7. Routing público · `consola.mwt.one`

El VPS ya tiene el contenedor `mwt-nginx` (del stack vecino `mwt_builder`)
escuchando en los puertos 80/443 con cert self-signed. Consola MWT.ONE se
expone a través de ese mismo nginx — no corremos otro nginx público aquí.

Pasos (todos idempotentes — el script los puede correr varias veces):

1. Asegúrate de que el stack de Consola está arriba:
   ```bash
   cd /opt/consola-mwt-one
   docker compose up -d
   ```

2. Monta `consola.conf` en `mwt-nginx` y conéctalo a la red de Consola:
   ```bash
   bash /opt/consola-mwt-one/scripts/mount_consola_nginx.sh
   ```

   El script:
   - ejecuta `docker network connect consola-mwt-one-net mwt-nginx`
     (solo si no estaba conectado),
   - `docker cp infra/nginx/consola.conf mwt-nginx:/etc/nginx/conf.d/consola.conf`
     (solo si el md5 cambió),
   - `docker exec mwt-nginx nginx -t` para validar,
   - `docker exec mwt-nginx nginx -s reload` para aplicar sin downtime.

3. Configura el DNS en Cloudflare: `consola.mwt.one` → A record al IP del VPS
   (`187.77.218.102`) con modo SSL "Full (not strict)".

`scripts/redeploy_vps.sh` llama a `mount_consola_nginx.sh` al final de
cada rebuild, así que cada `git push origin main` también deja nginx
actualizado (no hace falta reiniciarlo manualmente).

Verificación rápida:

| Qué                  | Curl                                                           |
|----------------------|----------------------------------------------------------------|
| Frontend público     | `curl -I https://consola.mwt.one/`                             |
| API pública          | `curl -I https://consola.mwt.one/api/`                         |
| Login endpoint       | `curl -X POST https://consola.mwt.one/api/auth/login/ -d '{}'` |

