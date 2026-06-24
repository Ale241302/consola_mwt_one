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
