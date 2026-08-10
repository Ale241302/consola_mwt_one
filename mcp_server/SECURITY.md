# MWT.ONE MCP — Guía de seguridad (SECURITY.md)

> Cómo se autentica el servidor MCP, qué protege cada capa, y qué hacer ante
> una fuga o incidente. Documento vivo: refleja las Olas 3.5–3.7 del plan de
> largo alcance (`plan_mcp_seguridad_largo_alcance.md`).

---

## 1. Modelo de amenazas

El MCP expone **datos reales de negocio** (costos, márgenes, comisiones,
crédito, precios MWT) a agentes de IA externos. La superficie de riesgo es alta:
una fuga no es un chart público, sino información comercial sensible.

Actores y capacidades que protegemos:

| Actor | Qué puede intentar | Mitigación |
|---|---|---|
| Usuario legítimo con rol restringido | Ver costos/margen vía tools permitidas | Redacción por rol (Ola 3.5) |
| Usuario dado de baja en la consola | Seguir operando con su token viejo | Fail-closed: identidad inválida → 401/lista vacía |
| Usuario de otro tenant | Ver datos de otra legal_entity | Scope por `legal_entity_ids` en el JWT + backend |
| Agente abusivo / rate | Enumerar datos o saturar | Throttle por usuario + paginación limitada |
| Token de servicio robado | Actuar como el MCP | Rotación + scopes mínimos + kill-switch readonly |

## 2. Autenticación (cómo se entra)

El MCP autentica contra la API REST de MWT.ONE con **una de dos** credenciales:

1. **ServiceToken** (`Authorization: ServiceToken <64-hex>`): acceso directo por
   stdio o registro del server. No representa a un usuario; tiene scopes
   (`mcp:*`, `mcp:token_exchange`). Solo se usa cuando NO hay identidad
   propagada.
2. **JWT de usuario** (Bearer, vía token exchange): cuando el MCP corre detrás
   del gateway (ContextForge → Authentik), los headers `X-Forwarded-User-*`
   propagan la identidad real. El MCP llama `POST /api/auth/mcp-token/` con el
   ServiceToken y el backend emite un JWT de **ese** usuario (1 h, cacheado 45
   min). El JWT hereda los `legal_entity_ids` del usuario **intersectados** con
   los del ServiceToken (nunca amplía tenants).

**Fail-closed (Ola 1/2):** si hay identidad propagada pero el backend no emite
JWT (usuario inactivo/borrado), el MCP devuelve 401 y `list_tools` devuelve
`[]` — **nunca** cae al token de servicio. Esto cierra la fuga "borro un
usuario y sigue entrando por el MCP".

## 3. Autorización (qué se puede hacer) — 3 capas

```
CAPA 1 · Lista de tools (tool_rbac.py)
   Filtra las 106 tools por (módulo, acción) de la matriz core.roles.permissions.
   Sin clientes.create → no se ve cliente_crear. Fail-closed si identidad inválida.

CAPA 2 · Redacción por rol en la respuesta (redact.py + _safe_role)
   Una tool permitida NO devuelve campos CEO_ONLY a roles no autorizados:
   costos, márgenes, comisiones, crédito, precio MWT → "***" (shape preservado).
   client_b2b además NO ve proveedores, PII ni decisión operativa interna.

CAPA 3 · Autorización en el backend (403)
   Si se fuerza una llamada, el backend niega (RoleBasedPermission + scope).
```

Catálogo CEO_ONLY alineado con `POL_VISIBILIDAD` del portal B2B
(`backend/apps/portal/serializers.py`). Roles con acceso total:
`superadmin`, `admin`, `ceo`.

## 4. Auditoría y observabilidad (Ola 3.6)

- Cada tool-call de escritura (`@write_tool`) y los **reads sensibles**
  (`SENSITIVE_READ_TOOLS`) persisten en `core.mcp_audit` vía
  `POST /api/auth/mcp-audit/` (best-effort, thread daemon, timeout 3s).
- La persistencia redacta PII y URLs firmadas (`_audit_sanitize`): nunca se
  guardan `file_path`, `storage_url`, `signed_url`, `tax_id`, `contact_email`,
  `phone`, `cedula`, tokens ni passwords.
- El log JSON a stderr también redacta esos campos.
- Retención: la tabla `mcp_audit` se limpia con `DELETE WHERE at_created <
  now() - interval '90 days'`.

## 5. Protección contra abuso (Ola 3.6)

Throttle por usuario en el backend (DRF):

| Scope | Rate | Endpoint |
|---|---|---|
| `mcp-token` | 6/min | token exchange |
| `mcp_audit` | 120/min | persistencia de auditoría |
| `mcp_diag` | 10/min | diagnóstico de scope |
| `mcp_health` | 30/min | estado DB/Redis |

