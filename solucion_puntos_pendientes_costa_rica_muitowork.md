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

## PASO 0 (OBLIGATORIO PRIMERO) — Re-bajar el MCP del GitHub con lo último (force-reinstall)
> ⚠️ pip **cachea** el paquete: si ya tienes `mwt-mcp` instalado, `pip install git+...` **NO** baja los cambios nuevos y verás "tools que no existen" (`producto_alias_crear`, `expediente_eliminar`, `oc_editar`, `expediente_buscar`…). **Siempre reinstala forzado antes de empezar:**

```bash
pip uninstall -y mwt-mcp
pip install --no-cache-dir --force-reinstall "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```

**Verifica la versión** (que estén las tools nuevas) antes de arrancar:
```bash
MWT_MCP_TOKEN=dummy python - <<'PY'
import asyncio; from mwt_mcp.server import mcp
req = {"expediente_buscar","expediente_editar","oc_editar","marca_listar",
       "producto_alias_crear","expediente_eliminar","documento_eliminar",
       "tallas_listar","expedientes_crear_lote"}
names = {t.name for t in asyncio.run(mcp.list_tools())}
falt = req - names
print("TOTAL TOOLS:", len(names))
print("FALTANTES:", falt or "ninguna ✅")
assert not falt, "MCP DESACTUALIZADO: vuelve a hacer el force-reinstall del PASO 0"
PY
```
Si `FALTANTES` no es vacío → repite el force-reinstall (no sigas con una versión vieja).

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
                PRINT(out)                    # 4) NARRA EN EL CHAT en vivo qué hizo/encontró + registra checklist
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
[ ] 2.  CABECERA      → expediente_obtener. **TRIANGULAR**: setea operating_company_id = UUID Muito Work
                         (5525986c-...) en el MISMO edit-full que las líneas (paso 5, ver §5-BIS "TRIANGULAR") —
                         este era el bug: quedaban como DIRECTO. brand_id=Marluvas (marca_listar → expediente_editar +
                         oc_editar), modo_operacion="COMISION". cliente final correcto (Sondel u otro de la OC).
[ ] 3.  CÓDIGOS       → Actualizar `codigo` de la OC a `po` (ej. "504990") vía `oc_editar` y `codigo` del expediente
                         a `f"EXP-{po}"` vía `expediente_editar`. (No enviar "po_number" porque la API lo ignora).
[ ] 4.  MATCH Part Nº → la OC trae "Part Nº" del CLIENTE (no el SKU MWT) con la talla al final.
                         Resuélvelo a producto MWT por ALIAS o por NOMBRE (§5-TER). SKU sin tallas/inexistente →
                         tallas_listar + producto_crear(...tallas UUID...) + producto_alias_crear.
[ ] 5.  LÍNEAS+OPERADOR→ UN solo expediente_edit_full_patch(eid, {operating_company_id (TRIANGULAR=Muito Work),
                         forma_pago:"CREDITO", payment_days:90, lines_removed:[dummy "PENDING" ids],
                         lines_added:[{producto_id, sku, talla, qty} por SKU×TALLA real]}). Talla del sufijo del
                         Part Nº o de la matriz de la proforma (NUNCA "UNICA"); cantidades = OC/proforma. (Ver §5-BIS.)
[ ] 6.  PRECIOS       → lineas_actualizar_precios([{linea_id, unit_price_mwt, unit_price_client}]) = precios de la OC/proforma;
                         total_price == qty × unit_price_cliente.
[ ] 7a. LIMPIAR DOCS  → documento_listar(expediente=eid): si hay un documento OC con código "SIN-PO" u "OC-AUTO-...",
                         y tiene archivo (storage_url != null), edita su código al PO correcto usando `documento_editar(doc_id, {"codigo": po})`.
                         Si no tiene archivo (storage_url = null o file_size_bytes = 0), bórralo con `documento_eliminar`.
