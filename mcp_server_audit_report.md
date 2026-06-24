# Auditoría MCP Server — Flujo Sondel Costa Rica 2026

**Fecha de auditoría:** 2026-06-24  
**Archivos auditados:**
- [server.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/server.py)
- [client.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/client.py)
- Referencia funcional: [solucion_puntos_pendientes_costa_rica_sondel.md](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/solucion_puntos_pendientes_costa_rica_sondel.md)

---

## 1. Resumen ejecutivo

**Veredicto:** ✅ **Cobertura 100% de la parte de plataforma del flujo end-to-end de Sondel Costa Rica** descrito en [solucion_puntos_pendientes_costa_rica_sondel.md](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/solucion_puntos_pendientes_costa_rica_sondel.md).

La auditoría estática del archivo [server.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/server.py) identifica **98 herramientas MCP expuestas** mediante el decorador `@mcp.tool()`. Todas las herramientas requeridas por el checklist y por el "Mapa Flujo → Herramienta MCP" del documento de Sondel están implementadas en el servidor MCP. No existe ninguna brecha de herramientas que bloquee la ejecución del flujo:
- Gestión de clientes y marcas.
- Creación de expedientes/OC y SKUs con tallas.
- Edición de líneas y soporte de **precios duales** (`unit_price_mwt` y `unit_price_client`).
- Carga de documentos, generación de proformas del sistema y procesamiento de datos SAP.
- Transiciones de estado con fechas de inicio/fin.
- Creación de nodos (Barco vs. Avión) y flujos de recepción/movimiento de mercancías.
- Liquidación de costos arancelarios/DUA de Costa Rica y asignación de artefactos.
- Fusión de expedientes con la misma OC compartida.

**Matiz operativo importante:**
La cobertura es 100% en lo que respecta a las acciones de la **plataforma Consola MWT.ONE**. Como está estipulado en las responsabilidades del agente, las tareas locales (como leer OneDrive, conectarse por IMAP a correos con reconexiones cada 2 minutos, realizar OCR/parseo de PDFs o archivos Excel de SAP/DUA locales, y enviar emails de resumen) quedan fuera del MCP por diseño y son ejecutadas por la lógica local del agente. El MCP es la interfaz de persistencia y procesamiento en la nube.

---

## 2. Metodología

1. **Análisis Funcional:** Se extrajeron los requisitos específicos del flujo de Sondel Costa Rica a partir de la documentación proporcionada en [solucion_puntos_pendientes_costa_rica_sondel.md](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/solucion_puntos_pendientes_costa_rica_sondel.md).
2. **Auditoría Estática:** Se analizó el archivo [server.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/server.py) buscando y extrayendo programáticamente todas las definiciones decoradas con `@mcp.tool()`.
3. **Mapeo de Herramientas:** Se emparejó cada paso del flujo con las herramientas MCP disponibles para confirmar que no hubiera brechas.
4. **Inspección del Cliente HTTP:** Se analizó [client.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/client.py) para validar la robustez en la comunicación (métodos HTTP, envío multipart para archivos de MinIO, autenticación Bearer y formato seguro de errores).

---

## 3. Inventario y Categorización de Herramientas (98 en Total)

El servidor MCP está altamente modularizado y expone las siguientes herramientas:

