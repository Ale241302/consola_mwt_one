# PROMPT — FLUJO COMPLETO COSTA RICA · SONDEL S.A. · **AÑO 2026** (creación + remediación) · consola.mwt.one

> 🗓️ **ALCANCE: SOLO la carpeta `2026`.** No proceses 2019–2025.

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
## 0.2 Configura la conexión (JSON `mcp.json` o Kimi CLI)
> 🔐 **NO hardcodees el token.** Expórtalo como variable de entorno y referencia `$MWT_MCP_TOKEN`. El token se genera en el VPS con `docker exec -i consola-mwt-one-django python manage.py mint_mcp_token --email alejandro@muitowork.com`. (Si hubo un token antiguo en claro en este archivo, **rótalo**: genera uno nuevo y el viejo deja de servir al rotar `DJANGO_SECRET_KEY` o desactivando el usuario.)
```bash
export MWT_MCP_TOKEN="<pega aquí el token de mint_mcp_token>"
export MWT_API_BASE="https://consola.mwt.one/api"
```
```json
{ "mcpServers": { "mwt-one": {
  "command": "python", "args": ["-m", "mwt_mcp"],
  "env": {
    "MWT_MCP_TOKEN": "$MWT_MCP_TOKEN",
    "MWT_API_BASE": "https://consola.mwt.one/api"
  } } } }
```
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

## 1.1 Carpetas a leer — ⚠️ SOLO el año **2026**
> **Alcance temporal limitado: procesa únicamente la carpeta `2026`.** Ignora 2019–2025. No abras ni inventaríes otros años.
- **Sondel directo:** `01 Marluvas / 01 M Costa Rica / 01 M Sondel / **2026** / <carpeta>`.
- **Operado por Muito Work (misma OC):** `01 Marluvas / 01 M Costa Rica / 02 M Muito Work / **2026** / <carpeta>`.

Cada carpeta se llama `<proforma> PO <po>` — ej. `2472-2026 PO 505107`: **`2472-2026` = nº de proforma**, **`505107` = nº de OC/PO** (a veces solo viene la proforma).

## 1.2 Archivos dentro de cada carpeta
`Factura/`, `SAP/`, `OC del Cliente/`, `Proforma/`, `Packing List Detallado/`, `Guia/` (con su **AWB o BL**), `DUA/`, `Pago de Impuestos/`. Descarga cada archivo a ruta local (para `file_path`).

## 1.3 Correo (IMAP `alvaro@muitowork.com`)
Busca por **nº de proforma y de OC** el hilo de esa operación → **estados y fecha de INICIO y FIN de cada estado** (REGISTRO, PRODUCCION, PREPARACION, DESPACHO, TRANSITO, EN_DESTINO, CERRADO), AWB/BL, DUA, costos, entrega. Lee solo el hilo de ESA proforma; si se cae el IMAP, **reconecta y sigue**.

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
Narra SIEMPRE en el chat, en tiempo real: «🧭 Orquestador: armando plan de PF 2472-2026 / OC 505107…», «⚙️ Operativo: leyendo OneDrive… encontré OC, proforma, SAP; falta DUA», cada acción del MCP y su resultado (✅/⚠️), «🔎 Auditor: revisando… ❌ faltan precios MWT», «🧭→⚙️ devuelvo a Operativo: corregir precios», y al cerrar un **resumen del expediente** (qué se hizo y cómo) antes de pasar al siguiente.

## Reconexión IMAP
El servidor de correo (A2Hosting) desconecta cada ~2 min. El Operativo debe atrapar la desconexión, **volver a hacer login al IMAP** y continuar desde donde quedó, sin perder el expediente en curso.

---

# 3 · CHECKLIST POR EXPEDIENTE (Operativo) — uno por uno, completo