[ ] 7b. SUBIR OC      → Si falta el documento de la OC, haz `documento_subir(kind="OC", codigo=po, expediente_id, oc_id, file_path, audience="CLIENT")`.
[ ] 7c. PROFORMA real → si está en OneDrive y falta: documento_subir(kind="PROFORMA", codigo="2453-2026", file_path=...).
[ ] 7d. PROFORMA sist.→ proforma_generar(expediente_id, audience="CLIENT"/"ADMIN_ONLY") **SOLO DESPUÉS** de cargar
                         líneas+precios (pasos 5-6); si la generas antes, sale en 0 pares / $0.
[ ] 7e. OTROS DOCS    → BL/AWB, DUA, Factura Marluvas, Packing, Pago de Impuestos (documento_subir kind=...).
[ ] 8.  SAP           → busca el Excel SAP en OneDrive (subcarpeta SAP/) o en el CORREO: hilo de Marluvas
                         "[Marluvas] Re: [Ticket #NNNNN] - RE: Registro da Proforma nº <proforma> - Muito Work Limitada / Costa Rica"
                         (remitente backoffice@marluvas.com.br); el XLSX (ej. 269482.xlsx) va ADJUNTO en el cuerpo → descárgalo.
                         Luego: sap_analizar(expediente_id, file_path) → devuelve sap_id, fecha_fabricacion y lineas[] con match.line_id.
                         Arma lineas_confirmadas con esos line_id y qty, y:
                         sap_confirmar(expediente_id, sap_id="269482", lineas_confirmadas=[{linea_id, qty_confirmada, unit_price}],
                                       fecha_fabricacion="2026-04-01", file_path=<xlsx>)  (firma: expediente_id PRIMERO; "fecha_fabricacion").
                         Asigna el SAP a esos productos y pasa REGISTRO→PRODUCCION. (si NO está en REGISTRO → sap_upsert, misma firma).
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

## ⚠️ TRIANGULAR (operado por Muito Work) — cómo setear el OPERADOR (esto fallaba)
Un expediente bajo `02 M Muito Work` cuyo cliente final es Sondel (u otro) es **TRIANGULAR**: el bug fue dejarlo como DIRECTO (sin `operating_company_id`). Para que el detalle muestre **"OPERADO POR MUITO WORK LIMITADA"** y los **precios duales** (Precio MWT + Precio Cliente), setea el operador **en el MISMO `edit-full` que carga las líneas**:

1. Obtén el UUID de Muito Work: `cliente_listar(q="Muito Work Limitada")` → `5525986c-3b09-4d13-bf8f-43ccaa2deae3` (CR, crédito $60k). El `client_id` (cliente final) sigue siendo Sondel.
2. `expediente_edit_full_patch(expediente_id, cambios)` con **`operating_company_id` = UUID Muito Work** + las líneas reales, en una sola llamada (payload real verificado):
```json
{
  "operating_company_id": "5525986c-3b09-4d13-bf8f-43ccaa2deae3",
  "forma_pago": "CREDITO",
  "payment_days": 90,
  "lines_added": [
    {"producto_id":"e7d6f2f7-3e0d-480a-95f4-1596e0273ec2","sku":"701809","talla":"37","qty":40},
    {"producto_id":"97f018d5-2a43-4d0e-a88f-54b807fc24c0","sku":"700728","talla":"38","qty":50}
    /* ...una por SKU×talla real... */
  ],
  "lines_removed": ["<linea_id dummy 1>","<linea_id dummy 2>", "..."],
  "lines_updated": []
}
```
   (Nota: `talla`/`qty`; en `lines_added` NO van precios — se fijan en el paso 6 con `lineas_actualizar_precios`: `unit_price_mwt` = precio de la PROFORMA, `unit_price_client` = precio de la OC. Eso genera el snapshot dual.)
3. **DIRECTO** (cuando NO es triangular, el cliente opera directo): `operating_company_id = client_id` (el mismo cliente). Sin snapshot dual.
4. Verifica con `expediente_obtener`: debe mostrar `operating_company_id` = Muito Work y el cliente final correcto; el detalle dirá "OPERADO POR MUITO WORK LIMITADA".

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

