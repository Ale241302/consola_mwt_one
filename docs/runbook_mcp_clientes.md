# Runbook — Alta / Baja de Clientes MCP (consola_mwt_one)

> Operativo para dar de alta, gestionar y dar de baja un cliente en el MCP
> por cliente (mcp.mwt.one). El aislamiento entre clientes es de 5 capas
> (Authentik → ContextForge → MCP → Backend → datos), verificado por la
> suite adversarial `scripts/mcp_isolation_suite.sh`.

---

## 0. Conceptos rápidos

| Término | Qué es | Dónde vive |
|---|---|---|
| `cliente_id` | UUID de `clientes.cliente` (legal entity) | Consola → Clientes |
| `vsid` | ID del virtual server en ContextForge | `/servers/<vsid>/mcp` |
| `provider OAuth2` | Credenciales OAuth del cliente en Authentik | idp.mwt.one |
| `X-MWT-Client-ID` | Header que ContextForge/nginx inyecta al MCP | nginx + gateway |
| `X-MWT-Gateway-Key` | Secreto compartido gateway→MCP | `.env` consola |

---

## 1. Alta de un cliente MCP (end-to-end)

**Objetivo:** el cliente conecta su IA a `https://mcp.mwt.one/servers/<vsid>/mcp`
y solo ve sus datos.

### Paso 1 — Crear/actualizar el Cliente en la consola
- Consola → Clientes → **Nuevo cliente** (o editar).
- Al guardar, el backend **provisiona la app en Authentik** automáticamente
  (Ola 3): crea grupo `mcp-cliente-<slug>`, provider `mcp-provider-<slug>`
  (client_id/secret) y application `mcp-<slug>`.
- Verificar en el detalle del cliente → sección **App MCP** (CEO-ONLY):
  URL, OAuth Client ID, OAuth Client Secret, estado `PROVISIONED`.

### Paso 2 — Emitir el ServiceToken scopeado
```bash
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
docker exec consola-mwt-one-django sh -c \
  'cd /app && python manage.py mint_mcp_token \
     --name mcp-<slug> \
     --scopes mcp:token_exchange \
     --client-ids <cliente_id> \
     --expires-days 30 --quiet'
# → MWT_MCP_SERVICE_TOKEN=<token>  (guárdalo en secreto, p.ej. en el .env.mcp)
```

### Paso 3 — Registrar el virtual server en ContextForge
El server virtual apunta a la **misma gateway compartida**; su `oauth_config`
usa el client_id/secret del provider del cliente (de `core.mcp_app`).

```bash
# Generar vsid (uuid) y INSERT en la DB de ContextForge replicando el shape
# del server global pero con oauth_config del provider del cliente.
# Ver scripts/register_mcp_server.py (helper) o la Ola 5 para el piloto.
```

### Paso 4 — nginx: inyectar X-MWT-Client-ID por ruta
En `infra/nginx/consola.conf`, añadir el location del vsid:
```nginx
location = /servers/<vsid>/mcp {
    proxy_set_header X-MWT-Client-ID  "<cliente_id>";
    proxy_set_header X-MWT-Gateway-Key "$MWT_MCP_GATEWAY_KEY";
    proxy_pass http://contextforge;
    ... (mismos proxy_set_header que /)
}
```
Re-montar: `bash scripts/mount_consola_nginx.sh`.

### Paso 5 — Actualizar mcp_url del cliente
```bash
docker exec consola-mwt-one-postgres psql -U mwt -d mwt_one -c \
  "UPDATE core.mcp_app SET mcp_url='https://mcp.mwt.one/servers/<vsid>/mcp'
   WHERE cliente_id='<cliente_id>'"
```

### Paso 6 — Sincronizar usuarios del cliente en el grupo Authentik
Consola → Cliente → App MCP → **Sincronizar usuarios** (o
`POST /api/clientes/<id>/mcp-app/sync-members/`). Los usuarios cuyo
`legal_entity_ids` contiene al cliente pasan al grupo `mcp-cliente-<slug>`.

### Paso 7 — Validar
```bash
bash /opt/consola-mwt-one/scripts/mcp_isolation_suite.sh
```
O manualmente:
- Login en `https://mcp.mwt.one/servers/<vsid>/mcp` con un usuario del cliente.
- `expediente_listar` → solo expedientes del cliente.
- Intentar `expediente_obtener` de otro cliente → 404/vacío.
- `?client=<otro-cliente>` → vacío.

---

## 2. Baja / desactivación de un cliente (kill-switch)

