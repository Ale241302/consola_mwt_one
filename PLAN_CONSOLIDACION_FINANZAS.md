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

| Hallazgo | Detalle |
|---|---|
| Sin proforma en BD | `EXP-PO 504649` (Sondel, REGISTRO, creado 2026-11-03). Solo tiene OC `PO 504649`. |
| Proformas en BD sin carpeta en `01 Marluvas\` | `2400-2026`, `2465-2026`, `2505-2026`, `2515-2026`, `2519-2026`, `2520-2026`, `2521-2026`, `2522-2026`, `PF-2026-0001` |
| Carpetas 2026 sin expediente | `2415-2026` (COMTEK), `2416-2026` (UMMIE) |
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

## Orden recomendado

`F1 → F2 → F3 → F4 → F5`, porque las fechas y montos de F2/F3 dependen de que las
OC/PF/SAP estén bien (F1). F4 es independiente y puede correr en paralelo.

## Cómo se reporta

Al cerrar cada fase se entrega: qué cambió, evidencia (consulta o captura), impacto
numérico antes/después y qué quedó pendiente. Sin evidencia no se declara cerrada.
