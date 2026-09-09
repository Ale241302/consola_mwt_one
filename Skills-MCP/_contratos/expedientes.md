# Contrato · módulo `expedientes` — Expedientes

- **Categoría:** CORE
- **Descripción:** Núcleo operativo: expedientes, OCs, proformas, líneas, SAP, documentos, fusiones y estados.

## Frontend
- `frontend/src/pages/Expedientes.jsx`
- `frontend/src/pages/ExpedienteDetail.jsx`
- `frontend/src/pages/OCDetail.jsx`
- `frontend/src/pages/FusionDetail.jsx`
- `frontend/src/pages/CreateExpedienteWizardLite.jsx`

## Backend
- `backend/apps/expedientes/`

## Tools MCP (tool → acción RBAC)
  - `proforma_generar` — create
  - `expediente_resolve_oc_preview` — create
  - `expediente_crear` — create
  - `expedientes_crear_lote` — create
  - `sap_upsert` — create
  - `expediente_eliminar` — delete
  - `documento_eliminar` — delete
  - `documento_descargar` — download_doc
  - `oc_editar` — update
  - `lineas_actualizar_precios` — update
  - `expediente_apply_pronto_pago` — update
  - `expediente_editar` — update
  - `expediente_edit_full_patch` — update
  - `expediente_avanzar_estado` — update
  - `expediente_envio_backfill` — update
  - `expediente_phase_durations_set` — update
  - `expediente_fusionar` — update
  - `expediente_fusion_label` — update
  - `expediente_desfusionar` — update
  - `documento_editar` — update
  - `sap_confirmar` — update
  - `sap_editar` — update
  - `sap_sincronizar_discrepancias` — update
  - `match_resolver` — update
  - `documento_subir` — upload_doc
  - `match_subir` — upload_doc
  - `oc_listar` — view
  - `oc_obtener` — view
  - `proforma_html` — view
  - `proforma_documento` — view
  - `factura_payload` — view
  - `expediente_listar` — view
  - `expediente_obtener` — view
  - `expediente_buscar` — view
  - `expediente_lineas` — view
  - `expediente_documentos_completos` — view
  - `expediente_buscar_por_producto` — view
  - `expediente_edit_full_get` — view
  - `expediente_phase_durations_get` — view
  - `expediente_tiempos` — view
  - `expediente_eventos` — view
  - `sap_analizar` — view
  - `sap_obtener` — view
  - `documento_listar` — view_doc

## Flujos operativos

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


## Notas / anti-patrones
- Es el módulo con más tools MCP (expediente_*, oc_*, proforma_*, sap_*, match_*, documento_*).
- documento_subir/descargar/ver/listar se rigen por upload_doc/download_doc/view_doc.
- sap_confirmar por sku+size sin linea_id devuelve 400 (defecto 2 corregido).
- dispatch_mode solo FCL/LCL/CONSOLIDADO (defecto 1 corregido).
- El tracking/packing list/AWB/BL son ARTEFACTOS del Builder (no `documentos`): solo visibles al cliente si publicado=True (artefacto_publicar).

## Referencia completa de tools (docstrings)

### `proforma_generar` — create
`def proforma_generar(expediente_id: str, audience: str = "CLIENT", codigo: str | None = None, payment_days: int | None = None) -> Any:`

