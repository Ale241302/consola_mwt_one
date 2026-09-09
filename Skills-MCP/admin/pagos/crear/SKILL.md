---
name: mwt-admin-pagos-crear
description: Rol Admin (CEO) · módulo Pagos (pagos) · permiso crear (crear). Herramientas MCP: pago_dry_run, pago_registrar. Lee el contrato en _contratos/pagos.md antes de actuar.
role: admin
module: pagos
action: create
---

# mwt-admin-pagos-crear

> Skill MCP enfocado: **Admin (CEO)** · **Pagos** · permiso **crear** (crear).

## Propósito
Operar el módulo **Pagos** (`pagos`) con la acción **crear** (crear) usando SOLO
las tools MCP que el rol **Admin (CEO)** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Admin (CEO)** → Acceso operativo y comercial total. Ve costos y márgenes (finanzas).

## Herramientas MCP para esta acción
  - `pago_dry_run` — `direction`: IN (entrante, cliente→MWT) u OUT (saliente, MWT→proveedor).
  - `pago_registrar` — NEEDS_REVIEW) y NO afecta saldos ni crédito hasta conciliar (ver pago_conciliar).

## Firmas (cómo invocar)
  - `pago_dry_run` → `def pago_dry_run(expediente_id: str, monto: float, direction: str, aplicaciones: list, counterparty_type: str | None = None, counterparty_id: str | None = None) -> Any:`
  - `pago_registrar` → `def pago_registrar( expediente_id: str, monto: float, moneda: str, fecha: str, metodo: str, tipo_pago: str, referencia: str, aplicaciones: list, notas: str | None = None, file_path: str | None = None, event_id: str | None = None, idempotency_key: str | None = None, ) -> Any:`


## Flujos del módulo

### Pagos (entrante/saliente)
```
     pago_applicables(expediente_id|client_id)
     pago_dry_run(...) [simular]
     pago_registrar({direction:'IN'|'OUT', monto, aplicaciones:[{applicable_type, applicable_id, monto_aplicado}]})
     pago_obtener(id) → pago_conciliar(id, bank_reference) [impacta saldo/crédito]
     pago_liberar_credito(id) / pago_rechazar(id, body)
```
> Anti-patrones:
     - Registrar un pago y no conciliarlo → no impacta saldos.
     - applicable_type debe ser COSTO|PRODUCTO|PROFORMA|FACTURA.


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- pago_registrar / pago_dry_run = pagos.create; pago_conciliar/rechazar/liberar = pagos.update.

## Errores comunes (cómo leerlos)
- 400 → payload inválido (campos/tipos en `detail`).
- 403 → rol sin permiso para esa tool/acción (matriz /roles).
- 404 → UUID mal o recurso fuera de scope.
- 409 → transición ilegal o duplicado.
- 429 → rate limit; esperá y reintentá.
- 500 → error interno; revisá logs de django.


## Restricciones (RBAC)
- Usa SOLO las tools listadas; cualquier otra tool de otro módulo/acción devuelve 403.
- El alcance de este skill es **crear** sobre **Pagos**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/pagos.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Pagos.jsx`
- Backend:
  - `backend/apps/finanzas/`
  - `backend/apps/finance/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó crear (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
