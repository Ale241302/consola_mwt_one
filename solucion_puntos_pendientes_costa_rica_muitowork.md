# PROMPT — REMEDIACIÓN COSTA RICA · MUITO WORK (operador) · consola.mwt.one

> **Para:** KIMI CLI (o Claude / Antigravity).
> **Alcance EXCLUSIVO:** expedientes operados por **Muito Work Limitada** en **Costa Rica** (cliente final = Sondel S.A. u otro según la OC). OneDrive: `01 Ventas / 01 Marluvas / 01 M Costa Rica / 02 M Muito Work / <año> / <proforma>`.
> **Qué hace:** toma los expedientes que YA existen (creados como esqueletos), los **busca por número de proforma/OC/PO**, y los **completa uno por uno** con la verdad de OneDrive + correo: productos (SKU·talla·cantidad·precio), documentos, SAP, recepción de lote, movimiento al nodo del cliente final, costos/impuestos/DUA y avance de estados con fechas.
> 🚫 **No se recrea nada** (prohibido `expediente_crear`). Solo se **actualiza/edita** lo existente.
> **Equipo (todos SENIOR):** **Orquestador** + **Operativo** + **Auditor**.
> **Resiliencia:** IMAP se cae cada ~2 min → **se procesa de a UNO** con checklist; si se pierde conexión, **reconecta solo y reintenta** el mismo expediente.
> **Lotes de 10:** al cerrar cada lote, **envía un resumen ejecutivo por correo a `alejandro@muitowork.com`** con lo que cambió/agregó por expediente.

---

# 0 · CONEXIÓN AL MCP `mwt-one`

```bash
pip install "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```
JSON (`mcp.json` / `claude_desktop_config.json`) o Kimi CLI:
```json
{ "mcpServers": { "mwt-one": {
  "command": "python", "args": ["-m", "mwt_mcp"],
  "env": {
    "MWT_MCP_TOKEN": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjo0OTM1NDM1NjQ2LCJpYXQiOjE3ODE4MzU2NDYsImp0aSI6ImY4OTllMTEyODFjODRmZDI5ZGNjNGVhZDVlOWFhNDFlIiwidXNlcl91dWlkIjoiNTA3MmZjZTItZTY2ZS00YmY3LThmZDItNjIzY2ZkM2FmYWY2IiwiZW1haWwiOiJhbGVqYW5kcm9AbXVpdG93b3JrLmNvbSIsInJvbGUiOiJhZG1pbiIsIm1jcCI6dHJ1ZX0.yeS-5L0LNapR7E6FJuH8g0d2hPobeMwWoke-TqKTetk",
    "MWT_API_BASE": "https://consola.mwt.one/api"
  } } } }
```
Verifica con **`mwt_whoami`** (rol `admin`). Si falla → detente.

---

# 1 · HARNESS / BUCLE DEL AGENTE (REPL resiliente) — el corazón del proceso

No proceses todo de golpe. El agente corre un **REPL** (Read → Eval → Print → Loop) **por expediente**, tolerante a caídas de IMAP/MCP. Pseudocódigo que DEBES seguir:

```python
conectar_mcp(); assert mwt_whoami().role == "admin"
worklist = inventariar()              # lista de proformas CR·MuitoWork (solo números), NO baja todo el correo
guardar_estado(worklist)              # checklist persistente: pendiente|en_proceso|hecho|rechazado|fallido

for lote in lotes(worklist, n=10):
    for proforma in lote:
        intentos = 0
        while True:                   # ── REPL por expediente (resiliente) ──
            try:
                ctx   = READ(proforma)        # 1) lee SOLO esta proforma: OneDrive + su hilo de correo
                plan  = EVAL(ctx, mcp_state)  # 2) decide el checklist §5 (qué falta)
                out   = EJECUTA(plan)         # 3) llamadas MCP (idempotentes)
                PRINT(out)                    # 4) registra qué cambió/agregó en el checklist
                auditar(proforma)             #    Auditor re-verifica con el MCP (§ gate)
                marcar(proforma, "hecho")
                break
            except (IMAPDesconectado, MCPError, RedError) as e:
                intentos += 1
                reconectar_imap(); reconectar_mcp()   # vuelve a conectarse SOLO
                if intentos >= 5:
                    marcar(proforma, "fallido", motivo=str(e)); break
                continue              # reintenta el MISMO expediente desde donde quedó (idempotente)
    enviar_resumen_email(lote, "alejandro@muitowork.com")   # § 8
guardar_estado(worklist)
```

