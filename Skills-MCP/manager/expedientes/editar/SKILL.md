---
name: mwt-manager-expedientes-editar
description: Rol Manager · módulo Expedientes (expedientes) · permiso editar (actualizar/modificar). Herramientas MCP: oc_editar, lineas_actualizar_precios, expediente_apply_pronto_pago, expediente_editar, expediente_edit_full_patch, expediente_avanzar_estado, expediente_envio_backfill, expediente_phase_durations_set, expediente_fusionar, expediente_fusion_label, expediente_desfusionar, documento_editar, sap_confirmar, sap_editar, sap_sincronizar_discrepancias, match_resolver. Lee el contrato en _contratos/expedientes.md antes de actuar.
role: manager
module: expedientes
action: update
---

# mwt-manager-expedientes-editar

> Skill MCP enfocado: **Manager** · **Expedientes** · permiso **editar** (actualizar/modificar).

## Propósito
Operar el módulo **Expedientes** (`expedientes`) con la acción **editar** (actualizar/modificar) usando SOLO
las tools MCP que el rol **Manager** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Manager** → Orquesta expedientes y equipo. NO ve rentabilidad interna (finanzas/analytics de margen).

## Herramientas MCP para esta acción
  - `oc_editar` — brand_id, proforma (código limpio "2228-2026"), sap, display_label, proveedor_id,
  - `lineas_actualizar_precios` — de la BD). `updates`: [{linea_id, unit_price_mwt, unit_price_client}].
  - `expediente_apply_pronto_pago` — `plazo_days` ∈ {8,30,60,90,120}. `covered_pairs`: opcional, [{sku, size}] para acotar.
  - `expediente_editar` — para lo que `expediente_edit_full_patch` NO cubre: `brand_id` (UUID de `marca_listar`),
  - `expediente_edit_full_patch` — operating_company_id, forma_pago, payment_days, client_id, lines_added [{producto_id,sku,talla,qty}],
  - `expediente_avanzar_estado` — PREPARACION, DESPACHO, TRANSITO, EN_DESTINO o CERRADO. Registra un evento inmutable.
  - `expediente_envio_backfill` — Actualiza el campo `field-XXXX` correspondiente (por etiqueta) en el `data`
  - `expediente_phase_durations_set`
  - `expediente_fusionar`
  - `expediente_fusion_label` — Cambia/borra la etiqueta de un grupo de fusión.
  - `expediente_desfusionar` — Deshace una fusión por fusion_id o por lista de expediente_ids.
  - `documento_editar`
  - `sap_confirmar` — transiciona REGISTRO→PRODUCCION. `lineas_confirmadas`: [{linea_id, qty_confirmada, unit_price?}].
  - `sap_editar`
  - `sap_sincronizar_discrepancias`
  - `match_resolver`

## Firmas (cómo invocar)
  - `oc_editar` → `def oc_editar(oc_id: str, cambios: dict) -> Any:`
  - `lineas_actualizar_precios` → `def lineas_actualizar_precios(updates: list) -> Any:`
  - `expediente_apply_pronto_pago` → `def expediente_apply_pronto_pago(expediente_id: str, plazo_days: int, covered_pairs: list | None = None) -> Any:`
  - `expediente_editar` → `def expediente_editar(expediente_id: str, cambios: dict) -> Any:`
  - `expediente_edit_full_patch` → `def expediente_edit_full_patch(expediente_id: str, cambios: dict) -> Any:`
  - `expediente_avanzar_estado` → `def expediente_avanzar_estado(expediente_id: str, fase_to: str, note: str | None = None, idempotence_token: str | None = None, documento_id: str | None = None, occurred_at: str | None = None) -> Any:`
  - `expediente_envio_backfill` → `def expediente_envio_backfill(expediente_id: str, tracking: str | None = None, carrier: str | None = None, etd: str | None = None, eta: str | None = None, origen: str | None = None, destino: str | None = None) -> Any:`
  - `expediente_phase_durations_set` → `def expediente_phase_durations_set(expediente_id: str, phase_durations: dict) -> Any:`
  - `expediente_fusionar` → `def expediente_fusionar(expediente_ids: list, label: str | None = None) -> Any:`
  - `expediente_fusion_label` → `def expediente_fusion_label(fusion_id: str, label: str | None = None) -> Any:`
  - `expediente_desfusionar` → `def expediente_desfusionar(fusion_id: str | None = None, expediente_ids: list | None = None) -> Any:`
  - `documento_editar` → `def documento_editar(documento_id: str, cambios: dict) -> Any:`
  - `sap_confirmar` → `def sap_confirmar( expediente_id: str, sap_id: str, lineas_confirmadas: list, fecha_fabricacion: str | None = None, file_path: str | None = None, ) -> Any:`
  - `sap_editar` → `def sap_editar(expediente_id: str, sap_id: str, cambios: dict) -> Any:`
  - `sap_sincronizar_discrepancias` → `def sap_sincronizar_discrepancias(expediente_id: str, actions: list) -> Any:`
  - `match_resolver` → `def match_resolver(expediente_id: str, log_id: str, actions: list, note: str | None = None) -> Any:`


