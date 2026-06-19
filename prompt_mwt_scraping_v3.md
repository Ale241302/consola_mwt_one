# PROMPT v3 — MWT: Scraping con fechas por estado + Carga real a `consola.mwt.one` vía MCP

> **Para:** KIMI CLI (o Claude / Antigravity / Cursor).
> **Modo:** **multi-agente**. Sub-agentes que leen en paralelo, comparten un **Índice Maestro** y, al final, un **Agente Ejecutor-MCP** carga todo en la plataforma con el MCP `mwt-one`.
> **Objetivo:** reconstruir cada expediente (proforma) leyendo **correo + OneDrive + PDF + Word + Excel**, **extrayendo la fecha de CADA correo y documento** para derivar la **fecha de inicio y fin de cada estado**, y luego **crearlo realmente en `consola.mwt.one`**: clientes, productos, expediente con OC, SAP, documentos, estados con sus fechas, nodos, recepción de lote, artefactos (AWB/BL y **factura comercial Marluvas**), movimientos, costos/impuestos/gastos y pagos.
> **v3 vs v2:** la v2 solo generaba el JSON. La v3 **lee las fechas de cada correo/documento, deriva las fechas de cada estado y EJECUTA la carga** vía MCP.

---

# PARTE 0 — CONÉCTATE AL MCP `mwt-one` (hazlo tú mismo, primero)

El MCP es tu **única vía** para escribir en la plataforma. Conéctate antes de procesar nada.

## Paso 1 — Instalación en una sola línea

```bash
pip install "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```

Esto instala el paquete `mwt-mcp` y todas sus dependencias en tu Python (módulo `mwt_mcp`, se arranca con `python -m mwt_mcp`).

## Paso 2 — Registra el servidor MCP

### Opción A — JSON estándar (Claude Desktop / Cursor / KIMI CLI)

Pega este bloque **completo** en tu config MCP (`mcp.json` o `claude_desktop_config.json`):

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

Llama a **`mwt_whoami`** → debe devolver `alejandro@muitowork.com`, rol `admin`. Si da error de token, **detente** y avisa. (El token ya está embebido; es de larga vida ~100 años; trátalo como secreto. Detalle de cómo se generó y se rota: **Apéndice B**.)

---

# PARTE 1 — QUÉ PUEDE HACER EL MCP `mwt-one` (87 herramientas)

| Dominio | Herramientas |
|---|---|
| **Salud** | `mwt_whoami` |
| **Clientes** | `cliente_listar`, `cliente_obtener`, `cliente_crear`, `cliente_editar`, `cliente_subsidiarias`, `cliente_kpis_pool` |
| **Productos** | `producto_listar`, `producto_obtener`, `producto_crear`, `producto_editar`, `ncm_listar` |
| **OC / Expedientes** | `oc_listar`, `oc_obtener`, `expediente_listar`, `expediente_obtener`, `expediente_lineas`, `expediente_resolve_oc_preview`, `expediente_crear`, `lineas_actualizar_precios`, `expediente_apply_pronto_pago`, `expediente_edit_full_get`, `expediente_edit_full_patch` |
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
| **Builder** | `builder_templates_listar`, `builder_template_obtener` |

> Referencia completa de capacidades, instalación, Docker y registro: **Apéndice B** (al final).

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
- Pista en OneDrive: rutas tipo `02 M Muito Work / <sub-cliente> /` = operador MWT, sub-cliente = cliente final. Rutas tipo `01 M SONDEL/` directas = normalmente operador = el cliente (confírmalo con la proforma/OC).

## 💲 Precios — los del DOCUMENTO, no los de la BD (REGLA CRÍTICA)

Lee los precios de la **OC y la proforma** (PDF/XLSX) y del **SAP** (Excel). **Ignora** los precios que ya estén en la base de datos.

- **`precio_mwt`** = precio de compra a Marluvas (FOB) → `unit_price_mwt` de la línea. Sale del **SAP/factura Marluvas** y/o de la columna de costo de la proforma.
- **`precio_cliente`** = precio de venta al cliente → `unit_price_client` de la línea. Sale de la **proforma** (columna de venta) y se confirma con la **OC del cliente**.
- Como `expediente_crear` re-deriva precios con el motor de la consola, **al final corrige cada línea con `lineas_actualizar_precios`** para dejar exactamente lo leído del documento.

---

# PARTE 3 — LECTURA PROFUNDA POR FORMATO (qué extraer de cada fuente)

Para **cada proforma** lee y cruza TODAS estas fuentes. **De cada fuente registra su FECHA** (la necesitas en la Parte 4).

### 3.1 Correos (IMAP `alvaro@muitowork.com` / backup `.eml/.mbox`)
- Lee el **hilo completo** (cuerpo, no solo asunto). De **cada** correo registra: `message-id`, **`Date:` (fecha y hora exacta)**, remitente, destinatarios, asunto, adjuntos.
- Clasifica cada correo por hito y **anota su fecha**:
  - Correo del **cliente con la OC** → fecha de **REGISTRO (inicio)**.
  - Correo de **Marluvas confirmando** (con Excel SAP / ticket) → fecha de **PRODUCCION (inicio)** = fin de REGISTRO.
  - Correo con **cotización/booking de flete** → fecha de **PREPARACION/DESPACHO**.
  - Correo con **AWB/BL** → fecha de **TRANSITO (inicio)**.
  - Correo de **aduana/DUA / arribo** → fecha de **EN_DESTINO (inicio)**.
  - Correo de **entrega / comprobante de pago** → fecha de **CERRADO (inicio)**.
