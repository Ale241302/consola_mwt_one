# Plan funcional y técnico — Consola MWT.ONE
## Radiografía CEO, embarques del cliente y mesa de trabajo por expediente

**Destinatario:** Alejandro  
**Origen:** conversación completa de definición con Álvaro, desde la revisión del harness y del sistema hasta correo, tareas y vistas CEO/cliente.  
**Fecha:** 11 de septiembre de 2026.  
**Estado:** plan para revisión e implementación; no acredita funcionalidades implementadas.  
**Repositorio:** Ale241302/consola_mwt_one.  
**Base de la auditoría:** commit de1837c5f00a043dfc1ee0ba9bddf3783fcfeb6f.  
**Documentos relacionados:** [Auditoría de nueva-oc](./auditoria-nueva-oc.md) y [manifiesto de evidencia](./evidencias-nueva-oc.json).

## 1. Problema y resultado esperado

Álvaro, como CEO, encuentra mucha información en la consola, pero no percibe con facilidad qué significa, qué es relevante ni qué decisión necesita tomar. El objetivo es que pueda entender intuitivamente el momento del negocio, sus compromisos y su dinero a la vista.

El problema incluye la actualización del sistema: Álvaro consulta por correo a COMEX, recibe fechas y documentos, pero puede olvidar consultar nuevamente o transcribir las respuestas. La consola debe aprovechar esas conversaciones para mantener los expedientes, documentos y fechas del cliente actualizados.

La primera pantalla debe responder, en este orden:

1. ¿Qué tengo pendiente de responder?
2. ¿Qué pedidos están próximos a salir de producción?
3. ¿Cómo está el flujo de dinero?

Como segundo nivel, el CEO necesita objetivos y evolución de cada cliente.

El cliente tiene otra prioridad: **sus embarques**. Debe comprender qué viene, cuánto viene, cuándo sale/llega, qué cambió, qué documentos tiene y qué necesita decidir. No se acordó construirle una portada de objetivos comerciales.

## 2. Alcance y principios

- Aprovechar la implementación existente: OC, expedientes, líneas, precios/plazos duales, SAP, transferencias, asignaciones, documentos, Builder, MinIO y MCP.
- Unificar comportamientos antes de añadir estructuras paralelas.
- Usar la misma información de negocio para consola, portal y MCP, con permisos y audiencias adecuados.
- Toda actualización extraída debe poder explicarse con su fuente y conservar el valor anterior.
- Una respuesta vaga no se convierte en fecha confirmada.
- Los correos se preparan automáticamente, pero **Álvaro revisa y decide cada envío**.
- No interpretar la existencia de un documento en BD como prueba de que hay un archivo válido.
- No confundir anulación comercial, división logística y agrupación visual.
- Empezar con una cuenta de correo y Álvaro como responsable; permitir delegación futura a usuarios.
- Toda decisión no cerrada en esta conversación se identifica como pendiente o propuesta, nunca como acuerdo.

## 3. Decisiones del modelo de negocio

### 3.1 OC, expediente y proforma

- El cliente se orienta por su **OC**.
- Una OC puede agrupar varios expedientes.
- Algunos expedientes pueden ser operados directamente por el cliente y otros por Muito Work.
- **Cada expediente tiene una sola proforma.**
- El asunto del correo suele incluir la proforma; será una referencia principal para asociación.
- OC y proforma no son intercambiables. No repartir una actualización entre todos los expedientes de una OC sin evidencia de que les aplica.
- El número SAP y el hilo sirven como referencias adicionales.
- Hay que verificar si el número de proforma es único entre marcas/emisores/años. Una proforma por expediente no demuestra por sí sola unicidad global del número.

### 3.2 Producción, división y embarque

Se discutió conservar los pedidos independientes durante producción y organizar su salida solos o acompañados en preparación. La auditoría mostró que ya existen operaciones para parte de esto; el diseño final debe apoyarse en ellas.

Reglas operativas confirmadas:

- Un pedido puede dividirse entre varias salidas, aunque no sea habitual.
- Las partes pueden tener distintos destinos, AWB o BL.
- Pedidos de clientes distintos no deben mezclarse bajo el mismo documento de embarque individual.
- Un contenedor puede transportar mercancía de clientes distintos con BL separados.
- Si una parte no está lista, **el cliente decide** esperar o separar.
- Una agrupación visual no acredita una reserva ni que la mercancía viaje junta.
- Registrar cantidades por línea/SKU/talla y por salida para evitar doble asignación.