Paginación acotada (`limit` ≤ 200) y proyección `campos` para reducir contexto
expuesto.

## 6. Datos sensibles que el MCP nunca debe devolver

Por diseño, los siguientes campos se oscurecen con `***` para roles
no-CEO/Admin (y proveedores/PII para client_b2b):

- **Costos:** `unit_cost`, `unit_cost_usd`, `cost_share_usd`, `landed_cost_usd`,
  `landed_unit_usd`, `landed_total_usd`, `total_cost`, `cost_breakdown`,
  `costo_estandar`, `costo_operativo`, `snapshot_unit_cost`.
- **Precio MWT:** `unit_price_mwt`, `unit_price` (legacy), `price_view`,
  `total_mwt`, `sobreprecio`, `diferencial`.
- **Rentabilidad:** `margen*`, `margin*`, `real_margin`, `projected_margin`,
  `margin_drift`.
- **Comisiones:** `comision_pct`, `commission_pct`, `commission_amount`,
  `commission_factor`, `commission_base`.
- **Crédito:** `credito_limit_usd`, `credito_aprobado`, `credito_usado*`,
  `credit_band`.
- **Proveedores/PII (client_b2b):** `supplier_id`, `proveedor_id`,
  `supplier_name`, `contact_email`, `phone`, `cedula`, `tax_id`, `ruc`, `cuit`.
- **Operativa interna (client_b2b):** `modo_operacion`, `freight_mode`,
  `dispatch_mode`, `price_basis`, `credit_days`, `is_blocked`, `phase_signal`,
  `factory_delay`, `available_transitions`.

## 7. Respuesta ante una fuga o incidente

### Sospecha de fuga de datos por el MCP
1. **No apagues el servidor a ciegas** — reduce el blast radius primero:
   `MWT_MCP_READONLY=1` (kill-switch) bloquea toda escritura sin derribar el
   proceso.
2. **Consulta la auditoría** para ver quién vio qué y cuándo:
   ```sql
   SELECT at_created, tool, event, identity_sub, ok
     FROM core.mcp_audit
    WHERE tool IN (SELECT unnest(ARRAY['expediente_obtener','expediente_lineas',
                   'transfer_costos_listar','transfer_liquidacion_preview']))
    ORDER BY at_created DESC LIMIT 100;
   ```
3. **Verifica el scope del usuario** con `mwt_diag_scope(email)` (CEO-only):
   ¿qué legal_entities ve, qué tools, qué le está permitido?
4. **Revisa `mwt_whoami`** del agente para confirmar el rol que se le propagó.

### Token de servicio comprometido
1. Revoca el token:
   `python manage.py revoke_service_token <id>` (en el contenedor django).
2. Rota el `MWT_MCP_TOKEN` en el `.env` del VPS y regenera uno con scopes
   mínimos:
   ```bash
   docker exec -i consola-mwt-one-django python manage.py mint_mcp_token \
     --name <nuevo> --scopes mcp:token_exchange --expires-days 30 --quiet
   ```
3. Verifica en `core.mcp_audit` si el token comprometido hizo algo sospechoso.

### JWT de usuario expirado / rol incorrecto
- El MCP cachea el perfil 5 min y el JWT 45 min. Si cambiaron permisos en la
  consola, el refresco es automático al re-mintear. Para forzar:
  reinicia el contenedor MCP (`docker restart consola-mwt-one-mcp`) o espera el
  TTL.

### Backend comprometido (responsabilidad compartida)
- El MCP delega la autoridad real al backend; el MCP solo **oculta/redacta**.
  Si el backend está comprometido, asume que el MCP no es la barrera final:
  rota `DJANGO_SECRET_KEY` y todos los tokens, y audita la matriz `/roles`.

## 8. Checklist de hardening (estado actual)

- [x] Token exchange OAuth→JWT con identidad real (fail-closed).
- [x] RBAC por rol en `list_tools` (106 tools mapeadas).
- [x] Redacción por rol en la respuesta (`redact.py` + `_safe_role`).
- [x] Auditoría durable `core.mcp_audit` (writes + reads sensibles).
- [x] Throttle por usuario (mcp-token/audit/diag/health).
- [x] `mwt_diag_scope` (CEO-only) para soporte.
- [x] Hints en errores (no filtran stack traces ni rutas internas).
- [ ] Docker: correr como usuario no-root (pendiente Ola 3.9).
- [ ] Rotación periódica de `MWT_MCP_TOKEN` documentada (operación recurrente).

## 9. Reportar un problema

Abre un issue en el repo (`Ale241302/consola_mwt_one`) con: tool afectada, rol,
payload de ejemplo (sin PII), y el `hint`/`detail` del error. Incluye el
timestamp y la fila de `core.mcp_audit` si aplica.
