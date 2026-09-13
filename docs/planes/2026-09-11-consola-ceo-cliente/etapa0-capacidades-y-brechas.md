# Etapa 0 — Contrato y comprobación de base

**Producto:** Consola MWT.ONE · **Rama:** `main` · **Commit del reconocimiento:** `dbc01b8` · **Fecha:** 13 de septiembre de 2026.

Reconocimiento ejecutado contra **producción** (VPS `187.77.218.102`): PostgreSQL `consola-mwt-one-postgres`, Django `consola-mwt-one-django`, API `https://consola.mwt.one`, y el proveedor **Hostinger Mail API** (solo lectura).

Salida de esta etapa: **mapa de capacidades, brechas reproducibles y backlog con alcance**. No modifica datos de negocio.

---

## 1. Alcance y método

| Frente | Cómo se comprobó |
|---|---|
| Tools MCP y permisos | Parseo de `mcp_server/mwt_mcp/tool_rbac.py` (`TOOL_MODULES`, `_ALWAYS`) cruzado con `@mcp.tool()` en `server.py`. |
| Hostinger Mail | Llamadas reales a la API `hm_*` (listado de buzones/carpetas/mensajes, lectura de texto, búsqueda, webhooks). |
| Esquema/triggers | Consultas a `information_schema`/`pg_proc`/`information_schema.triggers` y `public._applied_sql`, cruzadas con `backend/sql/*.sql`. |
| Casos de prueba | Consultas de datos reales (operadores, splits, comisiones, salidas) en PostgreSQL. |

---

## 2. Inventario de tools MCP y permisos

- **Total mapeadas:** **134** tools con `(módulo, acción)` + **5** tools *always* (visibles a cualquier identidad) = **139**.
- **Tools sin mapeo RBAC:** **0** (la suite `test_tool_rbac.py` lo exige).
- El listado se filtra por identidad: sin `*` en `modules`, sólo se exponen las tools cuyo `(módulo, acción)` está en los permisos del rol.

### 2.1 Conteo por módulo y acciones

| Módulo | Tools | Acciones (`view/create/update/delete/upload_doc/download_doc/view_doc`) |
|---|---:|---|
| expedientes | 44 | view 17 · update 16 · create 5 · delete 2 · upload_doc 2 · view_doc 1 · download_doc 1 |
| transferencias | 21 | update 10 · view 6 · create 4 · delete 1 |
| nodos | 10 | view 5 · update 3 · create 2 |
| productos | 9 | view 6 · create 2 · update 1 |
| pagos | 8 | update 3 · view 3 · create 2 |
| analytics | 7 | view 7 |
| inventario | 7 | view 5 · create 1 · update 1 |
| builder | 6 | view 3 · create 1 · update 1 · delete 1 |
| clientes | 6 | view 4 · create 1 · update 1 |
| dashboard | 6 | view 6 |
| finanzas | 5 | view 5 |
| storage | 2 | create 1 · download_doc 1 |
| marcas | 1 | view 1 |
| roles | 1 | view 1 |
| sizing | 1 | view 1 |

### 2.2 Tools *always* (sin control de módulo)

`mwt_whoami`, `mwt_health`, `mwt_guia_rol`, `mwt_audit_write_registry`, `tipo_cambio`.

### 2.3 Brechas MCP detectadas

- **No existen tools MCP para `tareas`** (Etapa 2) ni **`correo`** (Etapa 3). Hoy el agente no puede operar la mesa de tareas ni la bandeja por MCP.
- No hay tool de **embarques plurales** por expediente (sólo `expediente_obtener` / `shipping-summary` internos).
- `finanzas_*` están como `view` y existen; no hay tool de **arbitraje/flujo** (Etapa 5).

---

## 3. Verificación de Hostinger Mail y mecanismo de sync

Se comprobó la API de Hostinger Mail (solo lectura) sobre la cuenta de Muito Work:

