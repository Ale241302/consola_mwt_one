# Auditoría técnica integral — `solucion_puntos_pendientes_costa_rica_sondel.md`

Fecha: 2026-06-24
Repo: `consola_mwt_one`
Alcance: backend Django/DRF, SQL-first `backend/sql/*.sql`, frontend React/Vite, MCP `mcp_server/mwt_mcp/server.py`.
Generado por: codex `-p fugu` (auditoría multi-pasada: orquestador → backend/MCP → SQL → frontend → auditores adversariales). Volcado a este archivo por Claude porque el sandbox del provider bloqueó la escritura directa.

## 1. Resumen ejecutivo

**Veredicto:** el archivo `solucion_puntos_pendientes_costa_rica_sondel.md` es **mayoritariamente correcto como guía operativa**, pero **no es plenamente correcto como descripción de la "manera correcta" según el código real**.

**Confianza:** 86%.

### Lo correcto

- El MCP expone las herramientas citadas. `server.py` tiene 99 decoradores `@mcp.tool()`.
- Las firmas clave existen:
  - `sap_confirmar(expediente_id, sap_id, lineas_confirmadas, fecha_fabricacion, file_path)`.
  - `transfer_costo_agregar(transferencia_id, kind, amount, label, currency, fx_to_usd, price_view, scope_json, ...)`.
  - `transferencia_recibir(transferencia_id, lineas, ...)`.
  - `recepcion_crear(items, cost_lines, recepcion_id)`.
- El modelo de líneas de expediente sí soporta precios duales:
  - `unit_price_mwt`
  - `unit_price_client`
- El SQL soporta `scope_json`, `price_view`, `phase_durations_json`, `fusion_id`, `fusion_label`, nodos, recepciones, transferencias y landed cost.
- El frontend refleja precios duales, fusión visual, recepción por línea y paneles de costo/liquidación.

### Lo incorrecto o riesgoso

- 🔴 El `.md` afirma que la liquidación excluye IVA. **Falso en backend actual.**
- 🔴 El `.md` prescribe DAI por NCM con `scope_json` por línea. El esquema lo guarda, pero **el motor de liquidación no lo usa**.
- 🟡 La fusión de expedientes es **solo visual**, no consolidación real.
- 🟡 `transferencia_recibir` no exige completitud estricta de `qty_received` en backend.
- 🟡 `phase_durations_set` guarda overrides manuales, no eventos canónicos.
- 🟡 El ejemplo `≈459.50 ₡/USD` está desalineado con fallback real `505.0`.

---

## 2. Tabla priorizada de hallazgos