## Flujos del módulo

### Crear expediente desde OC (anti-duplicado)
```
     expediente_buscar(oc_number|proforma|sap)  ← SIEMPRE primero
     existe=true → expediente_obtener(match) y EDITAR (no crear)
     existe=false → expediente_resolve_oc_preview(client_id, lines)
     expediente_crear(client_id, ocr_payload={lines}, file_path='OC.pdf', operating_company_id, brand_id, forma_pago, credit_days_*, po_number)
     expediente_apply_pronto_pago(id, plazo_days) [si aplica]
     expediente_lineas(id) + lineas_actualizar_precios({linea_id, unit_price_mwt, unit_price_client})
```
> Anti-patrones:
     - expediente_crear sin file_path → OC sin binario.
     - po_number='SIN-PO' se ignora (omitir).
     - Duplicar expediente sin pasar por expediente_buscar.
     - dispatch_mode solo FCL/LCL/CONSOLIDADO.

### Documentos, SAP y proformas
```
     documento_subir(expediente_id, file_path, kind:'PROFORMA'|'OC'|'SAP', codigo)
     documento_listar(expediente_id) → documento_descargar(id) [URL firmada]
     sap_analizar(expediente_id, file_path) → sap_obtener → sap_confirmar (o match_subir → match_resolver)
     proforma_generar(expediente_id, audience='CLIENT') [DESPUÉS de cargar líneas]
     proforma_html(expediente_id, codigo) [previsualizar sin persistir]
```
> Anti-patrones:
     - sap_confirmar por sku+size sin linea_id → 400 (no transiciona en vacío).
     - sap_confirmar sin fecha_fabricacion real → rechazado.
     - Proforma antes de cargar líneas y precios → sale en 0 pares / $0.
     - Subir OC nuevo cuando ya hay un registro OC con oc_id → se anexa al existente.

### Fusionar y avanzar estados
```
     expediente_fusionar(expediente_ids=[...], label='SAP X + Y')
     expediente_avanzar_estado(expediente_id, action) [transición válida]
     expediente_phase_durations_set(id, phase_durations={...})
     expediente_eventos(id) [historial]
```
> Anti-patrones:
     - Saltarse transiciones ilegales → 409.
     - expediente_avanzar_estado con UUID abreviado → 404 (resuelve el id completo).


## Reglas transversales
- Anti-duplicados: `expediente_buscar` antes de `expediente_crear`.
- NUNCA inventes SKUs/tallas: vienen de producto_listar/tallas_listar.
- `campos` en tools de detalle/listado ahorra contexto.
- Leer con `_obtener`/`_listar`; escribir con `_crear`/`_editar`/`_avanzar`.

## Anti-patrones y notas del módulo
- Es el módulo con más tools MCP (expediente_*, oc_*, proforma_*, sap_*, match_*, documento_*).
- documento_subir/descargar/ver/listar se rigen por upload_doc/download_doc/view_doc.
- sap_confirmar por sku+size sin linea_id devuelve 400 (defecto 2 corregido).
- dispatch_mode solo FCL/LCL/CONSOLIDADO (defecto 1 corregido).
- El tracking/packing list/AWB/BL son ARTEFACTOS del Builder (no `documentos`): solo visibles al cliente si publicado=True (artefacto_publicar).

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
- El alcance de este skill es **editar** sobre **Expedientes**; para otra operación activá el SKILL.md correspondiente.
- Contrato completo: `_contratos/expedientes.md`.

## Frontend / Backend (referencia)
- Frontend:
  - `frontend/src/pages/Expedientes.jsx`
  - `frontend/src/pages/ExpedienteDetail.jsx`
  - `frontend/src/pages/OCDetail.jsx`
  - `frontend/src/pages/FusionDetail.jsx`
  - `frontend/src/pages/CreateExpedienteWizardLite.jsx`
- Backend:
  - `backend/apps/expedientes/`

## Entrega
Cuando completes la operación, resume: qué recurso quedó actualizar/modificar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