- Detecta por regex: Proforma `\d{4}-\d{4}`, PO/OC `(?:PO|OC)\s*\d+`, SAP `\d{6,}`, Booking `[A-Z]{2,4}\d{6,}`, AWB `\d{3}[\s-]?\d{4}[\s-]?\d{4}`, BL `[A-Z0-9\-]{5,}`.

### 3.2 OneDrive — carpetas
`01 Ventas/01 Marluvas/<país>/<cliente>/<año>/<proforma> PO <po>/` con subcarpetas `Proforma/`, `OC del Cliente/`, `SAP/`, `Factura/`, `Guia/`, `Packing List Detallado/`, `DUA/`, `Pago de Impuestos/`.
- Lista cada archivo real con su **fecha de archivo** (fecha de modificación o la fecha impresa dentro del documento).
- Clientes sin subcarpetas (Colombia/Honduras/Panamá): infiere el tipo por nombre/extensión.

### 3.3 PDF (`.pdf`)
- **OC del cliente:** nº PO, **fecha de la OC**, cliente final, líneas (ref/SKU, talla, cantidad), **precio de venta**, condiciones de pago.
- **Proforma:** nº proforma, **fecha**, operador, cliente final, matriz de tallas, **`precio_mwt` y `precio_cliente`**, totales, comisión.
- **Factura comercial Marluvas:** nº factura, **fecha**, FOB por línea, flete/seguro, incoterm (CPT/CIP/FOB).
- **BL/AWB:** número, **fecha de emisión**, carrier/naviera, origen/destino, booking.
- **DUA / Pago de impuestos:** nº DUA, **fecha**, TC CRC/USD, CIF, DAI, Ley 6946, IVA, timbres.

### 3.4 Word (`.doc/.docx`)
- OCs en Word, cartas de instrucción, notas: extrae nº OC, **fecha**, cliente, cantidades y cualquier precio o condición.

### 3.5 Excel (`.xlsx/.xls`)
- **SAP de Marluvas:** **ticket/pedido**, **fecha de confirmación**, líneas confirmadas (sku/talla/cantidad), **precios FOB → `precio_mwt`**.
- **Proforma XLSX:** matriz de tallas completa → una línea por sku×talla con `precio_mwt`/`precio_cliente`.
- **Cotizaciones de flete:** monto, carrier/naviera, incoterm, **validez/fecha**.
- **Cálculos DUA:** TC, CIF, DAI, Ley 6946, IVA, timbres, costo nacionalizado.

> De la **OC y la proforma** sale lo esencial: **operador, cliente final, `precio_mwt`, `precio_cliente`**, tallas y cantidades. **Nunca** tomes precios de la BD.

---

# PARTE 4 — FECHAS DE INICIO Y FIN DE CADA ESTADO (núcleo de la v3)

Para **cada expediente**, deriva `inicio` y `fin` de **cada estado** a partir de las **fechas reales** capturadas en la Parte 3. **El `fin` de un estado = el `inicio` del siguiente.**

## 4.1 Matriz de derivación (qué fecha usar)

| Estado | `inicio` = fecha de… | `fin` = fecha de… |
|---|---|---|
| REGISTRO | OC del cliente (correo/PDF) o emisión de proforma | confirmación SAP de Marluvas |
| PRODUCCION | confirmación SAP de Marluvas (Excel/correo) | 1ª cotización de flete / inicio de preparación / booking |
| PREPARACION | preparación / packing / cotización de flete | confirmación de booking / despacho |
| DESPACHO | booking confirmado / salida de origen | emisión de AWB/BL |
| TRANSITO | emisión de AWB/BL (PDF/correo) | arribo a destino |
| EN_DESTINO | arribo / inicio de trámite DUA | entrega + pago |
| CERRADO | entrega final / pago recibido | (terminal, sin `fin`) |

## 4.2 Reglas de fechas

- Formato `YYYY-MM-DD`. Toma la fecha del **correo (`Date:`) o documento** que dispara el hito.
- **Continuidad:** `fin(estado_n) == inicio(estado_n+1)`. No dejes huecos ni solapes.
- **Estado que no aplica** (p.ej. aéreo sin PREPARACION marítima, o saltos): `aplica:false`, sin fechas.
- **Fecha estimada** (sin documento exacto, la deduces de la secuencia): `inferida:true` + explica el criterio en `fuente`.
- **Falta total:** `null` + agrégala a `pendientes`. **Nunca inventes una fecha.**
- **Cita la fuente** de cada fecha: correo (`asunto · fecha · remitente`) o archivo de OneDrive.
- El **estado actual** (`estado_inferido`) es el último estado con `inicio` y sin `fin` (o con `fin` si ya está CERRADO).

## 4.3 Ejemplo trabajado (PF 2453-2026, aéreo)

```
OC del cliente (correo 2026-05-28)          → REGISTRO.inicio = 2026-05-28
Marluvas confirma SAP 275155 (Excel 2026-06-02) → REGISTRO.fin = PRODUCCION.inicio = 2026-06-02
Booking/flete COPA (correo 2026-06-08)      → PRODUCCION.fin = DESPACHO.inicio = 2026-06-08
AWB 230-6683-2102 (correo 2026-06-10)       → DESPACHO.fin = TRANSITO.inicio = 2026-06-10
(aún en tránsito, sin arribo)               → TRANSITO.fin = null  ⇒ estado_inferido = TRANSITO
PREPARACION / EN_DESTINO / CERRADO          → aplica:false (no ocurrieron / se saltó)
```