| Capacidad | Resultado |
|---|---|
| Listar buzones | OK — 4: `alvaro@`, `alejandro@`, `conta@`, `506@` (todas `@muitowork.com`). |
| Uso/límite de buzón | OK (`hm_get_quota` disponible). |
| Carpetas | OK — **110 carpetas**. `INBOX` (16 192 mensajes, 20 sin leer), `INBOX.Sent` (2 522), `INBOX.Drafts` (0), `INBOX.Archive`, `INBOX.Junk`, `INBOX.Trash`. |
| Listar mensajes | OK — con `messageId`, `inReplyTo`, flags y **adjuntos** (filename, mime, size). |
| Leer cuerpo | OK — `hm_get_message_text` devuelve texto + HTML. |
| Buscar | OK — `hm_search_messages` (IMAP SEARCH por asunto/cuerpo/fechas/tamaño). |
| Adjuntos | OK — descargables (`hm_download_attachment`). |
| Mover / flags / borrar | Herramientas disponibles (no ejecutadas). |
| Webhooks | **Sin webhooks configurados** (0). |

**Hallazgo relevante:** las carpetas ya codifican el negocio, p. ej. `INBOX.UMMIE.2478-2479-2026 · MAWB 729-91600806`, `INBOX.IMPORCOMP GUA.2410-2026 · AWB 230-6763-6645`. Sirven como referencia de proforma/AWB para correlación.

### Decisión de mecanismo de sync (Etapa 3)

1. **Primario — IMAP server-side (ya implementado):** `apps.correo.services.sync_mailbox()` con `CORREO_IMAP_*` (host `imap.hostinger.com:993`, usuario = buzón, contraseña de aplicación). Carpetas por defecto `INBOX` y `INBOX.Sent`. Dedup por `Message-ID`. Requiere cargar credenciales; hoy el sync es **no-op** sin ellas.
2. **Secundario — puente MCP → API:** el agente lee con `hm_*` y hace `POST /api/correo/mensajes/importar/` (ya probado: correlación AUTO por proforma/SAP).
3. **Futuro — Webhooks:** `hm_create_webhook` (`message.received`) contra un endpoint público firmado. No configurado.

---

## 4. Contraste esquema/triggers vs. `backend/sql` y modelos

- **SQL aplicados en la BD:** **189** (`public._applied_sql`).
- **Archivos `backend/sql/*.sql` locales:** **186**, **todos aplicados** (diferencia 0).
- Los 3 restantes en `_applied_sql` son de arranque (`./database`): `01_init.sql`, `02_auth_admin.sql`, `99_seed.sql` (el local `99_seed.sql.disabled` está deshabilitado a propósito).
- **Conclusión: sin drift** entre `backend/sql` y el esquema desplegado.

### 4.1 Tablas por schema (producción)

`ai 8 · amazon_ads 3 · analytics 1 · brands 7 · clientes 13 · cobros 12 · commercial 5 · core 13 · correo 6 · dashboard 2 · email_templates 5 · expedientes 18 · finance 11 · financiero 1 · inventario 15 · nodos 7 · notifications 5 · ops 4 · pipeline 2 · portal 3 · pricing 10 · productos 12 · proveedores 12 · public 4 · staging_cb 5 · tareas 3 · tickets 5 · transfers 9 · users 9`

### 4.2 Funciones de negocio desplegadas (no sólo modelos)

`clientes.comision_pct_for`, `clientes.familia_from_sku`, `expedientes.linea_default_commission`, `expedientes.tg_update_expediente_product_count`, `finance.finance_activity_log_immutable`, `finance.next_payment_codigo`, `inventario.recompute_recepcion_totals`, `transfers.recompute_transfer_total_cost`, `transfers.fn_sync_has_discrepancy`, `users.sync_role_permissions_to_core`, `core.token_denylist_cleanup`, entre otras.

### 4.3 Triggers relevantes

- `expedientes.linea :: trg_linea_default_commission` (comisión por línea, K3).
- `expedientes.expediente :: tg_exp_upd`, `expedientes.oc :: tg_oc_upd`.
- `transfers.cost_line :: tg_costline_recompute` (+ `tg_costline_upd`), `transfers.transferencia :: trg_sync_has_discrepancy`.
- `users.role_permission :: tg_role_permission_sync` → materializa a `core.roles` (JWT/MCP).
- `finance.activity_log :: tg_activity_log_no_update` / `no_delete` (append-only).
- `inventario.recepcion_linea :: tg_rec_linea_recompute`, `inventario.stock :: tg_stock_updated`.

> Nota: hay triggers **duplicados por nombre** en `information_schema.triggers` para una misma tabla/evento distinto (p. ej. `expedientes.linea :: tg_linea_product_count` x3, `transfers.cost_line :: tg_costline_recompute` x3). Es esperable cuando un trigger cubre varios eventos; no es un error, pero conviene confirmarlo con `pg_trigger` si se toca esa tabla.

---

