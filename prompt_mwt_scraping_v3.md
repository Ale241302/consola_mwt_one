# PROMPT v3 — MWT: Scraping con fechas por estado + Carga real a `consola.mwt.one` vía MCP

> **Para:** KIMI CLI (o Claude / Antigravity / Cursor).
> **Modo:** **multi-agente**. Sub-agentes que leen en paralelo, comparten un **Índice Maestro** y, al final, un **Agente Ejecutor-MCP** carga todo en la plataforma con el MCP `mwt-one`.
> **Objetivo:** reconstruir cada expediente (proforma) leyendo **correo + OneDrive + PDF + Word + Excel**, **extrayendo la fecha de CADA correo y documento** para derivar la **fecha de inicio y fin de cada estado**, y luego **crearlo realmente en `consola.mwt.one`**: clientes, productos, expediente con OC, SAP, documentos (subidos a MinIO), estados con sus fechas, nodos, recepción de lote, artefactos con archivo (AWB/BL y **factura comercial Marluvas**), movimientos, costos/impuestos/gastos y pagos.
> **v3 vs v2:** la v2 solo generaba el JSON. La v3 **lee las fechas, deriva las fechas de cada estado y EJECUTA la carga** vía MCP, sin duplicar lo que ya existe.

---

# PARTE 0 — CONÉCTATE AL MCP `mwt-one` (hazlo tú mismo, primero)

El MCP es tu **única vía** para escribir en la plataforma. Conéctate antes de procesar nada.

## Paso 1 — Instalación en una sola línea

```bash
pip install "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```

Instala el paquete `mwt-mcp` y sus dependencias (módulo `mwt_mcp`, se arranca con `python -m mwt_mcp`).

## Paso 2 — Registra el servidor MCP

### Opción A — JSON estándar (Claude Desktop / Cursor / KIMI CLI)

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

### Opción B — Registro directo con KIMI CLI

```bash
kimi mcp add mwt-one \
  --command python --args "-m,mwt_mcp" \
  --env MWT_MCP_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjo0OTM1NDM1NjQ2LCJpYXQiOjE3ODE4MzU2NDYsImp0aSI6ImY4OTllMTEyODFjODRmZDI5ZGNjNGVhZDVlOWFhNDFlIiwidXNlcl91dWlkIjoiNTA3MmZjZTItZTY2ZS00YmY3LThmZDItNjIzY2ZkM2FmYWY2IiwiZW1haWwiOiJhbGVqYW5kcm9AbXVpdG93b3JrLmNvbSIsInJvbGUiOiJhZG1pbiIsIm1jcCI6dHJ1ZX0.yeS-5L0LNapR7E6FJuH8g0d2hPobeMwWoke-TqKTetk \
  --env MWT_API_BASE=https://consola.mwt.one/api
```

## Paso 3 — Verifica

Llama a **`mwt_whoami`** → debe devolver `alejandro@muitowork.com`, rol `admin`. Si da error de token, **detente** y avisa. (El token está embebido; ~100 años; trátalo como secreto. Cómo se genera/rota: **Apéndice B**.)

---

# PARTE 1 — QUÉ PUEDE HACER EL MCP `mwt-one` (89 herramientas)

| Dominio | Herramientas |
|---|---|
| **Salud** | `mwt_whoami` |
| **Clientes** | `cliente_listar`, `cliente_obtener`, `cliente_crear`, `cliente_editar`, `cliente_subsidiarias`, `cliente_kpis_pool` |
| **Productos** | `producto_listar`, `producto_obtener`, `producto_crear`, `producto_editar`, `ncm_listar` |
| **OC / Expedientes** | `oc_listar`, `oc_obtener`, `expediente_listar`, `expediente_obtener`, **`expediente_buscar`** (anti-duplicados por nº OC/proforma/SAP), `expediente_lineas`, `expediente_resolve_oc_preview`, `expediente_crear`, `lineas_actualizar_precios`, `expediente_apply_pronto_pago`, `expediente_edit_full_get`, `expediente_edit_full_patch` |
| **Documentos** | `documento_subir`, `documento_listar` |
| **SAP** | `sap_analizar`, `sap_confirmar`, `sap_upsert`, `sap_obtener`, `sap_editar`, `sap_sincronizar_discrepancias` |
| **Balanceo IA** | `match_subir`, `match_resolver` |
| **Fusión** | `expediente_fusionar`, `expediente_fusion_label`, `expediente_desfusionar` |
| **Proforma / Factura** | `proforma_generar`, `proforma_html`, `factura_payload` |
| **Estados (con fechas)** | `expediente_avanzar_estado`, `expediente_phase_durations_get`, `expediente_phase_durations_set`, `expediente_eventos` |
| **Nodos** | `nodo_listar`, `nodo_obtener`, `nodo_crear`, `nodo_editar`, `nodo_artefactos_listar`, `nodo_artefacto_crear` |
| **Inventario / Recepción** | `stock_listar`, `inventario_saldos_por_expediente`, `inventario_expedientes_con_pendiente`, `inventario_lineas_en_nodo`, `recepcion_crear`, `inventario_transferir_asignaciones`, `inventario_artefactos_expediente` |
| **Movimientos** | `transferencia_listar`, `transferencia_obtener`, `transferencia_crear`, `transferencia_avanzar`, `transferencia_aprobar`, `transferencia_despachar`, `transferencia_editar`, `transferencia_recibir`, `transferencia_conciliar`, `transferencia_cerrar`, `transferencia_cancelar` |
| **Costos / impuestos / gastos** | `transfer_costos_listar`, `transfer_costo_agregar`, `transfer_costo_editar`, `transfer_costo_eliminar`, `transfer_artefacto_crear` |
| **Landed cost / factura** | `transfer_liquidacion_preview`, `transfer_liquidar`, `transfer_factura_payload`, `transfer_notas_listar`, `transfer_nota_crear` |
| **Pagos** | `pago_applicables`, `pago_listar`, `pago_obtener`, `pago_dry_run`, `pago_registrar`, `pago_conciliar`, `pago_liberar_credito`, `pago_rechazar` |
| **Storage / Builder** | **`storage_subir_archivo`** (sube el binario de un campo de archivo de artefacto), `builder_templates_listar`, `builder_template_obtener` |

> Referencia de capacidades, instalación, Docker y registro: **Apéndice B**.

---

# PARTE 2 — CONTEXTO DEL DOMINIO

MWT (Muito Work Trading) importa calzado de seguridad **Marluvas** para clientes de Centroamérica/Colombia/Perú. El documento central es la **proforma** (`####-####`, ej. `2472-2026`), que corresponde a una **OC/PO del cliente** y se vuelve un **expediente** que avanza por fases:

```
REGISTRO → PRODUCCION → PREPARACION → DESPACHO → TRANSITO → EN_DESTINO → CERRADO
```

| Fase | Qué la dispara | Documento/correo que la marca |
|---|---|---|
| REGISTRO | OC del cliente + proforma emitida | correo del cliente con la OC; PDF/XLSX de proforma |
| PRODUCCION | **confirmación SAP de Marluvas** (ticket/pedido) | correo de Marluvas + **Excel SAP** |
| PREPARACION | consolidación / packing / **cotización de flete** | correos de logística + cotizaciones |
| DESPACHO | booking confirmado / salida de origen | correo de logística (booking) |
| TRANSITO | **AWB** (aéreo) o **BL** (marítimo) emitido | correo de logística / PDF BL-AWB |
| EN_DESTINO | arribo / nacionalización (**DUA**) | correo aduana + PDF/Excel DUA |
| CERRADO | entrega + pago | correo de entrega / comprobante de pago |