Propuesta técnica: evaluar y extender transferencias + asignaciones + artefactos AWB/BL existentes; no crear una nueva entidad “embarque” sin justificar por qué las actuales no bastan.

### 3.3 Cambio de cliente: decisión final simplificada

La discusión inicial contempló expedientes hijos para traslado comercial. **Esa propuesta fue reemplazada por una operación más simple:**

1. Anular el pedido original y guardar el motivo.
2. Liberar la mercancía/asignación que corresponda.
3. Crear el nuevo pedido desde cero.
4. Usar el nuevo SAP que emite Marluvas, cliente, cantidades, precios y documentos propios.

Álvaro confirmó que no realiza esta reasignación después de facturar o recibir anticipos. Marluvas anula el pedido vigente y emite uno nuevo.

El cliente nuevo no necesita saber que la mercancía estuvo asignada a otro cliente. No requiere una jerarquía padre/hijo ni un “reemplaza a” visible. Sí se necesita trazabilidad interna de movimientos para conservar cantidades y evitar duplicarlas. El expediente original mantiene su historia.

**Pendiente acotado:** no quedó definido expresamente si la liberación/reasignación puede hacerse sobre mercancía todavía en producción o únicamente terminada. No bloquear el resto del trabajo por este punto.

### 3.4 Fuentes documentales

Los archivos se almacenan en MinIO. La infraestructura existente incluye OCR y extracción con IA. Correos, archivos originales y datos extraídos tienen funciones distintas:

- Original: evidencia conservada.
- Extracción: interpretación verificable.
- Dato del expediente/artefacto: valor validado que consume la aplicación.
- Documento para cliente: versión vigente y autorizada para su audiencia.

No copiar automáticamente documentos del pedido anterior a una nueva operación comercial.

## 4. Pantalla inicial del CEO

### 4.1 Pendientes de responder y mesa de trabajo

Mostrar correos que requieren respuesta, borradores por revisar, seguimientos por enviar, decisiones y cambios pendientes de validación.

Cada elemento debe expresar:

- Qué necesita atención y por qué.
- Cliente, OC y expediente/proforma relacionados.
- Responsable, vencimiento y estado.
- Última comunicación y contexto necesario.
- Acción directa: abrir borrador, revisar cambio, adjuntar documento, reprogramar o resolver.

Propuesta de grupos: vencidos, hoy, próximos y esperando respuesta. No convertir todos los correos recibidos en tareas.

### 4.2 Próximas salidas de producción

Mostrar cliente/OC, proforma/SAP, cantidades relevantes, fecha estimada o confirmada, última validación, preparación del despacho y bloqueos.

Permitir distinguir:

- Sin fecha concreta.
- Fecha por reconfirmar.
- Fecha reconfirmada.
- Cambio que afecta una reserva/documentación.
- Parte lista y parte pendiente.

Propuesta inicial no confirmada: ventana de tres semanas laborales. Debe ser configurable.

### 4.3 Flujo de dinero

Separar entradas, salidas y dinero disponible por fecha. Mostrar los pedidos/facturas/pagos que explican cada cifra.

No confundir:
- venta o comisión esperada;
- cobro recibido;
- margen;
- caja disponible.

Propuesta inicial no confirmada: horizonte de 90 días con agrupación semanal.

### 4.4 Segundo nivel: objetivos y evolución del cliente

No hay KPI definidos al inicio. Primero ofrecer una radiografía; después permitir metas mensuales, trimestrales y anuales.

Objetivos y evolución de clientes son secundarios en la vista CEO. Dimensiones propuestas: compras, recurrencia, margen/comisiones, pagos, pedidos y entregas. No quedaron priorizadas ni definidas sus fórmulas.

No inventar metas ni mostrar semáforos de cumplimiento sin referencia acordada.

## 5. Reglas de flujo económico

### 5.1 Comisiones

