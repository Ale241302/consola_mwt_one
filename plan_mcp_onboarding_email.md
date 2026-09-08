# Plan: Onboarding MCP por correo — paquetes de credenciales device-bound (mcp@mwt.one)

**Fecha:** 2026-09-07 · **Estado:** Diseño para validación (Fase 0 ejecutada).
**Alcance:** Pipeline que convierte un correo entrante (o un registro con aprobación de admin) en
un paquete `.md` + `.json` de credenciales para que una IA (Claude, opencode, Antigravity…) se
conecte **directo, sin OAuth interactivo**, al MCP de la empresa del usuario, con **vínculo a un
solo dispositivo** y **revocación del paquete anterior**.

Decisiones tomadas con el usuario: **① Token directo al MCP** (no OAuth por navegador) ·
**② Vínculo IP + secreto + un solo activo** · **③ Avanzar en fases con plan**.

---

## 0. Estado actual (verificado en producción)

- **Buzón `mcp@mwt.one` CREADO y operativo** en mailcow (`/opt/mailcow-dockerized`,
  `mail.mwt.one`). Dominio `mwt.one` activo en mailcow (`core` mailcow). Credenciales del buzón
  entregadas al usuario (IMAP `:993` SSL, SMTP `:587` STARTTLS AUTH). Autenticación real IMAP/SMTP
  OK (self-test de envío/recepción exitoso, `messages=1`).
- **MX/A:** `mwt.one` → `10 mail.mwt.one` y `mail.mwt.one` A `187.77.218.102` ya resuelven en
  Cloudflare → el correo entrante YA puede llegar al buzón.
- El backend ya **envía email vía mailcow**: `EMAIL_HOST=mail.mwt.one:465 SSL`, `info@mwt.one`,
  infra de templates HTML+TXT + `NotificationLog` + Celery (`notifications/email_dispatcher.py`,
  `notifications/tasks.py`). Contenedores celery-beat/worker arriba en `consola-mwt-one`.
- Canal **in-app** real: `users.activity_feed` (campana 🔔). Patrón a replicar para "notificar a
  admins": `expedientes/views_wizard.py:_notify_admins_expediente_created` (`:652-865`) — activity
  feed por admin + email.
- **`core.mcp_app`** (`backend/apps/core/models.py:64-87`): `cliente_id` (único) ↔ `mcp_url`,
  `oauth_client_id/secret`, `estado PROVISIONED`, `service_token_id`. Es la fuente de la URL MCP y
  del slug por empresa.
- **Auth MCP actual:** Authentik OAuth → ContextForge (`mcp.mwt.one`, `mcp-gateway/`, patches
  v3–v12 en `entrypoint.sh`) inyecta `X-Forwarded-User-*` + `X-MWT-Client-ID` →
  `IdentityPropagationMiddleware` (`asgi_middleware.py`) → `jwt_minter.py` mintea JWT vía
  `POST /api/auth/mcp-token/` (`auth_views.py:805-906`, requiere ServiceToken `mcp:token_exchange`,
  intersecta `legal_entity_ids` del usuario con `client_ids`, kill-switch cliente activo, JWT 1h).
  RBAC por rol en `tool_rbac.py` + redacción en `redact.py`. **No existe** registro público, ni
  usuarios "pendiente de activación", ni credenciales token directo.

---

## 1. Requisitos funcionales (traducción del brief)

1. **Correo entrante a `mcp@mwt.one`** con cuerpo conteniendo (mínimo) el **email** (clave) y
   opcionalmente **nombre** de un usuario.
2. Si el email **es un usuario consola existente y activo** → **responder al mismo remitente**
   (HTML) adjuntando `.md` (instrucciones/aviso de un-solo-uso) y `.json` (config MCP con token
   secreto). El usuario se lo pasa a su IA.
3. El paquete es **un solo uso por dispositivo**: primera conexión lo vincula a la **IP**; si el
   mismo archivo se usa desde otra IP → error "genera uno nuevo". **Emitir uno nuevo revoca el
   anterior** (el equipo 1 muere). El correo HTML debe explicarlo.