**Identificadores que encadenan todo:** **OC/PO** (`PO 505107`, puede haber **varias por proforma**, ej. `2548 + 2549`); **Proforma** (`2472-2026`); **Ticket/SAP Marluvas** (`275155`, puede haber varios); **AWB** (`230-6683-2102` + carrier) / **BL** (+ naviera) / **booking**.

## 🔑 El operador — `Muito Work Limitada` es un CLIENTE (REGLA CRÍTICA)

`Muito Work Limitada` **existe como cliente** en la plataforma. Cuando una proforma está bajo "Muito Work" significa que **la opera Muito Work Limitada (operador/intermediario), pero el cliente final es OTRO** (Sondel, CNFL, Magnesita, Agrofortres, etc.).

- Operador = **Muito Work Limitada** → `operating_company_id = UUID(Muito Work Limitada)` **y** `client_id = UUID(cliente final)`. El **crédito afecta a Muito Work Limitada**.
- Operador = **el propio cliente** (directo) → `operating_company_id = client_id`. El **crédito afecta al cliente**.
- Pista en OneDrive: rutas tipo `02 M Muito Work / <sub-cliente> /` = operador MWT, sub-cliente = cliente final.

## 💲 Precios — los del DOCUMENTO, no los de la BD (REGLA CRÍTICA)

Lee los precios de la **OC y la proforma** (PDF/XLSX) y del **SAP** (Excel). **Ignora** los precios que ya estén en la base de datos.

- **`precio_mwt`** = compra a Marluvas (FOB) → `unit_price_mwt` de la línea (del SAP/factura Marluvas o columna de costo de la proforma).
- **`precio_cliente`** = venta al cliente → `unit_price_client` (de la proforma y la OC).
- Como `expediente_crear` re-deriva precios, **al final corrige cada línea con `lineas_actualizar_precios`** (ver 7.5, incluida la regla del Total).

---

# PARTE 3 — LECTURA PROFUNDA POR FORMATO (qué extraer de cada fuente)

Para **cada proforma** lee y cruza TODAS estas fuentes. **De cada fuente registra su FECHA** (la necesitas en la Parte 4).

### 3.1 Correos (IMAP `alvaro@muitowork.com` / backup `.eml/.mbox`)
- Lee el **hilo completo** (cuerpo, no solo asunto). De **cada** correo registra: `message-id`, **`Date:` (fecha y hora exacta)**, remitente, destinatarios, asunto, adjuntos.
- Clasifica cada correo por hito y **anota su fecha**: OC del cliente → REGISTRO(inicio); Marluvas confirmando (Excel SAP) → PRODUCCION(inicio); cotización/booking de flete → PREPARACION/DESPACHO; AWB/BL → TRANSITO(inicio); aduana/DUA/arribo → EN_DESTINO(inicio); entrega/pago → CERRADO(inicio).
- Regex: Proforma `\d{4}-\d{4}`, PO/OC `(?:PO|OC)\s*\d+`, SAP `\d{6,}`, Booking `[A-Z]{2,4}\d{6,}`, AWB `\d{3}[\s-]?\d{4}[\s-]?\d{4}`, BL `[A-Z0-9\-]{5,}`.

### 3.2 OneDrive — carpetas
`01 Ventas/01 Marluvas/<país>/<cliente>/<año>/<proforma> PO <po>/` con subcarpetas `Proforma/`, `OC del Cliente/`, `SAP/`, `Factura/`, `Guia/`, `Packing List Detallado/`, `DUA/`, `Pago de Impuestos/`. Lista cada archivo con su **fecha** (modificación o la fecha impresa en el documento). Clientes sin subcarpetas (Colombia/Honduras/Panamá): infiere por nombre/extensión.

### 3.3 PDF (`.pdf`)
- **OC del cliente:** nº PO, **fecha de la OC**, cliente final, líneas (ref/SKU, talla, cantidad), **precio de venta**, condiciones de pago.
- **Proforma:** nº proforma, **fecha**, operador, cliente final, matriz de tallas, **`precio_mwt` y `precio_cliente`**, totales, comisión.
- **Factura comercial Marluvas:** nº factura, **fecha**, FOB por línea, flete/seguro, incoterm (CPT/CIP/FOB).
- **BL/AWB:** número, **fecha de emisión**, carrier/naviera, origen/destino, booking.
- **DUA / Pago de impuestos:** nº DUA, **fecha**, TC CRC/USD, CIF, DAI, Ley 6946, IVA, timbres.

### 3.4 Word (`.doc/.docx`)
OCs en Word, cartas de instrucción, notas: nº OC, **fecha**, cliente, cantidades, precios/condiciones.

### 3.5 Excel (`.xlsx/.xls`)
- **SAP de Marluvas:** **ticket/pedido**, **fecha de confirmación**, líneas confirmadas (sku/talla/cantidad), **FOB → `precio_mwt`**.
- **Proforma XLSX:** matriz de tallas → una línea por sku×talla con `precio_mwt`/`precio_cliente`.
- **Cotizaciones de flete:** monto, carrier/naviera, incoterm, **validez/fecha**.
- **Cálculos DUA:** TC, CIF, DAI, Ley 6946, IVA, timbres, costo nacionalizado.

> De la **OC y la proforma** sale lo esencial: **operador, cliente final, `precio_mwt`, `precio_cliente`**, tallas y cantidades. **Nunca** tomes precios de la BD.

---

# PARTE 4 — FECHAS DE INICIO Y FIN DE CADA ESTADO (núcleo de la v3)

Para **cada expediente**, deriva `inicio` y `fin` de **cada estado** desde las **fechas reales** de la Parte 3. **El `fin` de un estado = el `inicio` del siguiente.**

## 4.1 Matriz de derivación

| Estado | `inicio` = fecha de… | `fin` = fecha de… |
|---|---|---|
| REGISTRO | OC del cliente (correo/PDF) o emisión de proforma | confirmación SAP de Marluvas |
| PRODUCCION | confirmación SAP (Excel/correo) | 1ª cotización de flete / inicio de preparación / booking |
| PREPARACION | preparación / packing / cotización de flete | confirmación de booking / despacho |
| DESPACHO | booking confirmado / salida de origen | emisión de AWB/BL |
| TRANSITO | emisión de AWB/BL (PDF/correo) | arribo a destino |
| EN_DESTINO | arribo / inicio de trámite DUA | entrega + pago |
| CERRADO | entrega final / pago recibido | (terminal, sin `fin`) |

## 4.2 Reglas

- Formato `YYYY-MM-DD`. Toma la fecha del **correo (`Date:`) o documento** que dispara el hito.
- **Continuidad:** `fin(n) == inicio(n+1)`. Sin huecos ni solapes.
- **Estado que no aplica** (aéreo sin PREPARACION marítima, o saltos): `aplica:false`, sin fechas.
- **Fecha estimada** (sin documento exacto): `inferida:true` + explica el criterio en `fuente`.
- **Falta total:** `null` + a `pendientes`. **Nunca inventes una fecha.**
- **Cita la fuente** (correo `asunto · fecha · remitente`, o archivo de OneDrive).
- El **estado actual** (`estado_inferido`) es el último estado con `inicio` y sin `fin` (o CERRADO si cerró).

## 4.3 Ejemplo trabajado (PF 2453-2026, aéreo)

```
OC del cliente (correo 2026-05-28)              → REGISTRO.inicio = 2026-05-28
Marluvas confirma SAP 275155 (Excel 2026-06-02) → REGISTRO.fin = PRODUCCION.inicio = 2026-06-02
Booking/flete COPA (correo 2026-06-08)          → PRODUCCION.fin = DESPACHO.inicio = 2026-06-08
AWB 230-6683-2102 (correo 2026-06-10)           → DESPACHO.fin = TRANSITO.inicio = 2026-06-10
(aún en tránsito, sin arribo)                   → TRANSITO.fin = null  ⇒ estado_inferido = TRANSITO
PREPARACION / EN_DESTINO / CERRADO              → aplica:false
```

