---
name: mwt-admin-storage-descargar-documento
description: Rol Admin (CEO) · módulo Storage (storage) · permiso descargar-documento (descargar un archivo/documento). Herramientas MCP: artefacto_archivo_descargar. Lee el contrato en _contratos/storage.md antes de actuar.
role: admin
module: storage
action: download_doc
---

# mwt-admin-storage-descargar-documento

> Skill MCP enfocado: **Admin (CEO)** · **Storage** · permiso **descargar-documento** (descargar un archivo/documento).

## Propósito
Operar el módulo **Storage** (`storage`) con la acción **descargar-documento** (descargar un archivo/documento) usando SOLO
las tools MCP que el rol **Admin (CEO)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Admin (CEO)** → Acceso operativo y comercial total. Ve costos y márgenes (finanzas).

## Herramientas MCP para esta acción
  - `artefacto_archivo_descargar` — Útil para los CAMBOS de archivo de un artefacto del Builder (AWB/BL, factura),

## Firmas (cómo invocar)
  - `artefacto_archivo_descargar` → `def artefacto_archivo_descargar(key: str, ttl_minutes: int | None = None) -> Any:`


## Flujos del módulo

### Storage (MinIO)
```
     storage_subir_archivo(...) → key MinIO
     artefacto_archivo_descargar(key) [URL firmada]
```
> Anti-patrones:
     - La key devuelta es la que persiste en storage_url del documento.


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- storage_subir_archivo (storage.create) devuelve la key MinIO.
- artefacto_archivo_descargar usa storage.download_doc.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **descargar-documento** sobre **Storage**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/storage.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/components/`
  - `frontend/src/pages/`
- Backend:
  - `backend/apps/storage/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó descargar un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