- Se generan/cobran en relación con el pago del cliente.
- Cada pago parcial habilita la comisión proporcional.
- **Marluvas:** la comisión se paga entre el 10 y el 20 del mes calendario siguiente al pago del cliente.
- Ejemplo confirmado: pago del cliente el 1 de septiembre → comisión prevista del 10 al 20 de octubre.
- Las reglas pueden variar por marca; deben ser configurables por marca/contrato.
- Separar comisión proyectada por cobro futuro, comisión pendiente de liquidar por pago ya recibido y comisión efectivamente cobrada.
- Mostrar la ventana 10–20; no inventar un día exacto.
- Las reglas de días hábiles acordadas para tareas no cambian automáticamente esta ventana de comisión.

Pendientes técnicos: base de cálculo, moneda, porcentaje, asignación de pagos parciales a facturas/líneas, conciliación y reglas de otras marcas. Verificar en el módulo financiero existente antes de definir nuevos cálculos.

### 5.2 Arbitraje

- Cobro de la factura de venta menos pago de la factura de compra.
- El cliente paga el 100 % de la factura según lo indicado por Álvaro.
- Puede comprarse a 15 días y venderse a 90, o comprarse/venderse ambos a 90.
- Cada vencimiento parte de la fecha de su respectiva factura.
- Conservar separados los plazos de compra/MWT y venta/cliente.
- Una operación rentable puede requerir financiación temporal; el gráfico debe mostrar ese desfase.

**Pendiente necesario para mostrar saldo:** origen y actualización del dinero disponible inicial. Sin él, mostrar flujo neto de entradas/salidas y no llamarlo saldo disponible.

## 6. Portal del cliente y MCP

El cliente debe enfocarse en sus embarques, organizados desde sus OC y expedientes.

### 6.1 Portada y detalle

Priorizar:

1. Próximas llegadas y salidas.
2. Cambios importantes desde su última visita.
3. Acciones o decisiones pendientes del cliente.

Al abrir OC/embarque:
- Cantidades en producción, listas, embarcadas y entregadas.
- Relación de cada cantidad con su salida, destino y AWB/BL.
- Fechas estimadas/confirmadas/reales y cuándo se actualizaron.
- Próximo hito y siguiente actualización prevista.
- Factura, packing list, AWB/BL y otros documentos permitidos, con versión vigente.
- Decisiones como esperar o solicitar salida parcial, según el alcance que se cierre.

Todos los expedientes de su OC deben ser comprensibles, incluidos los operados por él y por Muito Work, sin revelar información interna.

### 6.2 Contrato MCP

El cliente debe poder consultar la misma verdad que ve en el portal, en formato estructurado. Ejemplos:

- “¿Qué cantidad de mi OC llega la próxima semana?”
- “¿Qué parte sigue en producción y con qué fecha?”
- “¿Qué cambió desde mi última consulta?”
- “Dame el AWB y la documentación vigente de esta salida.”
- “¿Qué necesitan de mí?”

El resultado debe incluir identificadores estables, cantidades, fechas, precisión/confianza semántica, fuente permitida, última actualización y enlaces accesibles.

La existencia de un correo interno como evidencia no autoriza a entregar el correo completo al cliente. Publicar el hecho relevante y solo las fuentes/documentos permitidos.

**No acordado:** habilitar al cliente acciones de escritura/aprobación por MCP. La conversación confirmó consultas; las decisiones operativas del cliente pueden registrarse por comunicación mientras se define ese alcance.

## 7. Correo integrado y captura fuera de la consola

### 7.1 Cuenta y conectividad

- Toda la comunicación operativa pasa por **una cuenta de Álvaro**.
- Se deben captar recibidos y enviados, incluidos mensajes escritos desde su cliente de correo habitual.
- Hostinger MCP es la integración deseada y debe verificarse: lectura de carpetas, búsqueda, hilos, adjuntos, borradores, envío, eventos/polling, permisos y límites.
- Tener infraestructura Hostinger no acredita que cada operación esté disponible por MCP.
- Verificar equivalencias si debe recurrirse a otra interfaz del mismo servicio. No sustituir proveedor sin explicarlo.

### 7.2 Historial del expediente

Registrar correo entrante/saliente, hilo, asunto, participantes, fechas, adjuntos y relación con proforma/SAP/expediente.

Propuestas técnicas:
- Deduplicación por identidad del mensaje y adjunto.
- Correlación por proforma y referencias del hilo, con apoyo de SAP.
- Mantener correos dudosos en bandeja “por vincular”.
- Considerar varios expedientes si el mensaje trata expresamente de varias proformas.
- Distinguir fecha del evento, fecha de recepción y fecha de procesamiento.
- No usar direcciones en mensajes citados como participantes actuales.