4. Si el email **no está registrado** → responder con **enlace de registro** a un formulario
   público de `consola.mwt.one`.
5. **Formulario público** (`/registro-mcp`, sin login): email, nombre completo, teléfono,
   contraseña, **empresa con autocompletado restringido** a clientes con MCP provisionado + sus
   subsidiarias (escribir "Sondel" → Sondel; "Comtek" no aparece si no tiene MCP), y bloque de
   **direcciones** (etiqueta/Nueva dirección, marcar default, calle, ciudad, país, código postal)
   reutilizando el UX de `UserFormView.jsx`.
6. El usuario registrado **NO queda habilitado** (sin login). Se notifica por **email + in-app** a
   los admins (rol `admin`/`ceo`/`superadmin`) y se le envía a él "cuenta creada, el equipo
   revisará".
7. Cuando un admin **activa** la cuenta → email al usuario "cuenta activada" **con el paquete
   `.md` + `.json` adjunto**.

---

## 2. Arquitectura objetivo

```
                 ┌────────────  FLUJO A: usuario existente  ────────────┐
Solicitante ──▶  mcp@mwt.one (mailcow, IMAP)                            │
   "correo, nombre"                                                     │
                 │                                                      
                 ▼  poller IMAP (Celery beat → task)                    
   backend  POST /api/onboarding/validate   ── existe y activo? ── SÍ ──▶
                 │                                        │               emitir grant
                 │ NO                                     │              + reply HTML
                 ▼                                        ▼              adjuntando .md/.json
   reply con link /registro-mcp                    solicitante recibe paquete
                 │
   ┌─────────────▼────────────  FLUJO B: registro nuevo  ──────────────┐
   /registro-mcp (público, frontend) ──▶ POST /api/onboarding/registro  │
   POST crea usuario PENDIENTE (no login) + activity_feed+email admins  │
   + email al solicitante "en revisión"                                │
                                                                        │
   admin activa en /usuarios ──▶ email "cuenta activada" + .md + .json │
                                                                        ▼
              ┌─────────────────  CREDENCIAL DEVICE-BOUND ─────────────────┐
              │  core.mcp_device_grant (1 activo por user+cliente)        │
              │  .json → { mcp_url + token secreto }                       │
              │  IA ─▶ mcp.mwt.one con "Authorization: DeviceToken <s>"   │
              │   gateway/MCP valida secret ─▶ POST /api/auth/mcp-token/   │
              │   (grant_secret + ip) → bind IP 1ª vez / match después,    │
              │   revocado?→401, cliente activo?→JWT 1h scoped al cliente  │
              └────────────────────────────────────────────────────────────┘
```

La clave: el **token directo reutiliza el mint path de `McpTokenView`**. En lugar de identidad
`X-Forwarded-User-*`, la identidad la aporta el **grant**: `mcp-token` recibe `grant_secret`, el
backend resuelve el grant → `user_uuid` + `cliente_id` → misma emisión de JWT con scope fijado al
cliente del grant (fail-closed). Todo el RBAC/redacción por rol aguas abajo funciona sin cambios.

---

## 3. Decisiones de diseño (D#)

- **D1 · Token directo al MCP.** Nuevo tipo de credencial `DeviceToken`. El `.json` embeje el
  `secret` (opaco, se guarda **hash SHA-256** en DB, se muestra 1 sola vez) + `mcp_url` del
  `core.mcp_app` del cliente. Sin OAuth por navegador.
- **D2 · Vínculo por dispositivo = IP + secreto + un solo activo.** La MAC no es verificable
  server-side sobre HTTP (el servidor solo ve IP pública). En la primera conexión con el grant, el
  backend **vincula la IP**; conexiones posteriores desde otra IP → `401 DEVICE_MISMATCH` pidiendo
  regenerar. La MAC solo se guarda si el agente la reporta (campo informativo). Dado que el AI corre
  en el equipo del usuario, la IP pública del equipo es el proxy razonable.