## 5. Casos de prueba autorizados (datos reales)

| # | Caso | ¿Existe hoy? | Referencia real |
|---|---|---|---|
| 1 | **Dos operadores** (MWT opera vs. cliente opera) | Sí | `EXP-2026-0001` (cliente Sondel S.A., operador **Muito Work Limitada**); `EXP-2026-0013` (cliente = operador Sondel S.A.). |
| 2 | **Split de expediente** | Sí | `EXP-IyC 003-2026-2` (split de `EXP-IyC 003-2026`) y `EXP-UMMIE-2026-02-2`. |
| 3 | **Comisión mixta por línea** (bases distintas) | Sí | Expediente `0a1a9612-9742-49c0-af62-27e9262b8ba6` con `commission_pct` 5 % y 10 %. |
| 4 | **OC con varios expedientes** | **No** | Ninguna OC agrupa >1 expediente activo → hay que **construirlo** para probar OC→expedientes. |
| 5 | **Mismo pedido con varias salidas (2 AWB/BL)** | **No** | Ningún expediente tiene ≥2 transferencias activas por asignación → **construirlo**. |
| 6 | **Pago parcial + comisión proporcional** | **No** | No hay ≥2 pagos por expediente en `cobros.pago` → **construirlo** (o validar con la lógica de líneas del caso 3). |

Los casos 4–6 deben crearse en un entorno de prueba autorizado (no en producción) antes de la Etapa 5.

---

## 6. Brechas y backlog (estado tras el cierre del backlog bloqueante)

