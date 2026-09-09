---
name: mwt-superadmin-finanzas-leer
description: Rol Super Admin · módulo Finanzas (finanzas) · permiso leer (consultar/listar). Herramientas MCP: finanzas_overview, finanzas_comisiones, finanzas_commission_by_month, finanzas_margin_scatter, finanzas_cliente. Lee el contrato en _contratos/finanzas.md antes de actuar.
role: superadmin
module: finanzas
action: view
---

# mwt-superadmin-finanzas-leer

> Skill MCP enfocado: **Super Admin** · **Finanzas** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Finanzas** (`finanzas`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Super Admin** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Super Admin** → Acceso total (incluye gobernanza y Kill-Switch). Ve finanzas, builder y roles.

## Herramientas MCP para esta acción
  - `finanzas_overview` — Devuelve `kpis` (comision_total_devengable, comision_devengada, comision_pendiente,
  - `finanzas_comisiones` — `client_id`: UUID del cliente para filtrar (ej. SONEPAR).
  - `finanzas_commission_by_month` — Devuelve `results`: [{month, month_label, commission_usd, delta_total_usd,
  - `finanzas_margin_scatter` — Devuelve `points`: [{id, label (PF · Cliente), projected, real, value}].
  - `finanzas_cliente`

## Firmas (cómo invocar)
  - `finanzas_overview` → `def finanzas_overview() -> Any:`
  - `finanzas_comisiones` → `def finanzas_comisiones(client_id: str | None = None, estado_devengo: str | None = None) -> Any:`
  - `finanzas_commission_by_month` → `def finanzas_commission_by_month() -> Any:`
  - `finanzas_margin_scatter` → `def finanzas_margin_scatter() -> Any:`
  - `finanzas_cliente` → `def finanzas_cliente(client_id: str) -> Any:`


## Flujos del módulo

### Finanzas (solo lectura, CEO/Admin)
```
     finanzas_overview()
     finanzas_comisiones() / finanzas_commission_by_month()
     finanzas_margin_scatter() / finanzas_cliente(id)
```
> Anti-patrones:
     - Solo admin/superadmin ven finanzas.view (costos y márgenes).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- Solo admin/superadmin tienen finanzas.view (ver costos y márgenes).
- Tools finanzas_* son de solo lectura.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **Finanzas**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/finanzas.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Finanzas.jsx`
- Backend:
  - `backend/apps/finanzas/`
  - `backend/apps/finance/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