Se carga con `expediente_phase_durations_set` (7.8). Nota: puedes fijar fechas de fases pasadas directamente, sin necesidad de avanzar el estado primero.

---

# PARTE 5 — ORQUESTACIÓN MULTI-AGENTE (Kimi)

Índice Maestro compartido (una ficha por proforma). Dos olas.

## Ola A — Recopilación (en paralelo)
1. **Correos-Indexador** — indexa todo el buzón; por correo: `message-id`, **fecha**, asunto, de/para, adjuntos; detecta IDs por regex; agrupa en **hilos por proforma/OC**.
2. **Correos-Lectura (N)** — leen conversaciones completas; reconstruyen `eventos` con narrativa **y fechas**; capturan ticket SAP, cotizaciones, DUA, operador, envío.
3. **OneDrive-Carpetas** — lista/clasifica archivos reales + **fecha de cada archivo**.
4. **Proforma (PDF/HTML/XLSX)** — matriz de tallas → `lineas_producto` con **`precio_mwt`/`precio_cliente`** del documento.
5. **SAP-Excel** — ticket Marluvas, **fecha de confirmación**, líneas, FOB.
6. **DUA** — bloque `dua` + fecha.
7. **Fechas-de-Estado** — calcula `fechas_estados` (Parte 4).
8. **Correlacionador/Redactor** — fusiona, valida (`total_pares == sum(cantidad)`), marca `pendientes`, escribe **`proformas_consolidado.json`** (Parte 6).

## Ola B — Ejecución (Agente Ejecutor-MCP)
Toma el JSON y **carga cada expediente** con el MCP (Parte 7), **en serie por expediente**, con **upsert** (consultar antes de crear). Puedes correr varios Ejecutores (uno por país/cliente), pero cada expediente se procesa atómicamente.

**Reglas comunes:** índice compartido; deduplicar por ruta y `message-id`; **citar fuente**; **nunca inventar** (ausente = `null` + `pendientes`); IDs (OC/PF/SAP/AWB/BL) **exactos**.

---

# PARTE 6 — ESQUEMA `proformas_consolidado.json`

```jsonc
{
  "meta": { "generado_en": "2026-06-18", "fuentes": ["correos","OneDrive","pdf","word","excel"],
            "total_proformas": 88, "correos_procesados": 0, "rango_fechas": ["",""] },
  "proformas": [
    {
      "numero_proforma": "2453-2026", "anio": 2026,
      "cliente_final": "Sondel S.A.", "cliente_tax_id": null, "cliente_email": null, "pais": "CR",
      "operador": "Muito Work Limitada", "operado_por_mwt": true,
      "numeros_oc": ["505107"], "fecha_oc": "2026-05-28",
      "ticket_marluvas": ["275155"], "numero_sap": ["275155"], "fecha_sap": "2026-06-02",
      "marca": "Marluvas", "moneda": "USD",

      "modo_transporte": "AEREO", "awb": "230-6683-2102", "carrier": "COPA AIRLINES",
      "bl": null, "naviera": null, "booking": null, "origen": null, "destino": null, "incoterm": null,

      "forma_pago": "CREDITO", "credit_days_mwt": 90, "credit_days_cliente": 60,

      "cotizaciones_flete": [
        { "modo": "AEREO", "monto_usd": 1033.19, "carrier": "COPA AIRLINES", "fecha": "2026-05-20", "incoterm": "CPT", "fuente": "correo: asunto/fecha/remitente" }
      ],

      "total_pares": 720, "total_venta_usd": 13101.60,
      "compra_mwt": { "fob_mercaderia_usd": 10370.10, "flete_factura_usd": 1033.19,
                      "seguro_factura_usd": 37.55, "total_factura_usd": 11403.29, "incoterm_factura": "CPT" },
      "comision_pct": 0.00,

      "dua": { "numero_dua": null, "fecha_dua": null, "tc_crc_usd": null,
               "flete_aereo_usd": null, "seguro_usd": null, "valor_aduana_cif_usd": null,
               "dai_usd": null, "ley_6946_usd": null, "iva_credito_usd": null, "timbres_usd": null,
               "costo_nacionalizado_sin_iva_usd": null, "costo_nacionalizado_con_iva_usd": null },

      "estado_inferido": "TRANSITO",

      "lineas_producto": [
        { "sku": "701809", "ref_cliente": null, "nombre_producto": "50B22-V-E-CPAP-CP",
          "descripcion": "Bota de amarrar...", "color": "Negro", "ncm": "6403.99.90",
          "talla": "37", "cantidad": 40,
          "precio_mwt": 18.23, "precio_cliente": 18.23,           // ← del DOCUMENTO; mwt=cliente salvo margen real
          "subtotal_compra": 729.20, "subtotal_venta": 729.20 }
      ],

      "fechas_estados": {                                          // ← NÚCLEO v3 (Parte 4)
        "REGISTRO":    { "aplica": true,  "inicio": "2026-05-28", "fin": "2026-06-02", "inferida": false, "fuente": "OC PDF (correo cliente 2026-05-28)" },
        "PRODUCCION":  { "aplica": true,  "inicio": "2026-06-02", "fin": "2026-06-08", "inferida": false, "fuente": "Excel SAP 275155 (correo Marluvas 2026-06-02)" },
        "PREPARACION": { "aplica": false, "inicio": null,         "fin": null,         "inferida": false, "fuente": null },
        "DESPACHO":    { "aplica": true,  "inicio": "2026-06-08", "fin": "2026-06-10", "inferida": false, "fuente": "correo booking COPA 2026-06-08" },
        "TRANSITO":    { "aplica": true,  "inicio": "2026-06-10", "fin": null,         "inferida": false, "fuente": "AWB 230-6683-2102 (correo 2026-06-10)" },
        "EN_DESTINO":  { "aplica": false, "inicio": null,         "fin": null,         "inferida": false, "fuente": null },
        "CERRADO":     { "aplica": false, "inicio": null,         "fin": null,         "inferida": false, "fuente": null }
      },

      "eventos": [
        { "tipo_evento": "OC_EMITIDA",     "fase": "REGISTRO",   "fecha_evento": "2026-05-28", "inferida": false,
          "que_paso": "El cliente envió la OC PO 505107 (720 pares).", "como": "Adjunto PDF de la OC.",
          "fuente": "CORREO", "correo_referencia": "asunto · 2026-05-28 · cliente", "extracto": "..." },
        { "tipo_evento": "SAP_CONFIRMADO", "fase": "PRODUCCION", "fecha_evento": "2026-06-02", "inferida": false,
          "que_paso": "Marluvas confirmó y asignó ticket 275155.", "como": "Correo + Excel SAP.",
          "fuente": "CORREO", "correo_referencia": "...", "extracto": "..." },
        { "tipo_evento": "EMBARQUE",       "fase": "TRANSITO",   "fecha_evento": "2026-06-10", "inferida": false,
          "que_paso": "AWB 230-6683-2102 por COPA; inicia envío aéreo.", "como": "Correo de logística.",
          "fuente": "CORREO", "correo_referencia": "...", "extracto": "..." }
      ],
      "historia_resumen": "Resumen 3-5 frases del ciclo según los correos.",

      "archivo_zip": "2453-2026.zip",
      "documentos": [
        { "tipo_documento": "PROFORMA",   "nombre_archivo": "...", "ruta_en_zip": "proforma/...",   "fecha_archivo": "2026-05-28", "fuente": "onedrive", "subido_a_minio": false, "storage_url": null, "documento_id": null },
        { "tipo_documento": "OC_CLIENTE", "nombre_archivo": "...", "ruta_en_zip": "oc_cliente/...", "fecha_archivo": "2026-05-28", "fuente": "correo",   "subido_a_minio": false, "storage_url": null, "documento_id": null },
        { "tipo_documento": "SAP",        "nombre_archivo": "SAP_275155.xlsx", "ruta_en_zip": "sap/SAP_275155.xlsx", "fecha_archivo": "2026-06-02", "fuente": "correo", "subido_a_minio": false, "storage_url": null, "documento_id": null },
        { "tipo_documento": "FACTURA",    "nombre_archivo": "Factura_Marluvas.pdf", "ruta_en_zip": "factura/...", "fecha_archivo": "2026-06-09", "fuente": "onedrive", "subido_a_minio": false, "storage_url": null, "documento_id": null },
        { "tipo_documento": "AWB",        "nombre_archivo": "AWB_230-6683-2102.pdf", "ruta_en_zip": "bl_awb/...", "fecha_archivo": "2026-06-10", "fuente": "correo", "subido_a_minio": false, "storage_url": null, "documento_id": null }
      ],
      // subido_a_minio / storage_url / documento_id los llena la Ola B

      "origen_onedrive": "01 Ventas/01 Marluvas/01 M Costa Rica/01 M SONDEL/2026/2453-2026 PO 505107",
      "pendientes": [],
      "consola": { "expediente_id": null, "oc_id": null,
                   "expediente_accion": null,        // "creado" | "editado" | "ya_existia_completo"
                   "cliente_accion": null, "operador_id": null,
                   "productos_acciones": [],         // [{sku, accion}]
                   "nodo_id": null, "nodo_accion": null,
                   "sap_cargado": false, "estados_seteados": false,
                   "documentos_subidos": [], "errores": [] }
    }
  ],
  "indice_correos": [
    { "message_id": "...", "fecha": "2026-06-02", "remitente": "...", "asunto": "...", "proforma": "2453-2026", "oc_asociada": "505107", "adjuntos": ["SAP_275155.xlsx"] }
  ],
  "resumen": { "por_estado": {}, "por_pais": {}, "por_cliente": {} }
}
```