- **D3 · Revocación single-active.** Índice único parcial por `(user_uuid, cliente_id)` donde
  `estado IN ('ISSUED','ACTIVE')`. Emitir uno nuevo revoca (`REVOKED`, motivo `replaced`) el
  anterior del mismo par. Cumple "equipo 1 muere al generar en equipo 2".
- **D4 · Ambigüedad de empresa (usuario con >1 cliente MCP).** El cuerpo del correo solo trae
  email+nombre. Resolución propuesta: (a) si `legal_entity_id` (primaria) tiene MCP → esa;
  (b) si hay **exactamente 1** cliente MCP en `legal_entity_ids` → esa; (c) si hay varios →
  responder pidiendo indicar la empresa (lista). **[decisión a validar]**.
- **D5 · Registro pendiente NO hace login.** El alta pública replica la triple escritura
  (mwtuser + core.users + Authentik) pero con **`is_active=FALSE`** en las 3 capas (hoy
  `users/views.py` fuerza activo). La consola filtra usuarios inactivos salvo `include_inactive=1`
  (ya soportado), donde el admin verá la acción **Activar**.
- **D6 · Autenticación de salida de mcp@mwt.one.** El pipeline responde **como** `mcp@mwt.one`
  autenticando con las credenciales del propio buzón (SMTP 587 STARTTLS), no con `info@mwt.one`
  (sender_acl de mailcow ata el From al mailbox autenticado).
- **D7 · Bypass OAuth solo para DeviceToken.** ContextForge valida OAuth salvo requests con header
  `Authorization: DeviceToken …` (formato), que reenvía tal cual al MCP (nuevo patch en el
  entrypoint de `mcp-gateway/`). La validación real (secret, IP, revocación) ocurre en backend,
  fail-closed. El MCP deriva cliente/tenant del propio grant (no necesita `X-MWT-Client-ID`).
- **D8 · Anti-abuso.** El buzón es público: throttle por remitente, parseo estricto, límites de
  tamaño, no procesar a destinos != mcp@mwt.one, y sólo se responde a remitentes con emails
  válidos verificables. Rspamd sigue activo.
- **D9 · SQL-first** (convención del repo): nuevas tablas vía archivo numerado idempotente en
  `backend/sql/` + `public._applied_sql`; **nunca** `makemigrations`.

---

## 4. Tablas nuevas (SQL-first)

### 4.1 `core.mcp_device_grant` (schema `core`) — núcleo de la credencial
| columna | tipo | notas |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| user_uuid | uuid not null | = `core.users.id` |
| email | text not null | snapshot del usuario (traza/auditoría) |
| cliente_id | uuid not null | empresa/tenant; referencia lógica a `clientes.cliente` y `core.mcp_app.cliente_id` |
| secret_hash | text not null unique | sha256 del secret (nunca en claro) |
| secret_prefix | text | primeros 8 chars, para soporte |
| estado | text not null default 'ISSUED' | ISSUED → ACTIVE (1ª conexión) → REVOKED / EXPIRED |
| ip_vinculada | inet null | bind de la 1ª conexión |
| mac_reportado | text null | informativo (si el agente lo reporta) |
| user_agent | text null | informativo |
| primera_conexion_at / ultima_conexion_at | timestamptz null | |
| creado_via | text not null | 'email' \| 'registro' |
| expira_at | timestamptz null | TTL propuesto 7 días sin usar |
| revocado_at / revoke_reason | timestamptz/text null | motivo: replaced / device_mismatch / revoked |
| created_at / updated_at | timestamptz default now() | |
| **idx único parcial** | | `(user_uuid, cliente_id) WHERE estado IN ('ISSUED','ACTIVE')` → enforce single-active |

### 4.2 `users.registration_request` (schema `users`) — registros pendientes de aprobación
| columna | tipo | notas |
|---|---|---|
| id | uuid pk | |
| email / full_name / phone / contact_email | text | del formulario |
| password_hash (pbkdf2 + hash sha256 para core.users, como `users/views.py`) | text | NO usable hasta activar |
| cliente_id | uuid not null | empresa elegida (padre o subsidiaria) |
| legal_entity_ids | text[] | [cliente_id] (+ padre si eligió subsidiaria) |
| role_default | text default 'client_b2b' | rol al activar |
| addresses | jsonb | bloque de direcciones (1..N, is_default) |
| estado | text default 'PENDIENTE' | PENDIENTE → APROBADO / RECHAZADO |
| ip_origen / user_agent | text | registro del solicitante |
| aprobado_por / aprobado_at | uuid/timestamptz null | |
| activado_user_uuid | uuid null | referencia al usuario creado al aprobar |
| created_at / updated_at | timestamptz | |

