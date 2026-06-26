# PROMPT — FLUJO COMPLETO COSTA RICA · SONDEL S.A. · **AÑOS 2019–2025** (histórico: creación + remediación) · consola.mwt.one

> 🗓️ **ALCANCE: SOLO las carpetas `2019`, `2020`, `2021`, `2022`, `2023`, `2024`, `2025`.** NO proceses 2026 (eso lo cubre el prompt `..._sondel.md`).
> 📜 **Son expedientes HISTÓRICOS** — la mayoría ya estaban cerrados/entregados. Igual se crean/completan al 100% (líneas, precios, docs, SAP, recepción, movimiento, costos) y se llevan a su **estado real final con fechas reales** sacadas del correo archivado. La fecha de hoy NO importa: respeta las fechas del año que corresponda.

> ## 🛠️ MODO REMEDIACIÓN (si el expediente YA existe)
> Antes de crear, **busca** si el expediente ya está registrado (`expediente_buscar` por proforma+OC, §ruta abajo). Si **ya existe**, NO lo recrees ni rehagas líneas/precios/documentos ya cargados — haz SOLO lo que le falte: **SAP faltante** (búscalo en el correo del año, súbelo y asígnalo), **avanzar estado** salto-a-salto al real (casi siempre CERRADO) y **fechas por fase** del correo del año. Si **no existe**, créalo con el checklist completo (§3). En ambos casos, SAP/estado/fechas se operan sobre el **ID DE EXPEDIENTE** (`…/exp/<id>`), no el de la OC.
>
> ### 🔎 Cómo obtener el ID de expediente (OC → expediente · para SAP/estado/fechas)
> El SAP, el estado y las fechas viven a nivel **EXPEDIENTE**, no de la OC. Una OC (`oc_obtener(oc_id)` = `GET /api/ocs/{oc_id}/`) trae `proforma`, `codigo` (OC) y un resumen (`sap` suele venir `null` a nivel OC); **el `…/exp/<id>` no sale de ahí**. Para obtener el/los `expediente_id`:
> - `expediente_buscar(oc_number="<OC>", proforma="<NNNN-AAAA>", client_id=<Sondel>)` → `matches:[{expediente_id, oc_id, sap_codigos, estado, …}]`, **o**
> - `expediente_listar(oc="<oc_id>")` → expedientes de esa OC (cada uno con su `id`, `sap`, `estado`).
>
> El `expediente_id` es el que usas en `expediente_avanzar_estado`, `expediente_phase_durations_set`, `sap_analizar`/`sap_confirmar` y `expediente_obtener`. **Una OC puede tener varios expedientes** (uno por SAP/split) → procesa cada uno por separado.

> **Para:** un agente de codificación capaz (Sakana Fugu / Kimi CLI / Claude / Antigravity).
> **Objetivo:** procesar **un expediente completo a la vez** — desde la creación/completado con cliente **SONDEL S.A.** — leyendo la verdad de **OneDrive + correo**, hasta dejarlo con productos, documentos, SAP, estados con fechas, recepción de inventario, movimiento al nodo de Sondel y costos/impuestos/DUA de Costa Rica. **No avanza al siguiente hasta terminar y auditar el actual.**
> **Equipo:** **Orquestador** (arma el plan/checklist) → **Operativo** (lee OneDrive/correo y crea/completa vía MCP) → **Auditor** (revisa lo creado). Todos **narran en vivo** al usuario.
> **Resiliencia:** el IMAP se cae cada ~2 min → el Operativo **reconecta solo** y reintenta.

---

# 0 · PASO 1 OBLIGATORIO — Instalar y conectar el MCP Server