`tipo_documento` ∈ `PROFORMA, OC_CLIENTE, SAP, FACTURA, AWB, BL, DUA, PACKING_LIST, GUIA, PAGO_IMPUESTOS, COTIZACION_FLETE, OTRO`.
`tipo_evento` ∈ `OC_EMITIDA, PROFORMA_REGISTRADA, SAP_CONFIRMADO, COTIZACION_FLETE, BOOKING, DESPACHO, EMBARQUE, ARRIBO, NACIONALIZACION_DUA, ENTREGA, PAGO_RECIBIDO, INCIDENCIA, NOTA`.

---

# PARTE 7 — PLAYBOOK DE CARGA VÍA MCP (Ola B, por cada expediente)

Ejecuta en orden. Guarda los IDs en `consola{}`.

> ## ♻️ PRINCIPIO UPSERT (clientes, productos, nodos, expedientes, OC, SAP)
> **NUNCA crees algo que ya existe.** Primero **consulta**; si existe, **revísalo y edítalo** (`*_editar`/`expediente_edit_full_patch`/`sap_upsert`), completando solo lo que falte (no pises un dato bueno con `null`); si no existe, créalo. Registra en `consola{}` si fue `creado` o `editado`.

### 7.1 Sesión — `mwt_whoami` (rol `admin`).

### 7.2 Cliente final + operador (upsert)
1. `cliente_listar(q="<cliente_final>")`. Existe → `cliente_obtener` + `cliente_editar` lo faltante. No existe → `cliente_crear({razon_social, nombre_comercial, tax_id?, pais_iso2, tipo:"DISTRIBUIDOR", estado:"ACTIVO"})`. Guarda `client_id`.
2. Operador: `operado_por_mwt == true` → `cliente_listar(q="Muito Work Limitada")` → `operating_company_id` (normalmente ya existe). Directo → `operating_company_id = client_id`.

### 7.3 Productos (SKUs) (upsert)
- Por cada `sku` único: `producto_listar(q="<sku>")`. Existe → `producto_editar` solo si hay datos nuevos (NCM, tallas, nombre). No existe → `producto_crear({sku, nombre:nombre_producto, marca_id?, costo_estandar:precio_mwt, precio_lista:precio_cliente, especificaciones:{ncm, tallas:[...], color}})`. (El precio por LÍNEA se fija en 7.5.)

### 7.4 ¿Existe el expediente? — ANTI-DUPLICADOS (crítico)
⚠️ **No uses `q` para esto.** El `q` de `expediente_listar`/`oc_listar` SOLO busca el código autogenerado (EXP-…, PO-2026-…), **no** el nº de OC del cliente ("504960") ni la proforma ("2468-2026"). Con `q` no encontrarás el existente y **crearás un duplicado** (fue el bug real: EXP-504960-6 cuando ya existía como PF 2468-2026).

**Usa SIEMPRE `expediente_buscar`** (compara contra `oc_codigos`/`proforma_codigos`/`sap_codigos` normalizando "PO"/"OC" y separadores):
```
expediente_buscar(oc_number="504960", proforma="2468-2026", client_id="<id Sondel>")
```
- `existe == true` → **NO crees nada.** Toma `matches[].expediente_id`/`oc_id`, mira su estado (`expediente_obtener` + `expediente_lineas`) y en 7.5 **EDITA** (no recrees) con `expediente_edit_full_patch`; sigue con SAP/estados/documentos que falten.
- `existe == false` → créalo (7.5).
- Verifica **por cada `numero_oc`** y **por proforma** (una proforma puede tener varias OC).

### 7.5 Crear (o editar si ya existe) el expediente + precios exactos
- **Si ya existía (7.4):** NO uses `expediente_crear`. Usa `expediente_edit_full_patch(expediente_id, {operating_company_id, forma_pago, lines_added/lines_updated})` y salta al paso 3.
- **Si no existía:**
  1. (Opcional) `expediente_resolve_oc_preview(client_id, lines=[{sku, size:talla, qty:cantidad}])`.
  2. `expediente_crear(client_id, operating_company_id, forma_pago, credit_days_mwt, credit_days_cliente, po_number=<numero_oc>, ocr_payload={lines:[{sku, size:talla, qty:cantidad, unit_price:precio_cliente}]})`. Guarda `expediente_id` y `oc_id`.
3. **Fija precios del documento — y que el TOTAL cuadre:** `expediente_lineas(expediente_id)` → `linea_id`; luego `lineas_actualizar_precios(updates=[{linea_id, unit_price_mwt, unit_price_client}])`.
   - ⚠️ **El "Total" de cada línea = `qty × unit_price_mwt`** (lado operador), mientras "Precio Cliente" muestra `unit_price_client`. Si pones `unit_price_mwt` distinto (más bajo), el Total **no cuadra** (bug real: 300×19.96 mostró $5.073 porque mwt quedó ~16.91).
   - **Regla:** salvo margen MWT↔cliente REAL del documento, pon **`unit_price_mwt = unit_price_client` = el precio unitario de la OC**. Ej.: `{linea_id, unit_price_mwt:19.96, unit_price_client:19.96}` → Total 300×19.96 = 5.988 ✔.
   - **Verifica:** relee `expediente_lineas` y comprueba `total_price == qty × unit_price_client`.

### 7.6 Documentos — subir a MinIO con el flujo correcto ⚠️
**Ningún archivo se queda en local.** Cada `.pdf/.docx/.xlsx` de OneDrive y de adjuntos de correo se sube a MinIO. **Subir = pasar la RUTA LOCAL** del archivo descargado en `file_path` (no el nombre ni texto). Usa el flujo que deja el binario REALMENTE almacenado:

