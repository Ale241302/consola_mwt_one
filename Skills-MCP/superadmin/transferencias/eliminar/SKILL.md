---
name: mwt-superadmin-transferencias-eliminar
description: Rol Super Admin · módulo Transferencias (transferencias) · permiso eliminar (eliminar/borrar). Herramientas MCP: transfer_costo_eliminar. Lee el contrato en _contratos/transferencias.md antes de actuar.
role: superadmin
module: transferencias
action: delete
---

# mwt-superadmin-transferencias-eliminar

> Skill MCP enfocado: **Super Admin** · **Transferencias** · permiso **eliminar** (eliminar/borrar).

## Propósito
Operar el módulo **Transferencias** (`transferencias`) con la acción **eliminar** (eliminar/borrar) usando SOLO
las tools MCP que el rol **Super Admin** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Super Admin** → Acceso total (incluye gobernanza y Kill-Switch). Ve finanzas, builder y roles.

## Herramientas MCP para esta acción
  - `transfer_costo_eliminar` — Elimina (soft) una línea de costo del movimiento.

## Firmas (cómo invocar)
  - `transfer_costo_eliminar` → `def transfer_costo_eliminar(transferencia_id: str, cost_id: str) -> Any:`


## Flujos del módulo

### Transferencias entre nodos
```
     transferencia_listar(origen, destino, estado) → transferencia_obtener(id)
     transferencia_crear({origen, destino, lineas:[{producto_id, size, qty}], ...})
     transferencia_aprobar(id) → transferencia_despachar(id) → transferencia_recibir(id, lineas)
     transferencia_conciliar(id) → transferencia_cerrar(id)
     transfer_notas_listar(id) / transfer_nota_crear(id, text)
```
> Anti-patrones:
     - Saltarse aprobar→despachar→recibir → 409 (transición ilegal).

### Costos y liquidación landed
```
     transfer_costos_listar(transferencia_id)
     transfer_costo_agregar(id, kind, amount, currency, fx_to_usd, scope_json={expediente_ids:[...]} o {lines:[...]})
     transfer_artefacto_crear(id, ...) [AWB/BL]
     transfer_liquidacion_preview(id) → transfer_liquidar(id, method='BY_VALUE')
     transfer_factura_payload(id)
```
> Anti-patrones:
     - El motor EXCLUYE el IVA del landed (va en summary.extra_costs_iva_usd).
     - scope_json: usa expediente_ids o lines, NO ambos a la vez.
     - transfer_costo_agregar usa `label` como parámetro nombrado.


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- transfer_liquidar EXCLUYE IVA del landed cost (P0 corregido).
- transfer_costo_* gestionan costos extra (DAI por NCM, etc.).

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **eliminar** sobre **Transferencias**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/transferencias.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Transfers.jsx`
  - `frontend/src/pages/TransferDetail.jsx`
  - `frontend/src/pages/CreateTransferWizard.jsx`
- Backend:
  - `backend/apps/transfers/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó eliminar/borrar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
