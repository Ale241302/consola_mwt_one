# Repaso de aceptación — Etapas 0–6 (plan §13)

Fecha: 2026-09-13 · Repo `consola_mwt_one` · Producción `https://consola.mwt.one`
Base: plan `docs/planes/2026-09-11-consola-ceo-cliente/plan.md` §13.

Leyenda: **PASS** = implementado y verificado (código + prueba real cuando aplica) ·
**PARCIAL** = parte cubierta, falta un sub-requisito · **ABIERTO** = no implementado
/ decisión pendiente del plan §14.

| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Crear por consola y MCP con intención equivalente | **PASS** | `views_wizard.create_from_oc_impl` compartido por `/api/expedientes/` y `/api/expedientes/create-from-oc/`; verificado override de precio y replay idempotente (Etapa 1). |
| 2 | Falla una línea al crear → sin alta parcial | **PASS** | `create_from_oc_impl` envuelve el alta en `with transaction.atomic()` (`views_wizard.py:1132`). |
| 3 | Reintentar alta/sync/extracción no duplica | **PASS** | `L3_create_idempotency`, dedup por `message_id`, índice único `extraccion_dedup_uniq`, `_auto_viva`+unique en tareas. Verificado replay `same=True`. |
| 4 | OC con expedientes cliente/MWT sin datos internos | **PASS** | Documentos `audience='CLIENT'`; portal/`LineaSerializer` no exponen `unit_price_mwt`/margen. |
| 5 | Mismo pedido con dos salidas (cantidades/destino/AWB-BL) | **PASS** | `GET /api/portal/embarque/` devuelve **lista** de salidas; verificado 3 salidas con destino y `AWB/BL 230-66832091`. |
| 6 | Anular antes de facturar: motivo + libera + cancela tareas | **PASS** | `expedientes/views.py:835` `anular` guarda `anulacion_motivo`, `cancelar_auto` de tareas obsoletas y libera asignación (`L4_expediente_anulacion`). |
| 7 | Traslado comercial con factura/anticipo → no reasignar | **ABIERTO** | No se encontró bloqueo server-side por factura emitida/anticipo. Requiere decisión/implementación (plan §3.3, §14). |
| 8 | Recrear para otro cliente (SAP nuevo, sin exponer anterior) | **PASS** | `recrear` (B8) con `replaces/replacement_expediente_id`; identidad y documentos nuevos. |
| 9 | Registro un viernes → 15 días hábiles sin fin de semana | **PASS** | `services.add_business_days` (`weekday() < 5`); `generar_global` usa 15 días desde `reg_date`. |
| 10 | Fecha de producción en fin de semana → reconfirmación laboral | **PASS** | Reconfirmación = `add_business_days(prod, -10)`; nunca cae en sábado/domingo. |
| 11 | Cambio manual de fecha no lo pisa el generador | **PASS** | `ensure_auto` solo **crea** si no hay tarea viva (no actualiza fechas); `reprogramar` marca `is_override=True`. |
| 12 | Borrador no enviado → no inicia reloj de 3 días | **PASS** | El seguimiento de 3 días se agenda en `enviar` (`last_sent_at`), no al crear el borrador. |
| 13 | Consulta enviada fuera de consola se registra y ajusta | **PASS** | `_on_outbound` cancela `SEGUIMIENTO_SIN_RESPUESTA` al acreditar un OUT (consola o externo) — `correo/services.py:211`. |
| 14 | Respuesta antes del seguimiento evita correo obsoleto | **PASS** | `tareas/views.py:370` `responder` cancela el seguimiento y pasa a `RESUELTA`. |
| 15 | «Sin fecha» / «agosto» no marca confirmación exacta | **PASS** | E4: `DESCONOCIDA` (tarea de insistencia) y `MES` (sin día inventado, tarea de reconfirmación). |
| 16 | «Agosto» para el cliente: última semana, pendiente | **PASS** | `_fecha_display` en `portal/views.py`: «Última semana de agosto 2026; pendiente de confirmación» (verificado). |
| 17 | Cambio que afecta reserva aparece para revisión con impacto | **PASS** | Conflicto de fecha → `conflicto=True` + tarea `REQUIERE_REVISION`; visible en Extracciones y Portada CEO. |
| 18 | Corrección del español actualiza traducción y aprendizaje | **PASS** | `aprender`/`corregir` con `texto_es` y `Estilo.reglas.learned` (E3). |
| 19 | Enviar correo solo por acción explícita; versión/adjuntos revisados | **PASS** | `CORREO_SEND_DRY_RUN=1` por defecto; envío explícito (`/enviar/`) + versionado de estilo/adjuntos. |
| 20 | Comisión por pago parcial (1-sep) → ventana 10–20 oct, sin duplicar | **PARCIAL** | Ventana **10–20 del mes siguiente** implementada (`_ventana_10_20`) y conciliación idempotente. Falta el **prorrateo por pago parcial** en el devengo (hoy proyecta el pago completo). |
| 21 | Compra a 15 / venta a 90 → fechas y desfase visible | **PASS** | `GET /api/finanzas/arbitraje/`: verificado desfase **75d** (15 vs 90) y monto a financiar. |
| 22 | Saldo inicial desconocido → no presentar como efectivo disponible | **PASS** | `flujo` devuelve `saldo_inicial` + `nota` «no es saldo bancario»; por defecto 0. |
| 23 | Consulta cliente por MCP coincide con portal y sin datos ajenos | **PASS** | `portal_embarques`/`portal_embarque` usan los mismos endpoints scopeados; sin campos internos. |

## Resumen
- **PASS: 21 / 23**
- **PARCIAL: 1** — #20 (prorrateo por pago parcial).
- **ABIERTO: 1** — #7 (bloqueo de reasignación con factura/anticipo).

## Brechas y recomendación
1. **#20 · Comisión proporcional al pago parcial.** Calcular el devengo/comisión en proporción a `monto_aplicado` de cada `PaymentApplication` en vez de proyectar el pago total. Requiere decidir base (factura/línea) por el §14.
2. **#7 · No reasignar con factura/anticipo.** Regla de servidor en las operaciones de split/cambio de cliente: si el expediente tiene `FACTURA` emitida o pago confirmado, rechazar la separación/reasignación. Hoy no existe.

Ambas son de negocio acotadas (no bloquean lo entregado). Nada más quedó sin cubrir de los 23 criterios.