CLIENT / MWT_INTERNAL / ADMIN_ONLY. ⚠️ Usa las LÍNEAS ACTUALES del expediente: si lo llamas
ANTES de cargar líneas y precios sale en 0 pares / $0 — **carga las líneas primero**.
(Para que el listado muestre el número de proforma del cliente, sube además el archivo real

### `expediente_resolve_oc_preview` — create
`def expediente_resolve_oc_preview(client_id: str, lines: list) -> Any:`

`lines`: lista de {client_part_number?, sku?, size, qty}. Devuelve líneas con
producto_id, unit_price y needs_review. Aunque no persiste, ejecuta POST, así

### `expediente_crear` — create
`def expediente_crear( client_id: str, ocr_payload: dict | None = None, lines: list | None = None, operating_company_id: str | None = None, brand_id: str | None = None, forma_pago: str | None = None, credit_days_mwt: int | None = None, credit_days_cliente: int | None = None, mode: str | None = None, freight_mode: str | None = None, transport_mode: str | None = None, dispatch_mode: str | None = None, price_basis: str | None = None, po_number: str | None = None, moneda: str | None = None, idempotence_token: str | None = None, file_path: str | None = None, ) -> Any:`

- `client_id`: cliente final (UUID).
- `operating_company_id`: operador. Si lo opera Muito Work Limitada, pasa el
  UUID del cliente operador MWT; si lo opera el cliente, su propio UUID (o se omite).
- `ocr_payload`: dict con `lines`: [{sku, size, qty, unit_price?, producto_id?}].
  **También puedes pasar `lines=[...]` directo** (el MCP lo envuelve en ocr_payload.lines;
  el backend exige las líneas DENTRO de ocr_payload).
  Los precios se re-derivan server-side del motor de pricing.
- `forma_pago`: CREDITO o CONTADO. `credit_days_mwt`/`credit_days_cliente`: plazos duales.
- `mode` (COMISION/FULL), `freight_mode` (SEA/AIR), `dispatch_mode` (FCL/LCL/CONSOLIDADO): solo admin.
- `file_path`: RUTA LOCAL del PDF/XLSX de la OC. **Pásalo SIEMPRE**: create-from-oc
  siempre crea el documento OC, pero solo guarda el binario en MinIO si recibe el archivo;
  sin `file_path` el documento queda con storage_url=null ("sin archivo almacenado").

### `expedientes_crear_lote` — create
`def expedientes_crear_lote(items: list) -> Any:`

para cargas masivas sin un tool-call por expediente. `items`: lista de dicts con los
mismos parámetros que `expediente_crear` (client_id, ocr_payload|lines, operating_company_id,
po_number, brand_id, forma_pago, file_path, ...). Aplica las MISMAS validaciones (rechaza
"SIN-PO" y líneas dummy PENDING). Recomendado: lotes de 20-50. Devuelve

### `sap_upsert` — create
`def sap_upsert( expediente_id: str, sap_id: str, lineas_confirmadas: list, fecha_fabricacion: str | None = None, file_path: str | None = None, ) -> Any:`

(sin docstring)

### `expediente_eliminar` — delete
`def expediente_eliminar(expediente_id: str) -> Any:`

expediente activo de su OC, la OC también se borra. Úsalo para expedientes FANTASMA

### `documento_eliminar` — delete
`def documento_eliminar(documento_id: str) -> Any:`

(sin docstring)

### `documento_descargar` — download_doc
`def documento_descargar(documento_id: str, ttl_minutes: int | None = None) -> Any:`

Requiere el `documento_id` y que el documento tenga `storage_url` (no esté roto).
Llama a /storage/signed_url/ del backend, que aplica el scoping de visibilidad
del documento (expediente + audience) antes de firmar. Devuelve
`{url, key, method:"GET", expires_at, bucket, available}`. Si el documento no
tiene archivo (`storage_url` nulo/vacío) devuelve error claro — usa
`documento_subir` para almacenarlo primero.

### `oc_editar` — update
`def oc_editar(oc_id: str, cambios: dict) -> Any:`

brand_id, proforma (código limpio "2228-2026"), sap, display_label, proveedor_id,

### `lineas_actualizar_precios` — update
`def lineas_actualizar_precios(updates: list) -> Any:`

de la BD). `updates`: [{linea_id, unit_price_mwt, unit_price_client}].

### `expediente_apply_pronto_pago` — update
`def expediente_apply_pronto_pago(expediente_id: str, plazo_days: int, covered_pairs: list | None = None) -> Any:`

`plazo_days` ∈ {8,30,60,90,120}. `covered_pairs`: opcional, [{sku, size}] para acotar.

### `expediente_editar` — update
`def expediente_editar(expediente_id: str, cambios: dict) -> Any:`