## 0.1 Instala/actualiza el MCP (force-reinstall — evita versiones cacheadas)
```bash
pip uninstall -y mwt-mcp
pip install --no-cache-dir --force-reinstall "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```
## 0.2 Configura la conexión (JSON `mcp.json` / Claude Desktop / Cursor / Kimi CLI)
```json
{
  "mcpServers": {
    "mwt-one": {
      "command": "python",
      "args": ["-m", "mwt_mcp"],
      "env": {
        "MWT_MCP_TOKEN": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjo0OTM1NDM1NjQ2LCJpYXQiOjE3ODE4MzU2NDYsImp0aSI6ImY4OTllMTEyODFjODRmZDI5ZGNjNGVhZDVlOWFhNDFlIiwidXNlcl91dWlkIjoiNTA3MmZjZTItZTY2ZS00YmY3LThmZDItNjIzY2ZkM2FmYWY2IiwiZW1haWwiOiJhbGVqYW5kcm9AbXVpdG93b3JrLmNvbSIsInJvbGUiOiJhZG1pbiIsIm1jcCI6dHJ1ZX0.yeS-5L0LNapR7E6FJuH8g0d2hPobeMwWoke-TqKTetk",
        "MWT_API_BASE": "https://consola.mwt.one/api"
      }
    }
  }
}
```
Kimi CLI:
```bash
kimi mcp add mwt-one --command python --args "-m,mwt_mcp" \
  --env MWT_MCP_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjo0OTM1NDM1NjQ2LCJpYXQiOjE3ODE4MzU2NDYsImp0aSI6ImY4OTllMTEyODFjODRmZDI5ZGNjNGVhZDVlOWFhNDFlIiwidXNlcl91dWlkIjoiNTA3MmZjZTItZTY2ZS00YmY3LThmZDItNjIzY2ZkM2FmYWY2IiwiZW1haWwiOiJhbGVqYW5kcm9AbXVpdG93b3JrLmNvbSIsInJvbGUiOiJhZG1pbiIsIm1jcCI6dHJ1ZX0.yeS-5L0LNapR7E6FJuH8g0d2hPobeMwWoke-TqKTetk \
  --env MWT_API_BASE=https://consola.mwt.one/api
```
> 🔐 Token admin embebido (decisión del CEO para conectar el agente). Trátalo como secreto; para revocarlo, rota con `mint_mcp_token`.
## 0.3 Verifica versión + sesión (no sigas si falla)
```bash
MWT_MCP_TOKEN=dummy python - <<'PY'
import asyncio; from mwt_mcp.server import mcp
req={"expediente_buscar","expediente_editar","oc_editar","marca_listar","producto_alias_crear",
     "expediente_eliminar","documento_eliminar","documento_subir","tallas_listar","expediente_fusionar",
     "expediente_resolve_oc_preview","lineas_actualizar_precios","expediente_edit_full_patch",
     "proforma_generar","sap_analizar","sap_confirmar","sap_upsert","sap_obtener",
     "expediente_avanzar_estado","expediente_phase_durations_set",
     "nodo_listar","nodo_crear","recepcion_crear","inventario_transferir_asignaciones",
     "transferencia_crear","transferencia_aprobar","transferencia_despachar","transferencia_recibir",
     "transferencia_conciliar","transferencia_editar","transferencia_listar","transferencia_obtener",
     "transfer_costo_agregar","transfer_liquidar","transfer_artefacto_crear","storage_subir_archivo",
     "builder_templates_listar","builder_template_obtener","tipo_cambio"}
names={t.name for t in asyncio.run(mcp.list_tools())}
print("TOTAL:",len(names),"FALTAN:",(req-names) or "ninguna ✅")
assert not (req-names), "MCP viejo: repite el force-reinstall (0.1)"
PY
```
Luego `mwt_whoami` → rol `admin`, `alejandro@muitowork.com`.

---

# 1 · ALCANCE Y FUENTES (OneDrive + correo)

## 1.1 Carpetas a leer — ⚠️ SOLO los años **2019 → 2025**
> **Alcance temporal limitado: procesa únicamente las carpetas `2019`, `2020`, `2021`, `2022`, `2023`, `2024`, `2025`.** Ignora `2026`. Recorre los años en orden cronológico (2019 primero).
- **Sondel directo:** `01 Marluvas / 01 M Costa Rica / 01 M Sondel / **<AÑO>** / <carpeta>` con `<AÑO>` ∈ {2019…2025}.
- **Operado por Muito Work (misma OC):** `01 Marluvas / 01 M Costa Rica / 02 M Muito Work / **<AÑO>** / <carpeta>`.

Cada carpeta se llama `<proforma> PO <po>` — ej. `1990-2023 PO 487201`: **`1990-2023` = nº de proforma** (el sufijo es el año de la operación), **`487201` = nº de OC/PO** (a veces solo viene la proforma). *(Los códigos son ilustrativos; usa los reales de cada carpeta.)*

## 1.2 Archivos dentro de cada carpeta
`Factura/`, `SAP/`, `OC del Cliente/`, `Proforma/`, `Packing List Detallado/`, `Guia/` (con su **AWB o BL**), `DUA/`, `Pago de Impuestos/`. Descarga cada archivo a ruta local (para `file_path`). En años viejos puede faltar algún subfolder — usa lo que exista y registra en el resumen lo que no esté.

## 1.3 Correo (IMAP `alvaro@muitowork.com`)
Busca por **nº de proforma y de OC** el hilo de esa operación → **estados y fecha de INICIO y FIN de cada estado** (REGISTRO, PRODUCCION, PREPARACION, DESPACHO, TRANSITO, EN_DESTINO, CERRADO), AWB/BL, DUA, costos, entrega. ⚠️ Para años viejos el hilo puede estar en carpetas IMAP archivadas (Archive/Todos) — busca en TODAS las carpetas, no solo INBOX. Lee solo el hilo de ESA proforma; si se cae el IMAP, **reconecta y sigue**.

## 1.4 Cliente, operador y PRECIOS DUALES (regla clave)
- **Cliente final = SONDEL S.A.** (siempre, en estos expedientes).
- Carpeta en **`01 M Sondel`** → **operación directa**: `operating_company_id = Sondel`. Un solo precio (el de la OC = precio cliente).
- Carpeta en **`02 M Muito Work` con la MISMA OC** → **operador = Muito Work Limitada**, **cliente = Sondel**. **DOS precios:**
  - **`unit_price_mwt`** = el precio que ves en la **PROFORMA** (precio MWT).
  - **`unit_price_client`** = el precio que ves en la **OC** (precio cliente).
- **Fusión:** si una misma OC aparece en Sondel **y** en Muito Work → son expedientes a **fusionar** (§5), con label = «proforma Sondel + proforma Muito Work».

---

# 2 · AGENTES (con feedback en vivo) y RESILIENCIA