Esto se carga en consola con `expediente_phase_durations_set` (Parte 7.8).

---

# PARTE 5 — ORQUESTACIÓN MULTI-AGENTE (Kimi)

Índice Maestro compartido (una ficha por proforma). Dos olas.

## Ola A — Recopilación (en paralelo)
1. **Correos-Indexador** — indexa todo el buzón; por correo: `message-id`, **fecha**, asunto, de/para, adjuntos; detecta IDs por regex; agrupa en **hilos por proforma/OC**.
2. **Correos-Lectura (N)** — leen conversaciones completas; reconstruyen `eventos` con narrativa **y fechas**; capturan ticket SAP, cotizaciones, DUA, operador, envío.
3. **OneDrive-Carpetas** — lista/clasifica archivos reales por subcarpeta + **fecha de cada archivo**.
4. **Proforma (PDF/HTML/XLSX)** — matriz de tallas → `lineas_producto` con **`precio_mwt`/`precio_cliente`** del documento.
5. **SAP-Excel** — ticket Marluvas, **fecha de confirmación**, líneas, FOB.
6. **DUA** — bloque `dua` + fecha.
7. **Fechas-de-Estado** — calcula `fechas_estados` (Parte 4) por expediente.
8. **Correlacionador/Redactor** — fusiona, valida (`total_pares == sum(cantidad)`), marca `pendientes`, escribe **`proformas_consolidado.json`** (Parte 6).

## Ola B — Ejecución (Agente Ejecutor-MCP)
Toma el JSON y **carga cada expediente** con el MCP (Parte 7), **en serie por expediente**, con **idempotencia** (consultar antes de crear). Puedes correr varios Ejecutores, uno por país/cliente, pero cada expediente se procesa de forma atómica.

**Reglas comunes:** índice compartido; deduplicar por ruta y `message-id`; **citar fuente** de cada dato; **nunca inventar** (ausente = `null` + `pendientes`); IDs (OC/PF/SAP/AWB/BL) **exactos**.

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
          "precio_mwt": 15.26, "precio_cliente": 18.23,            // ← del DOCUMENTO, no de la BD
          "subtotal_compra": 610.40, "subtotal_venta": 729.20 }
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
      // ⬆ subido_a_minio / storage_url / documento_id los llena la Ola B al subir cada archivo con documento_subir

      "origen_onedrive": "01 Ventas/01 Marluvas/01 M Costa Rica/01 M SONDEL/2026/2453-2026 PO 505107",
      "pendientes": [],
      "consola": { "expediente_id": null, "oc_id": null,
                   "expediente_accion": null,        // "creado" | "editado" | "ya_existia_completo"
                   "cliente_accion": null,           // "creado" | "editado" | "sin_cambios"
                   "operador_id": null,
                   "productos_acciones": [],         // [{sku, accion:"creado"|"editado"|"sin_cambios"}]
                   "nodo_id": null, "nodo_accion": null,
                   "sap_cargado": false, "estados_seteados": false,
                   "documentos_subidos": [], "errores": [] }   // ← lo llena la Ola B (upsert)
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

> ## ♻️ PRINCIPIO UPSERT (aplica a clientes, productos, nodos, expedientes, OC y SAP)
> **NUNCA crees algo que ya existe.** Para cada entidad: primero **consulta** (`*_listar`/`*_obtener`).
> - **Si existe:** NO lo crees. **Revísalo** (`*_obtener`), **compara** contra lo leído de los documentos y **edita** solo lo que falte o difiera (`cliente_editar`, `producto_editar`, `nodo_editar`, `expediente_edit_full_patch`, `sap_upsert`/`sap_editar`). Completa campos vacíos; no pises un dato bueno con `null`.
> - **Si NO existe:** créalo.
> - **Matching:** cliente por `razon_social`/`tax_id`; producto por `sku`; nodo por `codigo`/país; expediente por `numero_proforma`; OC por `numero_oc`; SAP por `numero_sap`.
> Registra en `consola{}` si cada entidad fue `creada` o `editada`.

### 7.1 Sesión — `mwt_whoami` (rol `admin`).

### 7.2 Cliente final + operador (upsert)
1. `cliente_listar(q="<cliente_final>")`.
   - **Existe** → `cliente_obtener(client_id)`, compara con lo leído y `cliente_editar(client_id, {campos faltantes/distintos})`. **No crear.**
   - **No existe** → `cliente_crear({razon_social, nombre_comercial, tax_id?, pais_iso2, tipo:"DISTRIBUIDOR", estado:"ACTIVO"})`.
   - Guarda `client_id`.
2. Operador:
   - `operado_por_mwt == true`: `cliente_listar(q="Muito Work Limitada")` → `operating_company_id` (si no existe, créalo una sola vez; normalmente ya existe).
   - directo: `operating_company_id = client_id`.