| Área Funcional | Herramientas Principales | Estado | Descripción |
|---|---|---|---|
| **Salud / Sesión** | `mwt_whoami` | ✅ Cubierto | Verifica la validez del token JWT y el rol del usuario (`admin`). |
| **Clientes** | `cliente_listar`, `cliente_obtener`, `cliente_crear`, `cliente_editar`, `cliente_subsidiarias`, `cliente_kpis_pool` | ✅ Cubierto | Gestión completa del catálogo de clientes y límites de crédito. |
| **Catálogo Productos** | `producto_listar`, `producto_obtener`, `producto_crear`, `producto_editar`, `ncm_listar`, `tallas_listar`, `producto_alias_crear` | ✅ Cubierto | Consulta y registro de productos, tallas UUID, códigos NCM y alias de part numbers. |
| **Órdenes de Compra (OC)** | `oc_listar`, `oc_obtener`, `oc_editar` | ✅ Cubierto | Manipulación y actualización de datos específicos de la OC del cliente. |
| **Marcas** | `marca_listar` | ✅ Cubierto | Obtención de marcas (ej. Marluvas). |
| **Expedientes / Dossiers** | `expediente_listar`, `expediente_obtener`, `expediente_buscar`, `expediente_lineas`, `expediente_resolve_oc_preview`, `expediente_crear`, `expedientes_crear_lote`, `expediente_editar`, `expediente_eliminar`, `expediente_edit_full_get`, `expediente_edit_full_patch`, `expediente_apply_pronto_pago` | ✅ Cubierto | Ciclo de vida completo del expediente de importación y sus líneas asociadas. |
| **Precios / Líneas** | `lineas_actualizar_precios` | ✅ Cubierto | Configuración de precios duales (FOB MWT vs. Cliente). |
| **Documentos** | `documento_subir`, `documento_listar`, `documento_eliminar`, `documento_editar` | ✅ Cubierto | Asociación de PDFs, imágenes y excels con storage en la nube (MinIO). |
| **SAP & Matchmaker** | `sap_analizar`, `sap_confirmar`, `sap_upsert`, `sap_obtener`, `sap_editar`, `sap_sincronizar_discrepancias`, `match_subir`, `match_resolver` | ✅ Cubierto | Interfaz para analizar excels de SAP y conciliar SKU/tallas discrepantes. |
| **Estados / Fechas** | `expediente_avanzar_estado`, `expediente_phase_durations_get`, `expediente_phase_durations_set`, `expediente_eventos` | ✅ Cubierto | Transiciones de estado y duraciones de fase a partir del hilo de correos. |
| **Fusión de Expedientes** | `expediente_fusionar`, `expediente_fusion_label`, `expediente_desfusionar` | ✅ Cubierto | Combinación de expedientes para OCs compartidas (Sondel + Muito Work). |
| **Proformas / Facturación** | `proforma_generar`, `proforma_html`, `factura_payload` | ✅ Cubierto | Generación de PDFs de proforma y payload para factura/remisión. |
| **Nodos (Almacenes)** | `nodo_listar`, `nodo_obtener`, `nodo_crear`, `nodo_editar`, `nodo_artefactos_listar`, `nodo_artefacto_crear` | ✅ Cubierto | Creación y administración de hubs (Marítimo, Aéreo y Bodega Destino). |
| **Inventario / Recepción** | `stock_listar`, `inventario_saldos_por_expediente`, `inventario_expedientes_con_pendiente`, `inventario_lineas_en_nodo`, `recepcion_crear`, `inventario_transferir_asignaciones`, `inventario_artefactos_expediente` | ✅ Cubierto | Control de stock físico en hubs y recepción de líneas asignadas. |
| **Movimientos (Transfers)**| `transferencia_listar`, `transferencia_obtener`, `transferencia_crear`, `transferencia_avanzar`, `transferencia_aprobar`, `transferencia_despachar`, `transferencia_editar`, `transferencia_recibir`, `transferencia_conciliar`, `transferencia_cerrar`, `transferencia_cancelar` | ✅ Cubierto | Control de tránsito nacional e internacional entre hubs y bodegas. |
| **Costos de Movimiento** | `transfer_costos_listar`, `transfer_costo_agregar`, `transfer_costo_editar`, `transfer_costo_eliminar` | ✅ Cubierto | Inyección de fletes, seguros y los aranceles/tasas DUA específicos de CR. |
| **Liquidación Landed Cost**| `transfer_liquidacion_preview`, `transfer_liquidar`, `transfer_factura_payload`, `transfer_notas_listar`, `transfer_nota_crear` | ✅ Cubierto | Cálculo CIF, Landed cost total y desglose por par/SKU. |
| **Storage / Binarios** | `storage_subir_archivo` | ✅ Cubierto | Proxy para subida multipart directa a MinIO. |
| **Builder / Artefactos** | `builder_templates_listar`, `builder_template_obtener`, `transfer_artefacto_crear` | ✅ Cubierto | Creación de artefactos de documentos oficiales basados en plantillas (AWB/BL, Factura Comercial, Packing, etc.). |
| **Pagos (Finanzas)** | `pago_applicables`, `pago_listar`, `pago_obtener`, `pago_dry_run`, `pago_registrar`, `pago_conciliar`, `pago_liberar_credito`, `pago_rechazar` | ✅ Cubierto | (Opcional) Registro y aplicación de flujos financieros en el expediente. |