- **🧭 Orquestador** — por cada proforma/OC arma el **plan/checklist** (§4) con el material de OneDrive/correo y se lo pasa al Operativo. Procesa **uno por uno**; no entrega el siguiente hasta que el actual esté `APROBADO`. Recibe del Auditor lo que esté mal y lo **re-pasa al Operativo** para corregir.
- **⚙️ Operativo** — lee OneDrive + correo, crea/completa el expediente vía MCP siguiendo el checklist. Si el IMAP se cae, **reconecta y reintenta** (idempotente). 
- **🔎 Auditor** — re-verifica con el MCP lo creado (§8). Si algo falla, devuelve al Orquestador la lista de fallos; el ciclo Operativo→Auditor se repite hasta `APROBADO`.

## Feedback en vivo (obligatorio)
Narra SIEMPRE en el chat, en tiempo real: «🧭 Orquestador: armando plan de PF 1990-2023 / OC 487201…», «⚙️ Operativo: leyendo OneDrive… encontré OC, proforma, SAP; falta DUA», cada acción del MCP y su resultado (✅/⚠️), «🔎 Auditor: revisando… ❌ faltan precios MWT», «🧭→⚙️ devuelvo a Operativo: corregir precios», y al cerrar un **resumen del expediente** (qué se hizo y cómo) antes de pasar al siguiente.

## Reconexión IMAP
El servidor de correo (A2Hosting) desconecta cada ~2 min. El Operativo debe atrapar la desconexión, **volver a hacer login al IMAP** y continuar desde donde quedó, sin perder el expediente en curso.

---

# 3 · CHECKLIST POR EXPEDIENTE (Operativo) — uno por uno, completo

```
[ ] 1.  LOCALIZAR/CREAR  → expediente_buscar(proforma="1990-2023", oc_number="487201") [args NOMBRADOS].
                            Si existe (esqueleto), se COMPLETA; si no, se CREA con líneas REALES (nunca dummy). NUNCA "SIN-PO".
[ ] 2.  CLIENTE/OPERADOR → cliente final = SONDEL S.A. (cliente_listar/crear). Operador: **DIRECTO** = Sondel
                            (`operating_company_id`=client_id) o **TRIANGULAR** = Muito Work (UUID 5525986c-...) si la carpeta es
                            02 M Muito Work / misma OC. ⚠️ El `operating_company_id` se setea en el MISMO edit-full que las
                            líneas (paso 6, ver §4 "Setear el OPERADOR") — así sale "OPERADO POR MUITO WORK LIMITADA" + precios duales.
[ ] 3.  MARCA/MODO       → brand_id = Marluvas (marca_listar) en expediente Y OC; modo_operacion.
[ ] 4.  CÓDIGOS          → OC = nº PO real (ej. 487201); proforma "1990-2023" (sufijo = año real). Limpios; nunca filename/prefijos.
[ ] 5.  PRODUCTOS/SKUs   → match del "Part Nº" de la OC → producto (alias o nombre, §3-BIS); SKU faltante →
                            tallas_listar + producto_crear(tallas UUID) + producto_alias_crear.
[ ] 6.  LÍNEAS+OPERADOR  → UN solo expediente_edit_full_patch(eid, {operating_company_id (TRIANGULAR=Muito Work / DIRECTO=Sondel),
                            forma_pago:"CREDITO", payment_days:90, lines_removed:[dummy "PENDING" ids],
                            lines_added:[{producto_id, sku, talla, qty} por SKU×TALLA real de la OC]}). Sin "UNICA"/"PENDING". (§4)
[ ] 7.  PRECIOS (duales) → lineas_actualizar_precios(updates=[{linea_id, unit_price_mwt, unit_price_client}]).
                            unit_price_mwt = precio de la PROFORMA; unit_price_client = precio de la OC. (Directo Sondel: mwt = cliente.)
                            Los linea_id salen de expediente_lineas(expediente_id).
[ ] 8.  DOCS             → borra OC roto previo (documento_eliminar). Para OC/Proforma, si quieres que la IA mapee
                            productos y haga cross-check, usa match_subir(expediente_id, document_type="ART-01_OC"|"ART-02_PROFORMA", file_path);
                            si ya resolviste las líneas, documento_subir(file_path, kind="OC", codigo="487201", expediente_id, oc_id, audience="CLIENT").
                            Resto (Factura, Packing, Guía AWB/BL, DUA, Pago de Impuestos) por documento_subir.
                            **Siempre expediente_id u oc_id**. Verifica storage_url≠null y file_size_bytes>0.
[ ] 9.  PROFORMA SISTEMA → proforma_generar(CLIENT y ADMIN_ONLY) SOLO DESPUÉS de cargar líneas (si no, sale en $0).
[ ] 10. SAP              → busca el Excel SAP en OneDrive (subcarpeta SAP/) o en el CORREO: hilo de Marluvas
                            "[Marluvas] Re: [Ticket #NNNNN] - RE: Registro da Proforma nº <proforma> - ... / Costa Rica"
                            (remitente backoffice@marluvas.com.br); el XLSX (ej. 269482.xlsx) va ADJUNTO en el cuerpo → descárgalo.
                            sap_analizar(expediente_id, file_path="<excel SAP>") → arma lineas_confirmadas con los
                            linea_id reales (de expediente_lineas / del match.line_id) de TODAS las líneas que cubre el SAP, luego
                            sap_confirmar(expediente_id, sap_id="<nº SAP real>",
                                          lineas_confirmadas=[{linea_id, qty_confirmada, unit_price}],
                                          fecha_fabricacion="<AAAA-MM-DD real del año>", file_path="<excel SAP>")
                            (firma: expediente_id primero; "fecha_fabricacion" no "fecha"; lineas_confirmadas es LISTA, no "TODAS").
                            Sube el Excel y ASIGNA el nº SAP a esos productos. (si NO está en REGISTRO → sap_upsert con misma firma).
[ ] 11. ESTADOS+FECHAS   → ⚠️ usa el ID DE EXPEDIENTE (el de /exp/<id>), NO el de la OC.
                            (a) AVANZAR ESTADO salto-a-salto con expediente_avanzar_estado(expediente_id, fase_to="<FASE>")
                                [= POST /expedientes/{id}/transition/ {fase_to, idempotence_token, note}] una llamada por cada
                                transición hasta el estado REAL (histórico: casi siempre CERRADO). Orden de fases:
                                REGISTRO → PRODUCCION → PREPARACION → DESPACHO → TRANSITO → EN_DESTINO → CERRADO.
                                Esto registra eventos REALES en event_log.
                            (b) FECHAS POR FASE con expediente_phase_durations_set(expediente_id, {"<FASE>":{"start":"AAAA-MM-DD",
                                "end":"AAAA-MM-DD"}}) [= POST /phase-durations/]. El backend MERGEA (no reemplaza) y calcula `days`.
                                REGISTRO ya suele venir sembrado; agrega las fases siguientes. El `start` de cada fase = `end`
                                de la anterior. ⚠️ HISTÓRICO: fechas del CORREO del AÑO correspondiente (o aproximado del año), NUNCA de hoy.
                                Verifica con expediente_phase_durations_get(expediente_id).
                                Ej.: phase_durations_set(eid, {"PRODUCCION":{"start":"2023-03-10","end":"2023-04-28"}}).
[ ] 12. NODOS            → verifica con nodo_listar; si NO existe, créalo (nodo_crear). BARCO (marítimo) y AVIÓN
                            (aéreo) son DOS nodos distintos; + nodo destino = SONDEL S.A. (otro nodo). §7.
[ ] 13. RECEPCIÓN        → recepcion_crear en el nodo que corresponda (BL→marítimo / AWB→aéreo) con SKU·talla·cantidad.
[ ] 14. MOVIMIENTO       → transferencia_crear(...) hub→nodo SONDEL, luego transferencia_aprobar → transferencia_despachar
                            → transferencia_recibir(lineas=[{id,qty_received}]) → transferencia_conciliar (NOMBRES COMPLETOS, §7).
[ ] 15. COSTOS/IMPUESTOS → sobre el movimiento: flete y seguro (de la FACTURA comercial) + DAI (por NCM, scope por línea) +
                            Ley6946/PROCOMER/timbres + gastos destino (servicios aduanales, transporte terrestre) (§6).
                            ⚠️ El IVA NO se carga como costo (es crédito fiscal acreditable, no suma al costo). Luego transfer_liquidar.
[ ] 16. ARTEFACTOS       → factura comercial, AWB/BL, Packing List, impuestos como artefactos con archivo (§7-art).
[ ] 17. FUSIÓN           → si la misma OC está en Sondel y en Muito Work → expediente_fusionar (§5).
[ ] 18. AUDITORÍA        → gate §8 APROBADO → resumen del expediente → siguiente.
```