**Objetivo:** cortar el acceso del cliente ≤ 10 min (idealmente inmediato).

### Automático (recomendado)
1. Consola → Cliente → **Desactivar** (estado → INACTIVO) o **Eliminar**.
2. El backend dispara el kill-switch (Ola 3): deshabilita la app en
   Authentik, **revoca el provider** (refresh tokens muertos) y marca
   `core.mcp_app.estado = DEPROVISIONED`.
3. El mint deja de emitir JWT para ese cliente → `CLIENTE_INACTIVO` 403.

### Manual (si el automático falló)
```bash
# 1. Deshabilitar la app + revocar provider
docker exec consola-mwt-one-django sh -c "curl -s -X PATCH .../core/applications/<slug>/ -d '{\"is_active\":false}'"
docker exec consola-mwt-one-django sh -c "curl -s -X DELETE .../providers/oauth2/<provider_pk>/"
# 2. Revocar el ServiceToken del cliente
docker exec consola-mwt-one-django sh -c 'cd /app && python manage.py revoke_service_token <id>'
# 3. (Opcional) quitar el vsid de ContextForge: enabled=0 en servers
# 4. (Opcional) quitar el location de nginx y re-montar
```

**Acceso residual:** los access tokens de Authentik viven ≤ 10 min; el JWT del
MCP se cachea ≤ 10 min. El backend corta de inmediato (403 CLIENTE_INACTIVO).

---

## 3. Rotación de secretos

| Secreto | Cómo se rota |
|---|---|
| `MWT_MCP_TOKEN` (ServiceToken) | `mint_mcp_token` nuevo + revocar el viejo + actualizar `.env` |
| `X-MWT-Gateway-Key` | `openssl rand -hex 32` en `.env` de consola + reiniciar MCP + re-montar nginx |
| OAuth client_secret | `POST /api/clientes/<id>/mcp-app/provision/` regenera el provider (nuevo secret) |
| DJANGO_SECRET_KEY | Rotar con ventana de mantenimiento (invalida sesiones/JWT) |

---

## 4. Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| `401` al conectar la URL | No completó OAuth, o usuario no está en el grupo | Verificar que el usuario tenga el cliente en `legal_entity_ids`; re-sync miembros |
| `TENANT_MISMATCH` en una tool | Identidad no pertenece al cliente del vsid | El usuario está en el vsid equivocado; verificar X-MWT-Client-ID del location nginx |
| `TENANT_SCOPE_VACIO` | Usuario sin `legal_entity_ids` | Asignar la empresa al usuario en Consola → Usuarios |
| `CLIENTE_INACTIVO` 403 | Cliente desactivado | Reactivar el cliente (estado ACTIVO) |
| Lista de expedientes vacía | Scope del JWT no incluye al cliente | Verificar mint con client_id; el JWT debe tener `tenant_id` |
| El header `X-MWT-Client-ID` no llega | nginx no montó el location o gateway sin passthrough | `mount_consola_nginx.sh`; gateway `passthrough_headers` incluye los 2 headers |
| Catálogo desactualizado | tools del server no re-registradas | Re-registrar tools en ContextForge |

---

## 5. Suite adversarial (CI / pre-release)

`scripts/mcp_isolation_suite.sh` corre 6.1-6.10. Requiere `MWT_MCP_SERVICE_TOKEN_SONDEL`
en el entorno. Cualquier regresión de aislamiento **bloquea el deploy**.

| # | Prueba | Resultado esperado |
|---|---|---|
| 6.1 | Usuario de otro cliente autoriza la app | Denegado en Authentik |
| 6.2 | Token de app Sondel vs vsid global/Comtek | 401/403 |
| 6.3 | Identidad sin pertenencia llega al MCP | `TENANT_MISMATCH` / `TENANT_SCOPE_VACIO` |
| 6.4 | `expediente_listar?client=<ajeno>` | `[]` |
| 6.5 | `expediente_obtener(<ajeno>)` | 403/404 |
| 6.6 | Admin en app de cliente | scope degradado al cliente |
| 6.7 | Cliente desactivado con token vivo | `CLIENTE_INACTIVO` ≤ 10 min |
| 6.8 | `costo_estandar` para client_b2b | redactado (`***`) |
| 6.9 | Caché enrich entre dos usuarios | keys separadas por tenant |
| 6.10 | JWT inválido/expirado/aud equivocada | 401 |

*Cada Ola del proyecto MCP por cliente se valida contra esta suite antes de
considerarla lista.*