### 7.3 Extracción y actualización

Datos mencionados: producción, BL/AWB, vencimientos (“due”), itinerarios, salida/llegada y documentación.

Regla acordada:
- Información inequívoca: actualizar con evidencia e historial.
- Contradicciones, cambios de importes/precios/cantidades y fechas que afectan reservas: revisión en mesa de trabajo.
- Distinguir pregunta, propuesta y confirmación; leer un correo no significa aceptar todo su texto como hecho.
- Publicar en el lado del cliente las fechas relevantes para dar claridad a su despacho, identificando estimación/confirmación.

Cuando COMEX diga “no hay fecha”:
- Registrar respuesta y mantener pendiente obtener fecha concreta.
- Preparar insistencia explicando que el cliente final necesita una fecha.

Cuando diga solo “agosto”:
- Conservar internamente el dato literal y su precisión mensual.
- Presentar “Salida estimada: última semana de agosto; pendiente de confirmación de fábrica”, conforme a la preferencia expresa de Álvaro.
- No etiquetarla como confirmada ni sustituir la evidencia por un día inventado.
- Mantener la solicitud de fecha concreta.
- La programación exacta de una reconfirmación sobre un mes impreciso requiere una regla configurable; no fingir que existe una fecha exacta.

### 7.4 Editor y envío

1. El agente prepara borrador, destinatarios y adjuntos sugeridos.
2. Álvaro revisa, reedita, añade/quita documentos.
3. Álvaro pulsa Enviar.
4. El backend envía mediante la integración y registra el resultado real.
5. Solo un envío efectivo inicia el reloj de espera de respuesta.

La acción de publicar este plan no autoriza envíos operativos futuros. No enviar automáticamente seguimientos.

Capturar los envíos externos de Álvaro y usarlos para resolver/reprogramar tareas; si ya consultó desde su correo, no mantener un seguimiento duplicado.

## 8. Catálogo de tareas, agenda y mesa de trabajo

Tres piezas conectadas:

| Pieza | Función |
|---|---|
| Catálogo | Plantillas reutilizables: consultar producción, reconfirmar, solicitar documento, revisar itinerario, preparar despacho. |
| Agenda del expediente | Instancias con fecha, responsable, notas, documentos, origen manual/automático y dependencia de hitos. |
| Mesa de trabajo | Pendientes de todos los expedientes, con acción y contexto. |

Álvaro es el responsable por defecto. Preparar la asignación futura a otro usuario.

### 8.1 Calendario acordado

**Días hábiles = lunes a viernes. No se excluyen feriados en esta primera regla.**

| Tarea | Regla |
|---|---|
| Solicitar fecha concreta de producción | 15 días hábiles después del registro del expediente. |
| Reconfirmar producción | 10 días hábiles antes de la fecha de producción informada. |
| Seguimiento sin respuesta | 3 días hábiles después del envío efectivo de la consulta. |

No contar desde la creación del borrador. Usar calendario y zona horaria consistentes; la zona operativa debe confirmarse.

Álvaro puede cambiar fechas manualmente. Los cambios automáticos deben respetar sus overrides y no duplicar tareas.

### 8.2 Estado y recuperación

Propuesta de estados: pendiente, borrador listo, esperando respuesta, requiere revisión, resuelta y cancelada.

Enviar “consultar producción” no necesariamente la resuelve; se espera una respuesta útil. Una respuesta vaga tampoco completa la tarea.

- Crear tareas base automáticamente según etapa.
- Mantener tareas libres/manuales.
- Cancelar/revisar tareas obsoletas al anular el expediente.
- Si llega respuesta antes del seguimiento, actualizar/retirar el borrador obsoleto.
- Si cambia una fecha, recalcular la tarea dependiente, salvo override.
- Reprocesar correos o reintentar jobs no debe duplicar tareas/envíos.
- No hay un límite de insistencias acordado; hacerlo configurable y visible, siempre con envío humano.

Pendiente menor: cierre automático de la primera consulta cuando una confirmación llega antes de los 15 días. Recomendación: resolverla con esa evidencia si cumple su objetivo.