| Prioridad | Severidad | Área | Descripción | Evidencia | Corrección recomendada |
|---|---:|---|---|---|---|
| P0 | 🔴 Crítico | Backend / .md / Frontend | El `.md` dice que IVA no suma y que la liquidación lo excluye; el backend suma toda `CostLine` activa, incluyendo `IVA` si existe. | `.md:190`; `backend/apps/transfers/liquidation.py:53-74`; `backend/sql/91e_transfers_cost_lines.sql:60-61`; `frontend/src/pages/CreateTransferWizard.jsx:52-53`, `:1535` | Implementar exclusión backend de IVA o bandera `capitalizable=false`; corregir el `.md` para decir que hoy el backend NO lo excluye. |
| P0 | 🔴 Crítico | Backend / SQL / .md | `scope_json` para DAI por NCM existe, pero `transfer_liquidar` no lo aplica. | `.md:176-183`; `backend/sql/91l_cost_line_scope.sql:13-24`, `:33`; `backend/apps/transfers/models.py:317-325`; `backend/apps/transfers/liquidation.py:53-74` | Hacer que `calcular_liquidacion()` aplique `scope_json.lines` / `expediente_ids`; agregar tests multi-NCM. |
| P1 | 🟡 Importante | Backend / SQL / Frontend | `price_view` existe pero la liquidación backend no filtra por vista. | `backend/sql/91m_cost_line_price_view.sql:19-30`, `:45-57`; `backend/apps/transfers/models.py:310-313`; `frontend/src/components/transfers/TransferLiquidationPanel.jsx:516-523`; `backend/apps/transfers/liquidation.py:53-74` | Decidir si costos son compartidos o por vista; alinear backend, frontend y docs. |
| P1 | 🟡 Importante | Backend / .md | `transferencia_recibir` no exige payload completo; si faltan cantidades puede pasar a `RECEIVED` con líneas `PENDING_REVIEW`. | `backend/apps/transfers/views.py:100-102`, `:1052`, `:1061-1080`; `mcp_server/mwt_mcp/server.py:992` | Backend debe rechazar recepción incompleta o documentar explícitamente el contrato débil. |
| P1 | 🟡 Importante | Backend / SQL / .md | `expediente_fusionar` es fusión visual, no fusiona líneas/SAP/documentos/movimientos. | `backend/sql/E3_expedientes_fusion.sql:2`, `:8-13`, `:30-31`; `backend/apps/expedientes/views.py:1133-1134`, `:1163-1166` | Cambiar `.md`: "agrupar visualmente". Si se requiere fusión real, diseñar proceso transaccional. |
| P1 | 🟡 Importante | Backend / .md | `phase_durations_set` guarda overrides manuales `{start,end,days}` en JSON, no eventos. | `backend/apps/expedientes/views.py:1057-1063`, `:1116`, `:1127-1128`; `backend/sql/E1_expedientes_phase_durations.sql:4`, `:19` | Matizar: "override manual para cronograma/reporte; eventos reales siguen en `event_log`". |
| P1 | 🟡 Importante | Backend / .md | Tipo de cambio: el `.md` usa `≈459.50 ₡/USD`, pero fallback real es `505.0`. | `.md:192`; `backend/apps/commercial/views.py:1933-1936`; `mcp_server/mwt_mcp/server.py:266` | Quitar número fijo o documentar fallback actual. |
| P2 | 🟢 Menor | MCP / .md | `documento_subir` funciona, pero la docstring MCP recomienda `match_subir` para OC/Proforma si se requiere mapping/cross-check. | `mcp_server/mwt_mcp/server.py:525-555` | Ajustar checklist: `match_subir` para OC/Proforma cuando aplique; `documento_subir` para documentos ya resueltos. |
| P2 | 🟢 Menor | Frontend | UI crea `cost_lines` con `scope_json` pero sin `price_view`; queda default MWT. | `frontend/src/pages/CreateTransferWizard.jsx:439-449`; `backend/apps/transfers/models.py:313` | Añadir selector `price_view` si se requiere vista cliente. |
| P2 | 🟢 Menor | Nodos / UI | Ejemplos de `nodo_crear` no incluyen `capabilities`; backend no bloquea si vacío, pero UI filtra por `DISPATCH`/`RECEIVE`. | `backend/apps/nodos/views.py:65-69`; `backend/apps/transfers/serializers.py:100-116`, `:268-286`; `frontend/src/pages/CreateTransferWizard.jsx:48`, `:251` | Crear nodos con `capabilities:["store","dispatch","receive"]`. |

---

## 3. MCP / Backend

### 3.1 Cobertura MCP

Confirmado por lectura de `mcp_server/mwt_mcp/server.py`.

Herramientas clave:

- `tipo_cambio(par="usd-crc")`: `mcp_server/mwt_mcp/server.py:266`.
- `expediente_buscar`: `server.py:305`.
- `expediente_resolve_oc_preview(client_id, lines)`: `server.py:351`.
- `lineas_actualizar_precios(updates)`: `server.py:456`.
- `sap_analizar(expediente_id, file_path)`: `server.py:593`.
- `sap_confirmar(...)`: `server.py:603`.
- `sap_upsert(...)`: `server.py:622`.
- `proforma_generar(...)`: `server.py:720`.
- `recepcion_crear(...)`: `server.py:880`.
- `transferencia_crear(...)`: `server.py:931`.
- `transferencia_recibir(...)`: `server.py:992`.
- `transfer_costo_agregar(...)`: `server.py:1031`.
- `transfer_liquidar(...)`: `server.py:1101`.

`client.py` inyecta Bearer token:

- `mcp_server/mwt_mcp/client.py:29`
- `mcp_server/mwt_mcp/client.py:53`

