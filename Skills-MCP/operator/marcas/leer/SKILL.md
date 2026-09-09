---
name: mwt-operator-marcas-leer
description: Rol Operador · módulo Marcas (marcas) · permiso leer (consultar/listar). Herramientas MCP: marca_listar. Lee el contrato en _contratos/marcas.md antes de actuar.
role: operator
module: marcas
action: view
---

# mwt-operator-marcas-leer

> Skill MCP enfocado: **Operador** · **Marcas** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Marcas** (`marcas`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Operador** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Operador** → Gestión diaria de OCs, documentos y líneas. Sin finanzas; mayoría de módulos en lectura.

## Herramientas MCP para esta acción
  - `marca_listar`

## Firmas (cómo invocar)
  - `marca_listar` → `def marca_listar(q: str | None = None) -> Any:`


## Flujos del módulo

### Marcas
```
     marca_listar() → marca_id para productos/pricing
```
> Anti-patrones:
     - marca_listar es solo lectura (marcas.view).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- Tool marca_listar es de solo lectura (marcas.view).

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **leer** sobre **Marcas**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/marcas.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Brands.jsx`
  - `frontend/src/pages/BrandDetail.jsx`
  - `frontend/src/pages/BrandClientPricingForm.jsx`
- Backend:
  - `backend/apps/brands/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