1. **Descarga primero** cada archivo a una ruta local (OneDrive desde su carpeta; correo, extrayendo el adjunto a un archivo).
2. **Sube según el tipo:**
   - **OC / PO del cliente** → `match_subir(expediente_id, document_type="ART-01_OC", file_path="<oc.pdf>")` — sube a MinIO **y** la IA cruza con las líneas (devuelve `log_id` + discrepancias; resuélvelas con `match_resolver(expediente_id, log_id, actions=[...])`).
   - **Proforma del cliente** → `match_subir(expediente_id, document_type="ART-02_PROFORMA", file_path="<proforma.pdf/xlsx>")`.
   - **SAP** → va DENTRO de `sap_confirmar`/`sap_upsert` con `file_path` (paso 7.7); así queda el ART-04 en MinIO y asigna líneas. **No lo subas por separado.**
   - **Resto (BL/AWB, DUA, factura comercial Marluvas, packing, pago de impuestos, cotización, otros)** → `documento_subir(file_path="<archivo>", kind=<BL|DUA|FACTURA|PACKING_LIST|PAGO_IMPUESTOS|COTIZACION_FLETE|OTRO>, codigo="<nombre legible>", expediente_id, audience="MWT_INTERNAL")`.
3. **Audiencia:** OC y proforma del cliente → `CLIENT`; factura Marluvas, SAP, costos e internos → `MWT_INTERNAL`/`ADMIN_ONLY`.
4. **Verifica** con `documento_listar(expediente=expediente_id)` que cada doc quedó con `storage_url`; guarda `storage_url`/`documento_id` en `documentos[]` + `subido_a_minio:true`. Lo que falte → `pendientes`. **No dupliques** (si ya está ese `kind`+`codigo`, no lo subas de nuevo).
5. Proforma del **sistema**: `proforma_generar(expediente_id, audience="CLIENT")` y `proforma_generar(expediente_id, audience="ADMIN_ONLY")`.

### 7.7 SAP — número + archivo + líneas en UNA llamada
El SAP no es solo un número: **se sube el Excel/PDF de Marluvas Y se eligen qué líneas (SKU/talla/cantidad) cubre**, todo en la misma llamada (genera ART-04 en MinIO y setea `linea.sap`).
1. (Opcional) `sap_analizar(expediente_id, file_path="<excel/pdf SAP>")` → pre-extrae nº/fecha y discrepancias.
2. **Confirmar** (primer SAP, expediente en REGISTRO → pasa a PRODUCCION):
   `sap_confirmar(expediente_id, sap_id="<numero_sap>", fecha_fabricacion="<fecha_sap>", lineas_confirmadas=[{linea_id, qty_confirmada, unit_price:<precio>}], file_path="<excel/pdf SAP>")`
   - `sap_id` **obligatorio**. **Siempre** `file_path` (si no, no queda el archivo).
   - `lineas_confirmadas`: **solo** las líneas que la fábrica confirmó (con sus `linea_id`). Las no incluidas quedan **libres para otro SAP**.
   - `fecha_fabricacion` = la fecha de registro/confirmación del SAP.
3. **Editar / SAP adicional** (ya no en REGISTRO, o 2º SAP) → `sap_upsert(...)` (no transiciona).
4. **Varias OC/SAP por proforma:** un expediente por SAP, luego `expediente_fusionar([ids], label=numero_proforma)`.
5. Verifica con `sap_obtener(expediente_id, sap_id)` (líneas con `sap` y `estado=SAP_CONFIRMADO`).

### 7.8 Estados + fechas inicio/fin
1. Avanza con `expediente_avanzar_estado(expediente_id, fase_to=...)` en orden hasta `estado_inferido`, saltando los `aplica:false`. (Esto mueve el punto del timeline.)
2. `expediente_phase_durations_set(expediente_id, phase_durations={ "REGISTRO":{"start":inicio,"end":fin}, "PRODUCCION":{...}, ... })` — claves **`start`/`end`** en `YYYY-MM-DD`; admite varias fases a la vez; `null` borra; omite los `aplica:false`. Se pueden fijar fechas de fases pasadas aunque no hayas avanzado.
3. Verifica con `expediente_phase_durations_get` y `expediente_eventos`.

### 7.9 Nodos + recepción de lote + artefactos con archivo (AWB/BL + factura Marluvas)
1. `nodo_listar()`. Busca el almacén destino por `codigo`/país: existe → úsalo (`nodo_editar` si falta dato); no existe → `nodo_crear({codigo, nombre, tipo:"ALMACEN", pais_iso2})`. Guarda `nodo_id`. No dupliques nodos.
2. Mercadería llegada (estado ≥ EN_DESTINO): `recepcion_crear(items=[{expediente_id, producto_id, talla, qty_asignada, nodo_id}], cost_lines=[{kind, amount, currency, fx_to_usd, source:"MANUAL", scope:{applies_to_all:true}}])`. (En recepción la cantidad es `qty_asignada` y la talla es `talla`; over-asignación da 400. Aquí `scope` o `scope_json` ambos valen.)
3. **Artefactos con ARCHIVO (AWB/BL, factura comercial Marluvas, packing list, impuestos):** sube el nº de AWB/BL, el archivo PDF, la factura, etc. **Sigue el flujo del APÉNDICE C** (leer template → subir archivo(s) con `storage_subir_archivo` → armar `data` por field.id → `nodo_artefacto_crear`). Resumen:
   - a) `builder_templates_listar()` → elige template (AWB/BL=9, Factura Comercial=13, Packing List=23, Impuestos=24). `builder_template_obtener(template_id)` → estructura con los `field.id`/`type`/`label`.
   - b) Por cada campo de archivo: `storage_subir_archivo(file_path, scope="artifact-field/<field_id>", filename)` → `key`.
   - c) `nodo_artefacto_crear(nodo_id, template_id, template_title, structure_snapshot=<structure_json>, data={...por field.id...}, lines=[{expediente_id, producto_id, talla, qty}])`. **El nº de AWB/BL va en el campo de texto "Tracking" del template** (no en el archivo). Ver mapeo exacto en **Apéndice C**.

### 7.10 Movimientos (si hay transferencia entre nodos)
1. `transferencia_crear(origen_id, destino_id, legal_context="NATIONALIZATION"|"INTERNAL"|"EXPORT"|"DISTRIBUTION"|"CONSIGNMENT", lineas=[{producto_id, sku, size, qty_transfer, unit_cost:precio_mwt, unit_value:precio_cliente}], context_data={bl_awb_number:<awb|bl>})`. Guarda `transferencia_id`.
   - En líneas de transferencia la talla es **`size`** (no `talla`). El AWB/BL va en `context_data` (`bl_awb_number` para NATIONALIZATION; `awb_bl_number` para EXPORT/DISTRIBUTION/CONSIGNMENT).
   - **`DISTRIBUTION` exige** `context_data.transfer_pricing_amount > 0` o falla con 400.
2. Avanza el estado: `transferencia_aprobar` (PLANNED→APPROVED) → `transferencia_despachar` (APPROVED→IN_TRANSIT; el backend estampa `dispatched_at`) → `transferencia_recibir(lineas=[{id, qty_received}])` (IN_TRANSIT→RECEIVED; manda la `qty_received` por línea) → `transferencia_conciliar(reconciled_by_id=..., gap_justification=...)` (RECEIVED→RECONCILED).
   - ETA/tracking/fechas: el backend las estampa en las transiciones; si necesitas fijar `eta`/`ref_tracking` manualmente, intenta `transferencia_editar({eta, ref_tracking})` (la fecha de despacho/arribo del envío también puede ir en el artefacto AWB/BL del Apéndice C).
   - ⚠️ `transferencia_conciliar` con discrepancia: exige `reconciled_by_id` (si no → 400) **y** uno de `exception_document_id` / `gap_justification` (si faltan ambos → 409 `EXCEPTION_DOC_REQUIRED`).