## §3-BIS · Match del "Part Nº" de la OC → producto
La OC trae el **código del cliente con la talla al final** (ej. `50B22CPAP-37`, `75BPR29-MSMC-CPAP-38`), NO el SKU MWT. Por línea: extrae la **talla** del sufijo y el **base**; resuelve:
1. **Alias (server-side):** `expediente_resolve_oc_preview(client_id=<Sondel>, lines=[{client_part_number:"50B22CPAP-37", qty:40}])` → `producto_id`, `sku`, `size`, `unit_price`, `needs_review`.
2. **Si `needs_review`:** busca por **nombre/descripción** con `producto_listar(q="<texto de la Description>")` y toma la mejor coincidencia.
3. **Registra el alias** (`producto_alias_crear(producto_id, cliente_id, alias="<base>")`) para que no falle la próxima.
4. Solo si no hay ninguna coincidencia → `producto_crear({sku, nombre, marca_id, unidad:"PAR", precio_lista, precio_mwt, hs_code, tallas:[<UUIDs de tallas_listar>], especificaciones:{ncm, color, sizes:[<los MISMOS UUIDs>]}})` — **las tallas van como UUID en `tallas[]` Y en `especificaciones.sizes[]`** (mismo array). **Nunca dejes una línea sin producto por nombre que no coincide exacto.**

---

# 4 · DUAL DE PRECIOS Y FUSIÓN (cuando la OC también está en Muito Work)

Cuando la **misma OC** aparece en `01 M Sondel` y en `02 M Muito Work`:
- Es **una operación operada por Muito Work** con **cliente Sondel**. Cada expediente del par mantiene su **proforma** (la de Sondel y la de Muito Work), pero comparten la OC.
- **Precios duales en las líneas:** `unit_price_mwt` = el de la **proforma** (precio MWT) · `unit_price_client` = el de la **OC** (precio cliente).
- El **nodo destino del movimiento = nodo de SONDEL S.A.** (no Muito Work).
- **Fusión:** `expediente_fusionar([<exp Sondel>, <exp Muito Work>], label="1990-2023 + <proforma MWT>")`. El Auditor verifica que quedó fusionado mostrando ambos números de proforma.