# 5-TER · MATCHING del "Part Nº" de la OC → producto MWT (por alias o por nombre)

En la OC de Sondel el **"Part Nº" es el código del CLIENTE con la talla al final**, NO el SKU de MWT, y a veces el nombre no coincide exacto. Ej. real (OC 504990 → proforma 2453-2026):

| Part Nº (OC) | base (sin talla) | talla | Unit Price (precio CLIENTE) |
|---|---|---|---|
| `50B22CPAP-37` | `50B22CPAP` | 37 | 18.23 |
| `50B22CPAP-40` | `50B22CPAP` | 40 | 18.23 |
| `75BPR29-MSMC-CPAP-38` | `75BPR29-MSMC-CPAP` | 38 | 36.73 |
| `70C32-PET-CPAP-PAD-39` | `70C32-PET-CPAP-PAD` | 39 | 28.39 |

**Cómo resolver cada línea (en este orden, hasta lograr ≥1 coincidencia):**
1. **Extrae la talla** del sufijo (dígitos tras el último guión: `-37`, `-38`, …) y el **base** = el resto.
2. **Alias (server-side):** `expediente_resolve_oc_preview(client_id=<cliente final>, lines=[{client_part_number:"50B22CPAP-37", qty:40}])`. El matcher de la consola cruza el base contra `product_client_alias`, extrae la talla y devuelve `producto_id`, `sku`, `size`, `unit_price` y `needs_review`. Usa esos `producto_id`/`sku` para las líneas. (Es lo más fiable: usa el alias ya registrado.)
3. **Si `needs_review=true` (sin alias):** busca por **nombre/descripción**: `producto_listar(q="<base o texto de la Description>")` (busca en nombre+sku+descripción). Toma la **mejor coincidencia** (la más parecida al nombre/descripción de la OC). Ej.: Description "Lace-up Boot-Composite-midsole…" / base `50B22CPAP` → producto `50B22M-CPAP-PAD` (SKU 700844). Quédate con **al menos una coincidencia** razonable.
4. **Registra el alias** para que no vuelva a fallar: `producto_alias_crear(producto_id, cliente_id=<cliente final>, alias="50B22CPAP")` (el base, sin la talla).
5. **Si de plano no hay ninguna coincidencia** ni por alias ni por nombre → crea el producto (`producto_crear` con tallas UUID) y luego el alias. Solo crea si realmente no existe.
6. **Precio:** el "Unit Price" de la OC es el **precio CLIENTE** (`unit_price_client`); el `unit_price_mwt` sale del SAP/proforma (si no hay margen real, iguala mwt=cliente). Cantidad = "Qty" de la OC.

> Regla: **nunca dejes una línea sin producto por no coincidir el nombre exacto.** Primero alias, luego nombre/descripción (mejor coincidencia), luego crear. Y registra el alias para la próxima.

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
| G | Documentos | `documento_listar` | `storage_url=null`/`file_size_bytes=0`; **OC duplicado o "PO SIN-PO" sin borrar**; OC con `codigo` inventado (≠ PO real); proforma del sistema con 0 pares (se generó antes de cargar líneas); falta OC/proforma/SAP/DUA |
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
4b. **Match del Part Nº de la OC** (código del cliente, no SKU): resuélvelo por **alias** (`expediente_resolve_oc_preview`) y, si no, por **nombre/descripción** (`producto_listar`, mejor coincidencia); registra el alias (`producto_alias_crear`). **Nunca dejes una línea sin producto por no coincidir el nombre exacto** (§5-TER).
5. **Códigos limpios** (OC "503295", proforma "2453-2026"); **nunca "SIN-PO"**.
6. **SAP obligatorio** si el doc/correo lo trae (analyze→confirm con todas las líneas + archivo).
7. **Todos los archivos a MinIO** (verifica `storage_url≠null`); borra rotos con `documento_eliminar` y re-sube.
8. **DUA/costos CR** completos sobre el movimiento (§6) + `transfer_liquidar`.
9. **Email a `alejandro@muitowork.com` cada 10 expedientes** con el resumen ejecutivo (§8).
10. **Cita la fuente** (correo: asunto·fecha·remitente / archivo OneDrive). Nunca inventes.
11. **NARRA EN VIVO (feedback continuo):** mientras trabajas, **ve diciendo en el chat qué estás haciendo y cómo**, expediente por expediente y paso por paso — no trabajes en silencio. En cada expediente di al menos: «🔍 Analizando PF 2453-2026 / OC 504990…», qué encontraste en OneDrive/correo, qué decides (ej. «matcheé `50B22CPAP-37`→SKU 700844 por alias», «creo SKU 700728 con tallas 38-43», «borro OC fantasma sin archivo»), cada acción del MCP antes de hacerla y su resultado («✅ líneas cargadas: 10 / total 425 pares», «✅ SAP 269474 confirmado», «⚠️ sin Excel SAP en OneDrive»), y el veredicto del Auditor al cerrar. El **PRINT del REPL (§1)** es ese feedback. El email por lote (§8) NO sustituye la narración en vivo: el correo es el resumen cada 10; el chat es el play-by-play en tiempo real.