## 9. Voz personal, traducción y contactos

### 9.1 Perfil de estilo de Álvaro

El sistema mantiene un perfil/skill de comunicación versionado dentro de la consola. No se trata de instalar únicamente un skill local en Codex.

- Borradores en primera persona y con firma habitual.
- Álvaro trabaja y corrige **en español**.
- El sistema traduce la versión corregida al idioma del receptor.
- Puede revisar ambas versiones antes de enviar.
- Si cambia el español, invalidar/regenerar la traducción anterior.
- Aprender principalmente de sus correcciones en español y de la versión enviada.
- No interpretar una elección de traducción como cambio de estilo personal.
- Una corrección aislada puede ser contextual; patrones repetidos pueden convertirse en preferencias.
- Perfil visible/editable/reversible; opción “recordar esta preferencia”.
- El estilo no modifica precios, compromisos, autorizaciones ni reglas de envío.

### 9.2 Idioma del receptor

Orden propuesto y aceptado en la conversación:
1. Preferencia guardada del contacto.
2. Idioma de sus mensajes en la conversación, excluyendo citas/firmas.
3. Si no hay evidencia, Álvaro lo selecciona y puede guardarlo.

No inferir idioma solo por nombre o país. Mostrar idioma de envío y procedencia de la elección. Con receptores de idiomas distintos, elegir un idioma común para ese mensaje.

### 9.3 Libreta de direcciones

Guardar contactos relevantes, no toda dirección en Para/CC o en texto citado.

Datos:
- Nombre, correo, empresa/marca y función.
- Idioma y fuente de la preferencia.
- Grupos operativos, por ejemplo COMEX Marluvas, con Para/CC.
- Perfil de conversación: formal/profesional cercano/coloquial; tratamiento; nombre/apodo; brevedad; temas y preferencias.

El sistema sugiere contactos por participación relevante; Álvaro puede guardar, ignorar o agregar manualmente. Excluir no-reply y direcciones automáticas de sugerencias habituales.

Guardar contacto no es requisito para responder un correo, ni responder implica guardar todos sus destinatarios.

El perfil individual ajusta la voz base; no generalizar a todos una corrección para una persona. Permitir ajuste por mensaje según el contexto.

## 10. AnyDoc y documentos

Álvaro está evaluando https://github.com/firecrawl/anydoc. Se revisó su documentación:

- Convierte documentos como PDF con texto, Word y Excel a Markdown.
- La conversión local no hace OCR de escaneos; su opción alojada recurre a Firecrawl Parse.
- No implementa por sí mismo seguimiento de correo, tareas ni actualizaciones de expedientes.
- El repo ya tiene extracción de campos por IA y manejo de MinIO.

**Decisión pendiente:** adoptar AnyDoc, combinarlo con el extractor actual o conservar el existente. Evaluar con una muestra real y autorizada de documentos, midiendo exactitud de proforma/SAP/fechas/cantidades, estructura de tablas, fallos, tiempo y costo. Considerar el destino de los archivos si se habilita OCR alojado. No migrar por la descripción de la herramienta sin comparar resultados.

## 11. Hallazgos de auditoría que condicionan el plan

La auditoría adjunta es estática y está anclada a un commit. No acredita estado de producción.

1. nueva-oc selecciona componentes distintos para staff y cliente.
2. Wizard interno crea vía /api/expedientes/; portal y MCP usan create-from-oc.
3. El camino interno no crea exactamente la misma documentación/auditoría que el portal.
4. El MCP ofrece operador y forma de pago que el handler create_from_oc no persiste explícitamente.
5. El alta interna inserta OC antes de validar y atrapa errores de líneas; revisar atomicidad e idempotencia.
6. Hay dos splits con políticas distintas para OC, SAP, producción y documentos.
7. El split general omite copiar audience de documentos; revisar la clasificación antes de reutilizarlo.
8. Fusión modifica identificador/etiqueta visual, no reserva/AWB/BL ni cantidades logísticas.
9. shipping-summary devuelve una salida singular y selecciona transferencia con un orden que no cumple “más reciente” global.
10. Hay fechas en líneas, SQL del expediente, artefactos y overrides del cronograma.
11. Anular mediante DELETE inactiva registros; no equivale a una anulación explicada al cliente.
12. Revisar los contratos de lectura por rol: no basta ocultar campos en React si API/MCP los devuelve.
13. Existe tarea EN_DESTINO, pero no se encontró seguimiento COMEX a 14/10 días en los tasks/schedule inspeccionados.

