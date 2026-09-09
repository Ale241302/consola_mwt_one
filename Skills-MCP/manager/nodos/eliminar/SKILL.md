---
name: mwt-manager-nodos-eliminar
description: Rol Manager · módulo Nodos (nodos) · permiso eliminar (eliminar/borrar). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/nodos.md antes de actuar.
role: manager
module: nodos
action: delete
---

# mwt-manager-nodos-eliminar

> Skill MCP enfocado: **Manager** · **Nodos** · permiso **eliminar** (eliminar/borrar).

## Propósito
Operar el módulo **Nodos** (`nodos`) con la acción **eliminar** (eliminar/borrar) usando SOLO
las tools MCP que el rol **Manager** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Manager** → Orquesta expedientes y equipo. NO ve rentabilidad interna (finanzas/analytics de margen).

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


## Flujos del módulo

### Nodos y artefactos de envío
```
     nodo_listar → nodo_obtener(id)
     nodo_crear({tipo, nombre, pais_iso2, ...})
     nodo_artefacto_crear(nodo_id, {tipo:'AWB'|'BL', nombre, data}) [fuente de tracking/carrier/ETD/ETA]
     builder_templates_listar() / builder_template_obtener(id)
```
> Anti-patrones:
     - El artefacto de envío del nodo es la fuente de verdad de tracking/carrier.
     - expediente_envio_backfill lee ese artefacto (no inventes tracking a mano).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- El artefacto de envío del nodo es fuente de verdad de tracking/carrier/ETD/ETA.
- builder_template_* y artefacto_* caen en nodos.*.
- artefacto_publicar(publicado=True) hace visible el artefacto (tracking/packing list) al client_b2b.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.

## Visibilidad de documentos y artefactos (según rol)
- Dos capas distintas: **documentos** (`documento_*`: OC, PROFORMA, FACTURA, SAP) y **artefactos del Builder** (tracking/AWB, BL, Packing List, Factura Comercial, Certificado de Origen).
- `documento_listar` (ver-documento) SOLO trae DOCUMENTOS; NO incluye artefactos.
- El tracking/packing list/AWB/BL se consulta con `expediente_documentos_completos` (permiso **leer**), `nodo_artefactos_listar` o `inventario_artefactos_expediente`.
- Restricción de visibilidad: solo el rol `client_b2b` se filtra → ve documentos `audience=CLIENT` (kind OC/PROFORMA/FACTURA) y artefactos SOLO con `publicado=True`. Admin/CEO y roles internos (operator/manager/viewer/finance/compras) ven TODOS los artefactos.
- Para exponer un artefacto al cliente: `artefacto_publicar(nodo_id, artifact_id, publicado=True)` (nodos.update).

## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **eliminar** sobre **Nodos**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/nodos.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Nodos.jsx`
  - `frontend/src/pages/NodoDetail.jsx`
- Backend:
  - `backend/apps/nodos/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó eliminar/borrar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
