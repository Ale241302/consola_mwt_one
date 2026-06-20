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

## Checklist antes de pushear

- [ ] Solo el archivo objetivo esta staged (verificado con `git diff --cached`).
- [ ] Si hay cambio de esquema: es un .sql nuevo idempotente y backward-compatible
      (NO migraciones Django).
- [ ] El frontend tocado pasa el Gate de Componentes (R1/R3 sin violaciones).
- [ ] Sin `console.log` ni secretos en el diff.

## Entrega

Las lineas exactas de `git add`/`commit`/`push` y el comando `ssh -p 2222
root@187.77.218.102 ... redeploy_vps.sh`, mas la verificacion del deploy.
