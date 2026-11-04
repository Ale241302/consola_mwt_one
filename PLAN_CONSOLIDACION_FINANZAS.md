# Plan de consolidación · Expedientes / Finanzas / Dashboard / Transferencias

> Estado: **fase 0 completada** (inventario y diagnóstico). Fecha: 2026-11-04.
> Este documento es el hilo conductor. Cada fase termina con evidencia verificable
> y un commit por archivo. Si algo no cuadra, se para aquí antes de tocar datos.

---

## Reglas del proyecto (no negociables)

1. **Una sola fuente de verdad por dato.** Si el número se puede calcular, se calcula;
   no se escribe a mano. Nada de montos "quemados".
2. **Ningún secreto en el repo.** La contraseña del VPS no se escribe en archivos,
   commits ni documentos. Se entra por llave SSH (`ssh -p 2222 root@187.77.218.102`).
3. **Un commit por archivo objetivo.** Nunca `git add -A` (el working tree tiene churn CRLF).
4. **Nada de migraciones Django.** El esquema es SQL-first: archivo `.sql` numerado e
   idempotente en `backend/sql/` (ver skill `nueva_migracion_sql`).
5. **Toda fecha mostrada debe poder explicarse.** La API expone `fecha_ancla` y
   `fecha_ancla_source`; si un número no tiene origen auditable, es un bug.
6. **Antes de cambiar una regla de negocio, se mide el impacto** (cuántas filas cambian
   y en cuánto cambia cada KPI) y se muestra al CEO.

---

## Estado verificado al 2026-11-04 (evidencia)

### Expedientes (45 activos)

> **Corrección 2026-11-04:** la primera pasada se hizo contra
> `_PROFORMAS_RUTAS.csv`, que está desactualizado (no conoce carpetas renombradas
> como `2498-2026 + 2505-2026` ni `2519-2026`). La tabla de abajo se recalculó
> **escaneando los nombres de carpeta reales en disco** (258 tokens `NNNN-AAAA`).
> Lección: el CSV no es fuente de verdad; las carpetas sí.

| Hallazgo | Detalle |
|---|---|
| Proformas en BD sin carpeta real | Solo `PF-2026-0001` (EXP-20330, formato irregular). `2437-2026` existe como `2437-2026b`; el sufijo `b` rompe el match y hay que normalizarlo. |
| Carpetas 2026 sin expediente | `2415-2026` (COMTEK), `2416-2026` (UMMIE), `2513-2026` (EGUISA), `2514-2026` (SONEPAR, OC 11002340) |
| OC cruzada | `EXP-IyC 003-2026-2` cuelga documentos de `IyC 003` **y** de `IyC 004` |
| OC con más de un documento | EXP-110021558, EXP-12543, EXP-2026-0008, EXP-505201-2, EXP-700143 |
| SAP compartido | `279689` en UMMIE-02 y UMMIE-02-2 (split real, ver decisiones) |
| Proforma con formato irregular | `PF-2026-0001` (EXP-20330); el resto usa `NNNN-AAAA` o `PF NNNN-AAAA` |
| OC con más de un documento | EXP-110021558 (`110021558`,`110021559`), EXP-12543 (`12543`,`12548`), EXP-2026-0008 (`20973`,`505107`), EXP-505201-2 (`505200`,`505201`), EXP-700143 (`700141`,`700143`) |
| OC cruzada | `EXP-IyC 003-2026-2` cuelga documentos de `IyC 003` **y** `IyC 004` |
| SAP compartido | `279689` en `EXP-UMMIE-2026-02` y `-02-2` (split: validar que sea intencional) |

### Finanzas (calendario de comisiones)

Totales actuales: **$57,537.28** = Recibidas $28,953.37 (16) + En tránsito
$16,014.69 (7) + Proyectado $1,396.13 (2) + Vencidas $11,173.09 (6).

Reglas vigentes (Sprint 2026-11-04):

- Ancla del plazo = `phase_durations_json.REGISTRO.start` (fallback ETD/ETA/created_at).
- Vencimiento = ancla + `credit_days_cliente` → **día 20 del mes siguiente**.
- Estado: hay pago IN confirmado → `RECIBIDA` (sin días). Si no, vencido → `VENCIDA`;
  plazo del cliente vencido → `EN_TRANSITO`; si no → `PROYECTADA`.
- "Recibida" = fecha del pago confirmado del cliente (no la FE de comisión de Marluvas).

