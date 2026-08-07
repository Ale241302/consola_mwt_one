# PROMPT — SOLUCIÓN DE PUNTOS PENDIENTES (MWT · consola.mwt.one)

> **Para:** KIMI CLI (o Claude / Antigravity / Cursor).
> **Objetivo:** resolver, sobre los expedientes YA creados, los **4 puntos pendientes** del informe de carga, leyendo la verdad de **OneDrive y correos**. **No se recrea nada** (🚫 prohibido `expediente_crear`): se completa/corrige lo existente.
> **Equipo (todos SENIOR):** 1 **Orquestador senior** + **4 Operativos senior** (uno por punto) + **4 Auditores senior** (uno por punto, cada uno re-verifica vía MCP lo que hizo su Operativo).

## Los 4 puntos a resolver
- **P1 · SIN-PO** (~100 expedientes con `po_number="SIN-PO"`): extraer el número de OC real del PDF de la OC en OneDrive (o del correo) y dejarlo correcto.
- **P2 · Líneas dummy** (línea `sku_text="PENDING"`): parsear la **matriz de tallas** del Excel de la proforma y cargar las líneas reales SKU×talla×cantidad×precio.
- **P3 · SAP sin cargar**: tomar el Excel SAP de la carpeta, parsearlo y cargarlo (`sap_analizar`→`sap_confirmar`).
- **P4 · Documentos faltantes**: subir OC, SAP, BL/AWB, DUA, Pago de Impuestos, Packing List que están en las subcarpetas de OneDrive.

---

# 0 · CONÉCTATE AL MCP `mwt-one`

```bash
pip install "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```

JSON estándar (Claude Desktop / Cursor / KIMI CLI):
```json
{
  "mcpServers": {
    "mwt-one": {
      "command": "python",
      "args": ["-m", "mwt_mcp"],
      "env": {
        "MWT_MCP_TOKEN": "$MWT_MCP_TOKEN",
        "MWT_API_BASE": "https://consola.mwt.one/api"
      }
    }
  }
}
```
Kimi CLI:
```bash
kimi mcp add mwt-one --command python --args "-m,mwt_mcp" \
  --env MWT_MCP_TOKEN=$MWT_MCP_TOKEN \
  --env MWT_API_BASE=https://consola.mwt.one/api
```
Verifica con **`mwt_whoami`** (rol `admin`). Si falla, detente.

---

# 1 · ESTRUCTURA Y ORDEN (orquestador → operativos → auditores)

**🧭 Orquestador senior:** arma la lista de trabajo (qué expediente tiene qué problema) y procesa **en lotes pequeños (10-15) por cliente/año**. Por cada expediente respeta el **orden de dependencias**:

```
P2 (líneas reales)  →  P1 (PO real)  →  P4 (documentos)  →  P3 (SAP)
   └ A2 audita          └ A1 audita      └ A4 audita        └ A3 audita
```
Razón del orden: el **SAP (P3) necesita las líneas reales (P2)** para seleccionar `lineas_confirmadas`; P1 y P4 comparten el PDF de la OC. Cada Operativo marca su paso; cada Auditor lo aprueba con el MCP. **Un expediente no se cierra hasta que A1–A4 estén APROBADOS.** El Orquestador no acumula deuda: termina cada lote antes del siguiente y emite avance incremental.

**Cómo encontrar a quién afecta cada problema** (Orquestador):
- `cliente_listar(q=<cliente>)` → `client_id`; `expediente_listar(client=<client_id>)` por cada cliente/país.
- P1 → expedientes cuyos `oc_codigos` contienen "SIN-PO" (o vacío).
- P2 → expedientes cuyas `expediente_lineas` tienen `sku`/`sku_text` = "PENDING" (o 1 línea dummy).
- P3 → expedientes con `sap_codigos` vacío **y** que tienen Excel SAP en su carpeta de OneDrive.
- P4 → expedientes con documentos faltantes o con `storage_url=null`/`file_size_bytes=0` (`documento_listar`).

**Fuentes de verdad:** OneDrive `01 Ventas/01 Marluvas/<país>/<cliente>/<año>/<proforma> PO <po>/` (subcarpetas `Proforma/ OC del Cliente/ SAP/ Factura/ Guia/ Packing List Detallado/ DUA/ Pago de Impuestos/`) + correos (`alvaro@muitowork.com`). **Descarga cada archivo a una ruta local** antes de subirlo.

