# Respuesta de Fugu (Sakana AI) — Decisión sobre el punto 2.15

**Consultado con:** `codex -p fugu` (vía línea de comandos con SAKANA_API_KEY)
**Fecha:** 2026-08-08
**Contexto consultado:** el agente auditó en producción el token exchange y el gateway; ver `_consulta_fugu_2_15.md`.

---

# Decisión sobre el punto 2.15

## 1. Recomendación: **OPCIÓN A**, con condición previa

Recomiendo ejecutar el hardening completo en una sola ventana:

- Reemplazar el JWT admin por un ServiceToken opaco.
- `LOG_LEVEL=INFO`.
- `MCPGATEWAY_ADMIN_API_ENABLED=false`.
- `SECURE_COOKIES=true`, siempre que el flujo OAuth se haya validado previamente.
- Recrear únicamente `mcp-gateway-contextforge`.

### Justificación

- **C no es aceptable:** mantiene en producción una ruta sin identidad que puede terminar usando un JWT con `role:admin`.
- **B reduce el riesgo principal**, pero obliga a una recreación ahora y otra posteriormente. Como log level, Admin API y cookies son cambios de configuración, conviene amortizarlos en una sola interrupción.
- `LOG_LEVEL=DEBUG` también puede exponer identidad, headers o datos sensibles en logs.
- La Admin API no debería estar habilitada en producción.

### Condición para `SECURE_COOKIES`

Si `SECURE_COOKIES=true` no se ha probado mediante un login OAuth completo en staging sobre HTTPS, aplicar temporalmente una variante **A′**:

1. Reemplazar inmediatamente el JWT admin.
2. Cambiar a `LOG_LEVEL=INFO`.
3. Deshabilitar la Admin API.
4. Dejar exclusivamente `SECURE_COOKIES` para una ventana posterior validada.

No debe postergarse el reemplazo del JWT admin.

---

## 2. Authentik frente a Pocket-ID

Antes de recrear ContextForge, hay que **alinear el compose con Authentik**, que es el stack realmente ejecutado en producción.

No recomiendo completar la migración a Pocket-ID en esta misma ventana porque implicaría:

- Invalidar las sesiones OAuth activas.
- Volver a configurar cliente, secret y redirect URIs.
- Validar claims y propagación de `X-Forwarded-User-*`.
- Mezclar el cambio de identidad con el cambio de credencial, dificultando el rollback.

### Procedimiento

1. Capturar con `docker inspect` la configuración real de:
   - `mcp-gateway-contextforge`.
   - Contenedores `mcp-gateway-authentik-*`.
2. Compararla con `docker-compose.yml.bak.authentik`.
3. Crear un `docker-compose.yml` que describa fielmente el runtime Authentik actual.
4. Mover Pocket-ID a un archivo inactivo, por ejemplo:
   `docker-compose.pocketid.yml`.
5. Validar el compose con:
   ```bash
   docker compose config
   ```
6. Confirmar que ContextForge depende de Authentik y usa las redes, volúmenes e imagen actuales.
7. Solo entonces recrear ContextForge con `--no-deps`.

La migración a Pocket-ID debe ser un proyecto separado, con su propia ventana y pruebas OAuth.

---

## 3. Scope exacto recomendado

Para el token almacenado como `MWT_MCP_TOKEN` recomiendo:

```bash
python manage.py mint_mcp_token \
  --name mcp-gateway-contextforge-prod \
  --scopes mcp:token_exchange \
  --expires-days 30
```

### Por qué únicamente `mcp:token_exchange`

El mismo token se utiliza:

1. Para autenticar la llamada a `/api/auth/mcp-token/`.
2. Como fallback directo cuando no hay identidad o falla el minting.

Por tanto, incluir `mcp:read` permitiría que una petición sin identidad dispusiera potencialmente de capacidad de lectura. El resultado seguro debe ser:

> **Sin identidad → sin acceso a datos ni escritura.**

No incluir:

- `mcp:read` en el token compartido del gateway.
- `mcp:write`.
- Wildcards como `mcp:*`.
- Rol admin o superadmin.

Si existe un proceso batch legítimo sin OAuth, debe utilizar otro token:

```bash
python manage.py mint_mcp_token \
  --name mcp-internal-reader-prod \
  --scopes mcp:read \
  --client-ids <uuid_1>,<uuid_2> \
  --expires-days 30
```

Este segundo token no debe instalarse en ContextForge.

### Precaución crítica detectada en `McpTokenView`

En la vista:

```python
user_legal_ids = set(request.user.legal_entity_ids or [])
```