> Al **aprobar**: transacción crea usuario (mwtuser+core.users+Authentik) activo con esos datos,
> marca `registration_request.estado=APROBADO`, y encola el email de activación + paquete.

---

## 5. Endpoints nuevos (backend)

Todos con throttle; los de correo con ServiceToken (scope `mcp:token_exchange`).

| Endpoint | Auth | Función |
|---|---|---|
| `POST /api/onboarding/validate` | ServiceToken | input `{email, remitente_ip}` → `{existe, activo, cliente_mcp:{id,razon,slug,mcp_url}, ambiguo?, empresas[]}`. Decide caso A (existe→grant) vs B (no existe→link). |
| `POST /api/onboarding/emit-grant` | ServiceToken | input `{email, cliente_id?, creado_via}` → crea grant (revoca previo), devuelve `{secret (única vez), paquete{md,json}, cliente}`. |
| `POST /api/onboarding/registro` | **AllowAny** (público) | Registro pendiente (D5). Valida email único, empresa MCP-válida, captcha-lite/rate. Crea `registration_request`, activity_feed+email a admins, email "en revisión" al solicitante. |
| `GET /api/onboarding/clientes?q=` | **AllowAny** | Autocomplete público restringido: clientes con `core.mcp_app.estado='PROVISIONED'` **+ sus subsidiarias** (activas). Devuelve id/razon_social/nombre_comercial/is_subsidiary/parent. |
| `POST /api/users/<id>/activate-mcp/` | Admin/CEO | Aprueba el request pendiente, crea/activa usuario, manda email de activación **con adjuntos .md/.json** (granatea vía emit-grant). |
| `POST /api/auth/mcp-token/` **(extensión)** | ServiceToken | Acepta body `{grant_secret, ip}` además de `{email|user_id}`. Resuelve grant (estado, expiración, cliente activo, **IP bind/match**, usuario activo) y emite el JWT 1h scopeado al `cliente_id` del grant. Devuelve igual shape `{access, user}` → **cero cambios** en RBAC/redacción del MCP. |

---

## 6. Fases de implementación

### Fase 0 — Buzón `mcp@mwt.one` ✅ (HECHO)
Creado en mailcow vía API, credenciales entregadas, IMAP/SMTP verificados. Falta persistir las
credenciales en el `.env` de consola como variables (Fase 1).

### Fase 1 — Pipeline de correo (validación + respuesta automática)
- `backend/sql/I1_mcp_device_grant.sql` (tabla 4.1; reutilizable por Fase 3).
- Nueva env: `MCP_MAILBOX_USER=mcp@mwt.one`, `MCP_MAILBOX_PASSWORD=…`,
  `MCP_MAILBOX_IMAP=mail.mwt.one:993`, `MCP_SMTP_*=…`. Documentar en `.env.example`.
- **Poller IMAP**: task Celery `onboarding.poll_mcp_inbox` (beat cada 60–120 s; opcional
  `imaplib` + reconnect). Lee INBOX de `mcp@mwt.one`, procesa solo mensajes **a** `mcp@mwt.one`,
  parsea cuerpo (texto/HTML) extrayendo `email` (regex/regex+heurística) y `nombre` opcional.
- **Router**: `POST /api/onboarding/validate` →
  - Existe y activo → `emit-grant` → **reply HTML** `emails/mcp_credenciales.html` adjuntando
    `.md` + `.json` (via `msg.attach`, patrón `email_dispatcher.py:358-362`). Mover a carpeta
    `Leidos/` o borrar el mensaje procesado.
  - No existe → reply HTML `emails/mcp_no_registrado.html` con link a `/registro-mcp`.
  - Ambigüedad (D4) → reply pidiendo empresa.