`config.py` usa:

- `MWT_API_BASE`: `mcp_server/mwt_mcp/config.py:13-14`
- `MWT_MCP_TOKEN`: `config.py:16`
- `require_token()`: `config.py:23-28`

### 3.2 SAP

Confirmado.

`server.py`:

- `sap_confirmar(expediente_id, sap_id, lineas_confirmadas, fecha_fabricacion, file_path)`: `server.py:603-618`.

Backend:

- Lee `sap_id`, `fecha_fabricacion`, `lineas_confirmadas`: `backend/apps/expedientes/views.py:1558-1560`.
- Valida lista: `views.py:1563-1573`.
- Valida fecha ISO: `views.py:1579-1583`.
- Exige `REGISTRO`: `views.py:1591`.
- Actualiza líneas con SAP: `views.py:1822-1827`.
- Transiciona expediente a `PRODUCCION`: `views.py:1842-1844`.

`upsert_sap` acepta estados posteriores:

- `backend/apps/expedientes/views.py:1933`
- `views.py:4039-4046`

### 3.3 Precios duales

Confirmado.

Modelo:

- `backend/apps/expedientes/models.py:213-216`.

SQL:

- `backend/sql/C0_expedientes_operating_company.sql:10-11`
- `backend/sql/C0_expedientes_operating_company.sql:28-41`

Endpoint bulk:

- `backend/apps/expedientes/views.py:4444-4456`
- `views.py:4536-4551`

MCP:

- `mcp_server/mwt_mcp/server.py:456-464`

Frontend:

- `frontend/src/pages/ExpedienteDetail.jsx:1022-1030`
- `frontend/src/pages/ExpedienteDetail.jsx:1475-1484`
- `frontend/src/pages/OCDetail.jsx:390-397`
- `frontend/src/pages/FusionDetail.jsx:510-522`, `:1073-1094`

### 3.4 Transferencias

Estados y transiciones confirmadas:

- Catálogo: `backend/sql/90_transfers.sql:27-32`.
- Transiciones: `backend/sql/91_transfers_audit.sql:60-69`.
- Actions: `backend/apps/transfers/views.py:1028`, `:1036`, `:1049`, `:1151`, `:1215`, `:1229-1237`.

Problema de recepción:

- `_recompute_line_discrepancy()` devuelve `PENDING_REVIEW` si `qty_received is None`: `backend/apps/transfers/views.py:100-102`.
- `receive` documenta body opcional: `views.py:1052`.
- `lineas_payload` puede ser vacío: `views.py:1061`.
- Solo actualiza cantidad si viene patch: `views.py:1066-1068`.
- Si no hay `OVER/UNDER`, puede pasar a `RECEIVED`: `views.py:1080`.

### 3.5 Liquidación: IVA y scope

Crítico.

`liquidation.py`:

- Algoritmo declara `extra_costs_usd = SUM(amount * fx_to_usd) de cost_lines activas`: `backend/apps/transfers/liquidation.py:8-10`.
- Carga todas las cost lines activas: `liquidation.py:53-55`.
- Suma todas: `liquidation.py:72-74`.

No hay exclusión de `IVA`.
No hay lectura de `scope_json`.
No hay filtro por `price_view`.

SQL sí soporta:

- `IVA` como kind: `backend/sql/91e_transfers_cost_lines.sql:60-61`.
- `scope_json`: `backend/sql/91l_cost_line_scope.sql:13-24`, `:33`.
- `price_view`: `backend/sql/91m_cost_line_price_view.sql:19-30`, `:45-57`.

Frontend permite IVA:

- `frontend/src/pages/CreateTransferWizard.jsx:52-53`.
- OCR DUA menciona DAI, IVA, PROCOMER, timbres y Ley 6946: `CreateTransferWizard.jsx:1535`.

`TransferLiquidationPanel` calcula preview con IVA separado, pero persiste llamando backend:

- Preview: `frontend/src/components/transfers/TransferLiquidationPanel.jsx:641-653`, `:689-703`.
- Persistencia: `TransferLiquidationPanel.jsx:1147-1155`.

---

## 4. SQL-first