---

## 4. Mapeo Detallado del Flujo de Sondel Costa Rica

| Paso del Flujo (Sondel) | Herramientas MCP Requeridas | ¿Cubierto? | Notas de Implementación de server.py |
|---|---|---|---|
| **Conectar / Verificar sesión** | `mwt_whoami` | **Sí** | Llama a `/api/auth/me/` para verificar credenciales y rol `admin`. |
| **Localizar / Crear expediente** | `expediente_buscar`, `expediente_crear`, `expedientes_crear_lote` | **Sí** | Permite buscar OCs/proformas pre-existentes o crearlas sin usar dummies. |
| **Cliente Sondel / Operador** | `cliente_listar`, `cliente_crear`, `expediente_editar` (operating_company_id), `oc_editar` | **Sí** | Soporta parametrización del cliente final y la empresa operadora. |
| **Marca Marluvas / Modo** | `marca_listar`, `expediente_editar` (brand_id, modo_operacion), `oc_editar` | **Sí** | Modifica metadatos en expediente y OC para alinearlo con la marca. |
| **Códigos limpios** | `oc_editar` (codigo, proforma), `expediente_editar` | **Sí** | Modifica los códigos removiendo prefijos o nombres de archivos. |
| **Match Part Nº → Producto** | `expediente_resolve_oc_preview`, `producto_listar`, `producto_alias_crear` | **Sí** | Resuelve aliases a nivel de servidor y permite registrar alias nuevos. |
| **Crear SKU con tallas** | `tallas_listar`, `producto_crear`, `ncm_listar` | **Sí** | Recupera UUIDs de tallas arancelarias y crea productos vinculando NCM. |
| **Líneas por SKU×talla** | `expediente_edit_full_patch` (lines_added/lines_removed), `expediente_lineas` | **Sí** | Edición en bloque de líneas eliminando placeholders temporales. |
| **Precios duales** | `lineas_actualizar_precios` | **Sí** | Inyecta en masa `unit_price_mwt` (proforma) y `unit_price_client` (OC). |
| **Subir / Borrar OC rota** | `documento_subir`, `documento_eliminar`, `documento_listar` | **Sí** | Control de adjuntos vinculados con su respectivo tipo de archivo. |
| **Generar proforma sistema** | `proforma_generar` | **Sí** | Dispara `/api/expedientes/{id}/generate_proforma/` para consolidar líneas. |
| **Subir Excel SAP + Asignar** | `sap_analizar`, `sap_confirmar`, `sap_upsert`, `sap_obtener` | **Sí** | Envía el excel para asignación automática del número SAP a los productos. |
| **Estados + Duraciones** | `expediente_avanzar_estado`, `expediente_phase_durations_set`, `expediente_phase_durations_get`, `expediente_eventos` | **Sí** | Configura tiempos de cada fase recuperados del hilo de correos. |
| **Crear nodos Barco/Avión** | `nodo_listar`, `nodo_crear`, `nodo_editar` | **Sí** | Permite crear almacenes de tránsito marítimos, aéreos y de destino. |
| **Recepción de inventario** | `recepcion_crear` | **Sí** | Registra entradas al stock del Hub de tránsito correspondiente. |
| **Movimiento nodo→nodo** | `transferencia_crear`, `transferencia_aprobar`/`despachar`/`recibir`/`conciliar`, `inventario_transferir_asignaciones` | **Sí** | Coordina el movimiento de stock desde el Hub CR hasta la bodega de Sondel S.A. |
| **Costos / Impuestos DUA** | `transfer_costo_agregar`, `transfer_liquidar`, `transfer_factura_payload` | **Sí** | Agrega costos arancelarios (DAI, Ley 6946, IVA, PROCOMER, timbres) y costos locales (transporte, agente aduanal) para liquidar Landed Cost. |
| **Artefactos (Factura/AWB/BL)** | `builder_templates_listar`, `builder_template_obtener`, `storage_subir_archivo`, `transfer_artefacto_crear`, `nodo_artefacto_crear` | **Sí** | Sube binarios a MinIO y crea artefactos del Builder asignando sus URLs. |
| **Fusión OC compartida** | `expediente_fusionar`, `expediente_fusion_label` | **Sí** | Fusiona expedientes de Sondel + Muito Work compartiendo la OC. |
| **Auditoría (Re-verificar)** | `expediente_obtener`, `producto_obtener`, `expediente_lineas`, `documento_listar`, `sap_obtener`, `stock_listar`, `transferencia_obtener`, `transfer_costos_listar` | **Sí** | Lee los datos persistidos para realizar la verificación en el Gate final. |
| **Pagos (Finanzas)** | `pago_applicables`, `pago_registrar`, `pago_conciliar` | **Sí** | Permite conciliar pagos entrantes o salientes opcionalmente. |

