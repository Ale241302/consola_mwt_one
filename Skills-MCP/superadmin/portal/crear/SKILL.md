---
name: mwt-superadmin-portal-crear
description: Rol Super Admin · módulo Portal (portal) · permiso crear (crear). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/portal.md antes de actuar.
role: superadmin
module: portal
action: create
---

# mwt-superadmin-portal-crear

> Skill MCP enfocado: **Super Admin** · **Portal** · permiso **crear** (crear).

## Propósito
Operar el módulo **Portal** (`portal`) con la acción **crear** (crear) usando SOLO
las tools MCP que el rol **Super Admin** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Super Admin** → Acceso total (incluye gobernanza y Kill-Switch). Ve finanzas, builder y roles.

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


## Flujos del módulo

### Portal B2B
```
     Listar catálogo/precios con scope a legal_entity_id del cliente.
     Descargar documentos del expediente con audience=CLIENT.
```
> Anti-patrones:
     - client_b2b SOLO ve audience=CLIENT y su tenant (R3).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- client_b2b tiene scope estricto a su legal_entity_id.
- El detalle de producto en portal filtra precios por rol.

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
- El alcance de este skill es **crear** sobre **Portal**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/portal.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Portal.jsx`
  - `frontend/src/pages/PortalProductDetail.jsx`
- Backend:
  - `backend/apps/portal/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó crear (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
