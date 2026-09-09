---
name: mwt-compras-pagos-descargar-documento
description: Rol Compras · módulo Pagos (pagos) · permiso descargar-documento (descargar un archivo/documento). Herramientas MCP: ninguna tool directa en esta acción. Lee el contrato en _contratos/pagos.md antes de actuar.
role: compras
module: pagos
action: download_doc
---

# mwt-compras-pagos-descargar-documento

> Skill MCP enfocado: **Compras** · **Pagos** · permiso **descargar-documento** (descargar un archivo/documento).

## Propósito
Operar el módulo **Pagos** (`pagos`) con la acción **descargar-documento** (descargar un archivo/documento) usando SOLO
las tools MCP que el rol **Compras** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Compras** → Proveedores + productos + marcas + sizing (create/update). Resto en lectura.

## Herramientas MCP para esta acción
  - (sin tools MCP directas en esta acción)

## Firmas (cómo invocar)
  - (sin tools en esta acción)


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
- El alcance de este skill es **descargar-documento** sobre **Pagos**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/pagos.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Pagos.jsx`
- Backend:
  - `backend/apps/finanzas/`
  - `backend/apps/finance/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó descargar un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
