---
name: mwt-finance-inventario-descargar-documento
description: Rol Finance · módulo Inventario (inventario) · permiso descargar-documento (descargar un archivo/documento). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/inventario.md antes de actuar.
role: finance
module: inventario
action: download_doc
---

# mwt-finance-inventario-descargar-documento

> Skill MCP enfocado: **Finance** · **Inventario** · permiso **descargar-documento** (descargar un archivo/documento).

## Propósito
Operar el módulo **Inventario** (`inventario`) con la acción **descargar-documento** (descargar un archivo/documento) usando SOLO
las tools MCP que el rol **Finance** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Finance** → Cobros, pagos y conciliación. Ve límites de crédito. Escritura solo en pagos; resto lectura.

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


## Flujos del módulo

### Recepción e inventario
```
     nodo_listar → nodo_obtener(id) [destino]
     recepcion_crear(expediente_id, nodo_id, lines=[{producto_id, size, qty, unit_cost_usd}], cost_lines=[{kind, amount, currency, fx_to_usd}])
     stock_listar(nodo, producto) [verificar saldos]
     inventario_saldos_por_expediente(expediente_ids=[...])
     inventario_transferir_asignaciones(...) [reasignar]
```
> Anti-patrones:
     - Recepción con unit_cost_usd=0 en líneas CERRADAS → rechazado.
     - kind de costo DEBE estar en el catálogo válido.
     - El nodo_id vive DENTRO de cada item de lines (no como arg suelto).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- recepcion_crear (inventario.create) confirma líneas con nodo_id dentro de cada item.
- stock_listar / inventario_* son de consulta (inventario.view).

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
- El alcance de este skill es **descargar-documento** sobre **Inventario**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/inventario.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Inventario.jsx`
  - `frontend/src/pages/InboundReceptionWizard.jsx`
  - `frontend/src/components/inventario/`
- Backend:
  - `backend/apps/inventario/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó descargar un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