### 7.3 Productos (SKUs) (upsert)
- Para cada `sku` único: `producto_listar(q="<sku>")`.
  - **Existe** → `producto_editar(producto_id, {campos faltantes})` solo si hay datos nuevos (NCM, tallas, nombre). **No crear ni duplicar el SKU.**
  - **No existe** → `producto_crear({sku, nombre:nombre_producto, marca_id?, categoria?, costo_estandar:precio_mwt, precio_lista:precio_cliente, especificaciones:{ncm, tallas:[...], color}})`.
  - (Los precios del documento se aplican por LÍNEA en 7.5, no se pisan los del catálogo aquí.)

### 7.4 ¿Existe el expediente / OC?
- `expediente_listar(q="<numero_proforma>")` y `oc_listar(q="<numero_oc>")`.
  - **Existe** → NO crear. `expediente_obtener` + `expediente_lineas` para ver su estado; en 7.5 **edita** (no recrees) lo que falte con `expediente_edit_full_patch` (líneas/operador/forma de pago) y sigue con SAP/estados/documentos que aún no tenga.
  - **No existe** → créalo (7.5).

### 7.5 Crear (o editar si ya existe) el expediente + precios exactos
- **Si ya existía (7.4):** NO uses `expediente_crear`. Usa `expediente_edit_full_patch(expediente_id, {operating_company_id, forma_pago, lines_added/lines_updated})` para completar/corregir, y salta al paso 3 (precios) y siguientes (SAP/estados/documentos faltantes).
- **Si no existía:**
  1. (Opcional) `expediente_resolve_oc_preview(client_id, lines=[{sku, size:talla, qty:cantidad}])`.
  2. `expediente_crear(client_id, operating_company_id, forma_pago, credit_days_mwt, credit_days_cliente, po_number=<numero_oc>, ocr_payload={lines:[{sku, size:talla, qty:cantidad, unit_price:precio_cliente}]})`. Guarda `expediente_id` y `oc_id`.
3. **Fija precios del documento (siempre):** `expediente_lineas(expediente_id)` → `linea_id`; luego `lineas_actualizar_precios(updates=[{linea_id, unit_price_mwt:precio_mwt, unit_price_client:precio_cliente}])`. **Estos mandan, no los de la BD.**

### 7.6 Documentos — SUBIR TODOS los archivos reales a la nube (MinIO) ⚠️ obligatorio
**Los archivos NO se quedan en local.** Todo `.pdf`, `.docx/.doc` y `.xlsx/.xls` que encuentres en **OneDrive** y en los **adjuntos de correo** relacionados con el expediente (proforma, OC/PO, SAP, factura comercial Marluvas, BL/AWB, DUA, packing, cotizaciones, pago de impuestos) **debe subirse a la plataforma con `documento_subir`**. El backend lo almacena en **MinIO/S3** y devuelve un `storage_url`/`signed_url`; ahí queda el archivo, no en tu disco.

1. **Descarga primero** cada archivo a una ruta local temporal: los de OneDrive desde su carpeta; los de correo, **extrayendo el adjunto** del mensaje (.eml/IMAP) a un archivo. Esa ruta es el `file_path`.
2. **Sube cada archivo** (uno por archivo, no solo el zip):
   `documento_subir(file_path="<ruta local del archivo descargado>", kind=<tipo>, codigo="<nombre legible>", expediente_id, audience="MWT_INTERNAL")`
   donde `kind` ∈ `PROFORMA | OC | SAP | FACTURA | AWB | BL | DUA | PACKING_LIST | GUIA | PAGO_IMPUESTOS | COTIZACION_FLETE | OTRO`.
   - **Audiencia:** la **OC del cliente** y la **proforma del cliente** pueden ir `audience="CLIENT"`; costos, factura Marluvas, SAP y documentos internos `audience="MWT_INTERNAL"` (o `ADMIN_ONLY` para lo sensible). Los `CLIENT_*` no deben ver documentos internos.
3. **Verifica** que subió: guarda el `storage_url`/`documento_id` devuelto en `consola.documentos_subidos[]` y refleja `documentos[].storage_url` + `documentos[].subido_a_minio:true` en el JSON. Cruza con `documento_listar(expediente=expediente_id)` para confirmar que **todos** quedaron en la nube; lo que falte va a `pendientes` con su motivo.
4. **No dupliques:** si `documento_listar` ya muestra ese `kind`+`codigo`, no lo vuelvas a subir.
5. Proforma del **sistema** (generada por la consola, además de la del OneDrive): `proforma_generar(expediente_id, audience="CLIENT")` y `proforma_generar(expediente_id, audience="ADMIN_ONLY")`.
6. **AWB/BL y factura comercial Marluvas:** además de subirlos como documento, cárgalos como **artefactos** (paso 7.9 / 7.10) para que queden vinculados al lote/movimiento.

> Regla: **ningún archivo relacionado al expediente puede quedarse solo en local**. Si tiene que ver con la proforma/OC/PO/SAP, se sube a MinIO vía el MCP.

### 7.7 SAP
- Con `numero_sap`: `sap_analizar(expediente_id, file_path="<excel SAP>")`; luego `sap_confirmar(expediente_id, sap_id=<numero_sap>, fecha_fabricacion=<fecha_sap>, lineas_confirmadas=[{linea_id, qty_confirmada, unit_price:precio_mwt}], file_path="<excel SAP>")` (transiciona REGISTRO→PRODUCCION). Si ya no está en REGISTRO, usa `sap_upsert(...)`.
- **Varias OC/SAP por proforma:** crea un expediente por SAP y luego `expediente_fusionar([ids], label=numero_proforma)`.

