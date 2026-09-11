# Investigación del flujo nueva-oc y expedientes

Revisión estática del repositorio Ale241302/consola_mwt_one, rama main, commit de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f. Fecha de revisión: 11 de septiembre de 2026.

## Resultado

La consola ya contiene gran parte de las capacidades que discutimos: OC padre, expedientes, líneas por producto/talla, SAP y fechas por línea, precios y plazos duales, división parcial, agrupación visual, documentos y acceso MCP. Mi propuesta anterior de incorporar estas capacidades como si faltaran era prematura.

El problema que emerge del código es la divergencia entre caminos: crear desde el wizard interno, crear desde portal/MCP, dividir desde edición general y dividir desde edición SAP no tienen las mismas reglas. Antes de añadir otro modelo conviene consolidar esas operaciones y definir cómo se presentan al CEO y al cliente.

No se ejecutó la aplicación, no se accedió a producción ni a MinIO, y no se modificó el repositorio remoto. Los comportamientos descritos son los de los handlers y consultas inspeccionados, no resultados de una prueba integrada. Se leyeron 30 archivos en una copia parcial de auditoría, incluidos los dos wizards, rutas, API, modelos, SQL, handlers, vistas de OC/expediente/fusión, MCP y pruebas existentes.

## 1. Qué abre nueva-oc

La misma URL /portal/nueva-oc selecciona componente según el rol:

| Actor | Componente | Pasos | Endpoint de creación |
|---|---|---|---|
| Interno/admin | CreateExpedienteWizardLite | Operador → Cliente → Productos → Revisar y crear | POST /api/expedientes/ |
| Cliente | CreateExpedienteWizard | Subir OC → Confirmar productos → Revisar y enviar | POST /api/expedientes/create-from-oc/ |
| MCP | expediente_crear | Recibe datos estructurados y archivo opcional | POST /api/expedientes/create-from-oc/ |

El wizard completo también admite entrada desde carrito. /wizard redirige a nueva-oc; existe una ruta de fallback al wizard completo. Por tanto, “crear expediente” no identifica hoy una única operación interna.

