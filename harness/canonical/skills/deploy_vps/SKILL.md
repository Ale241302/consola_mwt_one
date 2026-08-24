---
name: deploy_vps
description: Despliega un cambio a produccion en MWT.ONE stageando SOLO el archivo objetivo (nunca git add -A por el churn CRLF), haciendo git push a main y corriendo redeploy_vps.sh en el VPS por SSH.
trigger: El usuario quiere desplegar, hacer ship, push a produccion o redeploy del VPS.
---

# deploy_vps — deploy a produccion (VPS Hostinger)

El despliegue es **auto-deploy en cada push a `main`** (GitHub Actions
`deploy.yml`) sobre un unico VPS Hostinger. Esta skill describe el flujo seguro.

## Regla critica: NUNCA `git add -A`

El working tree tiene **churn CRLF** vs el indice (LF): `git diff` muestra cientos de
archivos falsamente modificados. Si haces `git add -A` o `git add .` commiteas ruido
masivo. **Stagea SOLO el/los archivo(s) objetivo** por ruta explicita.

## Procedimiento

### 1. Verifica que stageas exactamente lo correcto

```bash
git status --short
# Identifica los archivos REALMENTE modificados por tu tarea, no el churn CRLF.
```

### 2. Stagea por ruta explicita (solo el objetivo)

```bash
git add backend/sql/92_ejemplo.sql frontend/src/components/Ejemplo.jsx
git status --short   # confirma que SOLO estan tus archivos staged
git diff --cached    # revisa el diff exacto que vas a commitear
```

Si aparecen archivos que no tocaste, sacalos del stage (`git restore --staged <ruta>`)
antes de continuar.

### 3. Commit y push a main

```bash
git commit -m "<mensaje claro en ingles>"
git push origin main
```

El push dispara GitHub Actions (`.github/workflows/deploy.yml`), que reconstruye y
redespliega los contenedores en el VPS.

### 4. Redeploy manual por SSH (si hace falta forzarlo)

```bash
ssh -p 2222 root@187.77.218.102 'bash /root/redeploy_vps.sh'
```

Para aplicar un nuevo .sql de esquema, ademas:

```bash
ssh -p 2222 root@187.77.218.102 \
  'docker exec -i consola-mwt-one-postgres psql -U mwt -d mwt_one < /ruta/backend/sql/<archivo>.sql'
```

### 5. Verifica el deploy

```bash
ssh -p 2222 root@187.77.218.102 'docker compose -f /root/.../docker-compose.yml logs -f --tail=50 django'
```

Comprueba que `https://consola.mwt.one` responde y que no hay errores en los logs de
`django` ni `frontend`.

## Deploy del MCP server (mcp_server/) — build context, NO docker cp

> ⚠️ **CRITICO**: el contenedor `consola-mwt-one-mcp` se construye desde el build
> context `/opt/consola-mwt-one/mcp_server/` (ver `docker-compose.yml` servicio
> `mcp-server`). Los cambios dentro del contenedor con `docker cp` **se pierden**
> cuando el contenedor se recrea (`docker compose up -d --build` o auto-deploy).
>
> Hubo varios deploys fallidos por esto: `docker cp /tmp/x.py contenedor:/app/...`
> funcionaba en caliente pero la siguiente recreacion devolvia el codigo viejo.

### Procedimiento correcto para cambiar codigo MCP

1. **Sincroniza los archivos locales al build context del VPS** (NO dentro del
   contenedor):

   ```bash
   scp -P 2222 mcp_server/mwt_mcp/server.py mcp_server/mwt_mcp/enrich.py mcp_server/mwt_mcp/redact.py \
     root@187.77.218.102:/opt/consola-mwt-one/mcp_server/mwt_mcp/
   ```

2. **Reconstruye la imagen y recrea el contenedor**:

   ```bash
   ssh -p 2222 root@187.77.218.102 \
     'cd /opt/consola-mwt-one && docker compose build mcp-server && docker compose up -d --no-deps mcp-server'
   ```

3. **Verifica el checksum** (confirma que el contenedor tiene tu codigo):

   ```bash
   ssh -p 2222 root@187.77.218.102 \
     'docker exec consola-mwt-one-mcp sh -c "grep -c enrich_lineas /app/mwt_mcp/server.py; grep -c filter_internal_ids /app/mwt_mcp/redact.py"'
   # Esperado: 2 y 6 (o los marcadores de tu cambio) — NO 0.
   ```

4. Confirma que el contenedor esta healthy:

   ```bash
   ssh -p 2222 root@187.77.218.102 'docker ps --filter name=consola-mwt-one-mcp --format "{{.Status}}"'
   ```

> Si usas `docker cp` igual, recuerda que es **temporal**: sobrevivira al restart
> pero NO a una recreacion (`compose up`). Para persistir, sincroniza al build
> context y reconstruye.

## Checklist antes de pushear

- [ ] Solo el archivo objetivo esta staged (verificado con `git diff --cached`).
- [ ] Si hay cambio de esquema: es un .sql nuevo idempotente y backward-compatible
      (NO migraciones Django).
- [ ] El frontend tocado pasa el Gate de Componentes (R1/R3 sin violaciones).
- [ ] Sin `console.log` ni secretos en el diff.

## Entrega

Las lineas exactas de `git add`/`commit`/`push` y el comando `ssh -p 2222
root@187.77.218.102 ... redeploy_vps.sh`, mas la verificacion del deploy.