**Reglas del harness:**
- **READ es por expediente**, nunca "baja todo el buzón": abre solo la carpeta de esa proforma en OneDrive y su hilo de correo. Así una caída de IMAP afecta a UN expediente, no a todos.
- **Reconexión automática:** ante desconexión (IMAP cada ~2 min, o el MCP), `reconectar_*()` y reintentar el mismo expediente. Máx 5 intentos → `fallido` con motivo y sigue con el siguiente.
- **Idempotencia:** cada paso del checklist consulta antes de escribir (`expediente_buscar`, `expediente_lineas`, `documento_listar`, `sap_obtener`); reintentar no duplica.
- **Estado persistente:** mantén un archivo de checklist (JSON) con el avance por proforma; si el proceso muere, retoma donde quedó.

---

# 2 · AGENTES (todos SENIOR)

- **🧭 Orquestador senior** — arma la worklist (solo números de proforma CR·MuitoWork), la trocea en **lotes de 10**, entrega cada expediente al Operativo en orden, lleva el checklist/estado, dispara el **email por lote** y no avanza un expediente sin auditoría aprobada.
- **⚙️ Operativo senior** — ejecuta el **checklist §5** de un expediente: lee OneDrive/correo, parsea proforma/OC/SAP, y hace las llamadas MCP. Edita, no recrea.
- **🔎 Auditor senior** — re-verifica con el MCP cada punto (gate §9). `RECHAZADO` → devuelve al Operativo con la corrección; `APROBADO` → cierra.

---

# 3 · INVENTARIO (qué expedientes tocar) y BÚSQUEDA por número

1. **OneDrive** `01 Ventas/01 Marluvas/01 M Costa Rica/02 M Muito Work/<año>/`: cada subcarpeta es una **proforma** (ej. `2453-2026 ...`). Lista los números de proforma por año (2019…2026).
2. Para cada proforma, **encuentra el expediente existente** con el MCP (NO crear):
   `expediente_buscar(proforma="2453-2026")` (y/o `oc_number`, `sap`). Toma `expediente_id` y `oc_id` del match. Si `existe=false` y la carpeta tiene material real → es excepción, anótala (no la crees aquí salvo orden explícita).
3. Cliente/operador del expediente CR·MuitoWork: **operador = Muito Work Limitada** (`operating_company_id`), **cliente final = el de la OC** (Sondel S.A. u otro). Verifícalo en la OC; corrige con `expediente_editar`/`oc_editar` si está mal.

---

# 4 · FUENTES POR EXPEDIENTE (READ)

Por cada proforma abre SOLO su material:
- **OneDrive** `.../<año>/<proforma>/` subcarpetas: `Proforma/`, `OC del Cliente/`, `SAP/`, `Factura/`, `Guia/`, `Packing List Detallado/`, `DUA/`, `Pago de Impuestos/`. Descarga cada archivo a ruta local (para `file_path`).
- **Correo** (IMAP): el hilo de esa proforma → fechas de cada hito (OC, SAP, AWB/BL, DUA, entrega), DUA, costos. Conéctate, lee ese hilo, y libera; si se cae, reconecta.

De ahí saca: **operador y cliente final**, **SKU·talla·cantidad·precio (matriz de la proforma)**, **nº OC limpio**, **nº SAP**, **modo de envío (aéreo/marítimo)**, **nodo destino = cliente final**, fechas de estado, y los **costos/DUA** (§6).

---

# 5 · CHECKLIST POR EXPEDIENTE (el Operativo lo completa entero, en orden)

