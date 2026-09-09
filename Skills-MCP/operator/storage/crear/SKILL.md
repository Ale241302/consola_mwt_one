---
name: mwt-operator-storage-crear
description: Rol Operador · módulo Storage (storage) · permiso crear (crear). Herramientas MCP: storage_subir_archivo. Lee el contrato en _contratos/storage.md antes de actuar.
role: operator
module: storage
action: create
---

# mwt-operator-storage-crear

> Skill MCP enfocado: **Operador** · **Storage** · permiso **crear** (crear).

## Propósito
Operar el módulo **Storage** (`storage`) con la acción **crear** (crear) usando SOLO
las tools MCP que el rol **Operador** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Operador** → Gestión diaria de OCs, documentos y líneas. Sin finanzas; mayoría de módulos en lectura.

## Herramientas MCP para esta acción
  - `storage_subir_archivo` — Necesario para los CAMPOS DE ARCHIVO de un artefacto del Builder (AWB/BL pdf,

## Firmas (cómo invocar)
  - `storage_subir_archivo` → `def storage_subir_archivo(file_path: str, scope: str = "artifact-field/misc", filename: str | None = None) -> Any:`


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
- El alcance de este skill es **crear** sobre **Storage**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/storage.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/components/`
  - `frontend/src/pages/`
- Backend:
  - `backend/apps/storage/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó crear (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