---

## 5. Análisis del Cliente HTTP ([client.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/client.py))

La comunicación entre el servidor MCP y la API de la Consola MWT.ONE está excelentemente estructurada en [client.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/client.py):
- **Seguridad en Autenticación:** Se inyecta la cabecera `Authorization: Bearer <token>` dinámicamente llamando a `settings.require_token()`, lo que asegura el uso de tokens válidos.
- **Limpieza de Parámetros:** La función helper `_clean(obj)` remueve de forma automática las claves que tengan valores `None` de los diccionarios, previniendo discrepancias con el backend de Django, que interpreta de forma diferente claves ausentes de claves explícitas con valor `null`.
- **Transmisión de Archivos (Multipart):** La función `post_multipart` es clave para la subida de adjuntos (OC, DUA, Facturas) a MinIO; serializa campos complejos (dicts/lists) a JSON string y abre el binario de forma segura antes de la transmisión HTTPX.
- **Tratamiento de Errores Normalizado:** En lugar de dejar propagar excepciones crudas de red al agente MCP, el cliente captura respuestas `>= 400` y las traduce a la excepción personalizada `MwtApiError` para que las herramientas MCP las capturen mediante la función envolvente `_safe(call)` en [server.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/server.py). Así, el agente siempre recibe un JSON formateado indicando el error.

---

## 6. Observaciones de Seguridad e Integración Externa

1. ⚠️ **Seguridad - Secreto expuesto en la documentación:**
   El archivo [solucion_puntos_pendientes_costa_rica_sondel.md](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/solucion_puntos_pendientes_costa_rica_sondel.md) contiene un token JWT real de producción (`MWT_MCP_TOKEN`) hardcodeado en la sección §0.2. Este token otorga permisos de `admin` sobre consola.mwt.one.
   - **Recomendación crítica:** Se debe rotar ese token de inmediato en la base de datos de producción y reemplazarlo en el archivo de documentación por un placeholder o variable de entorno (ej. `$MWT_MCP_TOKEN`).
   