### 7.8 Estados + fechas inicio/fin
1. Avanza con `expediente_avanzar_estado(expediente_id, fase_to=...)` en orden hasta `estado_inferido`, saltando estados con `aplica:false`.
2. `expediente_phase_durations_set(expediente_id, phase_durations={ "REGISTRO":{"start":inicio,"end":fin}, "PRODUCCION":{...}, ... })` con las fechas de `fechas_estados` (omite los `aplica:false`).
3. Verifica con `expediente_phase_durations_get` y `expediente_eventos`.

### 7.9 Nodos + recepción de lote + artefactos (AWB/BL + factura Marluvas)
1. `nodo_listar()`. Busca el almacén destino por `codigo`/país: **si existe**, úsalo (y `nodo_editar` solo si falta algún dato); **si no existe**, `nodo_crear({codigo, nombre, tipo:"ALMACEN", pais_iso2})`. Guarda `nodo_id`. **No crees nodos duplicados.**
2. Mercadería llegada (estado ≥ EN_DESTINO): `recepcion_crear(items=[{expediente_id, producto_id, talla, qty_asignada, nodo_id}], cost_lines=[{kind, amount, currency, fx_to_usd, source:"MANUAL", scope:{applies_to_all:true}}])`.
3. Artefactos: `builder_templates_listar()` para ver templates y campos; luego
   - `nodo_artefacto_crear(nodo_id, template_id, template_title="AWB/BL", data={...}, lines=[{expediente_id, producto_id, talla, qty}])` para **AWB/BL**.
   - `nodo_artefacto_crear(nodo_id, template_id, template_title="Factura Comercial Marluvas", data={...})` para la **factura Marluvas**.

### 7.10 Movimientos
1. `transferencia_crear(origen_id, destino_id, legal_context="NATIONALIZATION"|"INTERNAL"|..., lineas=[{producto_id, sku, size, qty_transfer, unit_cost:precio_mwt, unit_value:precio_cliente}], context_data={bl_awb_number:<awb|bl>})`. Guarda `transferencia_id`.
2. `transferencia_aprobar` → `transferencia_despachar` (+ `transferencia_editar({eta, dispatched_at, ref_tracking})`) → `transferencia_recibir(lineas=[{id, qty_received}])` → `transferencia_conciliar`.
3. Artefacto del movimiento: `transfer_artefacto_crear(transferencia_id, template_id, template_title, data, lines)`.

### 7.11 Costos / impuestos / gastos
- Por concepto del `dua`/cotizaciones: `transfer_costo_agregar(transferencia_id, kind, amount, currency, fx_to_usd, price_view="MWT", scope_json={applies_to_all:true})`.
  - **Impuestos CR (clientes en Costa Rica):** `DAI`, `IVA`, `LEY_6946`, `PROCOMER`, `TIMBRE_ARCHIVO`, `TIMBRE_AGENTES`, `TIMBRE_CONTADORES`.
  - **Gastos:** `FLETE`, `SEGURO`, `ALMACENAJE`, `AGENCIAMIENTO`, `MANIPULEO`, `CONSOLIDACION`, o `OTRO` (custom, usa `label`).
  - Costo de un expediente específico: `scope_json={"applies_to_all":false,"expediente_ids":[expediente_id]}`.
- `transfer_liquidar(transferencia_id, method="BY_VALUE")` → `transfer_factura_payload(transferencia_id)` (factura/remisión).

### 7.12 Pagos (entrante / saliente)
1. `pago_applicables(type="PRODUCTO"|"COSTO", transferencia_id=...)` → `applicable_id`.
2. (Opcional) `pago_dry_run(...)`.
3. `pago_registrar(expediente_id, monto, moneda, fecha, metodo:"TRANSFERENCIA_BANCARIA", tipo_pago:"COMPLETO"|"PARCIAL", referencia, aplicaciones=[{applicable_type, applicable_id, cantidad_producto?, monto_aplicado}], file_path="<comprobante?>")`. (IN = entrante cliente→MWT; OUT = saliente MWT→proveedor/costos.)
4. Nace en **borrador**; aplica con `pago_conciliar(pago_id)` (recién ahí impacta saldo/crédito).

### 7.13 Resultado
- Actualiza `consola{}` (`expediente_id`, `oc_id`, `sap_cargado`, `estados_seteados`, `documentos_subidos[]`, `errores[]`). Si algo falla, **registra y continúa** con el siguiente expediente.

---

# PARTE 8 — REGLAS DE ORO

1. **Upsert (idempotencia):** consulta SIEMPRE antes de crear. Si la entidad (cliente, producto/SKU, nodo, expediente, OC, SAP) **ya existe → revísala y edítala** (`*_editar`/`expediente_edit_full_patch`/`sap_upsert`), **no la dupliques**. Solo crea lo que de verdad falta. (Excepción: la consola **sí permite OC/PO duplicadas** entre proformas distintas; no deduplicar por PO entre proformas.)
2. **Operador:** `Muito Work Limitada` = operador, no cliente final → `operating_company_id` vs `client_id`.
3. **Precios del documento**, no de la BD (`lineas_actualizar_precios`).
4. **Fechas reales** por estado (correos/documentos); `inferida:true` si las estimas; `null`+`pendientes` si faltan; **continuidad** `fin(n)=inicio(n+1)`.
5. **Una línea por (SKU × talla)**; `total_pares == sum(cantidad)`.
6. **Nunca inventes** OC/PF/SAP/AWB/BL ni montos/fechas.
7. **Cita la fuente** de cada dato.
8. **Sube TODOS los archivos reales a la nube (MinIO)** con `documento_subir` — `.pdf/.docx/.xlsx` de OneDrive **y adjuntos de correo** (proforma/OC/PO/SAP/factura/BL/AWB/DUA/packing). **Ningún archivo del expediente se queda en local.** AWB/BL y factura Marluvas, además, como **artefactos**. Verifica con `documento_listar`.
9. Ante error del MCP: regístralo en `errores[]` y continúa; entrega resumen de cargados/fallidos.

