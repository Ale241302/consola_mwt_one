---
name: mwt-viewer-marcas-descargar-documento
description: Rol Viewer (solo lectura) · módulo Marcas (marcas) · permiso descargar-documento (descargar un archivo/documento). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/marcas.md antes de actuar.
role: viewer
module: marcas
action: download_doc
---

# mwt-viewer-marcas-descargar-documento

> Skill MCP enfocado: **Viewer (solo lectura)** · **Marcas** · permiso **descargar-documento** (descargar un archivo/documento).

## Propósito
Operar el módulo **Marcas** (`marcas`) con la acción **descargar-documento** (descargar un archivo/documento) usando SOLO
las tools MCP que el rol **Viewer (solo lectura)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Viewer (solo lectura)** → Solo lectura (view/download_doc/view_doc) en todos sus módulos.

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


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
- El alcance de este skill es **descargar-documento** sobre **Marcas**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/marcas.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Brands.jsx`
  - `frontend/src/pages/BrandDetail.jsx`
  - `frontend/src/pages/BrandClientPricingForm.jsx`
- Backend:
  - `backend/apps/brands/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó descargar un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