---

# 2 · P1 — RESOLVER "SIN-PO"  ⚙️ Operativo-1 / 🔎 Auditor-1

**Operativo-1 (senior, especialista en OC):**
1. Para cada expediente SIN-PO: abre la carpeta de OneDrive de esa proforma y su **PDF de la OC** (subcarpeta `OC del Cliente/`); si no hay, busca en el correo del cliente.
2. **Extrae el número de OC real** (regex `(?:PO|OC)\s*\d+` o el campo "Purchase Order" del PDF). Déjalo **limpio**: solo dígitos (ej. `503295`).
3. **Fija el PO** subiendo el PDF de la OC como documento con código limpio (esto corrige a la vez el display "SIN-PO" porque `oc_codigos` toma el `codigo` del documento OC):
   `documento_subir(file_path="<oc.pdf>", kind="OC", codigo="503295", expediente_id, oc_id, audience="CLIENT")`
   y por consistencia `oc_editar(oc_id, {"codigo":"503295"})`.
4. Si de verdad **no existe ninguna OC** (cliente sin PO formal): asigna el **número de proforma** como referencia de OC (`codigo` = proforma) y anótalo como "sin PO formal" en el reporte — **nunca dejar "SIN-PO"**.

**Auditor-1 (senior):** `expediente_obtener`/`expediente_listar` → `oc_codigos` ya no contiene "SIN-PO"; existe un documento `kind=OC` con `codigo` limpio y `storage_url≠null`. RECHAZA si sigue "SIN-PO" o el código trae prefijos/filename.

---

# 3 · P2 — CARGAR LÍNEAS REALES (matar el "PENDING")  ⚙️ Operativo-2 / 🔎 Auditor-2

**Operativo-2 (senior, especialista en parsing de proformas):**
1. Abre el **Excel de la proforma** de la carpeta (hojas "Proforma", "tecmater", etc.). Parsea la **matriz de tallas**: por cada SKU, las cantidades por talla y el precio. Formatos variables → identifica la fila de SKU y las columnas de talla (34-49).
2. Para cada SKU: `producto_listar(q="<sku>")`. Si falta o no tiene tallas → créalo/edítalo: `tallas_listar` (mapa label→UUID) y `producto_crear({sku, nombre, marca_id (marca_listar "Marluvas"), unidad:"PAR", precio_lista, precio_mwt, hs_code:"6403.99.90", tallas:[UUIDs], especificaciones:{ncm, color, sizes:[UUIDs]}})` + `producto_alias_crear(...)`.
3. **Quita la línea dummy y agrega las reales** (una por SKU×talla): obtén el `linea_id` del dummy con `expediente_lineas`; luego
   `expediente_edit_full_patch(expediente_id, {lines_removed:["<linea_id dummy>"], lines_added:[{producto_id, sku, talla:"39", qty:40}, ...]})`.
4. **Fija los precios** de la proforma: `expediente_lineas` → `linea_id` de cada línea nueva; `lineas_actualizar_precios([{linea_id, unit_price_mwt, unit_price_client}])`. Regla: `unit_price_mwt = unit_price_client` (precio de la proforma/OC) salvo margen real → `total_price == qty × precio_cliente`.

**Auditor-2 (senior):** `expediente_lineas` → **ninguna** línea "PENDING" ni "UNICA"; hay una línea por SKU×talla real; `total_pares == sum(cantidad)` de la proforma; `total_price == qty × unit_price_client`. RECHAZA si queda el dummy, faltan tallas o los precios no cuadran.

---

# 4 · P3 — CARGAR EL SAP  ⚙️ Operativo-3 / 🔎 Auditor-3

**Pre-requisito:** P2 ya cargó las líneas reales (el SAP las necesita). **Operativo-3 (senior):**
1. Toma el **Excel SAP** de la subcarpeta `SAP/` (o adjunto de Marluvas en correo).
2. `sap_analizar(expediente_id, file_path="<sap.xlsx>")` → devuelve `sap_id`, `fecha_fabricacion` y `lineas[]` con `match.line_id`.
3. Obtén los `linea_id` reales con `expediente_lineas` y arma `lineas_confirmadas` = TODAS las líneas que cubre el SAP (`{linea_id, qty_confirmada = qty solicitada, unit_price}`).
4. **Confirma** (expediente en REGISTRO → pasa a PRODUCCION):
   `sap_confirmar(expediente_id, sap_id="179113", fecha_fabricacion="<fecha>", lineas_confirmadas=[...], file_path="<sap.xlsx>")`.
   Si ya NO está en REGISTRO → `sap_upsert(...)` (mismos campos). Varios SAP por proforma → un expediente por SAP y `expediente_fusionar([ids], label=proforma)`.