Confirmado que el esquema moderno está en `backend/sql/*.sql`; `database/*.sql` contiene inicialización más legacy.

Columnas/tablas relevantes:

- Fases expediente: `backend/sql/70_expedientes.sql:44-51`.
- Expediente base: `70_expedientes.sql:123-130`.
- Líneas: `70_expedientes.sql:206-220`.
- `operating_company_id`: `backend/sql/C0_expedientes_operating_company.sql:18-25`.
- Precios duales: `C0_expedientes_operating_company.sql:28-41`.
- `phase_durations_json`: `backend/sql/E1_expedientes_phase_durations.sql:4`, `:19`.
- Fusión visual: `backend/sql/E3_expedientes_fusion.sql:8-13`, `:22-31`.
- Transfer states: `backend/sql/90_transfers.sql:27-32`.
- Transfer transitions: `backend/sql/91_transfers_audit.sql:60-69`.
- Cost lines: `backend/sql/91e_transfers_cost_lines.sql:75-83`.
- CR cost kinds: `backend/sql/D6_cr_dua_cost_kinds.sql:20-27`.
- `scope_json`: `backend/sql/91l_cost_line_scope.sql:33`.
- `price_view`: `backend/sql/91m_cost_line_price_view.sql:30`.
- Landed cost columns: `backend/sql/91g_transfers_landed_cost.sql:42-62`.
- `unit_cost/unit_value` 4 decimales: `backend/sql/D5_transfers_linea_4dp.sql:3-8`, `:40-42`.
- Asignaciones de expediente a nodo: `backend/sql/65b_expediente_nodo_assignment.sql:30-40`.

Conclusión SQL: el esquema respalda muchas afirmaciones del `.md`, pero **el motor backend no implementa aún toda la semántica que el esquema permite**.

---

## 5. Frontend

### Confirmado

- Precios duales visibles/editables:
  - `ExpedienteDetail.jsx:1022-1030`
  - `FusionDetail.jsx:510-522`
- Fusión visual:
  - `Expedientes.jsx:143-146`
  - `Expedientes.jsx:508-524`
  - `Expedientes.jsx:989-1009`
- Recepción por línea:
  - `TransferDetail.jsx:16-17`
  - `TransferDetail.jsx:430-448`
- Transfer wizard envía `cost_lines` con `scope_json`:
  - `CreateTransferWizard.jsx:439-449`

### Riesgos

- UI permite `IVA` como costo capitalizable.
- UI preview puede diferir de persistencia backend.
- UI no envía `price_view` en creación de transferencia.
- El panel frontend comenta que los costos son compartidos entre vistas y no filtra por `price_view`:
  - `frontend/src/components/transfers/TransferLiquidationPanel.jsx:516-523`

---

## 6. Verificación punto por punto