2. **Dependencias del Tipo de Cambio (TC):**
   El cálculo del landed cost requiere la inyección del tipo de cambio del Colón costarricense frente al Dólar (₡/USD) en la propiedad `fx_to_usd` al usar `transfer_costo_agregar`. El servidor MCP no realiza peticiones automáticas a servicios de divisas (como `open.er-api.com`). Es responsabilidad de la lógica local del agente consultar el TC del día y pasarlo como argumento del parámetro `fx_to_usd` a las herramientas MCP.

3. **Limitación de validación dinámica local:**
   Dado que el paquete `mcp` no está instalado en el entorno Python local por defecto, no es posible ejecutar dinámicamente `asyncio.run(mcp.list_tools())` sin instalar antes las dependencias indicadas en [solucion_puntos_pendientes_costa_rica_sondel.md](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/solucion_puntos_pendientes_costa_rica_sondel.md) (§0.1). Sin embargo, el análisis estático confirma la declaración correcta y completa de las 98 herramientas.

---

## 7. Auditoría adicional del prompt Sondel Costa Rica 2026 contra el MCP actual de 99 herramientas

**Fecha de ampliación:** 2026-06-24  
**Archivo auditado:** [solucion_puntos_pendientes_costa_rica_sondel.md](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/solucion_puntos_pendientes_costa_rica_sondel.md)  
**Archivos de contraste técnico:** [server.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/server.py), [client.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/mcp_server/mwt_mcp/client.py), endpoints de tipo de cambio en [commercial/urls.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/backend/apps/commercial/urls.py) y [commercial/views.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/backend/apps/commercial/views.py), motor de liquidación en [transfers/liquidation.py](file:///c:/Users/ale13/OneDrive/Documents/consola_mwt_one/backend/apps/transfers/liquidation.py).

### 7.1 Veredicto actualizado

El flujo descrito en `solucion_puntos_pendientes_costa_rica_sondel.md` es **mayoritariamente válido y ejecutable** con el MCP actual: el apéndice del prompt menciona herramientas que existen en el servidor, y la nueva herramienta `tipo_cambio` está contemplada en el documento para `usd-crc` y `usd-brl`. La conclusión de cobertura funcional se mantiene: no hay una brecha de herramienta MCP que impida crear/completar expedientes, cargar documentos, confirmar SAP, mover inventario, agregar costos, liquidar y fusionar expedientes.

No obstante, esta ampliación **corrige y matiza** el inventario anterior: el `server.py` actual contiene **100 decoradores `@mcp.tool()` pero 99 nombres únicos de herramienta**, porque `tipo_cambio` está definida dos veces. Por tanto, cualquier mención previa a “98 herramientas” queda obsoleta para el estado actual del repositorio.

### 7.2 Coherencia con las 99 herramientas MCP

| Control | Resultado |
|---|---|
| Conteo estático de herramientas únicas | ✅ 99 nombres únicos |
| Decoradores `@mcp.tool()` detectados | ⚠️ 100 decoradores por duplicidad de `tipo_cambio` |
| Herramientas del apéndice del prompt | ✅ Todas existen en el set de herramientas actual |
| `tipo_cambio("usd-crc")` | ✅ Existe y apunta a `/api/commercial/exchange-rate/usd-crc/` |
| `tipo_cambio("usd-brl")` | ✅ Existe y apunta a `/api/commercial/exchange-rate/usd-brl/` |
| Semántica `fx_to_usd` para CRC/BRL | ✅ Correcta: si `rate = moneda_local por 1 USD`, entonces `fx_to_usd = 1/rate` para montos en moneda local |

**Rectificación importante:** la observación anterior “Dependencias del Tipo de Cambio (TC)” en §6.2 ya no debe interpretarse como una brecha del MCP. El agente **no debe consultar servicios externos directamente** para el flujo Sondel; debe usar `tipo_cambio`. El backend sí usa upstreams externos/cache/fallback internamente, pero eso queda encapsulado detrás de la API autenticada de MWT.ONE.

### 7.3 Hallazgos técnicos, de seguridad y de flujo

| ID | Severidad | Área | Hallazgo | Impacto | Recomendación |
|---|---:|---|---|---|---|
| **SEC-01** | 🚨 Crítica | Secretos | El prompt contiene un JWT real de producción en `MWT_MCP_TOKEN`. Decodificado sin exponer el valor: `role=admin`, `mcp=true`, emitido el **2026-06-19** y con expiración aproximada el **2126-05-26**. | Cualquier copia del archivo o historial Git concede control administrativo vía MCP durante décadas. | Rotar/revocar inmediatamente el token, removerlo del archivo y del historial, sustituir por `${MWT_MCP_TOKEN}`/placeholder, y emitir tokens de menor vida útil o alcance. |
| **TOOL-01** | ⚠️ Alta | MCP Server | `tipo_cambio` está definida dos veces en `server.py`: una versión validada con default `par="usd-crc"` y whitelist `usd-crc`/`usd-brl`, y una segunda versión posterior sin default ni whitelist. | Dependiendo de cómo FastMCP resuelva nombres duplicados, puede sobrescribirse la versión segura o quedar una definición ambigua; además confunde el conteo real. | Dejar una sola definición de `tipo_cambio`, preferiblemente la primera: default `usd-crc`, normalización `/` y `_` a `-`, y rechazo de pares no permitidos. |
| **TOOL-02** | ⚠️ Alta | Validación de versión | El script §0.3 del prompt no incluye `tipo_cambio` en el set `req` y no valida explícitamente que haya 99 herramientas únicas. | Un MCP viejo sin tipo de cambio podría pasar el smoke test y fallar recién en la liquidación de Costa Rica. | Agregar `tipo_cambio` a `req` y verificar `len(names) == 99` o, al menos, `assert "tipo_cambio" in names`. |
| **CALL-01** | ⚠️ Media | Firmas MCP | Varias invocaciones del checklist están abreviadas de forma que un agente podría llamarlas mal: `sap_analizar` requiere `(expediente_id, file_path)`, `sap_confirmar` requiere `(expediente_id, sap_id, lineas_confirmadas, fecha_fabricacion?, file_path?)`, `expediente_phase_durations_set` requiere `(expediente_id, phase_durations)`, y `transferencia_recibir` requiere IDs de líneas de transferencia con `qty_received`. | Errores operativos en runtime o acciones parcialmente ejecutadas. | Corregir el prompt con firmas exactas o añadir ejemplos mínimos por cada herramienta crítica. |
| **FLOW-01** | ⚠️ Alta | Idempotencia | El prompt exige reintentos por caídas IMAP, pero no prescribe el uso de `idempotence_token` en `expediente_crear` ni una estrategia de deduplicación para documentos, transferencias y cost lines. | Reintentos pueden crear expedientes, documentos, movimientos o costos duplicados. | Usar tokens determinísticos por `cliente+OC+proforma`, consultar antes de crear, y deduplicar por claves naturales: documento `(kind,codigo,expediente_id,file_size)`, costo `(kind,label,amount,currency,document_id,scope_json)`, transferencia `(origen,destino,tracking,dua,lineas)`. |
| **FLOW-02** | ⚠️ Alta | Eliminaciones | La instrucción “borra fantasmas sin respaldo (`expediente_eliminar`)" es peligrosa si la detección de duplicado es imperfecta. | Pérdida irreversible de registros legítimos, auditoría o documentos. | Antes de eliminar, exigir evidencia: misma OC, misma proforma, sin `storage_url`, sin SAP, sin stock, sin transferencias, sin pagos y menor completitud que el registro conservado. Para expedientes no vacíos, preferir desactivar/etiquetar o pedir confirmación humana. |
| **FIN-01** | ⚠️ Alta | Landed cost / IVA | El prompt dice que el IVA de Costa Rica es acreditable y “no suma al costo real”, pero también instruye agregarlo con `transfer_costo_agregar` antes de `transfer_liquidar`. El motor actual de liquidación suma todas las `CostLine` activas como `extra_costs_usd`. | Si se agrega IVA como cost line activa, el landed cost interno queda sobreestimado. | No incluir IVA acreditable en la liquidación interna hasta que exista una bandera `capitalizable=false`/`tax_credit=true` o una vista separada que `transfer_liquidar` excluya. Si se registra para trazabilidad, documentar que no debe afectar landed cost. |
| **FIN-02** | ⚠️ Media | DAI por NCM | La tabla distingue DAI 14% para `6403.99.90` y 10% para `6406.90.20`, pero solo indica “usa `label`”. | Si `scope_json` se deja `{"applies_to_all":true}`, un DAI de un NCM se prorratea contra líneas de otro NCM. | Crear cost lines separadas por NCM y usar `scope_json.lines` con las líneas afectadas; verificar NCM con `producto_obtener`/`ncm_listar`. |
| **FX-01** | ⚠️ Media | Tipo de cambio | `tipo_cambio` devuelve una tasa viva/cacheada. Para una DUA, la tasa fiscal aplicable puede ser la tasa oficial usada en la declaración, no necesariamente la tasa viva del día de carga. | Diferencias contables entre DUA, pago de impuestos y liquidación. | Si la DUA trae tipo de cambio, usar ese valor y guardar `source="DUA"`/nota. Si no lo trae, usar `tipo_cambio` y registrar `rate`, `source` y `timestamp` en notas del costo o de la transferencia. |
| **FLOW-03** | ⚠️ Alta | Fusión + inventario | El prompt ordena completar cada expediente del par Sondel/Muito Work antes de fusionar. Si ambas carpetas representan la misma OC física y las mismas líneas, recibir/mover ambos antes de fusionar puede duplicar stock y costos. | Doble conteo de inventario, landed cost y facturación. | Antes de recepción/movimiento, comparar hashes de líneas `(OC, SKU/base, talla, qty)` entre expedientes de la misma OC. Si son duplicados idénticos, conservar uno; si son expedientes complementarios, recibir cada línea física una sola vez y documentar el alcance de la fusión. |
| **DOC-01** | ⚠️ Media | Artefactos Builder | El prompt fija IDs de plantillas (`AWB/BL=9`, `Factura Comercial=13`, `Packing=23`, `Impuestos=24`). | Los IDs pueden cambiar entre entornos o migraciones. | Usar `builder_templates_listar` y seleccionar por título/tipo; luego `builder_template_obtener` para obtener `field.id` reales antes de `storage_subir_archivo` y `transfer_artefacto_crear`/`nodo_artefacto_crear`. |
| **DOC-02** | ℹ️ Baja | Documentos OC/Proforma/SAP | `documento_subir` es válido para adjuntos, pero el propio docstring del MCP recomienda `match_subir` para OC/Proforma cuando se requiere mapeo y `sap_confirmar`/`sap_upsert` con `file_path` para SAP. | Riesgo de documento visible pero sin mapeo/asignación semántica. | Mantener `documento_subir` para factura, DUA, BL/AWB, packing y pago de impuestos; para OC/Proforma/SAP preferir los flujos semánticos cuando apliquen y verificar con `documento_listar`/`sap_obtener`. |
| **SEC-02** | ⚠️ Media | Narración en vivo | La instrucción de narrar cada acción MCP puede exponer datos sensibles: token, URLs de storage, DUA, montos, identificadores fiscales o correos. | Fuga de información operativa/financiera en el chat o logs del agente. | Añadir política de redacción: nunca imprimir tokens, cookies, MinIO keys, URLs de descarga completas, credenciales IMAP, documentos tributarios completos ni PII innecesaria. |
| **SEC-03** | ⚠️ Media | Supply chain / instalación | `pip install --force-reinstall git+https://github.com/...` instala desde una referencia mutable si no se fija commit/tag. | Drift de versión o instalación de código no auditado en sesiones futuras. | Pinnear commit SHA o tag firmado; ejecutar en virtualenv; evitar `force-reinstall` global en entornos compartidos. |
| **SEC-04** | ⚠️ Media | Superficie MCP HTTP | El MCP soporta `MWT_MCP_TRANSPORT=http` y `MWT_MCP_HOST=0.0.0.0`. Con un token admin de backend, exponerlo sin capa adicional permite que cualquiera con acceso al puerto invoque herramientas. | Control remoto de operaciones administrativas. | Para este flujo usar `stdio` o bind `127.0.0.1`; si se usa HTTP, proteger con VPN/firewall/reverse proxy autenticado y token de menor privilegio. |
| **FLOW-04** | ℹ️ Baja | OneDrive/IMAP local | El prompt declara que OneDrive, IMAP y parseo local quedan fuera del MCP, pero no define checkpoints concretos de IMAP ni manifiesto local de archivos procesados. | Reprocesamiento, pérdida de contexto tras desconexión o mezcla de hilos de correo. | Guardar manifiesto local por expediente: paths, hashes, message-ids/UIDs, fechas extraídas, último UID visto y estado de auditoría. |

### 7.4 Ajuste sugerido para el smoke test de §0.3

El test de instalación debería validar explícitamente el nuevo tipo de cambio y el conteo único:

```python
req = {
    "expediente_buscar", "expediente_editar", "oc_editar", "marca_listar",
    "producto_alias_crear", "expediente_eliminar", "documento_eliminar",
    "tallas_listar", "expediente_fusionar", "recepcion_crear",
    "transferencia_crear", "transfer_costo_agregar", "nodo_crear",
    "tipo_cambio",
}
names = {t.name for t in asyncio.run(mcp.list_tools())}
print("TOTAL_UNICAS:", len(names), "FALTAN:", (req - names) or "ninguna ✅")
assert not (req - names), "MCP viejo: repite el force-reinstall"
assert len(names) == 99, f"Inventario MCP inesperado: {len(names)} herramientas únicas"
```

### 7.5 Ejemplos de firmas corregidas para llamadas críticas

```python
sap_analizar(expediente_id="<uuid-expediente>", file_path="C:/ruta/SAP.xlsx")

sap_confirmar(
    expediente_id="<uuid-expediente>",
    sap_id="<numero-sap>",
    fecha_fabricacion="2026-02-15",
    lineas_confirmadas=[{"linea_id": "<uuid-linea>", "qty_confirmada": 40}],
    file_path="C:/ruta/SAP.xlsx",
)

expediente_phase_durations_set(
    expediente_id="<uuid-expediente>",
    phase_durations={
        "REGISTRO": {"start": "2026-01-10", "end": "2026-01-12"},
        "TRANSITO": {"start": "2026-03-01", "end": "2026-03-15"},
    },
)

tipo_cambio("usd-crc")  # rate = CRC por 1 USD; para CRC: fx_to_usd = 1 / rate
```

### 7.6 Conclusión de la ampliación

El documento Sondel es un buen runbook operativo y su mapa de herramientas está alineado con el MCP actual, incluyendo `tipo_cambio`. Las brechas no son de “herramienta faltante”, sino de **seguridad del secreto embebido**, **ambigüedad por la definición duplicada de `tipo_cambio`**, **firmas abreviadas**, **riesgos de idempotencia/reintentos**, y **tratamiento financiero de IVA/DAI/tipo de cambio**. Antes de ejecutar el flujo en producción, se recomienda corregir `server.py` para dejar una sola `tipo_cambio`, rotar el JWT expuesto, endurecer el smoke test y añadir guardas explícitas de deduplicación, scope fiscal y redacción de datos sensibles.