```
[ ] 1.  LOCALIZAR     → expediente_buscar(proforma) → expediente_id, oc_id. (NO crear.)
[ ] 1b. RESPALDO REAL → ¿hay material real para este expediente? (ver §5-BIS). Si NO existe ni en OneDrive
                         ni en correo → es FANTASMA: expediente_eliminar(expediente_id) y pasa al siguiente.
[ ] 2.  CABECERA      → expediente_obtener: operador=Muito Work (operating_company_id), cliente final correcto,
                         brand_id=Marluvas (marca_listar → expediente_editar + oc_editar), modo_operacion="COMISION".
[ ] 3.  CÓDIGOS       → po_number/oc_codigos limpios (nº OC real de la OC; NUNCA "SIN-PO"); proforma "2453-2026".
[ ] 4.  SKUs          → por cada SKU de la proforma: producto_listar(q=sku); si falta o sin tallas →
                         tallas_listar (label→UUID) + producto_crear({...tallas:[UUIDs], especificaciones:{ncm,sizes:[UUIDs],color}})
                         + producto_alias_crear.
[ ] 5.  LÍNEAS        → parsea la MATRIZ de tallas de la proforma; quita la línea dummy "PENDING"
                         (expediente_edit_full_patch lines_removed) y agrega una línea por SKU×TALLA real
                         (size="39", NUNCA "UNICA"), cantidades = proforma.
[ ] 6.  PRECIOS       → lineas_actualizar_precios([{linea_id, unit_price_mwt, unit_price_client}]) = precios de la OC/proforma;
                         total_price == qty × unit_price_cliente.
[ ] 7.  DOCS          → sube OC (documento_subir kind="OC" codigo="<PO real>" file_path), Proforma
                         (match_subir ART-02_PROFORMA / o proforma_generar CLIENT y ADMIN_ONLY), y los demás de la carpeta
                         (BL/AWB, DUA, Factura Marluvas, Packing, Pago de Impuestos). Verifica storage_url≠null (§9).
[ ] 8.  SAP           → sap_analizar(file SAP) → sap_confirmar(sap_id, fecha, lineas_confirmadas=TODAS, file_path);
                         asigna el SAP a los productos. (si no está en REGISTRO → sap_upsert).
[ ] 9.  ESTADOS+FECHAS→ expediente_avanzar_estado hasta el estado actual + expediente_phase_durations_set
                         ({FASE:{start,end}}) con fechas de los correos (o aproximado).
[ ] 10. NODOS         → nodo del MÉTODO DE ENVÍO (aéreo/marítimo) y nodo DESTINO = cliente final (§7).
[ ] 11. RECEPCIÓN     → recepcion_crear en el nodo del método de envío (SKU·talla·cantidad del expediente).
[ ] 12. MOVIMIENTO    → transferencia del nodo método-de-envío → nodo del CLIENTE FINAL (§7).
[ ] 13. COSTOS/DUA    → costos, impuestos CR y gastos destino sobre el movimiento (§6) + transfer_liquidar.
[ ] 14. PAGOS         → si hay comprobantes: pago_registrar → pago_conciliar (opcional).
[ ] 15. AUDITORÍA     → gate §9 APROBADO → marcar `hecho`.
```

---

# 5-BIS · OPERADOR vs CLIENTE FINAL y EXPEDIENTES FANTASMA (borrar si no hay respaldo)

## Muito Work Limitada = OPERADOR logístico, NUNCA cliente final
- En estos expedientes el **operador** es Muito Work Limitada (`operating_company_id`), pero el **cliente final SIEMPRE es OTRO** (Sondel S.A. u el que diga la OC). Nunca pongas Muito Work como `client_id`/cliente final ni como nodo destino.
- El **cliente final y el nº de OC** se leen de la **OC del cliente** (PDF en `OC del Cliente/` o en el correo). El nodo destino del movimiento (§7) es la bodega de ese cliente final.

## Regla del FANTASMA: si no hay respaldo real → BORRAR (no debe existir)
Antes de tocar nada (paso 1b), comprueba que el expediente tenga **material real**:
1. **OneDrive:** busca su carpeta por número de proforma en `01 M Costa Rica/02 M Muito Work/<año>/`. Debe haber al menos **proforma u OC** con líneas/productos.
2. **Si no está en OneDrive → busca en el CORREO** (hilo de esa proforma/OC): adjuntos de proforma/OC/SAP.
3. **Si NO existe ni en OneDrive NI en correo** (caso PO `502240`: número que no aparece en ningún lado, sin productos, OC sin archivo): **es un expediente fantasma/inventado** →
   `expediente_eliminar(expediente_id)` y regístralo como `borrado` con motivo "sin respaldo en OneDrive/correo". **No lo edites ni le inventes datos.**
4. **Casos típicos que se BORRAN:** `po_number` que no se halla en ninguna fuente; expediente sin proforma ni OC reales; solo la línea dummy "PENDING" y un documento OC sin archivo (`storage_url=null`). Si tras descartar todo no hay de dónde sacar productos ni OC → borrar.
5. **No borres** si SÍ hay proforma/OC real pero faltan pasos (eso se completa con el checklist). Borrar es solo para los que **no deberían existir**.

> En el reporte por lote (§8) lista aparte los **borrados** (proforma/PO + motivo), separados de los corregidos.

---

# 6 · COSTOS · IMPUESTOS · DUA (Costa Rica) — sobre el MOVIMIENTO

El FOB ya está en las líneas del expediente. Sobre el **movimiento** (transferencia) agrega los costos incrementales con `transfer_costo_agregar(transferencia_id, kind, amount, currency, fx_to_usd, price_view="MWT", scope_json={"applies_to_all":true})`. **TC ₡/USD** real (ej. 459.50, fuente open.er-api.com) va en el `fx_to_usd` si el monto está en ₡; si está en USD usa `fx_to_usd=1`.