| Afirmación | Estado | Evidencia |
|---|---:|---|
| No hardcodear token | ✅ | `.md:20-29`; `config.py:13-16`, `:23-28`; no se encontró JWT `eyJ...`. |
| Tools MCP listadas existen | ✅ | `server.py`, 99 tools; firmas citadas arriba. |
| `sap_confirmar` firma correcta | ✅ | `server.py:603-618`. |
| `sap_confirmar` exige `REGISTRO` | ✅ | `views.py:1591`. |
| `sap_upsert` para estados posteriores | ✅ | `views.py:1933`, `:4039-4046`. |
| Precios duales en líneas | ✅ | `models.py:213-216`; SQL C0 `:28-41`. |
| `lineas_actualizar_precios` actualiza ambos | ✅ | `server.py:456-464`; `views.py:4444-4551`. |
| `proforma_generar` después de líneas | ✅ | `server.py:720-730`. |
| Fases `REGISTRO..CERRADO` existen | ✅ | `70_expedientes.sql:44-51`. |
| `phase_durations_set({start,end})` | ✅/⚠️ | Guarda overrides JSON, no eventos: `views.py:1116`, `:1127-1128`. |
| Nodos crear/listar | ✅/⚠️ | Tool existe; recomendar capabilities explícitas. |
| `recepcion_crear` existe | ✅ | `server.py:880-892`; inventario bulk `views.py:668-781`. |
| Máquina de estados transfer | ✅ | `91_transfers_audit.sql:60-69`. |
| `transferencia_recibir` exige líneas | ⚠️ | Tool sí, backend no estrictamente: `views.py:1052-1080`. |
| Cost kinds CR | ✅ | `91e_transfers_cost_lines.sql:60-66`; `D6_cr_dua_cost_kinds.sql:20-27`. |
| DAI scope por NCM | ❌ | Se guarda `scope_json`, pero `liquidation.py` lo ignora. |
| IVA no costo | ✅ como regla operativa | Pero no enforced. |
| Liquidación excluye IVA | ❌ | Falso: `liquidation.py:53-74`. |
| `transfer_liquidar(BY_VALUE)` | ✅ | `server.py:1101-1106`; `views.py:924-945`. |
| Tipo cambio MCP | ✅ | `server.py:266-277`. |
| `≈459.50 ₡/USD` | ⚠️ | Fallback real `505.0`: `commercial/views.py:1933-1936`. |
| Normalizar USD antes de enviar | ✅/⚠️ | Transfer line no tiene moneda; debe hacerlo el agente. |
| Fusión por OC compartida | ✅/⚠️ | Existe, pero visual: `E3_expedientes_fusion.sql:8-13`. |
| Artefactos con templates dinámicos | ✅ | `server.py:1081`, `:821`, `:1268`, `:1275`. |
| OneDrive/IMAP | ⚠️ NO VERIFICADO | Fuera del repo. |

---

## 7. Correcciones recomendadas al `.md`

1. Cambiar "la liquidación excluye IVA" por:
   - "No cargues IVA como `CostLine`: el backend actual no lo excluye automáticamente; si se carga activo, infla landed cost."
2. Cambiar DAI por NCM:
   - "`scope_json` se persiste, pero `transfer_liquidar` aún no lo aplica; validar manualmente o implementar soporte."
3. Cambiar fusión:
   - "`expediente_fusionar` agrupa visualmente; no consolida datos."
4. Cambiar recepción:
   - "Enviar todas las líneas con `qty_received`; backend tolera omisiones, pero no es seguro."
5. Cambiar fases:
   - "`phase_durations_set` guarda overrides manuales; los eventos reales siguen en `event_log`."
6. Quitar `≈459.50` o reemplazar por "consultar live; fallback actual 505.0".
7. Para OC/Proforma, mencionar `match_subir` como opción preferente cuando se requiere cross-check/match.
8. En ejemplos de `nodo_crear`, agregar `capabilities`.

---

## 8. Correcciones recomendadas al proyecto

1. Backend P0:
   - Implementar exclusión IVA o `capitalizable=false`.
   - Aplicar `scope_json` en `calcular_liquidacion()`.
   - Tests multi-NCM, multi-DAI, IVA activo.
2. Backend P1:
   - Definir semántica real de `price_view`.
3. Backend P1:
   - Hacer estricta `transferencia_recibir` o exigir flag explícito para pendientes.
4. Frontend P1:
   - Bloquear/advertir IVA capitalizable para Costa Rica.
5. Frontend/Backend P1:
   - Alinear preview frontend con persistencia backend.
6. MCP P2:
   - Advertir en docstrings que `scope_json` hoy no afecta `transfer_liquidar` hasta corregir backend.
7. Nodos P2:
   - Crear hubs/bodegas con capabilities explícitas.

---

## 9. NO VERIFICADO

- OneDrive real.
- IMAP real.
- `mwt_whoami` contra producción.
- IDs productivos de Sondel/Muito Work/Marluvas.
- Templates Builder reales por título.
- Montos reales DUA/factura.
- DB productiva aplicada exactamente a la última migración local.

## 10. Dictamen final

El `.md` sirve como checklist operativo, pero no debe usarse todavía como fuente de verdad financiera. El mayor riesgo está en landed cost: IVA, DAI scoped y `price_view` no están alineados entre prompt, backend y frontend.

Prioridad absoluta:

1. Corregir IVA.
2. Implementar scope por NCM.
3. Alinear `price_view`.
4. Documentar fusión como visual.