`request.user` es aparentemente el `ServiceTokenUser`, no el usuario objetivo. Si ese código coincide con producción, la supuesta intersección con las entidades del usuario real no se está realizando correctamente.

Antes del cambio hay que comparar el hash/código desplegado. Si producción contiene esa misma lógica:

1. Obtener los `legal_entity_ids` del **usuario objetivo**.
2. Intersectarlos con `st.client_ids` cuando el ServiceToken tenga restricciones.
3. Añadir pruebas que demuestren que el token emitido nunca amplía tenants.

**No debe emitirse un token con `client_ids` amplios hasta confirmar este punto**, porque podría transferir las entidades del ServiceToken al JWT del usuario en lugar de aplicar una intersección real.

---

## 4. Plan operativo para producción

### Preparación sin interrupción

1. Alinear el compose a Authentik.
2. Guardar:
   - `docker inspect` de ContextForge.
   - Compose y env actuales.
   - Digest de la imagen.
   - Token anterior en un almacén seguro fuera de Git, solo para rollback.
3. Verificar la implementación desplegada de la intersección de tenants.
4. Emitir el ServiceToken de 30 días con `mcp:token_exchange`.
5. Probar en staging:
   - Usuario activo → JWT correcto.
   - Usuario inactivo → 403.
   - Token sin `mcp:token_exchange` → 403.
   - Token de exchange usado contra datos/escritura → 403 o resultado vacío.
6. Probar `SECURE_COOKIES=true` mediante OAuth completo.

### Ventana de mantenimiento

7. Avisar la interrupción breve de `mcp.mwt.one`.
8. Confirmar backend, proxy y Authentik saludables.
9. Configurar:

```dotenv
MWT_MCP_TOKEN=<TOKEN_OPACO_64_HEX>
LOG_LEVEL=INFO
MCPGATEWAY_ADMIN_API_ENABLED=false
SECURE_COOKIES=true
```

10. Recrear exclusivamente ContextForge:

```bash
docker compose up -d --no-deps --force-recreate mcp-gateway-contextforge
```

11. Esperar el healthcheck.
12. Verificar mediante `docker inspect` que:
    - El token ya no comienza con `eyJ`.
    - El log level es INFO.
    - La Admin API está deshabilitada.
    - Las cookies seguras están activas, si correspondía.

No reiniciar Authentik, backend, proxy ni otros servicios.

### Rollback

Si falla una prueba crítica:

1. Restaurar env y compose anteriores.
2. Recrear solamente ContextForge:
   ```bash
   docker compose up -d --no-deps --force-recreate mcp-gateway-contextforge
   ```
3. Confirmar healthcheck y OAuth.
4. No revocar el token anterior hasta completar satisfactoriamente la validación.

---

## 5. Verificación posterior

### Ausencia de escalada admin

1. `MWT_MCP_TOKEN` es un valor opaco de 64 caracteres hexadecimales, no un JWT.
2. Una llamada sin `X-Forwarded-User-*`:
   - No devuelve datos de negocio.
   - No permite escritura.
   - No aparece como admin.
3. Una identidad inexistente o inactiva no obtiene acceso mediante fallback.
4. Un ServiceToken sin `mcp:token_exchange` recibe 403 en el exchange.
5. La Admin API responde deshabilitada o 404.
6. Los logs operan en INFO/WARN y no muestran tokens ni headers completos.
7. La cookie OAuth lleva `Secure`, si se aplicó el cambio.

### Identidad real en `mcp_audit`

1. Ejecutar una tool con un usuario OAuth real.
2. Confirmar en logs el camino:
   ```text
   minted user token for '<email_real>'
   ```
   y no:
   ```text
   no identity, using service token
   ```
3. Verificar que el JWT emitido contiene:
   - `user_uuid` real.
   - `email` real.
   - `mcp=true`.
   - Módulos del rol.
   - `legal_entity_ids` correctamente intersectados.
4. Confirmar en `mcp_audit` que el actor es el email/UUID real, no `service:*` ni un admin genérico.
5. Repetir con dos usuarios y comprobar que el actor cambia.
6. Confirmar aislamiento entre clientes A y B.
7. Confirmar 403 para usuarios inactivos.

## Criterio de salida

- No existe JWT admin en ContextForge.
- Sin identidad, el sistema falla cerrado.
- Ningún fallback permite escritura o lectura cross-tenant.
- `mcp_audit` registra al usuario real.
- Gateway sin DEBUG ni Admin API.
- Compose y runtime están alineados a Authentik.
- Pocket-ID queda para una migración independiente.