Concepto → `kind` (toma los montos reales de la DUA / factura aduanal / liquidación de la carpeta o correo):

| Concepto | kind | Base / nota |
|---|---|---|
| Flete (aéreo/marítimo internacional) | `FLETE` | costo real (AWB/BL) → entra al CIF |
| Seguro internacional | `SEGURO` | costo real → entra al CIF |
| DAI 6403.99.90 (calzado) | `DAI` | 14% sobre CIF de ese NCM |
| DAI 6406.90.20 (plantillas) | `DAI` | 10% sobre CIF de ese NCM (usa `label` para distinguir el NCM) |
| Ley 6946 | `LEY_6946` | 1% sobre CIF |
| IVA | `IVA` | 13% sobre CIF+DAI+Ley (acreditable / crédito fiscal — no suma al costo real) |
| PROCOMER | `PROCOMER` | sobre CIF |
| Timbre Asociación Agentes (Ley 7017) | `TIMBRE_AGENTES` | sobre CIF |
| Timbre Archivo Nacional | `TIMBRE_ARCHIVO` | sobre CIF |
| Timbre Contadores | `TIMBRE_CONTADORES` | sobre CIF |
| **Servicios aduanales (agente Barquero Fonseca)** | `OTRO` (`label="Servicios aduanales (Barquero Fonseca)"`) | costo en destino |
| **Transporte terrestre** | `OTRO` (`label="Transporte terrestre"`) | costo en destino |

Después: `transfer_liquidar(transferencia_id, method="BY_VALUE")` → calcula CIF, Landed total y $/par; `transfer_factura_payload` para la factura/remisión interna. (El IVA es crédito fiscal: el motor lo trata como acreditable, no suma al costo real de MWT.)

> Si hay una **DUA / factura aduanal / liquidación en PDF**, súbela primero con `transfer_*`/`documento_subir`; si usas el flujo IA del detalle del movimiento puede autodetectar y fusionar costos — igual valida los montos contra la tabla.

---

# 7 · NODOS Y MOVIMIENTO (método de envío → cliente final)

1. **Nodo del método de envío** (hub de entrada): `nodo_listar()`; si falta, `nodo_crear({codigo:"HUB-CR-AEREO"|"HUB-CR-MARITIMO", nombre, tipo:"ALMACEN", pais_iso2:"CR"})`. Hay un hub por método (aéreo / marítimo); puede haber varios por destino.
2. **Nodo destino = CLIENTE FINAL** (¡no Muito Work!): el destino es la bodega del cliente de la OC (Sondel S.A. u otro). `nodo_listar(q="<cliente final>")`; si falta, `nodo_crear({codigo:"BODEGA-SONDEL-CR", nombre:"<cliente final>", tipo:"ALMACEN", pais_iso2:"CR", operating_company_id:<cliente final>})`.
3. **Recepción** en el hub del método de envío: `recepcion_crear(items=[{expediente_id, producto_id, talla, qty_asignada, nodo_id:<hub>}], cost_lines?)`.
4. **Movimiento** hub → nodo cliente final:
   `transferencia_crear(origen_id=<hub>, destino_id=<nodo cliente final>, legal_context="NATIONALIZATION", lineas=[{producto_id, sku, size, qty_transfer, unit_cost:precio_mwt, unit_value:precio_cliente}], context_data={"bl_awb_number":"<AWB/BL>","dua_number":"<DUA>"})`.
   Luego avanza el movimiento: `transferencia_aprobar`→`transferencia_despachar`→`transferencia_recibir(lineas=[{id,qty_received}])`→`transferencia_conciliar`. Agrega los costos/DUA (§6) y `transfer_liquidar`.
   ⚠️ El cliente final del movimiento **se confirma con la OC**, no se asume Muito Work.

---

# 8 · EMAIL POR LOTE (cada 10 expedientes) → `alejandro@muitowork.com`

Al cerrar cada lote de 10, envía (con tu propio mecanismo de correo, el mismo con que enviaste el informe anterior) un **resumen ejecutivo** con asunto `Remediación CR·MuitoWork — lote N (expedientes X–Y)` y, por cada expediente:
- Proforma / OC / SAP.
- **Qué se agregó/cambió:** cabecera (operador, brand, modo), SKUs creados, líneas cargadas (cuántas, total pares), precios fijados, documentos subidos (con cuáles), SAP cargado, nodos usados/creados, movimiento creado + estado, costos/impuestos/DUA agregados (con totales: FOB, CIF, Landed, $/par), pagos.
- **Veredicto del auditor** (APROBADO / pendientes).