---

# PARTE 9 — CHECKLIST

- [ ] `mwt_whoami` OK (admin).
- [ ] Cada proforma: correos leídos con **fechas** + `eventos` + `historia_resumen`.
- [ ] `fechas_estados` con inicio/fin por estado, continuos y citados/inferidos.
- [ ] `operador`/`cliente_final` correctos; `operado_por_mwt` definido.
- [ ] `lineas_producto` con `precio_mwt`/`precio_cliente` **del documento**; `total_pares == sum(cantidad)`.
- [ ] En consola: cliente(s), SKU(s), expediente con OC y líneas, **precios corregidos** con `lineas_actualizar_precios`.
- [ ] SAP cargado; fusión si varias OC/SAP.
- [ ] **TODOS** los archivos (.pdf/.docx/.xlsx de OneDrive y adjuntos de correo) **subidos a MinIO** vía `documento_subir`, ninguno solo en local; verificado con `documento_listar`. Proforma generada; AWB/BL y factura Marluvas como artefactos.
- [ ] Estados avanzados + **fechas inicio/fin** (`phase_durations_set`) verificadas.
- [ ] Nodo + recepción + costos; movimiento con costos/impuestos/gastos; pagos draft→conciliar.
- [ ] `consola{}` por proforma.
- [ ] **REPORTE FINAL DE CIERRE (Parte 11)** generado: por cada proforma/OC indica cuántos expedientes, documentos subidos + rutas MinIO, SKUs y precios, operador, SAP, estado final, cliente, nodos, movimientos, costos/impuestos/gastos; + consolidado global y fallidos.

---

# PARTE 10 — ARRANQUE

1. **Conéctate al MCP** (Parte 0) y corre `mwt_whoami`.
2. **Ola A:** indexa correos (con **fechas**) + OneDrive; lee conversaciones, PDF, Word y Excel; parsea proforma y SAP; deriva `fechas_estados`; escribe `proformas_consolidado.json`.
3. **Ola B:** por expediente, ejecuta el Playbook (Parte 7) respetando idempotencia, operador, precios del documento y fechas de estado.
4. Entrega `proformas_consolidado.json` (con `consola{}`) + **el REPORTE FINAL DE CIERRE (Parte 11)**.

---

# PARTE 11 — REPORTE FINAL DE CIERRE (obligatorio)

Al terminar **toda** la lectura (correos + OneDrive) y **toda** la carga vía MCP, produce un **reporte de cierre**: (A) una ficha por cada proforma/OC indicando exactamente cómo quedó, y (B) un consolidado global. Entrégalo como **Markdown legible** y, además, como objeto `reporte_final` dentro del JSON.

## 11.1 Por cada expediente (proforma / OC-PO) reporta:

1. **Proforma / OC:** `numero_proforma`, `numeros_oc` (lista).
2. **Cuántos expedientes** se crearon/editaron para esa proforma (1, o N si hubo varias OC/SAP y **fusión**) + sus `expediente_id` y el `fusion_id`/label si aplica.
3. **Acción:** por expediente, si fue `creado`, `editado` o `ya_existía_completo` (mismo para cliente/productos/nodos).
4. **Cliente final:** nombre + `client_id`.
5. **Operador:** nombre + `operating_company_id` + `operado_por_mwt` (true/false). (Recuerda: `Muito Work Limitada` = operador, cliente final = otro.)
6. **Número(s) de SAP** cargados + si transicionó a PRODUCCION.
7. **Estado final** en que quedó el expediente + las **fechas inicio/fin** de cada estado seteadas.
8. **SKUs** (lista) con **`precio_mwt` y `precio_cliente`** efectivamente cargados (los del documento), cantidad y talla.
9. **Documentos subidos a MinIO:** cuántos y la **lista con tipo + ruta/`storage_url` + `documento_id`** de cada uno (proforma, OC, SAP, factura Marluvas, BL/AWB, DUA, packing…). Marca los que faltaron.
10. **Nodos:** nodo(s) usados/creados (`nodo_id`, código) y la **recepción de lote** (qty por SKU/talla) + **artefactos** subidos (AWB/BL, factura comercial Marluvas).
11. **Movimientos:** `transferencia_id`, origen→destino, estado final del movimiento, tracking BL/AWB.
12. **Costos / impuestos / gastos:** lista de cada concepto agregado al movimiento (`kind` + monto USD): DAI, IVA, Ley 6946, PROCOMER, timbres (impuestos); flete, seguro, almacenaje, agenciamiento… (gastos/costos). Incluye total.
13. **Pagos:** registrados (entrante/saliente) y si se **conciliaron**.
14. **Pendientes / errores:** lo que no se pudo cargar y por qué.

### Formato sugerido por expediente (Markdown)

