---
name: mwt-operator-expedientes-leer
description: Rol Operador · módulo Expedientes (expedientes) · permiso leer (consultar/listar). Herramientas MCP: oc_listar, oc_obtener, proforma_html, proforma_documento, factura_payload, expediente_listar, expediente_obtener, expediente_buscar, expediente_lineas, expediente_documentos_completos, expediente_buscar_por_producto, expediente_edit_full_get, expediente_phase_durations_get, expediente_tiempos, expediente_eventos, sap_analizar, sap_obtener. Lee el contrato en _contratos/expedientes.md antes de actuar.
role: operator
module: expedientes
action: view
---

# mwt-operator-expedientes-leer

> Skill MCP enfocado: **Operador** · **Expedientes** · permiso **leer** (consultar/listar).

## Propósito
Operar el módulo **Expedientes** (`expedientes`) con la acción **leer** (consultar/listar) usando SOLO
las tools MCP que el rol **Operador** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Operador** → Gestión diaria de OCs, documentos y líneas. Sin finanzas; mayoría de módulos en lectura.

## Herramientas MCP para esta acción
  - `oc_listar` — `limit`/`offset`: paginación (default limit=50, máx 200).
  - `oc_obtener`
  - `proforma_html` — Combina:
  - `proforma_documento` — Busca el documento kind=PROFORMA del expediente (para client_b2b solo
  - `factura_payload`
  - `expediente_listar` — (REGISTRO/PRODUCCION/PREPARACION/DESPACHO/TRANSITO/EN_DESTINO/CERRADO), phase_signal, q.
  - `expediente_obtener` — estado, forma_pago, tiempos por fase (phase_durations_json), y la
  - `expediente_buscar` — Busca expedientes que YA existen por **número de OC del cliente** (ej. "504960"
  - `expediente_lineas`
  - `expediente_documentos_completos` — capa de `documentos` (OC, proformas, SAP, facturas) como la capa de
  - `expediente_buscar_por_producto` — alias o característica). Ej.: "60b29", "700728", "bota alta", "caucho".
  - `expediente_edit_full_get`
  - `expediente_phase_durations_get` — Lee las fechas/duraciones por fase del expediente.
  - `expediente_tiempos` — Dos modos:
  - `expediente_eventos` — Historial de eventos (transiciones) del expediente.
  - `sap_analizar`
  - `sap_obtener`

## Firmas (cómo invocar)
  - `oc_listar` → `def oc_listar( q: str | None = None, client: str | None = None, estado: str | None = None, credit_band: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`
  - `oc_obtener` → `def oc_obtener(oc_id: str, campos: str | None = None) -> Any:`
  - `proforma_html` → `def proforma_html(expediente_id: str, codigo: str | None = None) -> Any:`
  - `proforma_documento` → `def proforma_documento( expediente_id: str, codigo: str | None = None, ttl_minutes: int | None = None, ) -> Any:`
  - `factura_payload` → `def factura_payload(expediente_id: str) -> Any:`
  - `expediente_listar` → `def expediente_listar( oc: str | None = None, client: str | None = None, estado: str | None = None, phase_signal: str | None = None, q: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`
  - `expediente_obtener` → `def expediente_obtener(expediente_id: str, campos: str | None = None) -> Any:`
  - `expediente_buscar` → `def expediente_buscar( oc_number: str | None = None, proforma: str | None = None, sap: str | None = None, client_id: str | None = None, ) -> Any:`
  - `expediente_lineas` → `def expediente_lineas(expediente_id: str, campos: str | None = None) -> Any:`
  - `expediente_documentos_completos` → `def expediente_documentos_completos( expediente_id: str, oc: str | None = None, q: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`
  - `expediente_buscar_por_producto` → `def expediente_buscar_por_producto( q: str, limit: int | None = None, ) -> Any:`
  - `expediente_edit_full_get` → `def expediente_edit_full_get(expediente_id: str, campos: str | None = None) -> Any:`
  - `expediente_phase_durations_get` → `def expediente_phase_durations_get(expediente_id: str) -> Any:`
  - `expediente_tiempos` → `def expediente_tiempos(expediente_id: str | None = None, freight_mode: str | None = None) -> Any:`
  - `expediente_eventos` → `def expediente_eventos(expediente_id: str, limit: int = 200) -> Any:`
  - `sap_analizar` → `def sap_analizar(expediente_id: str, file_path: str) -> Any:`
  - `sap_obtener` → `def sap_obtener(expediente_id: str, sap_id: str, campos: str | None = None) -> Any:`


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
- El alcance de este skill es **leer** sobre **Expedientes**; para otra operación activá el SKILL.md correspondiente.
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
Cuando completes la operación, resume: qué recurso quedó consultar/listar (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