```
[ ] 1.  LOCALIZAR/CREAR  → expediente_buscar(proforma="2472-2026", oc_number="505107") [args NOMBRADOS].
                            Si existe (esqueleto), se COMPLETA; si no, se CREA con líneas REALES (nunca dummy). NUNCA "SIN-PO".
[ ] 2.  CLIENTE/OPERADOR → cliente final = SONDEL S.A. (cliente_listar/crear). Operador: Sondel (directo) o
                            Muito Work (si la carpeta es 02 M Muito Work / misma OC). expediente_editar/oc_editar.
[ ] 3.  MARCA/MODO       → brand_id = Marluvas (marca_listar) en expediente Y OC; modo_operacion.
[ ] 4.  CÓDIGOS          → OC = nº PO real (ej. 505107); proforma "2472-2026". Limpios; nunca filename/prefijos.
[ ] 5.  PRODUCTOS/SKUs   → match del "Part Nº" de la OC → producto (alias o nombre, §3-BIS); SKU faltante →
                            tallas_listar + producto_crear(tallas UUID) + producto_alias_crear.
[ ] 6.  LÍNEAS           → una por SKU×TALLA real (de la OC), cantidad por talla = la de la OC. Sin "UNICA"/"PENDING".
[ ] 7.  PRECIOS (duales) → lineas_actualizar_precios(updates=[{linea_id, unit_price_mwt, unit_price_client}]).
                            unit_price_mwt = precio de la PROFORMA; unit_price_client = precio de la OC. (Directo Sondel: mwt = cliente.)
                            Los linea_id salen de expediente_lineas(expediente_id).
[ ] 8.  DOCS             → borra OC roto previo (documento_eliminar); sube cada archivo con
                            documento_subir(file_path="<...>", kind="OC", codigo="505107", expediente_id, oc_id, audience="CLIENT");
                            Proforma real (kind="PROFORMA", codigo="2472-2026"), Factura, Packing, Guía(AWB/BL), DUA,
                            Pago de Impuestos. **Siempre expediente_id u oc_id**. Verifica storage_url≠null.
[ ] 9.  PROFORMA SISTEMA → proforma_generar(CLIENT y ADMIN_ONLY) SOLO DESPUÉS de cargar líneas (si no, sale en $0).
[ ] 10. SAP              → sap_analizar(expediente_id, file_path="<excel SAP>") → arma lineas_confirmadas con los
                            linea_id reales (de expediente_lineas) de TODAS las líneas que cubre el SAP, luego
                            sap_confirmar(expediente_id, sap_id="178589",
                                          lineas_confirmadas=[{linea_id, qty_confirmada, unit_price}],
                                          fecha_fabricacion="2026-03-31", file_path="<excel SAP>")
                            (firma: expediente_id primero; "fecha_fabricacion" no "fecha"; lineas_confirmadas es LISTA, no "TODAS").
                            Sube el Excel y ASIGNA el nº SAP a esos productos. (si NO está en REGISTRO → sap_upsert con misma firma).
[ ] 11. ESTADOS+FECHAS   → en el detalle del SAP: expediente_avanzar_estado hasta el estado real +
                            expediente_phase_durations_set({FASE:{start,end}}) con las fechas del CORREO (inicio/fin).
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
- **Fusión:** `expediente_fusionar([<exp Sondel>, <exp Muito Work>], label="2472-2026 + <proforma MWT>")`. El Auditor verifica que quedó fusionado mostrando ambos números de proforma.

---

# 5 · FUSIÓN (detalle)
1. Detecta el par por **OC compartida** (`expediente_buscar(oc_number="505107")` → ≥2 matches con proformas distintas).
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

Toma los montos reales de la **FACTURA comercial** y la **DUA**:

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

⚠️ **IVA — NO lo cargues como costo.** El IVA (13%) es **crédito fiscal acreditable**: NO suma al costo real de MWT y la liquidación lo excluye. Si lo agregas como CostLine activa **infla el landed cost**. Déjalo solo como referencia informativa (en notas), no como `transfer_costo_agregar`.

**Tipo de cambio:** **prioridad = el TC OFICIAL que trae la DUA** (úsalo para convertir colones↔USD en costos/impuestos). Solo si la DUA no lo trae, usa el MCP: `tipo_cambio("usd-crc")` → `{rate, source, timestamp}` (≈459.50 ₡/USD). Para FOB Marluvas en R$: `tipo_cambio("usd-brl")`.
- En `transfer_costo_agregar`: si el `amount` ya está en USD → `fx_to_usd=1`; si está en colones → `fx_to_usd = 1/rate`.

**Normaliza a USD** los `unit_cost`/`unit_value` de las líneas de transferencia y los montos de costo: si la fuente está en BRL/CRC, conviértelos a USD antes de enviarlos.

Luego `transfer_liquidar(transferencia_id, method="BY_VALUE")` → CIF, Landed total, $/par; `transfer_factura_payload` para la factura/remisión.

---

# 7 · NODOS, MOVIMIENTO Y ARTEFACTOS

**Nodos — SIEMPRE verifica si existe; si NO existe, CRÉALO con `nodo_crear`.** Primero `nodo_listar(q="<codigo>")`; solo si no aparece, lo creas. No dupliques nodos.

⚠️ **BARCO y AVIÓN son DOS NODOS DISTINTOS** (no es un solo nodo "método de envío"):
- **Nodo MARÍTIMO (barco):** `nodo_crear({codigo:"HUB-CR-MARITIMO", nombre:"Hub Marítimo CR", tipo:"ALMACEN", pais_iso2:"CR"})`.
- **Nodo AÉREO (avión):** `nodo_crear({codigo:"HUB-CR-AEREO", nombre:"Hub Aéreo CR", tipo:"ALMACEN", pais_iso2:"CR"})`.
- Elige el correcto según el envío del expediente: **BL → nodo marítimo (barco)**, **AWB → nodo aéreo (avión)**. La recepción (§13) entra al nodo del método que corresponda a ESE expediente.
- **Nodo destino = SONDEL S.A.** (otro nodo distinto): `nodo_crear({codigo:"BODEGA-SONDEL-CR", nombre:"Sondel S.A.", tipo:"ALMACEN", pais_iso2:"CR", operating_company_id:<Sondel>})`.

Cada nodo se crea una sola vez y se reutiliza para los siguientes expedientes del mismo método/cliente.

**Recepción** en el nodo barco/avión: `recepcion_crear(items=[{expediente_id, producto_id, talla, qty_asignada, nodo_id:<hub>}])`.

**Movimiento** hub → nodo Sondel: `transferencia_crear(origen_id=<hub>, destino_id=<nodo Sondel>, legal_context="NATIONALIZATION", lineas=[{producto_id, sku, size, qty_transfer, unit_cost:<USD>, unit_value:<USD>}], context_data={"bl_awb_number":"<AWB/BL>","dua_number":"<DUA>"})` — `unit_cost`/`unit_value` **normalizados a USD**. Luego (NOMBRES COMPLETOS): `transferencia_aprobar(transferencia_id)` → `transferencia_despachar(transferencia_id)` → `transferencia_recibir(transferencia_id, lineas=[{id,qty_received}])` → `transferencia_conciliar(transferencia_id)` + costos (§6) + `transfer_liquidar(transferencia_id)`.

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
| E | Documentos | `documento_listar` | `storage_url=null`/`file_size_bytes=0` (roto); falta OC/proforma/SAP/factura/DUA |
| F | SAP | `sap_obtener` | Excel SAP no subido; nº SAP no asignado a los productos |
| G | Estados+fechas | `expediente_phase_durations_get`, `expediente_eventos` | no avanzó al estado real; faltan fecha inicio/fin (deben salir del CORREO) |
| H | Recepción | `stock_listar`, `inventario_artefactos_expediente` | sin recepción en nodo barco/avión |
| I | Movimiento+costos | `transferencia_listar`(descubrir) → `transferencia_obtener`, `transfer_costos_listar` | no hay movimiento; destino ≠ nodo Sondel; faltan flete/seguro/**DAI**/Ley6946/PROCOMER/timbres/gastos; **IVA cargado como costo** (no debe); sin liquidar |
| J | Fusión | `expediente_buscar(oc_number)` | la OC está en Sondel y Muito Work y NO quedó fusionada (con ambas proformas) |

`APROBADO` → resumen del expediente → siguiente. `RECHAZADO` → el Orquestador devuelve los fallos al Operativo, que corrige, y se re-audita. **No se avanza al siguiente expediente hasta `APROBADO`.**

---

# 9 · ORDEN DE TRABAJO

1. **PASO 1 (§0):** force-reinstall del MCP + verificar versión + `mwt_whoami`.
2. **Inventario (Orquestador):** lista las proformas de **`01 M Sondel/2026/`** (y las de **`02 M Muito Work/2026/`** con OC compartida para la fusión). **SOLO 2026** — no toques otros años.
3. **PILOTO:** procesa **la PRIMERA proforma/OC** de punta a punta (checklist §3) → audita (§8) → resumen. Valida que el flujo entero quedó perfecto **antes de seguir**.
4. **Uno por uno:** continúa con el resto; cada expediente: Orquestador→Operativo→Auditor, ciclo hasta `APROBADO`, con **feedback en vivo** y **resumen por expediente**, reconectando el IMAP cuando se caiga.
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
| Tipo de cambio ₡/USD (y R$/USD) | `tipo_cambio("usd-crc")` · `tipo_cambio("usd-brl")` |
| Costos factura (flete/seguro) + impuestos DUA + gastos | `transfer_costo_agregar` · `transfer_costos_listar` · `transfer_costo_editar` · `transfer_costo_eliminar` · `transfer_liquidacion_preview` · `transfer_liquidar` · `transfer_factura_payload` |
| Artefactos (factura, AWB/BL, packing, impuestos) | `builder_templates_listar` · `builder_template_obtener` · `storage_subir_archivo` · `transfer_artefacto_crear` · `nodo_artefacto_crear` |
| Fusión OC compartida (Sondel + MWT) | `expediente_fusionar` · `expediente_fusion_label` · `expediente_desfusionar` |
| Notas del movimiento | `transfer_nota_crear` · `transfer_notas_listar` |
| Pagos (entrante/saliente, opcional) | `pago_applicables` · `pago_dry_run` · `pago_registrar` · `pago_conciliar` · `pago_listar`/`obtener` |
| Borrar fantasma sin respaldo | `expediente_eliminar` |
| Auditoría (re-verificar todo) | `expediente_obtener` · `producto_obtener` · `expediente_lineas` · `documento_listar` · `sap_obtener` · `stock_listar` · `inventario_artefactos_expediente` · `transferencia_obtener` · `transfer_costos_listar` |

## Lo que NO hace el MCP (es trabajo LOCAL del agente)
1. **Leer OneDrive** (filesystem). 2. **Leer el correo IMAP** (imaplib) + reconectar cada ~2 min. 3. **Parsear** PDF/Excel (OC, proforma, SAP, DUA) con OCR/openpyxl/pdfplumber. 4. **Enviar email** de resumen (smtplib). El MCP solo expone la API de la plataforma; el agente aporta lectura de archivos/correo, parseo y envío de correo.