```
### PF 2453-2026 · OC 505107 — quedó en TRANSITO
- Expedientes: 1 (EXP-…, creado) | Fusión: no
- Cliente final: Sondel S.A. (client_id …) | Operador: Muito Work Limitada (operating_company_id …, operado_por_mwt=true)
- SAP: 275155 (PRODUCCION confirmada) | Estado final: TRANSITO
- Fechas: REGISTRO 2026-05-28→06-02 · PRODUCCION 06-02→06-08 · DESPACHO 06-08→06-10 · TRANSITO 06-10→(abierto)
- SKUs (3): 701809 t37 x40 (mwt 15.26 / cli 18.23) · … · total 720 pares
- Documentos subidos a MinIO (5): PROFORMA→s3://…/… (doc_id …) · OC→… · SAP_275155.xlsx→… · FACTURA_Marluvas→… · AWB→…
- Nodo: ALM-CR (nodo_id …, creado) | Recepción: 720 pares | Artefactos: AWB/BL ✔, Factura Marluvas ✔
- Movimiento: TRF-… (ALM-CR→…) estado RECONCILED, tracking 230-6683-2102
- Costos/impuestos/gastos: DAI $… · IVA $… · Ley6946 $… · timbres $… · flete $… (total $…)
- Pagos: 1 entrante conciliado ($…)
- Pendientes: ninguno
```

## 11.2 Consolidado global

- Total proformas procesadas; **expedientes creados vs editados vs ya existentes**.
- **Documentos subidos a MinIO** (total) y faltantes.
- Clientes / productos(SKU) / nodos **creados vs editados**.
- Distribución **por estado final**, **por país**, **por cliente/operador**.
- Movimientos, total de **costos/impuestos/gastos** cargados, pagos conciliados.
- **Lista de fallidos** (proforma + motivo).

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
      "numero_sap": ["275155"], "estado_final": "TRANSITO",
      "fechas_estados_seteadas": true,
      "skus": [ { "sku": "701809", "talla": "37", "cantidad": 40, "precio_mwt": 15.26, "precio_cliente": 18.23 } ],
      "documentos": [ { "tipo": "PROFORMA", "storage_url": "…", "documento_id": "…" } ],
      "nodos": [ { "nodo_id": "…", "codigo": "ALM-CR", "accion": "creado", "recepcion_qty": 720 } ],
      "artefactos": [ "AWB/BL", "FACTURA_MARLUVAS" ],
      "movimientos": [ { "transferencia_id": "…", "estado": "RECONCILED", "tracking": "230-6683-2102" } ],
      "costos": [ { "kind": "DAI", "amount_usd": 0 }, { "kind": "IVA", "amount_usd": 0 } ],
      "pagos": [ { "pago_id": "…", "direction": "IN", "conciliado": true, "monto_usd": 0 } ],
      "pendientes": [], "errores": [] }
  ],
  "fallidos": [ { "numero_proforma": "…", "motivo": "…" } ]
}
```

> Imprime SIEMPRE el reporte de cierre al final, aunque haya errores: es la prueba de qué quedó cargado en la plataforma por cada proforma/OC.

---
---

# APÉNDICE A — Referencia rápida de herramientas (parámetros clave)

- **cliente_crear(datos)** — `razon_social, nombre_comercial, tax_id, pais_iso2, tipo (B2B|CONSUMIDOR|DISTRIBUIDOR), dias_credito, estado`.
- **producto_crear(datos)** — `sku, nombre, marca_id, categoria, costo_estandar, precio_lista, especificaciones{ncm,tallas,color}`.
- **lineas_actualizar_precios(updates)** — `[{linea_id, unit_price_mwt, unit_price_client}]`. Fija los precios EXACTOS del documento.
- **expediente_crear(...)** — `client_id, operating_company_id, forma_pago (CREDITO|CONTADO), credit_days_mwt, credit_days_cliente, po_number, ocr_payload{lines:[{sku,size,qty,unit_price}]}, file_path?`.
- **sap_confirmar(...)** — `expediente_id, sap_id, fecha_fabricacion, lineas_confirmadas:[{linea_id,qty_confirmada,unit_price}], file_path?`. (REGISTRO→PRODUCCION.)
- **expediente_avanzar_estado(expediente_id, fase_to)** — `REGISTRO|PRODUCCION|PREPARACION|DESPACHO|TRANSITO|EN_DESTINO|CERRADO`.
- **expediente_phase_durations_set(expediente_id, phase_durations)** — `{ESTADO:{start,end}}` (fechas inicio/fin).
- **recepcion_crear(items, cost_lines?)** — `items:[{expediente_id,producto_id,talla,qty_asignada,nodo_id}]`.
- **nodo_artefacto_crear / transfer_artefacto_crear** — `template_id, template_title, data{...campos...}, lines:[{expediente_id,producto_id,talla,qty}]`. (AWB/BL, factura Marluvas.)
- **transfer_costo_agregar(...)** — `kind (DAI|IVA|LEY_6946|PROCOMER|TIMBRE_*|FLETE|SEGURO|ALMACENAJE|AGENCIAMIENTO|MANIPULEO|CONSOLIDACION|OTRO), amount, currency, fx_to_usd, price_view (MWT|CLIENT), scope_json`.
- **pago_registrar(...)** → **pago_conciliar(pago_id)** — el pago solo impacta al conciliar.

---

# APÉNDICE B — MWT.ONE · Servidor MCP (guía completa de referencia)

Servidor MCP (Model Context Protocol) que expone la operación completa de la Consola MWT.ONE como herramientas para que un agente de IA externo (Antigravity, Kimi CLI, Claude Desktop, Cursor, etc.) opere sobre la plataforma vía su API REST. Autentica con un **token de servicio de larga vida (≈100 años)** generado contra el backend. No guarda estado local: cada herramienta es una llamada autenticada a `https://consola.mwt.one/api`.