## ⚠️ Setear el OPERADOR (TRIANGULAR vs DIRECTO) — vía `edit-full`
Para que el detalle muestre **"OPERADO POR MUITO WORK LIMITADA"** y los **precios duales**, el `operating_company_id` se setea en el **MISMO `edit-full` que carga las líneas** (no en un PATCH suelto):

1. UUID de Muito Work: `cliente_listar(q="Muito Work Limitada")` → `5525986c-3b09-4d13-bf8f-43ccaa2deae3`. El `client_id` (cliente final) sigue siendo **Sondel**.
2. `expediente_edit_full_patch(expediente_id, cambios)` (payload real verificado):
```json
{
  "operating_company_id": "5525986c-3b09-4d13-bf8f-43ccaa2deae3",
  "forma_pago": "CREDITO",
  "payment_days": 90,
  "lines_added": [
    {"producto_id":"e7d6f2f7-...","sku":"701809","talla":"37","qty":40}
    /* ...una por SKU×talla real... */
  ],
  "lines_removed": ["<linea_id dummy 1>", "..."],
  "lines_updated": []
}
```
   (En `lines_added` NO van precios — se fijan después con `lineas_actualizar_precios`: `unit_price_mwt`=proforma, `unit_price_client`=OC → snapshot dual.)
3. **DIRECTO** (Sondel opera directo, sin par en Muito Work): `operating_company_id = client_id` (Sondel). Sin snapshot dual (mwt=cliente).
4. Verifica con `expediente_obtener`: `operating_company_id` correcto y, en triangular, el detalle dice "OPERADO POR MUITO WORK LIMITADA".

---

# 5 · FUSIÓN (detalle)

> ℹ️ **`expediente_fusionar` agrupa VISUALMENTE** (comparte `fusion_id`/`fusion_label`): NO consolida líneas, SAP, documentos ni movimientos — cada expediente conserva los suyos. Por eso debes completar cada expediente del par por separado y luego agruparlos.

1. Detecta el par por **OC compartida** (`expediente_buscar(oc_number="487201")` → ≥2 matches con proformas distintas).
2. Completa cada expediente del par (líneas, precios duales, SAP, etc.) ANTES de fusionar.
3. `expediente_fusionar([id1, id2], label="<proforma Sondel> + <proforma Muito Work>")`.
4. Si por error hay duplicados del MISMO expediente (misma OC y misma proforma) → conserva el más completo y borra el otro (`expediente_eliminar`), no fusionar duplicados idénticos.

---

# 6 · COSTOS · IMPUESTOS · DUA (Costa Rica) — sobre el MOVIMIENTO

El FOB ya está en las líneas. Sobre el **movimiento** agrega cada costo con **TODOS los argumentos NOMBRADOS** (la firma real es `transfer_costo_agregar(transferencia_id, kind, amount, label=None, currency="USD", fx_to_usd=1.0, price_view="MWT", scope_json=None, ...)` → `label` va ANTES de `currency`; si pasas posicional, `currency` cae en `label`):

```
transfer_costo_agregar(transferencia_id="<id>", kind="FLETE", amount=962.92,
                       currency="USD", fx_to_usd=1.0, price_view="MWT",
                       scope_json={"applies_to_all": true})
```

Toma los montos reales de la **FACTURA comercial** y la **DUA** del año correspondiente:

| Concepto | kind | scope_json | Nota |
|---|---|---|---|
| Flete internacional (de la factura) | `FLETE` | `{"applies_to_all":true}` | entra al CIF |
| Seguro internacional (de la factura) | `SEGURO` | `{"applies_to_all":true}` | entra al CIF |
| DAI 6403.99.90 (calzado) — 14% | `DAI` | **por líneas de ese NCM** `{"applies_to_all":false,"lines":[{producto_id,...}]}` | NO `applies_to_all` (hay 2 DAI distintos) |
| DAI 6406.90.20 (plantillas) — 10% | `DAI` | **por líneas de ese NCM** (las plantillas) | usa `label` para distinguir el NCM |
| Ley 6946 — 1% | `LEY_6946` | `{"applies_to_all":true}` | sobre CIF |
| PROCOMER | `PROCOMER` | `{"applies_to_all":true}` | sobre CIF |
| Timbre Asociación Agentes (Ley 7017) | `TIMBRE_AGENTES` | `{"applies_to_all":true}` | sobre CIF |
| Timbre Archivo Nacional | `TIMBRE_ARCHIVO` | `{"applies_to_all":true}` | sobre CIF |
| Timbre Contadores | `TIMBRE_CONTADORES` | `{"applies_to_all":true}` | sobre CIF |
| Servicios aduanales (agente Barquero Fonseca) | `OTRO` + `label="Servicios aduanales (Barquero Fonseca)"` | `{"applies_to_all":true}` | costo en destino |
| Transporte terrestre | `OTRO` + `label="Transporte terrestre"` | `{"applies_to_all":true}` | costo en destino |