Formato sugerido (tabla + totales del lote). Incluye al final del lote: cuántos `hecho`, `rechazado`, `fallido` y los motivos.

---

# 9 · GATE DE AUDITORÍA (el Auditor re-verifica con el MCP)

| # | Verifica | Con | RECHAZA si… |
|---|---|---|---|
| 0 | Respaldo real | OneDrive + correo | NO hay proforma/OC real en ninguna fuente → debió **borrarse** (`expediente_eliminar`), no quedar editado |
| A | Operador/cliente/marca/modo | `expediente_obtener`, `oc_obtener` | operador≠Muito Work, **cliente final = Muito Work** (mal), cliente final ≠ el de la OC, `brand_id`=null, `modo_operacion` vacío |
| B | SKUs con tallas | `producto_obtener` | SKU sin `tallas`/`especificaciones.sizes` |
| C | Líneas reales | `expediente_lineas` | queda "PENDING"/"UNICA", faltan tallas, cantidades ≠ proforma |
| D | Precios | `expediente_lineas` | `total_price ≠ qty × precio_cliente` o ≠ OC |
| E | Códigos | `oc_codigos`/`proforma_codigos` | "SIN-PO", filename o prefijos |
| F | SAP | `sap_obtener` | doc trae SAP y no está / líneas sin `sap` / sin ART-04 |
| G | Documentos | `documento_listar` | `storage_url=null`/`file_size_bytes=0`; falta OC/proforma/SAP/DUA |
| H | Estados+fechas | `expediente_phase_durations_get`, `expediente_eventos` | no llegó al estado actual / faltan fechas |
| I | Nodos+recepción | `inventario_artefactos_expediente`, `stock_listar` | sin recepción en hub del método de envío |
| J | Movimiento+costos | `transferencia_obtener`, `transfer_costos_listar` | destino ≠ cliente final / faltan costos/DUA / sin liquidar |

`APROBADO` → `hecho`. `RECHAZADO` → corrige y re-audita. No se cierra el expediente sin A–J en verde.

---

# 10 · REGLAS DE ORO

1. **Uno por uno** (REPL §1); nunca bajar todo el correo de golpe; **reconexión automática** ante caída de IMAP/MCP; reintento idempotente del mismo expediente.
2. **Solo CR·MuitoWork** (carpeta `01 M Costa Rica/02 M Muito Work`). **Muito Work = OPERADOR, NUNCA cliente final**; cliente final/destino = el de la OC (Sondel S.A. u otro).
2b. **FANTASMA → BORRAR:** si el expediente no tiene proforma/OC real en OneDrive **ni** en correo (PO inventado, sin productos, OC sin archivo) → `expediente_eliminar`. No debe existir; no lo edites ni le inventes datos (§5-BIS).
3. **No recrear** (prohibido `expediente_crear`): buscar por proforma/OC/SAP y **editar** (o borrar si es fantasma).
4. **Tallas reales** (label "39", nunca "UNICA"); SKU nuevo con **tallas UUID**. **Precios de la OC/proforma**; total = qty × precio_cliente.
5. **Códigos limpios** (OC "503295", proforma "2453-2026"); **nunca "SIN-PO"**.
6. **SAP obligatorio** si el doc/correo lo trae (analyze→confirm con todas las líneas + archivo).
7. **Todos los archivos a MinIO** (verifica `storage_url≠null`); borra rotos con `documento_eliminar` y re-sube.
8. **DUA/costos CR** completos sobre el movimiento (§6) + `transfer_liquidar`.
9. **Email a `alejandro@muitowork.com` cada 10 expedientes** con el resumen ejecutivo (§8).
10. **Cita la fuente** (correo: asunto·fecha·remitente / archivo OneDrive). Nunca inventes.

---

# 11 · ARRANQUE

1. Conéctate al MCP (`mwt_whoami`).
2. **Orquestador:** lista las proformas de `01 M Costa Rica/02 M Muito Work/<año>/`; arma la worklist y los lotes de 10.
3. Corre el **REPL (§1)**: por cada proforma → READ (OneDrive+correo) → EVAL (checklist §5) → EJECUTA (MCP) → PRINT → Auditor (§9). Reconecta solo si se cae.
4. **Cada 10 expedientes:** email de resumen a `alejandro@muitowork.com`.
5. Al final: reporte consolidado (hechos / rechazados / fallidos + motivos). **Nunca `expediente_crear`.**