3. **Artefacto del movimiento (AWB/BL, factura):** mismo flujo del **Apéndice C** pero con `transfer_artefacto_crear(transferencia_id, template_id, template_title, structure_snapshot, data, lines)`.

### 7.11 Costos, impuestos y gastos del movimiento
- Por cada concepto del `dua`/cotizaciones: `transfer_costo_agregar(transferencia_id, kind, amount, currency, fx_to_usd, price_view="MWT", scope_json={applies_to_all:true})`.
  - **Aquí la clave es `scope_json`** (no `scope`). No mandes `amount_usd` (es calculado).
  - **Impuestos CR (clientes en Costa Rica):** `DAI`, `IVA`, `LEY_6946`, `PROCOMER`, `TIMBRE_ARCHIVO`, `TIMBRE_AGENTES`, `TIMBRE_CONTADORES` (no hay otros timbres).
  - **Gastos:** `FLETE`, `SEGURO`, `ALMACENAJE`, `AGENCIAMIENTO`, `MANIPULEO`, `CONSOLIDACION`, o `OTRO` (custom, usa `label`).
  - Costo de un expediente específico: `scope_json={"applies_to_all":false,"expediente_ids":[expediente_id]}`.
- `transfer_liquidar(transferencia_id, method="BY_VALUE")` → `transfer_factura_payload(transferencia_id)` (factura/remisión).

### 7.12 Pagos (entrante / saliente)
1. `pago_applicables(type="PRODUCTO"|"COSTO", transferencia_id=...)` → `applicable_id`.
2. (Opcional) `pago_dry_run(...)`.
3. `pago_registrar(expediente_id, monto, moneda, fecha, metodo:"TRANSFERENCIA_BANCARIA", tipo_pago:"COMPLETO"|"PARCIAL", referencia, aplicaciones=[{applicable_type, applicable_id, cantidad_producto?, monto_aplicado}], file_path="<comprobante?>")`. (IN = entrante cliente→MWT; OUT = saliente MWT→proveedor/costos.)
4. Nace en **borrador**; aplica con `pago_conciliar(pago_id)` (recién ahí impacta saldo/crédito).

### 7.13 Resultado
- Actualiza `consola{}` (`expediente_id`, `oc_id`, acciones creado/editado, `sap_cargado`, `estados_seteados`, `documentos_subidos[]`, `errores[]`). Si algo falla, **registra y continúa** con el siguiente expediente.

---

# PARTE 8 — REGLAS DE ORO

1. **Upsert (anti-duplicados):** consulta SIEMPRE antes de crear. Para expedientes usa **`expediente_buscar(oc_number, proforma, sap, client_id)`** (NO `q`). Si existe → edita; no dupliques. (La consola permite OC/PO duplicadas entre proformas DISTINTAS, pero nunca recrees el MISMO expediente.)
2. **Operador:** `Muito Work Limitada` = operador, no cliente final → `operating_company_id` vs `client_id`.
3. **Precios del documento** (no de la BD) con `lineas_actualizar_precios`; **`unit_price_mwt = unit_price_client`** salvo margen real → que `total_price == qty × precio_cliente`.
4. **Fechas reales** por estado (correos/documentos); `inferida:true` si estimas; `null`+`pendientes` si faltan; continuidad `fin(n)=inicio(n+1)`.
5. **Una línea por (SKU × talla)**; `total_pares == sum(cantidad)`.
6. **Nunca inventes** OC/PF/SAP/AWB/BL ni montos/fechas.
7. **Cita la fuente** de cada dato.
8. **Sube TODOS los archivos a MinIO** (OC/proforma por `match_subir`, SAP por `sap_confirmar`, resto por `documento_subir`); AWB/BL y factura Marluvas como **artefactos con archivo** (`storage_subir_archivo` → `key` en `data` → `*_artefacto_crear`). Verifica con `documento_listar`. Ningún archivo se queda en local.
9. Ante error del MCP: regístralo en `errores[]` y continúa; entrega resumen de cargados/fallidos.

---

# PARTE 9 — CHECKLIST

- [ ] `mwt_whoami` OK (admin).
- [ ] Cada proforma: correos leídos con **fechas** + `eventos` + `historia_resumen`.
- [ ] `fechas_estados` con inicio/fin por estado, continuos y citados/inferidos.
- [ ] `operador`/`cliente_final` correctos; `operado_por_mwt` definido.
- [ ] `lineas_producto` con `precio_mwt`/`precio_cliente` **del documento**; `total_pares == sum(cantidad)`.
- [ ] **Anti-duplicados:** antes de crear, `expediente_buscar(oc_number, proforma, client_id)` → si existe, editar (no duplicar).
- [ ] En consola: cliente(s), SKU(s), expediente con OC y líneas, **precios corregidos** y **`total_price == qty × precio_cliente`** verificado.
- [ ] SAP cargado (`sap_confirmar`/`sap_upsert`) con archivo y líneas asignadas; fusión si varias OC/SAP.
- [ ] **TODOS** los archivos subidos a MinIO (OC/proforma por `match_subir`, resto por `documento_subir`), verificado con `documento_listar`; proforma generada; AWB/BL (nº en Tracking + PDF), factura comercial Marluvas, packing e impuestos como **artefactos con archivo** (Apéndice C: `storage_subir_archivo` + `*_artefacto_crear`).
- [ ] Estados avanzados + **fechas inicio/fin** (`phase_durations_set`) verificadas.
- [ ] Nodo + recepción + costos; movimiento con costos/impuestos/gastos; pagos draft→conciliar.
- [ ] `consola{}` por proforma.
- [ ] **REPORTE FINAL DE CIERRE (Parte 11)** generado.

---

# PARTE 10 — ARRANQUE

1. **Conéctate al MCP** (Parte 0) y corre `mwt_whoami`.
2. **Ola A:** indexa correos (con **fechas**) + OneDrive; lee conversaciones, PDF, Word y Excel; parsea proforma y SAP; deriva `fechas_estados`; escribe `proformas_consolidado.json`.
3. **Ola B:** por expediente, ejecuta el Playbook (Parte 7) respetando upsert/anti-duplicados, operador, precios del documento, subida a MinIO y fechas de estado.
4. Entrega `proformas_consolidado.json` (con `consola{}`) + **el REPORTE FINAL DE CIERRE (Parte 11)**.

---

# PARTE 11 — REPORTE FINAL DE CIERRE (obligatorio)

Al terminar TODA la lectura y TODA la carga, produce un reporte: (A) una ficha por proforma/OC de cómo quedó, y (B) un consolidado global. Entrégalo como **Markdown legible** + objeto `reporte_final` en el JSON.

## 11.1 Por cada expediente (proforma / OC-PO) reporta:
1. **Proforma / OC** (`numero_proforma`, `numeros_oc`).
2. **Cuántos expedientes** se crearon/editaron (1, o N con fusión) + `expediente_id` y `fusion_id`/label.
3. **Acción** por entidad: `creado`/`editado`/`ya_existía`.
4. **Cliente final** + `client_id`. **Operador** + `operating_company_id` + `operado_por_mwt`.
5. **Número(s) de SAP** + si pasó a PRODUCCION.
6. **Estado final** + fechas inicio/fin de cada estado seteadas.
7. **SKUs** con `precio_mwt`/`precio_cliente` cargados, cantidad y talla.
8. **Documentos en MinIO:** cuántos + lista con tipo + `storage_url` + `documento_id`. Marca faltantes.
9. **Nodos** usados/creados + recepción (qty por SKU/talla) + **artefactos con archivo** (AWB/BL, factura Marluvas) y su `key`.
10. **Movimientos:** `transferencia_id`, origen→destino, estado final, tracking BL/AWB.
11. **Costos/impuestos/gastos:** lista (`kind` + monto USD) + total.
12. **Pagos:** registrados (IN/OUT) y si se conciliaron.
13. **Pendientes / errores.**