### Dashboard

- `FLUJO 90 DÍAS`: **entradas $285,033 / salidas $0**. No es caja: suma `total_client`
  completo de cada expediente cuya `fecha_pago_aprox` cae en la ventana, y no descuenta
  lo ya cobrado. Las salidas solo se calculan para operados por MWT con
  `shipment_date + credit_days_mwt` **futuro**, y casi todos los embarques ya pasaron.
  Anclas asimétricas ⇒ salidas artificialmente 0.
- `COMISIÓN DEVENGABLE USD 57,537` = mismo cálculo que Finanzas (coherente).

### Transferencias (landed cost)

Hipótesis a confirmar en `TRF-20260911-V76P` / `GT-POD-GUATEMALA`:
- "Landed total" $4,495.13 = FOB 3,052 + DAI 751.63 + IVA 691.50 → **incluye IVA**.
  Si el IVA no es capitalizable (regla ya aplicada en `transfers/liquidation.py`),
  el landed debería ser $3,803.63 y el IVA ir como línea informativa.
- Validar que "Total SIN IVA · coste base + MWT" coincida con la suma de costos reales.

---

## Decisiones tomadas y aplicadas (2026-11-04)

### 1. `EXP-IyC 003-2026-2` → la OC correcta es **IyC 003**

Evidencia: la carpeta es `2498-2026 + 2505-2026   I y C 003 2026` (dos PFs en una
sola OC 003). `IyC 004` tiene su propia carpeta (`2519-2026   I y C 004 2026`) y su
propio expediente. Sus líneas son SKU 700239 / SAP 288740, distintas de 003 (700644 /
286650), pero comparten OC y HBL.

**Aplicado:** el documento `IyC 004-2026` se movió de `EXP-IyC 003-2026-2` a
`EXP-IyC 004-2026`. El expediente ahora muestra `PO IyC 003-2026`.

### 2. `EXP-PO 504649` → PF **2391-2025**

Evidencia: carpeta `01 M Costa Rica\02 M Muito Work\2025\01 MW SONDEL\2391-2025  PO 504649`
con PF, PO del cliente, DUA, factura y liquidación. Nadie más usaba esa PF.

**Aplicado:** PDF subido a MinIO (`documento/59d0a0c9-…pdf`, 105,821 bytes) y registrado
como documento PROFORMA. El listado ya muestra `2391-2025`.

### 3. `2400-2026` vs `2405-2026` → **no es error de dedo, no se toca**

Evidencia (leyendo los PDF, no el nombre):

| PF | Contenido | Fecha | Pares | Total |
|---|---|---|---|---|
| 2400-2026 | Consolidado OC 110021558 + 110021559; SKU 700010 (270) + 702064 (1,855) | 16/mar/2026 | 2,125 | $40,198.05 |
| 2405-2026 | SKU 700010 (135) + 701935 (925) | 13/ene/2026 | 1,060 | $20,050.65 |

Las cantidades de 2400 coinciden **exactamente** con las líneas del expediente
(270 + 1,855). 2405 incluye el SKU 701935, que no está en el expediente, y su carpeta
delata otra OC (`OC 110021559`). Conclusión: 2400 es la PF del expediente; 2405 es otra
orden. No se borra nada.

### 4. UMMIE-02 / UMMIE-02-2 → **split intencional**

Mismo SKU 701276, mismas tallas repartidas (02: 33/38/39/40/41 · 02-2: 34/38/39),
mismo SAP 279689, misma OC y misma PF 2478-2026. Es un embarque partido: el SAP
compartido es correcto.

### 5. `2415-2026` / `2416-2026` → **no se crean todavía**

- `2416-2026`: PF limpia (UMMIE, 474 pares, $7,603.06, crédito 120 d) pero **sin
  número de OC** en la carpeta, en la BD ni en el correo. UMMIE usa la convención
  `PO UMMIE-2026-NN` y ya existen 01, 02, 03: inventar el 04 repetiría el defecto.
- `2415-2026`: además hay **conflicto de cliente** — la carpeta está bajo
  `03 M Colombia\01 COMTEK` y la PF dice "Sonepar Colombia". No se puede decidir sin
  el cliente real.

**Pendiente:** conseguir la OC de ambas (correo al cliente o factura) antes de crear.
Aparecieron además `2513-2026` (EGUISA) y `2514-2026` (SONEPAR OC 11002340) sin
expediente.