⚠️ **IVA (13%) — crédito fiscal acreditable, NO capitaliza.** Con el backend parcheado (liquidación 2026-06-24), `transfer_liquidar` **excluye el IVA del landed** automáticamente (`kind="IVA"` → va a `summary.extra_costs_iva_usd`, no suma al costo). Puedes registrarlo con `kind="IVA"` como referencia o **omitirlo**; en ningún caso infla el landed. (⚠️ Si la plataforma aún NO tiene el patch desplegado, NO lo cargues como costo.) ⚠️ **Tarifas históricas:** las tasas/timbres pudieron cambiar entre 2019 y 2025 — usa los montos REALES de la DUA de ESE año, no los actuales.

**DAI por NCM:** con el patch, la liquidación **aplica `scope_json`**: el DAI 14% (calzado) y el DAI 10% (plantillas) se prorratean SOLO entre sus líneas. ⚠️ **El backend NO deriva el NCM**: solo compara los `producto_id` (y `talla`) que TÚ pongas en `scope_json.lines`. Por eso **tú agrupas las líneas por NCM** (leyendo `hs_code`/`especificaciones.ncm` de cada producto con `producto_obtener`/`ncm_listar`) y armas el scope de cada DAI con los `producto_id` de ESE NCM. Ej.:
```
transfer_costo_agregar(transferencia_id, kind="DAI", amount=753.88, currency="USD", fx_to_usd=1.0,
   label="DAI 14% 6403.99.90",
   scope_json={"applies_to_all": false, "lines":[{"producto_id":"<sku calzado 1>"},{"producto_id":"<sku calzado 2>"}]})
```
⚠️ **Verifica el scope con el reporte:** tras `transfer_liquidar`, revisa `summary.scope_fallbacks` y `extras[].scope_fallback`. Si alguno es `true`, significa que un costo con scope NO matcheó ninguna línea (ej. `producto_id` mal) y el backend lo repartió sobre TODO el batch → el landed quedó mal: **corrige los `producto_id` del scope y vuelve a liquidar.**

**Tipo de cambio:** **prioridad = el TC OFICIAL de la DUA** del año (úsalo para convertir colones↔USD). ⚠️ Para expedientes históricos **NUNCA uses el TC de hoy**: el ₡/USD de 2019–2025 es distinto al actual; toma el de la DUA/factura de ESE año. Solo si el documento no lo trae y necesitas un live como último recurso: `tipo_cambio("usd-crc")` (consulta actual, NO histórica — márcalo en el resumen). Para FOB Marluvas en R$: usa el TC R$/USD de la factura del año.
- En `transfer_costo_agregar`: si el `amount` ya está en USD → `fx_to_usd=1`; si está en colones → `fx_to_usd = 1/rate` (rate del año).

**Normaliza a USD** los `unit_cost`/`unit_value` de las líneas de transferencia y los montos de costo: si la fuente está en BRL/CRC, conviértelos a USD (con el TC del año) antes de enviarlos.

Luego `transfer_liquidar(transferencia_id, method="BY_VALUE")` → CIF, Landed total, $/par; `transfer_factura_payload` para la factura/remisión.

---

# 7 · NODOS, MOVIMIENTO Y ARTEFACTOS

**Nodos — SIEMPRE verifica si existe; si NO existe, CRÉALO con `nodo_crear`.** Primero `nodo_listar(q="<codigo>")`; solo si no aparece, lo creas. No dupliques nodos. Los nodos son atemporales: el mismo HUB-CR-MARITIMO sirve para 2019 y 2025 — créalo una vez y reúsalo en todos los años.

⚠️ **BARCO y AVIÓN son DOS NODOS DISTINTOS** (no es un solo nodo "método de envío"):
⚠️ **Incluye SIEMPRE `capabilities`** (el wizard de transferencia filtra nodos por `DISPATCH`/`RECEIVE`; sin ellas el nodo no aparece como origen/destino válido).
- **Nodo MARÍTIMO (barco):** `nodo_crear({codigo:"HUB-CR-MARITIMO", nombre:"Hub Marítimo CR", tipo:"ALMACEN", pais_iso2:"CR", capabilities:["store","dispatch","receive"]})`.
- **Nodo AÉREO (avión):** `nodo_crear({codigo:"HUB-CR-AEREO", nombre:"Hub Aéreo CR", tipo:"ALMACEN", pais_iso2:"CR", capabilities:["store","dispatch","receive"]})`.
- Elige el correcto según el envío del expediente: **BL → nodo marítimo (barco)**, **AWB → nodo aéreo (avión)**. La recepción (§13) entra al nodo del método que corresponda a ESE expediente.
- **Nodo destino = SONDEL S.A.** (otro nodo distinto): `nodo_crear({codigo:"BODEGA-SONDEL-CR", nombre:"Sondel S.A.", tipo:"ALMACEN", pais_iso2:"CR", operating_company_id:<Sondel>, capabilities:["store","dispatch","receive"]})`.

Cada nodo se crea una sola vez y se reutiliza para los siguientes expedientes del mismo método/cliente.

**Recepción** en el nodo barco/avión: `recepcion_crear(items=[{expediente_id, producto_id, talla, qty_asignada, nodo_id:<hub>}])`.