### Formato sugerido por expediente
```
### PF 2453-2026 · OC 505107 — quedó en TRANSITO
- Expedientes: 1 (EXP-…, creado) | Fusión: no
- Cliente final: Sondel S.A. (…) | Operador: Muito Work Limitada (…, operado_por_mwt=true)
- SAP: 275155 (PRODUCCION) | Estado final: TRANSITO
- Fechas: REGISTRO 05-28→06-02 · PRODUCCION 06-02→06-08 · DESPACHO 06-08→06-10 · TRANSITO 06-10→(abierto)
- SKUs (3): 701809 t37 x40 (mwt 18.23 / cli 18.23) · … · total 720 pares
- Docs MinIO (5): PROFORMA→… (doc_id …) · OC→… · SAP_275155.xlsx→… · FACTURA_Marluvas→… · AWB→…
- Nodo: ALM-CR (…, creado) | Recepción: 720 | Artefactos: AWB/BL ✔ (key …), Factura Marluvas ✔ (key …)
- Movimiento: TRF-… (ALM-CR→…) RECONCILED, tracking 230-6683-2102
- Costos/impuestos/gastos: DAI $… · IVA $… · flete $… (total $…)
- Pagos: 1 entrante conciliado ($…)
- Pendientes: ninguno
```

## 11.2 Consolidado global
Total proformas; **expedientes creados vs editados vs ya existentes**; **documentos en MinIO** (total/faltantes); clientes/SKUs/nodos creados vs editados; distribución por estado final / país / operador; movimientos, total costos/impuestos/gastos, pagos conciliados; **lista de fallidos** (proforma + motivo).

## 11.3 Objeto `reporte_final` en el JSON
```jsonc
"reporte_final": {
  "generado_en": "2026-06-18",
  "totales": { "proformas": 88, "expedientes_creados": 0, "expedientes_editados": 0,
               "documentos_subidos_minio": 0, "documentos_faltantes": 0,
               "clientes_creados": 0, "productos_creados": 0, "nodos_creados": 0,
               "movimientos": 0, "pagos_conciliados": 0, "fallidos": 0 },
  "por_estado_final": {}, "por_pais": {}, "por_operador": {},
  "expedientes": [
    { "numero_proforma": "2453-2026", "numeros_oc": ["505107"],
      "expediente_ids": ["…"], "fusion_id": null, "expediente_accion": "creado",
      "cliente_final": "Sondel S.A.", "client_id": "…",
      "operador": "Muito Work Limitada", "operating_company_id": "…", "operado_por_mwt": true,
      "numero_sap": ["275155"], "estado_final": "TRANSITO", "fechas_estados_seteadas": true,
      "skus": [ { "sku": "701809", "talla": "37", "cantidad": 40, "precio_mwt": 18.23, "precio_cliente": 18.23 } ],
      "documentos": [ { "tipo": "PROFORMA", "storage_url": "…", "documento_id": "…" } ],
      "nodos": [ { "nodo_id": "…", "codigo": "ALM-CR", "accion": "creado", "recepcion_qty": 720 } ],
      "artefactos": [ { "tipo": "AWB/BL", "key": "…" }, { "tipo": "FACTURA_MARLUVAS", "key": "…" } ],
      "movimientos": [ { "transferencia_id": "…", "estado": "RECONCILED", "tracking": "230-6683-2102" } ],
      "costos": [ { "kind": "DAI", "amount_usd": 0 } ],
      "pagos": [ { "pago_id": "…", "direction": "IN", "conciliado": true, "monto_usd": 0 } ],
      "pendientes": [], "errores": [] }
  ],
  "fallidos": [ { "numero_proforma": "…", "motivo": "…" } ]
}
```

> Imprime SIEMPRE el reporte de cierre al final, aunque haya errores.

---
---

# APÉNDICE C — CÓMO CREAR UN ARTEFACTO (subir AWB/BL nº + archivo, factura comercial, packing, impuestos)

Los artefactos del Builder son formularios con campos (texto, número, fecha, select, radio, checkbox y **archivo**). Se crean en un **nodo** (`nodo_artefacto_crear`) o en un **movimiento** (`transfer_artefacto_crear`). El binario (PDF) se sube aparte y su `key` va dentro de `data`.

## C.1 Flujo (4 pasos)

1. **Lee la estructura del template** (los `field.id` cambian por template, NO los inventes):
   - `builder_templates_listar()` → catálogo (id, title, structure_json).
   - `builder_template_obtener(template_id)` → `structure_json.sections[].columns[].fields[]` con `{id, type, label, options}`.
2. **Sube cada archivo** del template (campos `type:"file"`):
   - `storage_subir_archivo(file_path="<archivo.pdf>", scope="artifact-field/<field_id>", filename="<archivo.pdf>")` → `{key, content_type, size}`.
3. **Arma `data`** indexado por **`field.id`**, con el valor según `type`:
   | type | valor en `data[field.id]` |
   |---|---|
   | text / textarea / code | string |
   | number | número (ej. `438`) |
   | date | `"YYYY-MM-DD"` |
   | select / radio | el **`label`** de la opción (ej. `"awb"`, `"aéreo"`, `"USD"`), **no** el id |
   | checkbox | booleano |
   | file | `{ "key": <key>, "url": "/api/storage/download/?key=<key urlencoded>", "name": "<archivo.pdf>", "mime": <content_type>, "size": <size> }` |
4. **Crea el artefacto:**
   `nodo_artefacto_crear(nodo_id, template_id, template_title, structure_snapshot=<structure_json tal cual>, data={...}, lines=[{expediente_id, producto_id, talla, qty}])`
   (`lines` salen de `/api/nodos/{id}/builder-artifacts/available-lines/?template_id=&expediente_ids=`; en movimiento, de la versión `/transferencias/{id}/...`).

## C.2 Mapeo de los templates clave (field-ids reales observados — **verifica con `builder_template_obtener`**, pueden cambiar)

**Template 9 — `ART-05: AWB/BL` (Documento de Envío):**
- `field-0052` (radio) Tipo de Documento → `"awb"` | `"bl"`
- `field-0055` (radio) Modo de Transporte → `"aéreo"` | `"marítimo"`
- `field-0061` (radio) Modo de Flete → `"prepaid"` | `"postpaid"`
- `field-0064` (radio) Gestión de Despacho → `"mwt"` | `"client"`
- `field-1778635869890` (text) **CARRIER** → ej. `"COPA AIRLINES"`
- `field-0072` (text) **Tracking → AQUÍ va el NÚMERO de AWB/BL** (ej. `"230-6683-2102"`)
- `field-1778637230655` (file) **AWB/BL → el PDF** (objeto `{key,...}`)
- `field-1780150662711` (date) Fecha de Despacho · `field-1780150673285` (date) Fecha de Arribo
- `field-0081` (radio) Consolidación → `"sí"` | `"no"`

**Template 13 — `Factura Comercial`:**
- `field-0113` (text) ID de Factura (ej. `"2453-2026"`)
- `field-0114` (select) Moneda → `"USD"` | `"CRC"`
- `field-0118` (number) Total Vista Cliente (ej. `11403`)
- `field-1779822627353` (file) **Factura → el PDF**

**Template 23 — `Packing List Dellado`:**
- `field-1779742541599` (file) Packing List (PDF)
- `field-1780418747156` (number) # Cajas · `field-1780418760960` (number) Peso bruto · `field-1780418781017` (number) Peso Neto · `field-1780418795993` (text) Metros Cúbicos