Evidencia: [frontend/src/App.jsx:99](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/App.jsx#L99); [frontend/src/pages/CreateExpedienteWizardLite.jsx:47](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/CreateExpedienteWizardLite.jsx#L47); [frontend/src/pages/CreateExpedienteWizard.jsx:50](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/CreateExpedienteWizard.jsx#L50); [mcp_server/mwt_mcp/server.py:1528](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/mcp_server/mwt_mcp/server.py#L1528).

## 2. Cómo crea el flujo interno

1. Selecciona operador MWT o cliente, y luego el cliente final.
2. Incorpora productos manualmente o desde una plantilla. Valida cantidades positivas y asignación del producto. La plantilla resuelve SKU/nombre/referencia y tallas; este camino no es el OCR de PDF del portal.
3. En el resumen se eligen crédito/contado, plazos MWT/cliente y precios. Hay overrides manuales de precio por SKU.
4. Agrupa líneas repetidas por SKU y talla antes de enviarlas.
5. Envía client_id, operating_company_id, estado REGISTRO, condiciones de pago y líneas con los precios duales. Marca, transporte y moneda no son obligatorios en este formulario.
6. El backend genera código EXP; si falta oc_id, crea una OC mínima PO-AAAA-NNNNN, estado EMITIDA.
7. Guarda el expediente y después sus líneas como PENDIENTE_SAP, con cantidad, producto, talla y precios congelados. El precio legacy depende del operador.
8. La navegación termina en la OC padre, no necesariamente en el detalle del expediente.

Este camino no crea por sí mismo el documento OC/ART-01 que sí crea el otro camino. La OC de base de datos no equivale automáticamente a un archivo de orden de compra almacenado.

Evidencia: [frontend/src/pages/CreateExpedienteWizardLite.jsx:497](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/CreateExpedienteWizardLite.jsx#L497); [frontend/src/pages/CreateExpedienteWizardLite.jsx:684](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/CreateExpedienteWizardLite.jsx#L684); [backend/apps/expedientes/views.py:550](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L550); [backend/apps/expedientes/views.py:940](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L940).

## 3. Cómo crea el portal y cómo se conecta MCP

El portal sube PDF/XLSX a parse-oc, resuelve líneas contra los alias de producto del cliente y presenta productos para revisión. En creación:

- Fuerza el cliente desde la identidad autenticada para un usuario cliente.
- Deja decisiones logísticas/comerciales internas pendientes y registra PENDING_CEO_REVIEW.
- Usa token de idempotencia cuando se proporciona.
- Crea en una transacción OC, expediente, líneas, ART-01, documento OC, evento de creación y registro de envío del wizard.
- El documento OC se marca para audiencia CLIENT.
- El archivo se sube fuera de la transacción de BD, de forma best-effort. Un registro documental no prueba por sí solo que el binario quedó almacenado.

MCP expediente_crear llama a este mismo endpoint, acepta lines u ocr_payload y admite archivo local. Eso ya ofrece una base común entre cliente e IA, pero no coincide con el alta interna.

Diferencia concreta: la herramienta MCP ofrece operating_company_id y forma_pago y los envía, pero el handler create_from_oc inspeccionado no los lee ni los incluye en el INSERT del expediente. No puede asumirse que queden persistidos como en el wizard interno; defaults o triggers desplegados requieren comprobación de BD.

Evidencia: [frontend/src/pages/CreateExpedienteWizard.jsx:220](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/CreateExpedienteWizard.jsx#L220); [frontend/src/pages/CreateExpedienteWizard.jsx:574](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/CreateExpedienteWizard.jsx#L574); [backend/apps/expedientes/views_wizard.py:929](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views_wizard.py#L929); [backend/apps/expedientes/views_wizard.py:1110](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views_wizard.py#L1110); [backend/apps/expedientes/views_wizard.py:1172](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views_wizard.py#L1172); [backend/apps/expedientes/views_wizard.py:1400](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views_wizard.py#L1400); [mcp_server/mwt_mcp/server.py:1581](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/mcp_server/mwt_mcp/server.py#L1581).

## 4. Qué es cada pieza hoy

| Pieza | Función comprobada |
|---|---|
| OC | Cabecera comercial con cliente, código, proforma/SAP y agregados. Agrupa expedientes y líneas por oc_id. |
| Expediente | Combina seguimiento operativo y condiciones comerciales: cliente, operador, fase, ruta, fechas, importes, plazos y grupo de fusión. |
| Línea | Cantidad por producto/SKU/talla; precios MWT/cliente; SAP, fecha de producción y estado. |
| Documento | Referencia a OC/expediente, tipo, código, audiencia y ubicación de archivo. |
| Artefacto | Datos estructurados/documentales del proceso; existen artefactos de expediente y del Builder en nodos. |
| Transferencia | Movimiento logístico con origen/destino, tracking, salida, ETA, recepción y documentos. Se relaciona con expedientes mediante asignaciones. |
| Fusión | Identificador y etiqueta compartidos entre expedientes para agruparlos visualmente. |

Los vínculos centrales del ORM son UUID lógicos, no ForeignKey, y los modelos son managed=False. Hay SQL adicional que amplía el esquema, por lo que leer solo models.py no describe toda la BD.

Evidencia: [backend/apps/expedientes/models.py:62](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/models.py#L62); [backend/apps/expedientes/models.py:102](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/models.py#L102); [backend/apps/expedientes/models.py:204](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/models.py#L204); [backend/apps/transfers/models.py:67](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/transfers/models.py#L67).

## 5. SAP, producción, fases y embarque

confirm-sap recibe SAP, fecha_fabricacion, líneas confirmadas y documento opcional. Asigna SAP y production_date a las líneas, registra ART-04 y eventos, y pasa el expediente de REGISTRO a PRODUCCION. Si cambia la cantidad confirmada, reemplaza la cantidad de la línea y registra la diferencia; no conserva automáticamente el remanente como otra línea.

upsert-sap permite añadir/actualizar después: modifica líneas, documentos y la fecha del expediente. Hay datos de producción en líneas, campos SQL del expediente y payloads de artefactos. Las duraciones/fechas del cronograma también admiten overrides. Esto obliga a definir una precedencia explícita antes de automatizar respuestas de COMEX.

Las fases técnicas son:
REGISTRO → PRODUCCION → PREPARACION → DESPACHO → TRANSITO → EN_DESTINO → CERRADO.

La UI ya une PREPARACION y DESPACHO como “Preparación de despacho”. Avanzar de fase es flexible: el handler no exige documento aunque el catálogo lo sugiera. Por ello, estar en una fase no demuestra documentalmente que todos sus hitos estén cumplidos.

El detalle de OC agrupa por SAP; para cada grupo toma fecha, transporte y expediente de la primera línea. Eso puede simplificar demasiado un grupo heterogéneo.

Ya existe infraestructura logística: shipping-summary consulta AWB/BL del Builder y transferencias mediante asignaciones. Sin embargo, devuelve un artefacto y una transferencia singulares. La consulta de transferencias ordena por ID antes que por fecha y luego toma la primera fila; el comentario “más reciente” no coincide con una selección global por fecha. Un expediente con varias salidas necesita una vista plural que preserve todas las rutas.

Evidencia: [backend/apps/expedientes/views.py:2019](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L2019); [backend/apps/expedientes/views.py:2325](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L2325); [backend/apps/expedientes/views.py:4910](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L4910); [frontend/src/lib/phaseDisplay.js:1](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/lib/phaseDisplay.js#L1); [backend/apps/expedientes/views.py:1873](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L1873); [frontend/src/pages/OCDetail.jsx:1174](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/OCDetail.jsx#L1174); [backend/apps/inventario/views.py:846](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/inventario/views.py#L846).

## 6. Fusión y dos divisiones diferentes

**Fusión visual.** fusionar solo escribe fusion_id/fusion_label. No crea AWB, BL, reserva, distribución de cantidades ni transferencia. Tampoco comprueba igualdad de cliente en ese handler. No debe interpretarse como una consolidación logística validada.

**División desde edición general.** El wizard envía split_line_ids y split_quantities:
- Crea otra OC copiando código/PO, proforma y SAP de la anterior.
- Crea expediente REGISTRO y recalcula precios.
- Para una línea completa, cambia su OC/expediente y precios, conservando SAP, producción y estado de línea.
- Para parte de una línea, reduce el original y crea una nueva PENDIENTE_SAP sin SAP ni fecha.
- Copia documentos activos de la OC original; no copia explícitamente audience.
- Mueve asignaciones de inventario solo cuando no queda esa combinación producto/talla en el original.
- No declara un parent_id/original_line_id en los modelos examinados. El evento edit_full no incluye el resultado del split; el nuevo ID aparece en la respuesta.

**División al cambiar cliente desde edición SAP.**
- Crea otro expediente en REGISTRO conservando oc_id.
- Mueve líneas de ese SAP y limpia su SAP y fecha de producción.
- Inactiva documentación SAP; incluye limpieza de archivos en MinIO.
- Si el original queda vacío, inactiva también el expediente original.
- Registra un evento específico sap.split_expediente.

Estos dos caminos no implementan la misma semántica. Ninguno debe asumirse equivalente a “Marluvas anula el pedido y emite uno nuevo” sin definir qué identidad/documentación debe sobrevivir.

Evidencia: [backend/apps/expedientes/views.py:1362](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L1362); [frontend/src/pages/CreateExpedienteWizardLite.jsx:578](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/frontend/src/pages/CreateExpedienteWizardLite.jsx#L578); [backend/apps/expedientes/views.py:4125](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L4125); [backend/apps/expedientes/views.py:4295](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L4295); [backend/apps/expedientes/views.py:4343](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L4343); [backend/apps/expedientes/views.py:2608](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L2608).

## 7. Hallazgos que cambian las decisiones de producto

Son hallazgos de código; su ocurrencia en datos reales y el esquema desplegado quedan por verificar.

| Hallazgo | Consecuencia para el negocio | Prioridad propuesta |
|---|---|---|
| Alta interna y portal/MCP persisten conjuntos diferentes de registros y términos | La misma intención puede producir expedientes distintos según el canal | Alta |
| Alta interna inserta OC antes de validar expediente; inserciones de líneas atrapan errores y continúa a 201 | Riesgo de cabecera huérfana o alta incompleta. No se encontró transacción global ni ATOMIC_REQUESTS en el settings leído | Alta |
| Split general copia documentos sin audience; SQL C1 define CLIENT por defecto | Un documento interno puede perder su clasificación al copiarse. Antes de reasignar entre clientes hay que conservar audiencia y filtrar documentos aplicables | Alta |
| Split completo conserva SAP en líneas; parcial lo limpia; split SAP tiene otra política | Un expediente REGISTRO puede contener confirmaciones heredadas que no corresponden al pedido nuevo | Alta |
| shipping-summary representa solo una salida y selecciona transferencia por ID | No explica correctamente el caso de múltiples AWB/BL y destinos | Alta |
| Anulación accesible como DELETE inactiva expediente/OC | Conservar la fila no equivale a mostrar al cliente “anulado y reemplazado”, ni a guardar ese vínculo | Media |
| Fechas repartidas entre líneas, expediente, artefactos y overrides | Una actualización puede no reflejarse igual en todas las vistas | Alta |
| Serializadores generales exponen todos los campos del modelo; LineaViewSet no pasa request al serializer | El precio “para el viewer” no basta para asegurar una respuesta por audiencia. Revisar el contrato de lectura de portal y MCP con roles reales | Alta |

En las rutas de edición/división examinadas no encontré un bloqueo explícito por factura emitida o anticipo recibido. La regla que vos definiste debe validarse en servidor para cada operación aplicable, no solo explicarse en el formulario. No se inspeccionaron exhaustivamente todos los triggers de la base desplegada.

Evidencia adicional: [backend/sql/C1_documentos_audience.sql:7](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/sql/C1_documentos_audience.sql#L7); [backend/apps/expedientes/views.py:1048](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L1048); [backend/apps/expedientes/serializers.py:813](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/serializers.py#L813); [backend/apps/expedientes/views.py:4992](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/views.py#L4992).

## 8. Cómo continuar sobre esta base

1. Definir una sola operación de creación compartida por wizard interno, portal y MCP, con diferencias explícitas de permisos. Alta atómica, reintentos seguros y condiciones comerciales consistentes.
2. Separar las intenciones del usuario: editar pedido, dividir cantidades para transporte, agrupar visualmente y anular/recrear comercialmente. Reutilizar capacidades existentes con reglas consistentes.
3. Para tu decisión de anular/recrear: conservar el anterior y sus documentos, motivo y vínculo interno opcional al reemplazo; crear nueva identidad comercial con SAP nuevo. Evitar exponer el cliente anterior al nuevo.
4. Aprovechar transferencias, asignaciones y artefactos para representar todos los embarques por expediente. No crear otra entidad logística sin reconciliar primero esas piezas.
5. Añadir el seguimiento COMEX sobre estos hitos: estimación, fecha informada, fuente, fecha de consulta y reconfirmación a 14 días. La IA extrae; la operación de negocio valida y registra el cambio.
6. Construir portal y MCP sobre la misma lectura por cliente, con cantidades, fechas, fuentes, documentos permitidos y decisiones pendientes. Encima, la radiografía CEO agrega embarques y caja sin perder el detalle.

Se encontró una tarea diaria para fecha EN_DESTINO y su schedule. En los tasks de expedientes y schedule inspeccionados no aparece la consulta COMEX/reconfirmación a 14 días. Esto no acredita ausencia de una integración externa; simplemente no fue encontrada en esa ruta.

Evidencia: [backend/apps/expedientes/tasks.py:187](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/apps/expedientes/tasks.py#L187); [backend/config/settings.py:321](https://github.com/Ale241302/consola_mwt_one/blob/de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f/backend/config/settings.py#L321).

## 9. Verificación y límites

Se contrastaron rutas de React, payloads, endpoints, SQL de escritura, modelos, serializadores, estructura logística y wrappers MCP. Se leyeron pruebas de fusión y del wizard cliente: contienen casos de agrupación visual, permisos, alias/productos y creación B2B. No se ejecutaron porque esta revisión usó una copia parcial de código y no una BD de pruebas configurada.

Estado: análisis estático realizado; UI renderizada, persistencia real, permisos end-to-end, migraciones desplegadas, OCR y automatizaciones en producción UNVERIFIED.

Pruebas propuestas para una siguiente intervención: mismo alta por consola/MCP; fallo al insertar una línea; split total/parcial; cambio de cliente; documento interno en split; pedido facturado o con anticipo; dos embarques con AWB/BL diferentes; fechas COMEX y cronograma; consulta como cliente original y nuevo cliente.

Se adjunta un manifiesto con SHA-256 de los archivos de código leídos para vincular la investigación con su evidencia local.