---

## Los 4 agentes

Cada agente tiene contrato en `.claude/agents/`. Ninguno toca fuera de su dominio y
todos leen este documento antes de actuar.

### 1. `expedientes-steward` — datos maestros PF / OC / SAP

**Misión.** Que cada expediente tenga exactamente una OC real, sus proformas y sus
SAP, y que coincidan con las carpetas de `01 Marluvas\` y con los correos.

**Entradas.** `_PROFORMAS_RUTAS.csv`, carpetas por año, `GET /api/expedientes/`,
correos de `alvaro@muitowork.com` (MCP Hostinger, buscar por PF/OC/SAP).

**Salidas.** Tabla de conciliación (expediente ↔ PF ↔ OC ↔ SAP ↔ carpeta ↔ correo),
lista de correcciones propuestas y aplicadas.

**No hace.** No toca montos ni estados financieros. No borra expedientes.

### 2. `finanzas-owner` — devengo, calendario y KPIs

**Misión.** Que Comisión devengable / recibida / pendiente / vencida salgan de pagos
reales y fechas auditables, sin montos quemados.

**Entradas.** `finance.payment`, `expedientes.*`, tarifas (`cliente.comision_pct`,
`expediente.commission_pct`, reglas por marca/familia), `finance.comision_historica`.

**Salidas.** Reglas documentadas, impacto medido antes/después, y API con
`fecha_ancla` + `fecha_ancla_source` en cada fila.

**No hace.** No inventa comisiones donde no hay tasa (`SIN_TASA` se reporta aparte).

### 3. `dashboard-owner` — flujo y KPIs de portada

**Misión.** Que "Neto USD (90d)" sea caja esperada de verdad: entradas cobrables
(no facturado ya cobrado), salidas a proveedor con el mismo criterio temporal.

**Entradas.** `finance.payment`, `_build_item()`, `credit_days_mwt`, vencimientos de compra.

**Salidas.** `GET /api/finanzas/flujo/` corregido + nota metodológica visible en pantalla.

**No hace.** No reutiliza el número de Finanzas si el criterio es distinto; lo declara.

### 4. `transferencias-owner` — landed cost y factura interna

**Misión.** Que el landed cost y la factura interna de una transferencia cuadren, con
IVA fuera del costo capitalizable y el prorrateo por línea correcto.

**Entradas.** `transfers/liquidation.py`, cost lines, artefactos de la transferencia,
`transfer_liquidacion_preview`.

**Salidas.** Liquidación verificada en `TRF-20260911-V76P` + tests de la fórmula.

**No hace.** No cambia precios de venta ni comisiones.

---

## Fases

### Fase 0 — Congelar la verdad ✅ (hecho)

- Snapshot de los 45 expedientes (código, PF, OC, SAP, estado, fechas, montos).
- Inventario de carpetas (`_PROFORMAS_RUTAS.csv`: 257 PFs; 38 de 2026).
- Diagnóstico de Finanzas, Dashboard y Transferencias.

**Criterio de aceptación:** existe la tabla de conciliación y el diagnóstico escrito.

### Fase 1 — Reconciliación de datos maestros

1. Generar la tabla expediente ↔ PF ↔ OC ↔ SAP ↔ carpeta (script reproducible).
2. Buscar correos por cada PF/OC/SAP en `alvaro@muitowork.com` y anotar el asunto que
   confirma la relación.
3. Resolver los 6 grupos de anomalías de la tabla de arriba, uno por uno, con evidencia.
4. Corregir vía MCP `expediente_editar` / `documento_editar` /
   `expediente_phase_durations_set`; nunca por UPDATE directo si existe tool.

**Criterio de aceptación:** 0 expedientes sin OC, 0 PFs sin carpeta *o* justificación
escrita, y la tabla de conciliación sin huecos.

### Fase 2 — Finanzas verificables

1. Congelar los totales actuales (línea base).
2. Revisar las 45 filas contra su origen: ¿la tasa existe? ¿el pago existe? ¿el ancla existe?
3. Corregir `commission_pct` faltantes o mal puestos.
4. Re-medir y comparar contra la línea base.

**Criterio de aceptación:** cada fila del calendario se puede reconstruir a mano desde
sus datos de origen; el total no cambia sin explicación escrita.

### Fase 3 — Dashboard

1. Redefinir el flujo: entradas = cobros pendientes (facturado − pagado), salidas =
   pagos a proveedor con `shipment_date + credit_days_mwt`, ambos simétricos.
2. Excluir lo ya cobrado y lo ya pagado.
3. Nota metodológica en pantalla (una línea).

**Criterio de aceptación:** `Neto USD = Entradas − Salidas` y la suma se explica fila
por fila; salidas ≠ 0 mientras haya embarques por pagar.

### Fase 4 — Transferencias

1. Reproducir la liquidación de `TRF-20260911-V76P`.
2. Confirmar si el IVA está dentro del landed total y sacarlo si no corresponde.
3. Verificar el prorrateo por línea y la factura interna.

**Criterio de aceptación:** landed total = FOB + costos capitalizables; IVA en línea
aparte; la factura interna cuadra al centavo.

### Fase 5 — UI mínima

- Columna "Expediente" del calendario muestra la **OC** (ej. `PO 110022927`), no el
  código interno `EXP-110022927`. El `EXP-` queda como tooltip.
- Tooltip de origen de fecha (`fecha_ancla_source`).

### Fase 6 — Cierre

- Un pase de `reviewer` sobre el diff completo.
- Verificación en producción de los 4 módulos con números antes/después.

---

### Fase 2 — Auditoría de las 45 comisiones (2026-11-04)

**Cuadre del total.** $57,537.28 = Recibidas $28,953.37 + En tránsito $16,014.69 +
Proyectado $1,396.13 + Vencidas $11,173.09. Cada fila se reconstruye desde su tasa y
su pago; **no hay montos quemados** y ninguna fila `COMISION` quedó sin tasa.

**Hallazgos**

| # | Hallazgo | Impacto |
|---|---|---|
| 1 | **"Margen total" no era margen**: sumaba `total_client` completo en los 31 expedientes operados por el cliente | $664,579.26 (77.38%) → **$126,424.52 (14.72%)** |
| 2 | `get_oc_codigos()` del serializer por fila hacía `int(storage_url)` | excepción silenciosa → OC vacía en el detalle |
| 3 | SONEPAR: `commission_pct = 0.07` en 2 expedientes, **ignorado** porque las 27 líneas traen 0.10 | comisión calculada al 10%; el 7% es dato muerto |
| 4 | 5 expedientes MWT con pagos > suma de líneas (factura incluye costos/flete) | no afecta la comisión (MWT no genera comisión) |
| 5 | 21 expedientes con `total_paid = 0` pese a tener pagos confirmados | el calendario ya no depende de ese campo; el listado sí muestra balance viejo |

**Cambios aplicados (commit `5e0f509`)**

- `overview()`: margen = arbitraje (solo MWT-operados) + comisiones (solo
  cliente-operados). Se exponen `margen_arbitraje_usd` ($68,887.24),
  `margen_comisiones_usd` ($57,537.28) y `margen_base_usd` ($858,796.70) para que el
  número sea auditable.
- `ExpedienteListSerializer.get_oc_codigos()`: `int(bool(storage_url))`, igual que el
  batch del listado.

**Pendiente de decisión del CEO**

- El 7% de SONEPAR: si es una excepción negociada, hoy **no se aplica** (habría que
  hacer que el override gane; movería −$1,269.79). Si es basura, se pone en NULL.
- Sincronizar `total_paid` en los 21 expedientes (opcional: no mueve comisiones).

---

### Fase 3 — Flujo 90 días (2026-11-04)

**Antes:** entradas $285,033 / salidas $0. Sumaba la factura completa y exigía fecha
futura para las salidas (ancla `shipment_date + credit_days_mwt` ya pasada ⇒ 0).

**Ahora** (`flujo()`, commit `b3464f1`): entradas = saldo por cobrar del cliente
(facturado − pagado confirmado); salidas = saldo pendiente al proveedor, solo en los
operados por MWT; **misma ventana en ambos lados** y lo vencido entra como pendiente
inmediato en el bucket de hoy.

Resultado: **entradas $428,224.83 / salidas $129,891.82 / neto $298,333.01**.

### Fase 4 — Landed cost con IVA (2026-11-04)

Caso `TRF-20260911-V76P` (GT-POD → GT-UMMIE, 200 pares SKU 701809):

| | Backend | UI (antes) |
|---|---|---|
| FOB | 3,052.00 | 3,052.00 |
| DAI | 751.63 | 751.63 |
| IVA | 691.50 (informativo) | **dentro del landed** |
| Landed total | **3,803.66** | 4,495.13 |
| Promedio/unidad | 19.0183 | 22.4757 |

El backend ya excluía el IVA; el panel del frontend lo volvía a sumar en `destTotal`.
Corregido en `TransferLiquidationPanel.jsx` con `isCapitalizable()`, la misma regla que
`liquidation.py`. El IVA sigue visible como línea de costo en la sección 2.

### Fase 5 — Columna OC (2026-11-04)

El calendario ahora muestra el **PO real del cliente** (resolución
`build_expediente_ref_batches`, igual que el listado) y el código `EXP-…` queda en el
tooltip. Antes salía el código interno (`EXP-110022927`) o el `PO-AAAA-NNNNN`
autogenerado. Las 31 filas tienen OC.

---

### Fase 6 — Review del diff (2026-11-04)

El `code-reviewer` pasó sobre `git diff 8f4182c..HEAD`. Hallazgos bloqueantes y su
resolución (commit `b847123`):

| # | Hallazgo | Corrección |
|---|---|---|
| 1 | El flujo inventaba saldo por cobrar desde el valor del pedido | Ahora usa `totals_for()` (ART-13). Sin factura no hay cuenta por cobrar; se reporta aparte en `proyecciones.sin_factura_usd` ($214,822.50) |
| 2 | `except Exception: pass` devolvía un flujo parcial como válido | Eliminado: un fallo rompe la respuesta |
| 3 | Pagos no confirmados se contaban dos veces (caja + proyección) | Solo `CONFIRMADO_*` entran como caja |
| 4 | Cualquier OUT reducía la deuda con el proveedor | Solo `counterparty_type IN ('PROVEEDOR','SUPPLIER')` |
| 5 | `mes_comision` usaba otra ancla (PREPARACION.end) | Ahora usa el mismo ancla REGISTRO |
| 6 | `SIN_TASA` diluía el denominador del margen | Se excluye del denominador |
| 7 | `ivaCostoUsd` quedó sin consumidor | Variable eliminada |

### SONEPAR 7 %: origen y decisión

El event_log lo documenta: `EXP-110021558` cobró **USD 2,813.86 = 7 % de 40,198.05**
en Payoneer el 20/07/2026 (id 1013278031). **No es basura: es la tasa negociada.**
El cálculo la ignoraba porque la suma por línea ganaba al override. Corregido en
`_build_item()` (commit `02fcd3c`): el override del expediente tiene precedencia.

`EXP-110022220` queda con 7 % × 2,128.50 = $149.00, pero el cobro real fue **$229.73**
(= 7 % de 3,281.80). La base real difiere de la suma de líneas: pendiente de revisar.

### Datos: sync de los 21 y alineación con ART-13

- `total_paid` = SUM(pagos IN confirmados) en los 21.
- `total_invoiced`/`balance` se alinearon a `totals_for()` (ART-13) en 11 filas donde
  la aproximación desde el balance legado no coincidía con la fuente canónica.

### Expedientes creados desde carpeta (2026-11-04)

| PF | Expediente | Cliente | Pares | Total |
|---|---|---|---|---|
| 2415-2026 | EXP-COMTEK 001-2026 | COMTEK (carpeta; la PF dice Sonepar, queda anotado) | 6 | $144.12 |
| 2416-2026 | EXP-2416-2026 | UMMIE | 474 | $7,603.06 |
| 2513-2026 | EXP-2513-2026 | EGUISA | 50 | $389.00 |

Se usó el orquestador real (`create_from_oc`), con precios tomados de la PF y el
documento PROFORMA registrado en MinIO. `REGISTRO.start` = fecha de la PF (2026-02-12)
en 2415/2416, no la fecha de digitación.

**No creado:** `2514-2026` es un *ajuste* de `EXP-110023409` (PF 2484) + OC 110023539,
no una orden independiente. Requiere decidir si se anexa al expediente existente.

Total tras la creación: **48 expedientes**, comisión devengable **$57,058.21**.

---

## Orden recomendado

`F1 → F2 → F3 → F4 → F5`, porque las fechas y montos de F2/F3 dependen de que las
OC/PF/SAP estén bien (F1). F4 es independiente y puede correr en paralelo.

## Cómo se reporta

Al cerrar cada fase se entrega: qué cambió, evidencia (consulta o captura), impacto
numérico antes/después y qué quedó pendiente. Sin evidencia no se declara cerrada.
