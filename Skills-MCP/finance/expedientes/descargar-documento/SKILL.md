---
name: mwt-finance-expedientes-descargar-documento
description: Rol Finance · módulo Expedientes (expedientes) · permiso descargar-documento (descargar un archivo/documento). Herramientas MCP: documento_descargar. Lee el contrato en _contratos/expedientes.md antes de actuar.
role: finance
module: expedientes
action: download_doc
---

# mwt-finance-expedientes-descargar-documento

> Skill MCP enfocado: **Finance** · **Expedientes** · permiso **descargar-documento** (descargar un archivo/documento).

## Propósito
Operar el módulo **Expedientes** (`expedientes`) con la acción **descargar-documento** (descargar un archivo/documento) usando SOLO
las tools MCP que el rol **Finance** tiene permitidas por RBAC.

## Antes de empezar
- `mwt_whoami` → confirma token/identidad y rol.
- `mwt_health` → si sospechás lentitud o token expirado.
- `mwt_diag_scope(email)` (CEO-only) → por qué un rol no ve una tool.

## Contexto del rol
- Rol: **Finance** → Cobros, pagos y conciliación. Ve límites de crédito. Escritura solo en pagos; resto lectura.

## Herramientas MCP para esta acción
  - `documento_descargar` — Requiere el `documento_id` y que el documento tenga `storage_url` (no esté roto).

## Firmas (cómo invocar)
  - `documento_descargar` → `def documento_descargar(documento_id: str, ttl_minutes: int | None = None) -> Any:`

## Referencia cruzada (dónde está la tool real)
- `documento_descargar` descarga DOCUMENTOS; el binario de un artefacto (tracking/packing list) se descarga con `artefacto_archivo_descargar` (`storage.download_doc`).

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
- El alcance de este skill es **descargar-documento** sobre **Expedientes**; para otra operación activá el SKILL.md correspondiente.
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
Cuando completes la operación, resume: qué recurso quedó descargar un archivo/documento (con su id/código), qué tools usaste, y el estado final. Corroborá con las tools de lectura del mismo módulo.