---

# 11 · ARRANQUE — 3 fases (escribir harness → piloto → lote)

**FASE A · Escribe el harness** (§12): el script Python orquestador que lee OneDrive+correo, completa cada expediente vía MCP, audita y manda email cada 10.
**FASE B · PILOTO con UN expediente** antes de tocar los 50: corre el harness en modo piloto sobre **proforma 2453-2026 / OC 504983** (`python harness.py --piloto 2453-2026`). Valida con el MCP que quedó perfecto (gate A–J) y **muestra la narración en vivo (§10 regla 11)**. No sigas si el piloto no pasa.
**FASE C · LOTE COMPLETO:** una vez validado el piloto, corre `python harness.py --todos` sobre las ~50 proformas de CR·MuitoWork, en lotes de 10, con email por lote y reanudación si se cae.

Antes de todo: **PASO 0** (force-reinstall del MCP) + `mwt_whoami` (rol admin).

---

# 12 · HARNESS PYTHON ORQUESTADOR (escríbelo y córrelo)

El harness usa las **funciones del propio MCP como SDK** (las importa de `mwt_mcp.server`): así el script Python llama directo `M.expediente_buscar(...)`, `M.documento_subir(...)`, etc., con el mismo token. Lee OneDrive (filesystem) y correo (imaplib) en Python, parsea proforma/OC, completa el checklist §5, audita (§9) y envía email cada 10 (smtplib). Es **resiliente** (REPL §1: reconecta y reintenta el mismo expediente) y **reanudable** (estado en JSON).

