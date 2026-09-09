---
name: mwt-admin-transferencias-editar
description: Rol Admin (CEO) · módulo Transferencias (transferencias) · permiso editar (actualizar/modificar). Herramientas MCP: transferencia_avanzar, transferencia_aprobar, transferencia_despachar, transferencia_editar, transferencia_recibir, transferencia_conciliar, transferencia_cerrar, transferencia_cancelar, transfer_costo_editar, transfer_liquidar. Lee el contrato en _contratos/transferencias.md antes de actuar.
role: admin
module: transferencias
action: update
---

# mwt-admin-transferencias-editar

> Skill MCP enfocado: **Admin (CEO)** · **Transferencias** · permiso **editar** (actualizar/modificar).

## Propósito
Operar el módulo **Transferencias** (`transferencias`) con la acción **editar** (actualizar/modificar) usando SOLO
las tools MCP que el rol **Admin (CEO)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Admin (CEO)** → Acceso operativo y comercial total. Ve costos y márgenes (finanzas).

## Herramientas MCP para esta acción
  - `transferencia_avanzar` — Avanza el movimiento al siguiente estado legal (advance).
  - `transferencia_aprobar` — Aprueba el movimiento (PLANNED→APPROVED).
  - `transferencia_despachar`
  - `transferencia_editar`
  - `transferencia_recibir`
  - `transferencia_conciliar`
  - `transferencia_cerrar` — Cierra el movimiento (→CLOSED).
  - `transferencia_cancelar` — Cancela el movimiento (→CANCELLED, revierte efectos de inventario).
  - `transfer_costo_editar` — Edita una línea de costo del movimiento (PATCH parcial).
  - `transfer_liquidar` — El motor **excluye el IVA** del landed (crédito fiscal acreditable; va aparte en

## Firmas (cómo invocar)
  - `transferencia_avanzar` → `def transferencia_avanzar(transferencia_id: str, notes: str | None = None) -> Any:`
  - `transferencia_aprobar` → `def transferencia_aprobar(transferencia_id: str, notes: str | None = None) -> Any:`
  - `transferencia_despachar` → `def transferencia_despachar(transferencia_id: str, notes: str | None = None) -> Any:`
  - `transferencia_editar` → `def transferencia_editar(transferencia_id: str, cambios: dict) -> Any:`
  - `transferencia_recibir` → `def transferencia_recibir(transferencia_id: str, lineas: list, received_at: str | None = None, received_by_name: str | None = None) -> Any:`
  - `transferencia_conciliar` → `def transferencia_conciliar(transferencia_id: str, reconciled_by_id: str | None = None, reconciled_note: str | None = None, exception_document_id: str | None = None, gap_justification: str | None = None) -> Any:`
  - `transferencia_cerrar` → `def transferencia_cerrar(transferencia_id: str) -> Any:`
  - `transferencia_cancelar` → `def transferencia_cancelar(transferencia_id: str, notes: str | None = None) -> Any:`
  - `transfer_costo_editar` → `def transfer_costo_editar(transferencia_id: str, cost_id: str, cambios: dict) -> Any:`
  - `transfer_liquidar` → `def transfer_liquidar(transferencia_id: str, method: str = "BY_VALUE") -> Any:`


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
- El alcance de este skill es **editar** sobre **Transferencias**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/transferencias.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Transfers.jsx`
  - `frontend/src/pages/TransferDetail.jsx`
  - `frontend/src/pages/CreateTransferWizard.jsx`
- Backend:
  - `backend/apps/transfers/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó actualizar/modificar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