- Seguridad: throttle por remitente, límite de tamaño, no rebotar spam, log durable (`mcp_audit`).
- Templates HTML+TXT nuevos en `backend/apps/notifications/templates/emails/` (y `.txt`).
- Pruebas: self-envío end-to-end contra el buzón real; unit tests del parser.

### Fase 2 — Registro público + aprobación de admin
- `backend/sql/I2_registration_request.sql` (tabla 4.2).
- Backend: `apps/onboarding` con endpoints `/api/onboarding/{registro,clientes}`,
  `POST /api/users/<id>/activate-mcp/` + notificaciones (reusar patrón
  `_notify_admins_expediente_created`, `views_wizard.py:652-865`, para activity_feed+email).
- Frontend: nueva ruta pública **`/registro-mcp`** (en `App.jsx` junto a `/login`, fuera de
  `ProtectedRoute`). Formulario clonado del UX de `UserFormView.jsx` (campos + direcciones +
  "Nueva dirección"/"Marcar default") con autocomplete a `/api/onboarding/clientes` (restringido a
  MCP-provisioned + subsidiarias). Guard `CeoAdminOnlyRoute` **no** aplica (es público).
- UI admin en `Users.jsx`: badge "pendiente" y acción Activar (o vista de solicitudes).
- Templates: `mcp_registro_recibido.html` (solicitante), `mcp_admin_notificacion.html` (admins).

### Fase 3 — Credencial device-bound + token directo al MCP
- Backend: extender `McpTokenView` (`auth_views.py`) con `grant_secret`+`ip`; resolver grant con
  reglas D2/D3 (bind/match IP, single-active, cliente activo vía `_active_client_ids_scope`,
  usuario activo); shape de respuesta idéntico. SQL ya en Fase 1.
- **MCP server** (`mcp_server/mwt_mcp/`):
  - `identity.py`: soportar identidad de grant (`grant_secret`) en el contextvar.
  - `asgi_middleware.py`: leer `Authorization: DeviceToken <secret>` (+ capturar IP real del
    cliente vía `X-Forwarded-For`/peer según topología nginx) y guardarla como identidad.
  - `jwt_minter.py`: si hay `grant_secret`, llamar `mcp-token` con `{grant_secret, ip}` en vez de
    `{email}`; mismo fail-closed/cache.
  - `tool_rbac.py`/`redact.py`: **sin cambios** (trabajan sobre el `user` devuelto).
- **Gateway**: nuevo patch `contextforge_patch_v13.py` + registro en `mcp-gateway/patch/entrypoint.sh`
  (bypass OAuth solo si `Authorization: DeviceToken`; forward del header + real-IP).
  **[requiere inspección del entrypoint/gateway real en el VPS antes de implementar]**.
- Generador de paquete (backend): `.json` = `{mcpServers:{...mcp_url, headers:{Authorization:
  DeviceToken <secret>}, env…}}` según el destino (claude/opencode/antigravity/… pueden variar);
  `.md` = instrucciones + aviso un-solo-uso/por-dispositivo + pasos de revocación.
- Tests adversariales (MCP): grant válido/mal/revocado/IP distinta/cliente inactivo/usuario
  inactivo → añadir a `mcp_server/tests/`.

### Fase 4 — Activación admin con envío de paquete
- Al `activate-mcp/`: transacción de alta activa (mwtuser+core.users+Authentik `is_active=TRUE`,
  sync grupos `mcp-cliente-<slug>` reutilizando `users/views.py:202-217`), `emit-grant`
  (`creado_via='registro'`), email `mcp_cuenta_activada.html` con `.md`+`.json` adjuntos.
- Estado visual en consola: del "pendiente" al "activo + paquete emitido (fecha, IP vinculada)".

### Fase 5 — Hardening y operación
- Kill-switch: desactivar cliente/usuario → revocar grants del par (`REVOKED`) → inmediatez ≤ TTL
  del cache del grant (proponer 5–10 min en tenant scoped, alineado a `jwt_minter`).