No convertir todos estos hallazgos en una migración masiva. Reproducir y corregir los que afectan el flujo seleccionado, preservando datos.

## 12. Plan de implementación por etapas

Las etapas son dependencias de trabajo, no un calendario prometido. Alejandro estima esfuerzo después de verificar entorno e integraciones.

### Etapa 0 — Contrato y comprobación de base
- Revisar este plan y auditoría con el repo actual.
- Contrastar esquema desplegado/triggers con SQL y modelos.
- Verificar MCP Hostinger y acceso a recibidos/enviados/borradores/adjuntos/envío.
- Inventariar las herramientas MCP actuales y sus permisos.
- Elegir casos de prueba anonimizados o autorizados: OC con varios expedientes, dos operadores, split, varias salidas y comisión parcial.
- Resolver solo los pendientes que bloqueen el siguiente incremento.

**Salida:** mapa actualizado de capacidades, brechas reproducibles y backlog con alcance.

### Etapa 1 — Integridad del expediente y lectura compartida
- Unificar creación en una operación de servidor con adaptadores por canal.
- Persistir cliente/operador/términos/precios de forma consistente.
- Alta atómica y reintentos sin duplicación.
- Formalizar OC → expedientes → proforma; validar referencias ambiguas.
- Diferenciar editar, split logístico, fusión visual y anular/recrear.
- Conservar audiencias/documentos y evitar traslado de SAP comercial obsoleto.
- Representar todas las salidas por cantidades, reutilizando transferencias/asignaciones.
- Definir lecturas por rol para portal y MCP.

**Salida:** base coherente sobre la cual automatizar.

### Etapa 2 — Tareas y mesa de trabajo
- Catálogo, tareas manuales/automáticas, calendario hábil y overrides.
- Responsables, estados, dependencias, evidencia y reprogramación.
- Vista global y agenda por expediente.
- Implementar las tres reglas de seguimiento acordadas.

**Salida:** pendientes útiles aun antes de automatizar toda la lectura del correo.

### Etapa 3 — Correo de extremo a extremo
- Sincronización de recibidos/enviados y deduplicación.
- Historial por expediente y cola de asociación dudosa.
- Libreta/contactos relevantes y grupos.
- Editor español, traducción, adjuntos y envío explícito.
- Aprendizaje del estilo versionado.
- Tareas esperan envío real y respuesta; reconocer envíos fuera de consola.

**Salida:** Álvaro opera sus correos desde la mesa y su actividad externa se refleja.

### Etapa 4 — Extracción, fechas y publicación al cliente
- Procesamiento de correos/adjuntos y evaluación comparativa AnyDoc.
- Evidencia por campo, historial y reglas de conflicto.
- Fechas exactas, rangos y mes impreciso.
- Actualización de artefactos y documentos vigentes.
- Portal/MCP muestran estado actualizado sin revelar correspondencia interna.

**Salida:** el expediente se alimenta del trabajo diario con cambios explicables.

### Etapa 5 — Radiografía CEO y embarques del cliente
- Portada CEO: respuestas pendientes, próximas salidas de producción, flujo.
- Flujo de comisiones por marca y arbitraje por fechas de factura.
- Fuente del saldo inicial y conciliación de cobros/pagos.
- Portal de embarques con cambios, cantidades, documentos y acciones.
- Misma lectura estructurada para MCP.

**Salida:** vista intuitiva y útil, apoyada en información mantenida por etapas previas.

### Etapa 6 — Objetivos y evolución
- Acordar indicadores y referencias.
- Metas mensuales/trimestrales/anuales y evolución de clientes para CEO.
- Delegación a usuarios y refinamientos de automatización.
- No desplazar embarques como prioridad del cliente.

**Salida:** seguimiento estratégico sobre datos ya confiables.

## 13. Criterios de aceptación