## B.1 Qué puede hacer (87 herramientas)
(Tabla completa en la **Parte 1** de este documento: Clientes, Productos, OC/Expedientes, Documentos, SAP, Balanceo IA, Fusión, Proforma/Factura, Estados, Nodos, Inventario/Recepción, Movimientos, Costos/Impuestos/Gastos, Landed cost/Factura, Pagos, Builder, Salud.)

## B.2 Generar el token (sin vencimiento)
El backend incluye el comando `mint_mcp_token`. Córrelo **en el VPS** contra el contenedor `django` (firma con el `DJANGO_SECRET_KEY` de producción):

```bash
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
docker exec -i consola-mwt-one-django python manage.py mint_mcp_token \
  --email alejandro@muitowork.com
```

Salida (ejemplo):

```
== MWT.ONE — MCP service token ==
  usuario : alejandro@muitowork.com
  rol     : superadmin
  vida    : 36500 dias
  TOKEN (guardalo como MWT_MCP_TOKEN en el .env del MCP):
  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....<token largo>....
```

> Solo el token (sin banner): añade `--quiet`. Para revocarlo: rota `DJANGO_SECRET_KEY` o desactiva el usuario en `core.users`. Copia ese token: es tu `MWT_MCP_TOKEN`. (El token ya generado para esta operación está embebido en la Parte 0.)

## B.3 Instalar y correr el MCP

**Opción A — local (stdio):** Antigravity / Kimi CLI / Claude Desktop
```bash
cd mcp_server
pip install -r requirements.txt
export MWT_MCP_TOKEN="<pega-el-token>"
export MWT_API_BASE="https://consola.mwt.one/api"
python -m mwt_mcp          # arranca en stdio
```

**Opción B — por red (streamable-http / Docker):**
```bash
cd mcp_server
docker build -t mwt-mcp .
docker run -d --name mwt-mcp -p 8765:8765 \
  -e MWT_MCP_TOKEN="<pega-el-token>" \
  -e MWT_API_BASE="https://consola.mwt.one/api" \
  -e MWT_MCP_TRANSPORT=http \
  mwt-mcp
# Endpoint MCP: http://<host>:8765/mcp
```

Variables (`.env.example`): `MWT_API_BASE`, `MWT_MCP_TOKEN`, `MWT_MCP_TRANSPORT` (stdio|http), `MWT_MCP_HOST`, `MWT_MCP_PORT`, `MWT_HTTP_TIMEOUT`, `MWT_MCP_READONLY` (1 = solo lectura).

## B.4 Registrar en clientes de IA

**Antigravity / Claude Desktop / Cursor** (`mcpServers`):
```json
{
  "mcpServers": {
    "mwt-one": {
      "command": "python",
      "args": ["-m", "mwt_mcp"],
      "cwd": "/ruta/a/consola_mwt_one/mcp_server",
      "env": {
        "MWT_MCP_TOKEN": "<pega-el-token>",
        "MWT_API_BASE": "https://consola.mwt.one/api"
      }
    }
  }
}
```

**Kimi CLI:**
```bash
kimi mcp add mwt-one \
  --command python --args "-m,mwt_mcp" \
  --cwd /ruta/a/consola_mwt_one/mcp_server \
  --env MWT_MCP_TOKEN=<pega-el-token> \
  --env MWT_API_BASE=https://consola.mwt.one/api
```
(Para clientes que solo soportan HTTP, usa la Opción B y apunta a `http://<host>:8765/mcp`.)

> Si instalaste con `pip install "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"` (Parte 0), **omite `cwd`**: el módulo `mwt_mcp` ya es global.

## B.5 Flujo operativo de referencia
1. `cliente_crear` / `producto_crear` → catálogo.
2. `expediente_resolve_oc_preview` → `expediente_crear` (operador, líneas, forma de pago, plazos duales) → `lineas_actualizar_precios` (precios del documento) → `expediente_apply_pronto_pago`.
3. `documento_subir` (OC/PO) · `proforma_generar` · `sap_analizar`→`sap_confirmar` (o `match_subir`→`match_resolver`).
4. `expediente_fusionar` para agrupar varios SAP/operadores.
5. `expediente_avanzar_estado` / `expediente_phase_durations_set` (fechas de estado).
6. `nodo_crear` · `recepcion_crear` (expediente/SKU/talla/cantidad + costos + artefactos AWB/BL + factura Marluvas).
7. `transferencia_crear` → `transferencia_aprobar/despachar/recibir/conciliar`; `transfer_costo_agregar` (DUA/impuestos/gastos); `transfer_artefacto_crear` (AWB/BL); `transfer_liquidar`; `transfer_factura_payload`.
8. `pago_applicables` → `pago_registrar` (entrante/saliente, productos/costos) → `pago_conciliar` (recién ahí impacta saldos/crédito).

Empieza siempre con `mwt_whoami` para confirmar que el token está activo.