| # | Brecha | Estado | Qué debes hacer tú (owner) | Qué ya hice yo (código) |
|---|---|---|---|---|
| B1 | Claves LLM inválidas (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` → **401**) | **Bloqueado por clave** | Cargar una clave válida (OpenAI o Anthropic) en el env del contenedor `django` | Helper `ai_hub/llm_text.py` (OpenAI → Anthropic por HTTP directo) + endpoint de diagnóstico |
| B2 | Sync IMAP apunta a `mail.mwt.one` (mailcow), no a Hostinger | **Parcial** | Definir `CORREO_IMAP_HOST=imap.hostinger.com`, `CORREO_IMAP_USER=alvaro@muitowork.com`, `CORREO_IMAP_PASSWORD=<app password>` | `sync_mailbox` (IMAP) + `diagnostico_imap` para verificar sin exponer credenciales |
| B3 | Envío de correo real sin dry-run | **Hecho** | Nada (opcional: `CORREO_SEND_DRY_RUN=0` cuando quieras envío real) | `CORREO_SEND_DRY_RUN=1` por defecto; respuesta `{"dry_run":true}` sin enviar |
| B4 | Adjuntos sólo metadata | **Hecho** | Nada | Adjuntos suben a **MinIO** (sync/import/upload) + endpoint de **URL firmada** |
| B5 | Sin tools MCP de `tareas`/`correo` | Pendiente | Nada | — (a implementar en E2/E3 si se quiere operar por MCP) |
| B6 | Creación no unificada | Pendiente | Decidir si se unifica ahora | — |
| B7 | Alta interna sin `idempotence_token` | Pendiente | Nada | — |
| B8 | Sin “anular/recrear” con motivo y vínculo | Pendiente | Regla: no reasignar tras factura/anticipo | — |
| B9 | Lecturas por rol incompletas (portal/MCP) | Pendiente | Nada | — |
| B10 | Casos 4–6 de prueba inexistentes | **Receta lista** | Autorizar entorno de prueba | Recipe de construcción (abajo) |

### B10 — Cómo construir los casos de prueba 4–6 (entorno de prueba)

No se ejecutó en producción. Vía consola o MCP, en un entorno autorizado:

1. **OC con varios expedientes.** Crear dos expedientes que compartan `oc_id`:
   - `expediente_crear(client_id, lines=[...])` → crea `EXP-A`.
   - `oc_editar(EXP-A.oc_id, ...)` no cambia OC; para el segundo, `expediente_crear(..., oc_id=EXP-A.oc_id)` con `lines=[...]`.
   - Verificar: `SELECT oc_id, count(*) FROM expedientes.expediente WHERE is_active GROUP BY 1 HAVING count(*)>1;`
2. **Mismo pedido con 2 AWB/BL.** Dos salidas del mismo expediente:
   - `transferencia_crear(origen, destino, lineas=[...])` → `TRF-1`; enlazar con `inventario_transferir_asignaciones(..., transferencia_id=TRF-1)`.
   - Repetir con `TRF-2`. Verificar `shipping-summary` devolviendo `transferencias[]` con 2.
3. **Pago parcial + comisión proporcional.** Base: expediente `0a1a9612-9742-49c0-af62-27e9262b8ba6` (comisión 5 %/10 %):
   - `pago_applicables(type=PROFORMA, expediente=...)` → `applicable_id`.
   - `pago_registrar(..., tipo_pago=PARCIAL, aplicaciones=[{monto_aplicado: 50%}])` ×2 y `pago_conciliar` cada uno.

---

## 6.b Acciones pendientes del owner (resumen)

Para desbloquear el backlog externo sólo faltan **dos cosas tuyas**:

1. **Clave LLM válida** (B1) en el env del contenedor `django` (p. ej. `ANTHROPIC_API_KEY`). Verificar con
   `GET /api/correo/mensajes/diagnostico/` → debe pasar de `err: HTTP 401` a `"anthropic":"ok"`.
2. **Credenciales IMAP de Hostinger** (B2) en el env: `CORREO_IMAP_HOST`, `CORREO_IMAP_USER`, `CORREO_IMAP_PASSWORD`.
   Verificar con el mismo endpoint → `imap.ok=true` y `host=imap.hostinger.com`.

Todo lo demás del backlog bloqueante (**B3, B4**) ya quedó implementado y verificado.

---

## 7. Enlaces de evidencia

- Tools MCP: `mcp_server/mwt_mcp/tool_rbac.py` (`TOOL_MODULES`), `mcp_server/mwt_mcp/server.py`.
- Hostinger: `hostinger_mail_mcp/server.py` (tools `hm_*`); API verificada en vivo (solo lectura).
- Correo backend: `backend/apps/correo/services.py` (`sync_mailbox`, `correlacionar`, `enviar_envio`).
- Esquema: `backend/sql/` + `public._applied_sql`.
- Plan y auditoría origen: `docs/planes/2026-09-11-consola-ceo-cliente/{plan.md, auditoria-nueva-oc.md}`.

---

## Anexo A — Inventario completo de tools MCP (134)

| Tool | Módulo | Acción |
|---|---|---|
| `aging_chart` | analytics | view |
| `artefacto_archivo_descargar` | storage | download_doc |
| `artefacto_editar` | nodos | update |
| `artefacto_publicar` | nodos | update |
| `builder_artefacto_crear` | builder | create |
| `builder_artefacto_editar` | builder | update |
| `builder_artefacto_eliminar` | builder | delete |
| `builder_artefacto_listar` | builder | view |
| `builder_artefacto_obtener` | builder | view |
| `builder_structure_construir` | builder | view |
| `builder_template_obtener` | nodos | view |
| `builder_templates_listar` | nodos | view |
| `cashflow_chart` | analytics | view |
| `cliente_crear` | clientes | create |
| `cliente_editar` | clientes | update |
| `cliente_kpis_pool` | clientes | view |
| `cliente_listar` | clientes | view |
| `cliente_obtener` | clientes | view |
| `cliente_subsidiarias` | clientes | view |
| `comparar` | dashboard | view |
| `dashboard_resumen` | analytics | view |
| `documento_descargar` | expedientes | download_doc |
| `documento_editar` | expedientes | update |
| `documento_eliminar` | expedientes | delete |
| `documento_listar` | expedientes | view_doc |
| `documento_subir` | expedientes | upload_doc |
| `expediente_apply_pronto_pago` | expedientes | update |
| `expediente_avanzar_estado` | expedientes | update |
| `expediente_buscar` | expedientes | view |
| `expediente_buscar_por_producto` | expedientes | view |
| `expediente_crear` | expedientes | create |
| `expediente_desfusionar` | expedientes | update |
| `expediente_documentos_completos` | expedientes | view |
| `expediente_edit_full_get` | expedientes | view |
| `expediente_edit_full_patch` | expedientes | update |
| `expediente_editar` | expedientes | update |
| `expediente_eliminar` | expedientes | delete |
| `expediente_envio_backfill` | expedientes | update |
| `expediente_eventos` | expedientes | view |
| `expediente_fusion_label` | expedientes | update |
| `expediente_fusionar` | expedientes | update |
| `expediente_lineas` | expedientes | view |
| `expediente_listar` | expedientes | view |
| `expediente_obtener` | expedientes | view |
| `expediente_phase_durations_get` | expedientes | view |
| `expediente_phase_durations_set` | expedientes | update |
| `expediente_resolve_oc_preview` | expedientes | create |
| `expediente_tiempos` | expedientes | view |
| `expedientes_crear_lote` | expedientes | create |
| `exportar_csv` | dashboard | view |
| `exportar_xlsx` | dashboard | view |
| `exposicion_chart` | analytics | view |
| `factura_payload` | expedientes | view |
| `finanzas_cliente` | finanzas | view |
| `finanzas_comisiones` | finanzas | view |
| `finanzas_commission_by_month` | finanzas | view |
| `finanzas_margin_scatter` | finanzas | view |
| `finanzas_overview` | finanzas | view |
| `generar_grafico` | dashboard | view |
| `generar_reporte` | dashboard | view |
| `inventario_artefactos_expediente` | inventario | view |
| `inventario_expedientes_con_pendiente` | inventario | view |
| `inventario_lineas_en_nodo` | inventario | view |
| `inventario_saldos_por_expediente` | inventario | view |
| `inventario_transferir_asignaciones` | inventario | update |
| `lineas_actualizar_precios` | expedientes | update |
| `marca_listar` | marcas | view |
| `margen_marcas_chart` | analytics | view |
| `match_resolver` | expedientes | update |
| `match_subir` | expedientes | upload_doc |
| `mwt_diag_scope` | roles | view |
| `ncm_listar` | productos | view |
| `nodo_artefacto_crear` | nodos | create |
| `nodo_artefactos_listar` | nodos | view |
| `nodo_crear` | nodos | create |
| `nodo_editar` | nodos | update |
| `nodo_listar` | nodos | view |
| `nodo_obtener` | nodos | view |
| `oc_editar` | expedientes | update |
| `oc_listar` | expedientes | view |
| `oc_obtener` | expedientes | view |
| `pago_applicables` | pagos | view |
| `pago_conciliar` | pagos | update |
| `pago_dry_run` | pagos | create |
| `pago_liberar_credito` | pagos | update |
| `pago_listar` | pagos | view |
| `pago_obtener` | pagos | view |
| `pago_rechazar` | pagos | update |
| `pago_registrar` | pagos | create |
| `producto_alias_crear` | productos | create |
| `producto_buscar` | productos | view |
| `producto_crear` | productos | create |
| `producto_editar` | productos | update |
| `producto_ficha_tecnica` | productos | view |
| `producto_listar` | productos | view |
| `producto_obtener` | productos | view |
| `producto_precio_cliente` | productos | view |
| `proforma_documento` | expedientes | view |
| `proforma_generar` | expedientes | create |
| `proforma_html` | expedientes | view |
| `recepcion_crear` | inventario | create |
| `render_tabla` | dashboard | view |
| `reporte_cobranza` | analytics | view |
| `reporte_expedientes` | analytics | view |
| `sap_analizar` | expedientes | view |
| `sap_confirmar` | expedientes | update |
| `sap_editar` | expedientes | update |
| `sap_obtener` | expedientes | view |
| `sap_sincronizar_discrepancias` | expedientes | update |
| `sap_upsert` | expedientes | create |
| `stock_listar` | inventario | view |
| `storage_subir_archivo` | storage | create |
| `tallas_listar` | sizing | view |
| `transfer_artefacto_crear` | transferencias | create |
| `transfer_costo_agregar` | transferencias | create |
| `transfer_costo_editar` | transferencias | update |
| `transfer_costo_eliminar` | transferencias | delete |
| `transfer_costos_listar` | transferencias | view |
| `transfer_factura_payload` | transferencias | view |
| `transfer_liquidacion_preview` | transferencias | view |
| `transfer_liquidar` | transferencias | update |
| `transfer_nota_crear` | transferencias | create |
| `transfer_notas_listar` | transferencias | view |
| `transferencia_aprobar` | transferencias | update |
| `transferencia_avanzar` | transferencias | update |
| `transferencia_cancelar` | transferencias | update |
| `transferencia_cerrar` | transferencias | update |
| `transferencia_conciliar` | transferencias | update |
| `transferencia_crear` | transferencias | create |
| `transferencia_despachar` | transferencias | update |
| `transferencia_editar` | transferencias | update |
| `transferencia_listar` | transferencias | view |
| `transferencia_obtener` | transferencias | view |
| `transferencia_recibir` | transferencias | update |