**Movimiento** hub → nodo Sondel: `transferencia_crear(origen_id=<hub>, destino_id=<nodo Sondel>, legal_context="NATIONALIZATION", lineas=[{producto_id, sku, size, qty_transfer, unit_cost:<USD>, unit_value:<USD>}], context_data={"bl_awb_number":"<AWB/BL>","dua_number":"<DUA>"})` — `unit_cost`/`unit_value` **normalizados a USD** (TC del año). Luego (NOMBRES COMPLETOS): `transferencia_aprobar(transferencia_id)` → `transferencia_despachar(transferencia_id)` → `transferencia_recibir(transferencia_id, lineas=[{id,qty_received}])` **con TODAS las líneas y su `qty_received`** (el backend tolera omisiones y puede pasar a RECEIVED con líneas en PENDING_REVIEW — no es seguro; manda siempre el payload completo) → `transferencia_conciliar(transferencia_id)` + costos (§6) + `transfer_liquidar(transferencia_id)`.

**§7-art · Artefactos con archivo** (factura, AWB/BL, Packing, impuestos):
1. `builder_templates_listar()` y **resuelve el `template_id` DINÁMICAMENTE por su título** (busca "AWB/BL", "Factura Comercial", "Packing", "Impuestos") — **no hardcodees IDs** (cambian entre entornos). Lee sus campos con `builder_template_obtener(template_id)`.
2. Por cada campo de archivo: `storage_subir_archivo(file_path, scope="artifact-field/<field_id>")` → `key`.
3. `transfer_artefacto_crear(transferencia_id, template_id, template_title, structure_snapshot, data={<field_id>:{key,url,name,mime,size}, ...}, lines=[{expediente_id,producto_id,talla,qty}])` (o `nodo_artefacto_crear` si es a nivel de nodo). El **nº AWB/BL** va en el campo de texto "Tracking".

---

# 8 · GATE DE AUDITORÍA (el Auditor re-verifica con el MCP, todo antes de avanzar)

| # | Verifica | Con | RECHAZA si… |
|---|---|---|---|
| A | Cliente Sondel / operador correcto | `expediente_obtener`, `oc_obtener` | cliente ≠ Sondel; operador mal; marca/modo vacíos |
| B | SKUs y match | `producto_obtener`, `expediente_lineas` | SKU no corresponde al Part Nº de la OC; SKU sin tallas |
| C | Líneas | `expediente_lineas` | talla "UNICA"/dummy "PENDING"; tallas/cantidades ≠ OC |
| D | Precios duales | `expediente_lineas` | falta `unit_price_mwt`(proforma) o `unit_price_client`(OC); total ≠ qty×precio |
| E | Documentos | `documento_listar` | `storage_url=null`/`file_size_bytes=0` (roto); falta OC/proforma/SAP/factura/DUA (lo que exista del año) |
| F | SAP | `sap_obtener` | Excel SAP no subido; nº SAP no asignado a los productos |
| G | Estados+fechas | `expediente_phase_durations_get`, `expediente_eventos` | no llegó al estado real (histórico: CERRADO); fechas no son del año real (deben salir del CORREO) |
| H | Recepción | `stock_listar`, `inventario_artefactos_expediente` | sin recepción en nodo barco/avión |
| I | Movimiento+costos | `transferencia_listar`(descubrir) → `transferencia_obtener`, `transfer_costos_listar`, `transfer_liquidacion_preview` | no hay movimiento; destino ≠ nodo Sondel; faltan flete/seguro/**DAI**/Ley6946/PROCOMER/timbres/gastos; TC no es del año; sin liquidar. ✅ **IVA**: cargarlo está OK (el backend lo excluye); verifica que el IVA aparezca en `summary.extra_costs_iva_usd` y **NO** en el landed. ⚠️ **RECHAZA si `summary.scope_fallbacks > 0`** (un DAI scoped no matcheó → landed mal). |
| J | Fusión | `expediente_buscar(oc_number)` | la OC está en Sondel y Muito Work y NO quedó fusionada (con ambas proformas) |

`APROBADO` → resumen del expediente → siguiente. `RECHAZADO` → el Orquestador devuelve los fallos al Operativo, que corrige, y se re-audita. **No se avanza al siguiente expediente hasta `APROBADO`.**

---

# 9 · ORDEN DE TRABAJO

1. **PASO 1 (§0):** force-reinstall del MCP + verificar versión + `mwt_whoami`.
2. **Inventario (Orquestador):** recorre los años **2019 → 2025 en orden cronológico**; por cada año lista las proformas de **`01 M Sondel/<AÑO>/`** (y las de **`02 M Muito Work/<AÑO>/`** con OC compartida para la fusión). **NO toques 2026.**
3. **PILOTO:** procesa **la PRIMERA proforma/OC** (la más antigua de 2019) de punta a punta (checklist §3) → audita (§8) → resumen. Valida que el flujo entero quedó perfecto **antes de seguir**.
4. **Uno por uno:** continúa con el resto, año por año; cada expediente: Orquestador→Operativo→Auditor, ciclo hasta `APROBADO`, con **feedback en vivo** y **resumen por expediente**, reconectando el IMAP cuando se caiga. Respeta SIEMPRE las **fechas y el TC del año** que corresponda.
5. **Nunca** dejes "SIN-PO", líneas dummy, documentos rotos, SAP sin asignar ni movimiento sin costos.
6. **🛑 BORRADOS CON GUARDA HUMANA:** `expediente_eliminar` y `documento_eliminar` son destructivos en producción (token admin). **Solo bórralos con confirmación explícita del usuario** y tras evidenciar el motivo (ej. `documento_listar` mostrando `storage_url=null`, o `expediente_buscar` sin respaldo en OneDrive/correo). El agente **propone** el borrado con la evidencia y **espera el OK**; nunca borra en automático.