**Template 24 — `Impuestos`:**
- `field-1779745388070` (date) Fecha de Transferencia · `field-1779745423636` (number) Monto Acreditado · `field-1779745444471` (file) Comprobante

## C.3 Ejemplo real (Factura Comercial en un nodo)

```
key = storage_subir_archivo(file_path="Invoice 2453-2026.pdf",
                            scope="artifact-field/field-1779822627353",
                            filename="Invoice 2453-2026.pdf")   # → {key, content_type, size}

nodo_artefacto_crear(
  nodo_id="<nodo>", template_id=13, template_title="Factura Comercial",
  structure_snapshot=<structure_json del template 13>,
  data={
    "field-0113": "2453-2026",
    "field-0114": "USD",
    "field-0118": 11403,
    "field-1779822627353": { "key": key, "url": "/api/storage/download/?key=<urlenc>",
                             "name": "Invoice 2453-2026.pdf", "mime": "application/pdf", "size": 186866 }
  },
  lines=[{ "expediente_id": "<exp>", "producto_id": "<prod>", "talla": "39", "qty": 5 }, ...]
)
```

Y para el **AWB/BL** (template 9): sube el PDF a `field-1778637230655`, pon el **número** en `field-0072` (Tracking), el carrier en `field-1778635869890`, las fechas en los campos date, y crea con `nodo_artefacto_crear`/`transfer_artefacto_crear`.

---
---

# APÉNDICE A — Referencia rápida de herramientas (parámetros clave)

- **expediente_buscar(oc_number?, proforma?, sap?, client_id?)** — ANTI-DUPLICADOS. `{existe, matches[]}`. Úsala antes de crear (no por código autogenerado).
- **cliente_crear(datos)** — `razon_social, nombre_comercial, tax_id, pais_iso2, tipo (B2B|CONSUMIDOR|DISTRIBUIDOR), dias_credito, estado`.
- **producto_crear(datos)** — `sku, nombre, marca_id, categoria, costo_estandar, precio_lista, especificaciones{ncm,tallas,color}`.
- **expediente_crear(...)** — `client_id, operating_company_id, forma_pago (CREDITO|CONTADO), credit_days_mwt, credit_days_cliente, po_number, ocr_payload{lines:[{sku,size,qty,unit_price}]}, file_path?`.
- **lineas_actualizar_precios(updates)** — `[{linea_id, unit_price_mwt, unit_price_client}]`. El "Total" usa `unit_price_mwt` → ponlo = `unit_price_client` salvo margen real.
- **match_subir(expediente_id, document_type, file_path)** — `document_type`: ART-01_OC | ART-02_PROFORMA | ART-04_SAP. Sube a MinIO + mapea líneas (→ `log_id`). **match_resolver(expediente_id, log_id, actions)**.
- **sap_confirmar(...)** — `expediente_id, sap_id, fecha_fabricacion, lineas_confirmadas:[{linea_id,qty_confirmada,unit_price}], file_path`. (REGISTRO→PRODUCCION; las no incluidas quedan libres.)
- **expediente_avanzar_estado(expediente_id, fase_to)** — `REGISTRO|PRODUCCION|PREPARACION|DESPACHO|TRANSITO|EN_DESTINO|CERRADO`.
- **expediente_phase_durations_set(expediente_id, phase_durations)** — `{ESTADO:{start,end}}` (`YYYY-MM-DD`; `null` borra; varias fases a la vez).
- **recepcion_crear(items, cost_lines?)** — `items:[{expediente_id,producto_id,talla,qty_asignada,nodo_id}]`; `cost_lines` admite `scope` o `scope_json`.
- **storage_subir_archivo(file_path, scope, filename?)** — sube binario → `{key, content_type, size}`. Mete `{key,url,name,mime,size}` en `data[<field_id>]` del artefacto.
- **nodo_artefacto_crear / transfer_artefacto_crear** — `template_id, template_title, data{...campos, incl. file con {key,...}}, lines:[{expediente_id,producto_id,talla,qty}]`.
- **transfer_costo_agregar(...)** — `kind (DAI|IVA|LEY_6946|PROCOMER|TIMBRE_ARCHIVO|TIMBRE_AGENTES|TIMBRE_CONTADORES|FLETE|SEGURO|ALMACENAJE|AGENCIAMIENTO|MANIPULEO|CONSOLIDACION|OTRO), amount, currency, fx_to_usd, price_view (MWT|CLIENT), scope_json`.
- **transferencia_conciliar(...)** — con discrepancia exige `reconciled_by_id` (400) y `exception_document_id`/`gap_justification` (409 si faltan).
- **pago_registrar(...)** → **pago_conciliar(pago_id)** — el pago solo impacta al conciliar.

---

# APÉNDICE B — MWT.ONE · Servidor MCP (guía completa de referencia)

Servidor MCP que expone la operación completa de la Consola MWT.ONE como herramientas para un agente de IA externo (Antigravity, Kimi CLI, Claude Desktop, Cursor). Autentica con un **token de servicio de larga vida (≈100 años)**. No guarda estado local: cada herramienta es una llamada autenticada a `https://consola.mwt.one/api`.

## B.1 Qué puede hacer (89 herramientas)
Ver tabla completa en la **Parte 1**.

## B.2 Generar el token (sin vencimiento)
```bash
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
docker exec -i consola-mwt-one-django python manage.py mint_mcp_token --email alejandro@muitowork.com
```
(Solo el token: `--quiet`. Revocar: rota `DJANGO_SECRET_KEY` o desactiva el usuario en `core.users`.) El token de esta operación ya está embebido en la Parte 0.

## B.3 Instalar y correr el MCP
**Local (stdio):**
```bash
cd mcp_server && pip install -r requirements.txt
export MWT_MCP_TOKEN="<token>"; export MWT_API_BASE="https://consola.mwt.one/api"
python -m mwt_mcp
```
**Por red (Docker, streamable-http):**
```bash
cd mcp_server && docker build -t mwt-mcp .
docker run -d --name mwt-mcp -p 8765:8765 \
  -e MWT_MCP_TOKEN="<token>" -e MWT_API_BASE="https://consola.mwt.one/api" -e MWT_MCP_TRANSPORT=http mwt-mcp
# Endpoint: http://<host>:8765/mcp
```
Variables: `MWT_API_BASE`, `MWT_MCP_TOKEN`, `MWT_MCP_TRANSPORT` (stdio|http), `MWT_MCP_HOST`, `MWT_MCP_PORT`, `MWT_HTTP_TIMEOUT`, `MWT_MCP_READONLY` (1 = solo lectura).

## B.4 Registrar en clientes de IA
Si instalaste con `pip install "git+...#subdirectory=mcp_server"` (Parte 0), **omite `cwd`** (el módulo `mwt_mcp` es global). Para clientes solo-HTTP, usa la Opción B y apunta a `http://<host>:8765/mcp`.

## B.5 Flujo operativo de referencia
`mwt_whoami` → catálogo (`cliente_crear`/`producto_crear`) → **`expediente_buscar`** (anti-dup) → `expediente_crear` → `lineas_actualizar_precios` → `match_subir` (OC/proforma) / `sap_confirmar` (SAP) → `proforma_generar` → `expediente_avanzar_estado` + `expediente_phase_durations_set` → `nodo_crear` + `recepcion_crear` + `storage_subir_archivo` + `nodo_artefacto_crear` (AWB/BL, factura Marluvas) → `transferencia_crear`/`aprobar`/`despachar`/`recibir`/`conciliar` → `transfer_costo_agregar` → `transfer_liquidar`/`transfer_factura_payload` → `pago_applicables`/`pago_registrar`/`pago_conciliar`.