- Rate limits públicos, spam del buzón, monitoreo de la cola IMAP, rotación de secret del paquete.
- Actualizar README del MCP (§ auth) y `mwt-operations` skill con el flujo de onboarding.

---

## 7. Riesgos y notas honestas

- **MAC no verificable** server-side → el vínculo real es IP+secreto (D2). Dos equipos tras la
  **misma IP pública** (NAT de oficina) comparten vínculo; si eso rompe el requisito, habría que
  añadir "activación por enlace de un clic desde el navegador" (opción B de diseño).
- **Bypass OAuth en ContextForge** es la pieza más delicada: el gateway es el mismo parcheado
  v3–v12. Hay que inspeccionar el estado real en el VPS (entrypoint + config actual) antes de
  escribir v13 y validar que `AUTH_REQUIRED=true` no bloquea antes del chequeo.
- **Entregabilidad / reputación**: el buzón ya recibe de externos (MX ok). Envíos salientes desde
  `mcp@mwt.one` comparten la IP del VPS (límite Hostinger 5/min); para volúmenes bajos OK.
- **Spoofing del remitente**: mailcow verifica SPF/DKIM del origen; el parseo NO debe confiar en
  `Reply-To` sin validación y debe confirmar el email contra el usuario existente antes de emitir
  credenciales (es el control real).
- El nuevo registro es **público**: requiere rate limit + validación de dominio del email y
  revisión humana antes de activar (ya en el diseño).

---

## 8. Abierto a confirmar antes de Fase 1

1. ¿Resolver D4 con "primaria → única → preguntar"? (recomendado)
2. Credenciales de `mcp@mwt.one`: ¿las guardo en `/opt/consola-mwt-one/.env` del VPS (+ copia en
   `.env.example`) para que el poller las use? (recomendado)

---

## 9. Estado de implementación (2026-09-08)

- **Fase 0 ✅** buzón `mcp@mwt.one` operativo.
- **Fase 1 ✅ desplegada**: tabla `core.mcp_device_grant`, `mcp_onboarding` + `mcp_mailbox`,
  templates reply, command `manage.py mcp_poll_inbox`. E2E real validado.
- **Fase 2 ✅ desplegada**: `users.registration_request` (SQL I2), endpoints
  `/api/onboarding/{clientes,registro,solicitudes,<id>/aprobar,<id>/rechazar}`, servicio de
  activación (mwtuser + core.users + Authentik + grant + email con .json/.md), templates
  `mcp_registro_recibido/mcp_admin_notificacion/mcp_cuenta_activada`, páginas frontend
  **`/registro-mcp`** (pública) y **`/registro-solicitudes`** (admin, con link desde /usuarios).
  Throttles públicos `mcp_registro`/`mcp_registro_q`.
- **Fase 3 ⚠️ parcial**: backend `mcp_device_grant_auth` + `McpTokenView` con `grant_secret+ip`
  (bind IP al primer uso, `DEVICE_MISMATCH`/`REVOKED`/`EXPIRED`) **validado end-to-end contra
  producción** (200 mismo equipo / 401 otro equipo). MCP server soporta
  `Authorization: DeviceToken <secret>` (identity/asgi/jwt_minter, caché atada a secret+IP) —
  suite **148 tests verdes**. Gateway: patches **v13** (bypass OAuth en `require_auth`) y **v13b**
  (exime CSRF) aplicados, pero ContextForge aún responde `401 requires OAuth` en la capa de
  enrutado del server virtual → **falta cerrar el direct-proxy del server para DeviceToken**
  (enrutar por payload `device-token` a `consola-mwt-one-mcp:8765`). Por eso el beat
  `mcp_poll_inbox` está **APAGADO** hasta completar ese tramo del gateway.
- Pruebas manuales listas: `docker exec consola-mwt-one-django python manage.py mcp_poll_inbox`
  (pipeline correo) y el flujo de registro→aprobación en la consola.

3. Formato del **cuerpo** del correo que esperamos (¿solo `email` en el body basta?, ¿nombre
   opcional?). Mientras tanto el parser acepta "email: x@y.z" o el email suelto.