**Auditor-3 (senior):** `sap_obtener(expediente_id, sap_id)` → SAP cargado; líneas con `sap` y `estado=SAP_CONFIRMADO`; el ART-04 (archivo SAP) quedó almacenado (`documento_listar`, `storage_url≠null`). RECHAZA si el SAP del Excel no está, faltan líneas o no se subió el archivo.

---

# 5 · P4 — SUBIR DOCUMENTOS FALTANTES  ⚙️ Operativo-4 / 🔎 Auditor-4

**Operativo-4 (senior, especialista en documentos):** por cada subcarpeta de OneDrive sube el archivo real (descárgalo a ruta local primero). **Subir = pasar `file_path`** con código LIMPIO:
- **OC del Cliente** → ya la sube P1 (`documento_subir kind="OC" codigo="503295"`).
- **Proforma** → `match_subir(expediente_id, document_type="ART-02_PROFORMA", file_path)` (o `documento_subir kind="PROFORMA" codigo="2228-2026"`).
- **SAP** → lo sube P3 dentro de `sap_confirmar`. No duplicar.
- **BL/AWB** → `documento_subir(kind="BL", ...)` **y** artefacto con archivo (template 9, nº en "Tracking", PDF en el campo file).
- **Factura comercial Marluvas** → `documento_subir(kind="FACTURA", ...)` + artefacto (template 13).
- **DUA** → `documento_subir(kind="DUA", ...)`. **Pago de Impuestos** → `kind="PAGO_IMPUESTOS"`. **Packing List** → `kind="PACKING_LIST"` (+ artefacto template 23).
- Audiencia: OC/proforma del cliente → `CLIENT`; SAP/factura/DUA/internos → `MWT_INTERNAL`.

Antes de subir, **revisa lo ya subido**: `documento_listar(expediente=...)`; si un documento tiene `storage_url=null` o `file_size_bytes=0` (roto/sin peso) → **`documento_eliminar(documento_id)`** y re-súbelo con el archivo real de OneDrive.

**Auditor-4 (senior):** `documento_listar` → cada documento esperado existe, con `storage_url≠null` y `file_size_bytes>0`; ningún registro roto. RECHAZA si falta un documento que sí está en OneDrive o si quedó alguno sin archivo.

---

# 6 · REPORTE DE AVANCE (incremental + final)

El Orquestador mantiene una tabla por **proforma / OC / PO**:

```
## SOLUCIÓN DE PENDIENTES
| Proforma | OC/PO | Expediente | P1 SIN-PO | P2 Líneas | P3 SAP | P4 Docs | Estado |
|---|---|---|---|---|---|---|---|
| 2225-2024 | 503295 | EXP-PO 503295 | ✅ 503295 | ✅ 18 líneas | ✅ SAP 178589 | ✅ 5 docs | APROBADO |
| 2280-2025 | (sin PO) | EXP-PO 503831 | ⚠️ sin PO formal→usa proforma | ✅ 10 líneas | ⏳ sin Excel SAP | ✅ 3 docs | parcial |
```
Y un consolidado: por punto (cuántos resueltos / pendientes / sin fuente) y por cliente/año. **Indica siempre en qué proforma/OC/PO está cada cosa y qué se hizo.** Lo que no se pueda resolver por falta de fuente en OneDrive/correo → lista de `pendientes` con el motivo.

---

# 7 · ARRANQUE

1. `mwt_whoami` (admin).
2. **Orquestador:** inventaria por cliente (`expediente_listar`) y clasifica cada expediente por punto (P1–P4). Arma lotes de 10-15.
3. **Por cada expediente (en su lote):** P2 → A2 · P1 → A1 · P4 → A4 · P3 → A3. Solo se cierra con A1–A4 APROBADOS.
4. Emite el reporte incremental por lote y el consolidado final.
5. **Nunca `expediente_crear`** — este modo solo completa/corrige lo existente, leyendo OneDrive y correos.