```python
#!/usr/bin/env python3
# harness.py — remediación CR · Muito Work (operador). Uso:
#   python harness.py --piloto 2453-2026      # 1 expediente de prueba
#   python harness.py --todos                 # lote completo (~50), de a 10
import os, sys, json, time, argparse, traceback, smtplib, imaplib
from email.message import EmailMessage

os.environ.setdefault("MWT_MCP_TOKEN", "<TOKEN del PASO 0>")
os.environ.setdefault("MWT_API_BASE", "https://consola.mwt.one/api")
import mwt_mcp.server as M          # ← las tools del MCP como SDK (requiere PASO 0 hecho)

ONEDRIVE = "<ruta local>/01 Ventas/01 Marluvas/01 M Costa Rica/02 M Muito Work"
ESTADO   = "estado_cr_muitowork.json"        # checklist persistente / reanudable
IMAP = {"host":"az1-ts3.a2hosting.com","port":993,"user":"alvaro@muitowork.com","pass":"<...>"}
SMTP = {"host":"...","port":587,"user":"...","pass":"...","to":"alejandro@muitowork.com"}

# ---------- utilidades de estado (reanudable) ----------
def cargar_estado():
    try: return json.load(open(ESTADO))
    except Exception: return {}
def guardar_estado(s): json.dump(s, open(ESTADO,"w"), ensure_ascii=False, indent=1)

# ---------- conexiones (reconexión automática) ----------
def chequear_mcp():
    who = M.mwt_whoami()
    assert isinstance(who,dict) and who.get("role")=="admin", f"MCP/token mal: {who}"
def imap_conectar():
    c = imaplib.IMAP4_SSL(IMAP["host"], IMAP["port"]); c.login(IMAP["user"], IMAP["pass"]); return c

# ---------- READ: material real de UNA proforma ----------
def leer_onedrive(proforma):
    # localiza la carpeta de la proforma (directa o dentro de '01 MW SONDEL …'),
    # devuelve rutas locales de: oc_pdf, proforma_xlsx/pdf, sap_xlsx, bl_awb, dua, factura, packing.
    ...
def leer_correo(proforma, imap):
    # busca el hilo de esa proforma; baja adjuntos a /tmp; saca fechas de hitos. Si se cae, relanza excepción.
    ...
def parsear_oc(oc_pdf):
    # devuelve {cliente_final, po_number_real, lineas:[{part_number, base, talla, qty, precio_cliente}]}
    ...
def parsear_proforma(xlsx):
    # matriz de tallas -> [{sku?|base, talla, qty, precio_mwt, precio_cliente}]
    ...

# ---------- EVAL+EJECUTA: completa el expediente con el MCP (checklist §5) ----------
def completar_expediente(proforma, ctx, log):
    cli  = ctx["cliente_final"]; po = ctx["po_number_real"]
    found = M.expediente_buscar(proforma=proforma, oc_number=po)        # 1 localizar
    if not found.get("existe"):
        log("⚠️ no existe expediente para", proforma); return "sin_expediente"
    exp = found["matches"][0]; eid = exp["expediente_id"]; oid = exp["oc_id"]
    # 1b RESPALDO: si no hay OC/proforma real ni en OneDrive ni en correo -> FANTASMA -> borrar
    if not ctx["tiene_respaldo"]:
        M.expediente_eliminar(eid); log("🗑️ fantasma sin respaldo -> borrado", proforma); return "borrado"
    # 2 cabecera: operador Muito Work, cliente final, marca, modo
    marca = M.marca_listar(q="Marluvas"); brand = marca[0]["id"] if isinstance(marca,list) and marca else None
    M.expediente_editar(eid, {"brand_id": brand, "modo_operacion": "COMISION", "codigo": f"EXP-{po}"})  # cabecera
    M.oc_editar(oid, {"brand_id": brand, "codigo": po})                  # 3 código OC limpio (PO real)
    # 4 match Part Nº -> producto ; 5 OPERADOR + líneas reales en UN edit-full (TRIANGULAR=Muito Work) ; 6 precios
    lines_added = resolver_lineas(cli, ctx["lineas"], log)               # usa expediente_resolve_oc_preview / producto_listar / producto_alias_crear
    dummy = [l["id"] for l in M.expediente_lineas(eid) if (l.get("sku") in (None,"PENDING"))]
    M.expediente_edit_full_patch(eid, {
        "operating_company_id": ctx["operador_mwt_id"],   # TRIANGULAR: UUID Muito Work (5525986c-...). DIRECTO: = client_id
        "forma_pago": "CREDITO", "payment_days": 90,
        "lines_removed": dummy, "lines_added": lines_added,
    })
    M.lineas_actualizar_precios(precios_desde(M.expediente_lineas(eid), ctx))  # unit_price_mwt(proforma) + unit_price_client(OC)
    # 7 documentos (limpia/edita OC con "SIN-PO" usando documento_editar, sube OC real con PO, proforma real, otros) ; verifica storage_url
    subir_documentos(eid, oid, po, proforma, ctx, log)
    # 7d proforma del SISTEMA *después* de cargar líneas
    M.proforma_generar(eid, audience="CLIENT"); M.proforma_generar(eid, audience="ADMIN_ONLY")
    # 8 SAP (analyze->confirm con todas las líneas) si hay xlsx ; 9 estados+fechas
    cargar_sap(eid, ctx, log); avanzar_estados_y_fechas(eid, ctx, log)
    # 10-13 nodos (aéreo/marítimo) + recepción + movimiento al CLIENTE FINAL + costos/DUA (§6,§7)
    nodo_recepcion_movimiento_costos(eid, ctx, log)
    return "hecho"

def auditar(proforma, eid, log):
    # gate §9 A–J re-consultando el MCP. Devuelve ("APROBADO"|"RECHAZADO", fallos[])
    ...

def email_resumen(lote_idx, items):
    msg = EmailMessage(); msg["Subject"]=f"Remediación CR·MuitoWork — lote {lote_idx}"
    msg["From"]=SMTP["user"]; msg["To"]=SMTP["to"]
    msg.set_content(render_resumen(items))     # tabla por expediente: qué cambió/agregó, totales, veredicto, borrados
    with smtplib.SMTP(SMTP["host"], SMTP["port"]) as s:
        s.starttls(); s.login(SMTP["user"], SMTP["pass"]); s.send_message(msg)

# ---------- BUCLE PRINCIPAL (REPL resiliente, reanudable) ----------
def procesar(proformas):
    st = cargar_estado(); imap = None
    for lote_idx, lote in enumerate(chunks(proformas, 10), start=1):
        items=[]
        for pf in lote:
            if st.get(pf,{}).get("estado")=="hecho":  # reanudación
                continue
            intentos=0
            while True:
                logbuf=[]; log=lambda *a: (print(*a), logbuf.append(" ".join(map(str,a))))  # NARRA EN VIVO (§10.11)
                try:
                    chequear_mcp()
                    if imap is None: imap = imap_conectar()
                    log(f"🔍 Analizando PF {pf} …")
                    ctx = construir_contexto(pf, imap, log)     # leer_onedrive + leer_correo + parsear_*
                    eid = ctx.get("expediente_id")
                    estado = completar_expediente(pf, ctx, log)
                    veredicto, fallos = auditar(pf, eid, log) if estado=="hecho" else (estado, [])
                    st[pf]={"estado":"hecho" if veredicto=="APROBADO" else veredicto,"fallos":fallos,"log":logbuf}
                    guardar_estado(st); items.append((pf, st[pf])); break
                except (imaplib.IMAP4.error, ConnectionError, OSError, M.MwtApiError) as e:
                    intentos+=1; log(f"🔌 conexión perdida ({e}); reconectando… intento {intentos}")
                    try: imap and imap.logout()
                    except Exception: pass
                    imap=None; time.sleep(3)
                    if intentos>=5:
                        st[pf]={"estado":"fallido","motivo":str(e),"log":logbuf}; guardar_estado(st); items.append((pf, st[pf])); break
                    continue                                  # reintenta el MISMO expediente (idempotente)
                except Exception as e:
                    st[pf]={"estado":"fallido","motivo":str(e),"trace":traceback.format_exc()}; guardar_estado(st); items.append((pf, st[pf])); break
        email_resumen(lote_idx, items)                        # § 8 · cada 10
    reporte_final(st)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--piloto"); ap.add_argument("--todos",action="store_true")
    a=ap.parse_args(); chequear_mcp()
    if a.piloto: procesar([a.piloto])                          # FASE B
    elif a.todos: procesar(listar_proformas_cr_muitowork())    # FASE C (~50, de a 10)
    else: print("usa --piloto <proforma> o --todos")
if __name__=="__main__": main()
```

> Las funciones con `...` (leer_onedrive, leer_correo, parsear_oc/proforma, resolver_lineas, subir_documentos, cargar_sap, avanzar_estados_y_fechas, nodo_recepcion_movimiento_costos, auditar, render_resumen, construir_contexto, listar_proformas_cr_muitowork) las **completas siguiendo §4–§9** (parseo de proforma/OC con openpyxl/pdfplumber; matching por alias/nombre §5-TER; costos/DUA §6; nodos/movimiento §7; gate §9). Mantén la **idempotencia** (consultar antes de escribir) para que el reintento no duplique. **Narra en vivo** en cada paso (§10.11).