> Regla de oro: **un expediente no se cierra hasta estar 100% completo y auditado**; recién entonces empieza el siguiente.

---

# APÉNDICE · MAPA FLUJO → HERRAMIENTA MCP (referencia rápida)

El MCP cubre **toda** la parte de plataforma. Por cada paso, la(s) tool(s):

| Paso del flujo | Herramienta(s) MCP |
|---|---|
| Conectar / verificar sesión | `mwt_whoami` |
| Localizar / crear expediente | `expediente_buscar` · `expediente_crear` · `expedientes_crear_lote` |
| Cliente Sondel / operador | `cliente_listar` · `cliente_crear` · `expediente_editar`(operating_company_id) · `oc_editar` |
| Marca Marluvas / modo | `marca_listar` · `expediente_editar`(brand_id,modo_operacion) · `oc_editar`(brand_id) |
| Códigos limpios (OC=PO real, proforma) | `oc_editar`(codigo,proforma) · `expediente_editar` |
| Match Part Nº → producto (alias/nombre) | `expediente_resolve_oc_preview` · `producto_listar` · `producto_alias_crear` |
| Crear SKU con tallas + NCM | `tallas_listar` · `producto_crear` · `producto_editar` · `ncm_listar` |
| Líneas SKU×talla (quitar dummy) | `expediente_lineas` · `expediente_edit_full_patch`(lines_added/lines_removed) |
| Precios DUALES (mwt=proforma, cliente=OC) | `lineas_actualizar_precios`(unit_price_mwt,unit_price_client) |
| Subir OC / borrar OC roto / verificar | `documento_subir` · `documento_eliminar` · `documento_listar` |
| Generar proforma del sistema | `proforma_generar` (`proforma_html`, `factura_payload`) |
| Subir Excel SAP + asignar nº a productos | `sap_analizar` → `sap_confirmar` / `sap_upsert` · `sap_obtener` |
| Discrepancias SAP / matchmaker IA | `sap_sincronizar_discrepancias` · `match_subir` · `match_resolver` |
| Estados + fecha inicio/fin por SAP | `expediente_avanzar_estado` · `expediente_phase_durations_set` · `expediente_phase_durations_get` · `expediente_eventos` |
| Nodos barco/avión + Sondel (crear si faltan) | `nodo_listar` · `nodo_crear` · `nodo_editar` · `nodo_obtener` |
| Recepción de inventario al nodo | `recepcion_crear` · `inventario_saldos_por_expediente` · `inventario_lineas_en_nodo` · `inventario_expedientes_con_pendiente` |
| Movimiento nodo→nodo Sondel | `transferencia_crear` · `transferencia_aprobar` · `transferencia_despachar` · `transferencia_editar` · `transferencia_recibir` · `transferencia_conciliar` · `transferencia_cerrar` · `transferencia_cancelar` · `transferencia_listar` · `transferencia_obtener` · `inventario_transferir_asignaciones` |
| Tipo de cambio ₡/USD (y R$/USD) — ⚠️ usa el del AÑO | `tipo_cambio("usd-crc")` · `tipo_cambio("usd-brl")` (live; para histórico prioriza el TC de la DUA/factura) |
| Costos factura (flete/seguro) + impuestos DUA + gastos | `transfer_costo_agregar` · `transfer_costos_listar` · `transfer_costo_editar` · `transfer_costo_eliminar` · `transfer_liquidacion_preview` · `transfer_liquidar` · `transfer_factura_payload` |
| Artefactos (factura, AWB/BL, packing, impuestos) | `builder_templates_listar` · `builder_template_obtener` · `storage_subir_archivo` · `transfer_artefacto_crear` · `nodo_artefacto_crear` |
| Fusión OC compartida (Sondel + MWT) | `expediente_fusionar` · `expediente_fusion_label` · `expediente_desfusionar` |
| Notas del movimiento | `transfer_nota_crear` · `transfer_notas_listar` |
| Pagos (entrante/saliente, opcional) | `pago_applicables` · `pago_dry_run` · `pago_registrar` · `pago_conciliar` · `pago_listar`/`obtener` |
| Borrar fantasma sin respaldo | `expediente_eliminar` |
| Auditoría (re-verificar todo) | `expediente_obtener` · `producto_obtener` · `expediente_lineas` · `documento_listar` · `sap_obtener` · `stock_listar` · `inventario_artefactos_expediente` · `transferencia_obtener` · `transfer_costos_listar` |

## Lo que NO hace el MCP (es trabajo LOCAL del agente)
1. **Leer OneDrive** (filesystem) — recorrer las carpetas de año 2019–2025. 2. **Leer el correo IMAP** (imaplib) + reconectar cada ~2 min + buscar en carpetas archivadas de años viejos. 3. **Parsear** PDF/Excel (OC, proforma, SAP, DUA) con OCR/openpyxl/pdfplumber. 4. **Enviar email** de resumen (smtplib). El MCP solo expone la API de la plataforma; el agente aporta lectura de archivos/correo, parseo y envío de correo.