| Caso | Resultado esperado |
|---|---|
| Crear por consola y MCP con intención equivalente | Mismo cliente, operador, cantidades y términos; diferencias de permisos explícitas. |
| Falla una línea al crear | No queda una OC/expediente parcialmente creado como éxito. |
| Reintentar alta, sincronización o extracción | No duplica pedidos, correos, documentos ni tareas. |
| OC con expedientes cliente/MWT | Cliente ve su conjunto sin márgenes/precios internos no autorizados. |
| Mismo pedido con dos salidas | Se muestran ambas, con cantidades, destinos y AWB/BL propios. |
| Anular antes de facturar/cobrar | Motivo conservado, asignación liberada una vez y tareas obsoletas canceladas. |
| Intentar traslado comercial con factura/anticipo | Regla de no reasignación aplicada en servidor según lo acordado. |
| Recrear para otro cliente | Nuevo SAP y condiciones; no expone identidad/documentos del anterior. |
| Registro un viernes | Consulta a 15 días hábiles sin contar sábados/domingos. |
| Fecha de producción en fin de semana | Reconfirmación calculada en días laborales y sin tarea en sábado/domingo. |
| Cambio manual de fecha de tarea | Reprocesar información no pisa el override. |
| Borrador no enviado | No inicia plazo de 3 días para respuesta. |
| Consulta enviada fuera de consola | Se registra y ajusta el seguimiento existente. |
| Respuesta inequívoca antes del seguimiento | Actualiza pendiente y evita correo obsoleto. |
| “Sin fecha” o “agosto” | No marca confirmación exacta; prepara insistencia y conserva evidencia. |
| “Agosto” para el cliente | Última semana estimada, pendiente de confirmación; no falsa certeza. |
| Cambio que afecta reserva | Aparece para revisión con su impacto. |
| Corrección del español | Traducción se actualiza; aprendizaje toma la edición española. |
| Enviar correo | Solo por acción explícita; se usa versión y adjuntos revisados. |
| Comisión por pago parcial el 1 de septiembre | Solo proporción aplicable, prevista del 10 al 20 de octubre; sin duplicar al conciliar. |
| Compra a 15 días, venta a 90 | Salida/entrada en sus fechas y desfase visible. |
| Saldo inicial desconocido | No presenta flujo neto como efectivo disponible. |
| Consulta cliente por MCP | Coincide con portal y no devuelve datos de otros clientes o campos internos. |

Validación: pruebas de negocio sobre operaciones de servidor; pruebas por rol; casos integrados de correo/tareas; revisión visual de pantallas reales; contraste con documentos autorizados. No usar datos demo como evidencia de producción.

## 14. Decisiones todavía abiertas

No es necesario resolverlas todas antes de empezar:

- Capacidades reales y mecanismo de conexión MCP Hostinger.
- Hora/zona horaria de programación; lunes–viernes ya acordado, feriados excluidos del alcance inicial.
- Alcance de lectura histórica de correo y criterio de contacto relevante.
- Primera comunicación: agrupada por marca/destinatarios o individual por expediente. Se propuso agrupar, no hubo decisión.
- Momento de insistencia ante respuesta vaga y tope de recordatorios; todos quedan sujetos al envío humano.
- Reconfirmación cuando la única fecha conocida es un mes.
- Política de tareas si una fecha ya estaba confirmada antes del primer vencimiento.
- Fuente/moneda del saldo inicial y detalle financiero de cálculo/conciliación.
- Reasignación de mercancía aún en producción.
- Unicidad de números de proforma entre emisores/años.
- Acciones del cliente por portal/MCP: consulta confirmada, escritura pendiente.
- Metas/KPI y dimensiones de evolución.
- Ventanas visuales propuestas: tres semanas de producción y 90 días de flujo.
- Selección de AnyDoc tras evaluación.

## 15. Instrucciones de entrega para Alejandro

Usar el harness integrado de forma proporcional: contratos claros, evidencia real, implementación por incrementos y verificación de resultado. Las decisiones de Álvaro en este plan prevalecen sobre propuestas anteriores del chat.

Primer trabajo recomendado:
1. Contrastar auditoría con el estado actual.
2. Confirmar conectividad de correo.
3. Diseñar una única operación de expediente y una lectura de embarques por OC.
4. Entregar el primer incremento de tareas/mesa con casos de aceptación verificables.

Este documento define el producto y la secuencia; no indica que se hayan conectado cuentas, enviado correos, instalado AnyDoc, creado automatizaciones, cambiado datos de clientes ni desplegado funcionalidades.