para lo que `expediente_edit_full_patch` NO cubre: `brand_id` (UUID de `marca_listar`),
`modo_operacion` ("COMISION"|"FULL"), `freight_mode` ("SEA"|"AIR"), `dispatch_mode`
("FCL"|"LCL"|"CONSOLIDADO"), `incoterm`, `forma_pago` ("CREDITO"|"CONTADO"),
`operating_company_id`, `credit_days`/`credit_days_mwt`/`credit_days_cliente`, `moneda`.
(Para corregir la MARCA pon `brand_id` aquí Y en la OC con `oc_editar`. `transport_mode`

### `expediente_edit_full_patch` — update
`def expediente_edit_full_patch(expediente_id: str, cambios: dict) -> Any:`

operating_company_id, forma_pago, payment_days, client_id, lines_added [{producto_id,sku,talla,qty}],
lines_removed [linea_id], lines_updated [{id,qty}], split_line_ids, split_quantities.
⚠️ NO toca campos de cabecera como `brand_id`, `modo_operacion`, `incoterm`, `freight_mode`,

### `expediente_avanzar_estado` — update
`def expediente_avanzar_estado(expediente_id: str, fase_to: str, note: str | None = None, idempotence_token: str | None = None, documento_id: str | None = None, occurred_at: str | None = None) -> Any:`

PREPARACION, DESPACHO, TRANSITO, EN_DESTINO o CERRADO. Registra un evento inmutable.
`occurred_at`: ISO-8601 (YYYY-MM-DD o YYYY-MM-DDTHH:MM:SS) de la fecha-hora REAL

### `expediente_envio_backfill` — update
`def expediente_envio_backfill(expediente_id: str, tracking: str | None = None, carrier: str | None = None, etd: str | None = None, eta: str | None = None, origen: str | None = None, destino: str | None = None) -> Any:`

Actualiza el campo `field-XXXX` correspondiente (por etiqueta) en el `data`
del artefacto de envío del nodo del expediente: tracking, carrier, fecha de
despacho (etd), fecha de arrivo (eta), origen/destino. NO toca la cabecera

### `expediente_phase_durations_set` — update
`def expediente_phase_durations_set(expediente_id: str, phase_durations: dict) -> Any:`

(sin docstring)

### `expediente_fusionar` — update
`def expediente_fusionar(expediente_ids: list, label: str | None = None) -> Any:`

(sin docstring)

### `expediente_fusion_label` — update
`def expediente_fusion_label(fusion_id: str, label: str | None = None) -> Any:`

Cambia/borra la etiqueta de un grupo de fusión.

### `expediente_desfusionar` — update
`def expediente_desfusionar(fusion_id: str | None = None, expediente_ids: list | None = None) -> Any:`

Deshace una fusión por fusion_id o por lista de expediente_ids.

### `documento_editar` — update
`def documento_editar(documento_id: str, cambios: dict) -> Any:`

(sin docstring)

### `sap_confirmar` — update
`def sap_confirmar( expediente_id: str, sap_id: str, lineas_confirmadas: list, fecha_fabricacion: str | None = None, file_path: str | None = None, ) -> Any:`

transiciona REGISTRO→PRODUCCION. `lineas_confirmadas`: [{linea_id, qty_confirmada, unit_price?}].

### `sap_editar` — update
`def sap_editar(expediente_id: str, sap_id: str, cambios: dict) -> Any:`

(sin docstring)

### `sap_sincronizar_discrepancias` — update
`def sap_sincronizar_discrepancias(expediente_id: str, actions: list) -> Any:`

(sin docstring)

### `match_resolver` — update
`def match_resolver(expediente_id: str, log_id: str, actions: list, note: str | None = None) -> Any:`

(sin docstring)

### `documento_subir` — upload_doc
`def documento_subir( file_path: str | None = None, kind: str = "OTRO", codigo: str | None = None, expediente_id: str | None = None, oc_id: str | None = None, audience: str = "CLIENT", ) -> Any:`

tipo (OC, PROFORMA, BL, FACTURA, DUA, OTRO...). `codigo`: nombre/código (default =
nombre del archivo). `audience`: CLIENT, MWT_INTERNAL o ADMIN_ONLY.

NOTA DE ALMACENAMIENTO: para la **OC** y la **Proforma** del cliente conviene usar
`match_subir(document_type="ART-01_OC"|"ART-02_PROFORMA")` y para el **SAP**
`sap_confirmar`/`sap_upsert` con `file_path`, porque esos flujos dejan el binario
bien almacenado y, además, mapean/asignan líneas. Usa `documento_subir` para el resto
(BL/AWB, DUA, factura, otros). Verifica luego con `documento_listar`.

Requiere `expediente_id` u `oc_id` (sin ellos el documento queda huérfano y no aparece
en el expediente). Para `kind="OC"`, `codigo` = el **nº de PO real** de la OC (ej. "504990"),
NUNCA un número inventado ni el nombre del archivo. Para `kind="PROFORMA"`, `codigo` = número
limpio "####-####" (ej. "2453-2026"). Antes de subir un OC, borra el OC roto/fantasma previo

### `match_subir` — upload_doc
`def match_subir(expediente_id: str, document_type: str, file_path: str) -> Any:`

expediente, devolviendo discrepancias. `document_type`: ART-01_OC, ART-02_PROFORMA o ART-04_SAP.

### `oc_listar` — view
`def oc_listar( q: str | None = None, client: str | None = None, estado: str | None = None, credit_band: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`

`limit`/`offset`: paginación (default limit=50, máx 200).

### `oc_obtener` — view
`def oc_obtener(oc_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `proforma_html` — view
`def proforma_html(expediente_id: str, codigo: str | None = None) -> Any:`

Combina:
  1. El HTML renderizado (o el del documento PROFORMA guardado).
  2. La URL de descarga del documento PROFORMA EXISTENTE (si hay), para
     que el usuario pueda descargar/guardar el archivo (.html/.pdf) real.

Si el expediente ya tiene su proforma guardada (ej. "PF 2488-2026"),
`archivo_url` apunta al binario del documento (descarga directa). Si no
existe documento persistido, solo devuelve el HTML renderizado y el
usuario puede pedir `proforma_generar` para persistirlo.

### `proforma_documento` — view
`def proforma_documento( expediente_id: str, codigo: str | None = None, ttl_minutes: int | None = None, ) -> Any:`

Busca el documento kind=PROFORMA del expediente (para client_b2b solo
audience=CLIENT; admin/CEO cualquiera) y devuelve su URL firmada para
descargar el binario (HTML/PDF) tal como está guardado. Úsala cuando el
usuario pida "la proforma" de un expediente y ya exista una generada.

`expediente_id` acepta UUID, EXP-…, o referencia (OC/SAP/proforma).
Devuelve `{found, documento_id, kind, audience, codigo, file_ext,
url, expires_at}`. Si no hay documento PROFORMA → `{found:false}` y usa
`proforma_generar`/`proforma_html` para crear la proforma del sistema.

### `factura_payload` — view
`def factura_payload(expediente_id: str) -> Any:`

(sin docstring)

### `expediente_listar` — view
`def expediente_listar( oc: str | None = None, client: str | None = None, estado: str | None = None, phase_signal: str | None = None, q: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`

(REGISTRO/PRODUCCION/PREPARACION/DESPACHO/TRANSITO/EN_DESTINO/CERRADO), phase_signal, q.
`limit`/`offset`: paginación (default limit=50, máx 200).
`campos`: lista separada por comas (ej. "id,codigo,estado") para proyectar y ahorrar contexto

### `expediente_obtener` — view
`def expediente_obtener(expediente_id: str, campos: str | None = None) -> Any:`

estado, forma_pago, tiempos por fase (phase_durations_json), y la
información de ENVÍO (transport_mode, carrier, tracking, freight_mode,
dispatch_mode, consolidation) cuando existe. Úsala también cuando el
usuario pregunte '¿cómo se envía?', '¿cuál es el tracking?', '¿quién es
el transportista?' de un expediente.

### `expediente_buscar` — view
`def expediente_buscar( oc_number: str | None = None, proforma: str | None = None, sap: str | None = None, client_id: str | None = None, ) -> Any:`

Busca expedientes que YA existen por **número de OC del cliente** (ej. "504960"
o "PO 504960"), **número de proforma** (ej. "2468-2026") y/o **número de SAP**.
El `q` normal NO sirve: solo matchea el código autogenerado (EXP-…). Esta tool
compara contra `oc_codigos` / `proforma_codigos` / `sap_codigos` de cada expediente,
normalizando prefijos 'PO'/'OC' y separadores.

Recomendado pasar `client_id` para acotar la búsqueda. Devuelve
`{existe, total, matches:[{expediente_codigo, referencia_cliente, oc_codigos,
proforma_codigos, sap_codigos, estado, fusion_label, fusion_members}]}`.
Los UUIDs internos (id/expediente_id/oc_id/fusion_id) NUNCA se exponen;
para encadenar `expediente_obtener` usa `expediente_codigo` (EXP-…) que el

### `expediente_lineas` — view
`def expediente_lineas(expediente_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `expediente_documentos_completos` — view
`def expediente_documentos_completos( expediente_id: str, oc: str | None = None, q: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`

capa de `documentos` (OC, proformas, SAP, facturas) como la capa de
`artefactos` del Builder (BL/AWB, Packing List, Factura Comercial,
Certificado de Origen).

Úsala cuando el usuario pida 'documentos', 'el BL', 'conocimiento de
embarque', 'packing list', 'factura comercial', 'certificado de origen',
'proforma', 'OC' o cualquier documento/artefacto de un expediente — así
encuentra el documento esté en la capa que esté.

Devuelve `{documentos: [...], artefactos: [...]}`. `q` filtra por texto
(código/título). Para un client_b2b los documentos se limitan a audience=CLIENT

### `expediente_buscar_por_producto` — view
`def expediente_buscar_por_producto( q: str, limit: int | None = None, ) -> Any:`

alias o característica). Ej.: "60b29", "700728", "bota alta", "caucho".

Resuelve el producto y consulta `/api/lineas/?producto=...` (que ya aplica
el scope del usuario), devolviendo por cada expediente el producto con el
PRECIO DEL EXPEDIENTE (snapshot de la línea, no el del catálogo):
  · client_b2b  -> unit_price_client
  · admin/CEO   -> unit_price_client y unit_price_mwt
Devuelve `{expedientes:[{expediente_id, referencia, estado, sku, nombre,

### `expediente_edit_full_get` — view
`def expediente_edit_full_get(expediente_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `expediente_phase_durations_get` — view
`def expediente_phase_durations_get(expediente_id: str) -> Any:`

Lee las fechas/duraciones por fase del expediente.

### `expediente_tiempos` — view
`def expediente_tiempos(expediente_id: str | None = None, freight_mode: str | None = None) -> Any:`

Dos modos:
  · Sin `expediente_id`: promedios globales de días por fase (phase-stats),
    opcionalmente por método de envío (`freight_mode`: AIR|SEA). Para un
    client_b2b se filtra a sus empresas (scope); admin/CEO ve todo.
  · Con `expediente_id`: duraciones y fechas por fase de ESE expediente
    (timeline), incluyendo eventos y líneas con sus precios.

Úsala cuando el usuario pregunte "¿cuánto tarda la producción?", "tiempos

### `expediente_eventos` — view
`def expediente_eventos(expediente_id: str, limit: int = 200) -> Any:`

Historial de eventos (transiciones) del expediente.

### `sap_analizar` — view
`def sap_analizar(expediente_id: str, file_path: str) -> Any:`

(sin docstring)

### `sap_obtener` — view
`def sap_obtener(expediente_id: str, sap_id: str, campos: str | None = None) -> Any:`

(sin docstring)

### `documento_listar` — view_doc
`def documento_listar( expediente: str | None = None, oc: str | None = None, kind: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None, ) -> Any:`

Revisa `storage_url` y `file_size_bytes`: si `storage_url=null` o `file_size_bytes=0`
el documento NO tiene archivo (registro roto) → bórralo con `documento_eliminar` y re-súbelo.
`limit`/`offset`: paginación (default limit=50, máx 200).

