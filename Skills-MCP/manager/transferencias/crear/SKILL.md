---
name: mwt-manager-transferencias-crear
description: Rol Manager · módulo Transferencias (transferencias) · permiso crear (crear). Herramientas MCP: transferencia_crear, transfer_artefacto_crear, transfer_nota_crear, transfer_costo_agregar. Lee el contrato en _contratos/transferencias.md antes de actuar.
role: manager
module: transferencias
action: create
---

# mwt-manager-transferencias-crear

> Skill MCP enfocado: **Manager** · **Transferencias** · permiso **crear** (crear).

## Propósito
Operar el módulo **Transferencias** (`transferencias`) con la acción **crear** (crear) usando SOLO
las tools MCP que el rol **Manager** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Manager** → Orquesta expedientes y equipo. NO ve rentabilidad interna (finanzas/analytics de margen).

## Herramientas MCP para esta acción
  - `transferencia_crear` — `legal_context`: INTERNAL/NATIONALIZATION/EXPORT/DISTRIBUTION/CONSIGNMENT.
  - `transfer_artefacto_crear` — Mismo formato de `data` (indexado por field.id; ver `nodo_artefacto_crear`),
  - `transfer_nota_crear` — Agrega una nota al movimiento.
  - `transfer_costo_agregar` — `kind`: DAI, IVA, ALMACENAJE, AGENCIAMIENTO, MANIPULEO, FLETE, SEGURO,

## Firmas (cómo invocar)
  - `transferencia_crear` → `def transferencia_crear( origen_id: str, destino_id: str, legal_context: str = "INTERNAL", lineas: list | None = None, cost_lines: list | None = None, ref_tracking: str | None = None, context_data: dict | None = None, notes: str | None = None, idempotency_key: str | None = None, ) -> Any:`
  - `transfer_artefacto_crear` → `def transfer_artefacto_crear(transferencia_id: str, template_id: int, template_title: str, data: dict, structure_snapshot: dict | None = None, lines: list | None = None) -> Any:`
  - `transfer_nota_crear` → `def transfer_nota_crear(transferencia_id: str, text: str, actor_name: str | None = None) -> Any:`
  - `transfer_costo_agregar` → `def transfer_costo_agregar( transferencia_id: str, kind: str, amount: float, label: str | None = None, currency: str = "USD", fx_to_usd: float = 1.0, price_view: str = "MWT", scope_json: dict | None = None, source: str = "MANUAL", document_id: str | None = None, notes: str | None = None, ) -> Any:`


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
- El alcance de este skill es **crear** sobre **Transferencias**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/transferencias.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Transfers.jsx`
  - `frontend/src/pages/TransferDetail.jsx`
  - `frontend/src/pages/CreateTransferWizard.jsx`
- Backend:
  - `backend/apps/transfers/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó crear (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
