# PROMPT — Scraping unificado MWT (Correos + OneDrive → expedientes)

> **Para:** Kimi K2 o Claude. **Modo:** **multi-agente** — varios sub-agentes que **leen en paralelo, se comunican y comparten un único Índice Maestro**.
> **Fuentes (LAS DOS son obligatorias):**
> 1. **Correos** (IMAP `alvaro@muitowork.com` o el backup `.eml/.mbox/.txt/.html` + adjuntos): los hilos entre **cliente, MWT, fábrica (Marluvas) y logística**. **Aquí está la HISTORIA de cada proforma** (qué pasó, cómo, cuándo se registró, cuándo empezó el envío, cómo se resolvió). **Hay que leer las conversaciones, no solo los asuntos.**
> 2. **OneDrive** (`01 Ventas/01 Marluvas/...`): carpetas por proforma con los archivos (HTML/PDF/XLSX, OC, **SAP en Excel**, BL/AWB, factura, DUA, packing, **cotizaciones de flete**).
> **Salida (una sola):** `proformas_consolidado.json` (corregido) **+ un `.zip` por número de proforma** con los archivos reales.
> **Destino:** crear expedientes en `consola.mwt.one` (`create-from-oc`). Formato estricto.

> 🔴 **NO basta con escanear OneDrive.** En la entrega anterior se leyó OneDrive pero los correos quedaron sub-utilizados. **Esta vez DEBES leer y resumir las conversaciones de correo por cada proforma** y reconstruir el historial de eventos con su narrativa y fechas.

---

## 0. Contexto del dominio

MWT importa calzado de seguridad **Marluvas** para clientes de Centroamérica/Colombia/Perú. El documento central es la **proforma** (`####-####`, ej. `2472-2026`), que corresponde a una **OC/PO del cliente** y se vuelve un **expediente** que avanza por fases:

`REGISTRO → PRODUCCION → PREPARACION → DESPACHO → TRANSITO → EN_DESTINO → CERRADO`

| Fase | Qué la dispara | Dónde se ve (sobre todo en CORREO) |
|---|---|---|
| REGISTRO | OC del cliente + proforma emitida | correo del cliente con la OC; carpeta Proforma/OC |
| PRODUCCION | **confirmación SAP de Marluvas** (con su **ticket/pedido**) | correo de Marluvas + **Excel SAP** |
| PREPARACION | consolidación / packing / **cotización de flete** | correos de logística + cotizaciones |
| DESPACHO | booking confirmado / salida de origen | correo de logística |
| TRANSITO | **AWB** (aéreo) o **BL** (marítimo) emitido | correo de logística / carpeta BL-AWB |
| EN_DESTINO | arribo / nacionalización (**DUA**) | correo aduana + carpeta DUA |
| CERRADO | entrega + pago | correo |

**Identificadores que encadenan todo** (claves de correlación entre correo y OneDrive): **OC/PO** (`PO 505107`, puede haber **varias por proforma**, ej. `OC 2548 + 2549`); **Proforma** (`2472-2026`); **Ticket/SAP Marluvas** (`275155`, puede haber varios); **AWB** (`230-6683-2102` + carrier) / **BL** (+ naviera) / **booking**.

> ⚠️ **Correcciones que ya venían bien y hay que mantener:** líneas **una por (SKU × talla)**; **archivos reales en `{proforma}.zip`**; `compra_mwt` con FOB+flete+seguro (CPT/CIP), no solo FOB.

---

## 1. Orquestación multi-agente (obligatorio)

Todos los agentes leen/escriben en un **Índice Maestro compartido** (una ficha por **proforma**). Cuando un agente halla un identificador (OC/PF/Ticket-SAP/AWB/BL/booking) que enlaza con otra ficha, lo anota para que el Correlacionador una.

1. **Agente Correos — Indexador** — recorre TODO el buzón/backup, lista cada correo (`message-id`, fecha, asunto, de/para, adjuntos) y detecta OC/PF/SAP/AWB/BL/booking por regex. **Agrupa los correos en hilos por proforma/OC** (un hilo ≈ una proforma).
2. **Agentes Correos — Lectura (N en paralelo)** — por cada proforma, **leen las conversaciones completas** (cuerpo + adjuntos) y reconstruyen:
   - **Historial de eventos** con narrativa: *qué pasó, cómo, cuándo quedó registrado, cuándo empezó el proceso de envío, cómo se resolvió* (incidencias, retrasos, cambios de cantidad, etc.).
   - El **ticket/pedido que da Marluvas** al confirmar (número SAP).
   - **Cotizaciones de flete** (aéreo y marítimo): monto, carrier/naviera, validez, condición (CPT/CIP/FOB).
   - Datos de envío: modo, AWB/BL, booking, carrier/naviera, ETA, origen/destino.
   - El **operador** de la operación (MWT como intermediario vs cliente directo).
3. **Agente OneDrive — Carpetas** — recorre `01 Ventas/01 Marluvas/<país>/<cliente>/<año>/<proforma> PO <po>/` y **lista/clasifica los archivos reales** por subcarpeta (`Proforma/`, `OC del Cliente/`, `SAP/`, `Factura/`, `Guia/`, `Packing List Detallado/`, `DUA/`, `Pago de Impuestos/`). Clientes sin subcarpetas (Colombia/Honduras/Guatemala): inferir tipo por nombre/extensión.
4. **Agente Proforma-HTML/XLSX (N en paralelo)** — parsea la **matriz de tallas** del HTML/XLSX de la proforma → `lineas_producto` por sku×talla (§2).
5. **Agente SAP-Excel** — abre los **Excel de SAP** (carpeta `SAP/` o adjuntos de Marluvas) y extrae: **ticket/pedido Marluvas**, líneas confirmadas (sku/talla/cantidad), fecha de confirmación, precios de compra (FOB) → alimenta `ticket_marluvas`, `compra_mwt` y valida contra las líneas de la proforma.
6. **Agente DUA** — de los documentos DUA (PDF/Excel) y correos de aduana, extrae el bloque `dua` (§3).
7. **Agente Empaquetador** — por proforma, **copia los archivos reales** (de OneDrive y adjuntos de correo) a `{proforma}/<tipo>/...` y genera **`{proforma}.zip`**.
8. **Agente Correlacionador/Redactor** — fusiona correo + OneDrive por proforma, resuelve conflictos (conserva ambos + `conflicto:true`), valida (`total_pares == sum(cantidad)`), marca `pendientes` y **escribe `proformas_consolidado.json`** (§3).

**Reglas:** índice compartido; **paralelo por lotes**; deduplicar por ruta y por `message-id`; **citar la fuente** de cada dato (carpeta/archivo o asunto+fecha+remitente del correo); **nunca inventar** (dato ausente = `null`, en `pendientes`); números (OC/PF/Ticket/AWB/BL) transcritos **exactos**.

---

## 2. Líneas de producto — UNA fila por SKU × talla (mantener)

Recorré la **matriz/curva de tallas** del HTML/XLSX y emití una fila por celda con cantidad > 0:

```json
{ "sku": "701809", "ref_cliente": null, "nombre_producto": "50B22-V-E-CPAP-CP",
  "descripcion": "Bota de amarrar...", "color": "Negro", "ncm": "6403.99.90",
  "talla": "37", "cantidad": 40,
  "precio_unitario_compra": 15.26, "precio_unitario_venta": 18.23,
  "subtotal_compra": 610.40, "subtotal_venta": 729.20 }
```
Reglas: `talla` obligatoria (si no aplica `"UNICA"`); `cantidad` int; precios float (sin `$`/comas); `nombre_producto` limpio y `descripcion` aparte; sin duplicados; `ref_cliente` si el cliente usa su referencia; validar `total_pares == sum(cantidad)`.

---

## 3. Esquema de salida `proformas_consolidado.json`

```jsonc
{
  "meta": { "generado_en": "2026-06-16", "fuentes": ["correos","OneDrive"],
            "total_proformas": 90, "correos_procesados": 0, "rango_fechas": ["",""] },
  "proformas": [
    {
      "numero_proforma": "2453-2026",
      "anio": 2026,
      "cliente": "Sondel S.A.",
      "cliente_tax_id": null, "cliente_email": null,
      "pais": "CR",
      "operador": "Muito Work (intermediario)",   // MWT intermediario | cliente directo
      "numeros_oc": ["PO 505107"],                 // LISTA (puede haber varias: ej. 2548 + 2549)
      "ticket_marluvas": ["275155"],               // ticket/pedido que da Marluvas (= SAP)
      "numero_sap": ["275155"],
      "marca": "Marluvas",
      "moneda": "USD",

      "modo_transporte": "AEREO",                  // AEREO|MARITIMO|TERRESTRE|null
      "awb": "230-6683-2102", "carrier": "COPA AIRLINES",
      "bl": null, "naviera": null, "booking": null,
      "origen": null, "destino": null, "incoterm": null,

      "cotizaciones_flete": [                       // de correos/archivos
        { "modo": "AEREO",    "monto_usd": 1033.19, "carrier": "COPA AIRLINES", "validez": "2026-05-20", "incoterm": "CPT", "fuente": "correo: asunto/fecha" },
        { "modo": "MARITIMO", "monto_usd": 480.00,  "naviera": "MAERSK",        "validez": null,         "incoterm": "CIF", "fuente": "..." }
      ],

      "total_pares": 720,
      "total_venta_usd": 13101.60,
      "compra_mwt": {                               // costo REAL de compra a Marluvas (CPT/CIP, no solo FOB)
        "fob_mercaderia_usd": 10370.10,
        "flete_factura_usd": 1033.19,
        "seguro_factura_usd": 37.55,
        "total_factura_usd": 11403.29,
        "incoterm_factura": "CPT"                   // CPT | CIP | FOB
      },
      "comision_pct": 0.00,

      "dua": {                                      // nacionalización (DDP) — de DUA/aduana
        "numero_dua": null, "fecha_dua": null, "tc_crc_usd": null,
        "flete_aereo_usd": null, "seguro_usd": null, "valor_aduana_cif_usd": null,
        "dai_usd": null, "ley_6946_usd": null, "iva_credito_usd": null, "timbres_usd": null,
        "costo_nacionalizado_sin_iva_usd": null, "costo_nacionalizado_con_iva_usd": null
      },

      "estado_inferido": "PRODUCCION",

      "lineas_producto": [ /* §2 — una por sku×talla */ ],

      "archivo_zip": "2453-2026.zip",
      "documentos": [
        { "tipo_documento": "PROFORMA",   "nombre_archivo": "...", "ruta_en_zip": "proforma/...",   "fuente": "onedrive" },
        { "tipo_documento": "OC_CLIENTE", "nombre_archivo": "...", "ruta_en_zip": "oc_cliente/...", "fuente": "onedrive" },
        { "tipo_documento": "SAP",        "nombre_archivo": "SAP_275155.xlsx", "ruta_en_zip": "sap/SAP_275155.xlsx", "fuente": "correo" },
        { "tipo_documento": "FACTURA",    "nombre_archivo": "...", "ruta_en_zip": "factura/...",    "fuente": "onedrive" },
        { "tipo_documento": "COTIZACION_FLETE", "nombre_archivo": "...", "ruta_en_zip": "otros/...", "fuente": "correo" }
      ],

      "eventos": [                                   // ← historial reconstruido del CORREO (narrativa + fechas)
        { "tipo_evento": "OC_EMITIDA",     "fase": "REGISTRO",   "fecha_evento": "2026-05-28", "inferida": false,
          "que_paso": "El cliente envió la OC PO 505107 con 720 pares.",
          "como": "Adjunto PDF de la OC en el correo del cliente.",
          "fuente": "CORREO", "correo_referencia": "asunto / fecha / remitente", "extracto": "..." },
        { "tipo_evento": "SAP_CONFIRMADO", "fase": "PRODUCCION", "fecha_evento": "2026-06-02", "inferida": false,
          "que_paso": "Marluvas confirmó el pedido y asignó ticket 275155.",
          "como": "Correo de Marluvas con Excel de confirmación.",
          "fuente": "CORREO", "correo_referencia": "...", "extracto": "..." },
        { "tipo_evento": "EMBARQUE",       "fase": "TRANSITO",   "fecha_evento": "2026-06-10", "inferida": false,
          "que_paso": "Se emitió AWB 230-6683-2102 por COPA AIRLINES; inicia el envío aéreo.",
          "como": "Correo de logística con la guía aérea.",
          "cuando_inicio_envio": "2026-06-10",
          "fuente": "CORREO", "correo_referencia": "...", "extracto": "..." }
        // ... incidencias/retrasos y CÓMO SE RESOLVIERON también van como eventos (tipo NOTA o el que aplique)
      ],
      "historia_resumen": "Resumen en 3-5 frases del ciclo de esta proforma según los correos: registro, producción, envío, incidencias y resolución.",

      "origen_onedrive": "01 Ventas/01 Marluvas/01 M Costa Rica/01 M SONDEL/2026/2453-2026 PO 505107",
      "pendientes": []
    }
  ],
  "indice_correos": [
    { "message_id": "...", "fecha": "2026-06-02", "remitente": "...", "asunto": "...", "proforma": "2453-2026", "oc_asociada": "PO 505107", "adjuntos": ["SAP_275155.xlsx"] }
  ],
  "resumen": { "por_estado": {}, "por_pais": {}, "por_cliente": {} }
}
```

`tipo_documento` ∈ `PROFORMA, OC_CLIENTE, SAP, FACTURA, AWB, BL, DUA, PACKING_LIST, GUIA, PAGO_IMPUESTOS, COTIZACION_FLETE, OTRO`.
`tipo_evento` ∈ `OC_EMITIDA, PROFORMA_REGISTRADA, SAP_CONFIRMADO, COTIZACION_FLETE, BOOKING, DESPACHO, EMBARQUE, ARRIBO, NACIONALIZACION_DUA, ENTREGA, PAGO_RECIBIDO, INCIDENCIA, NOTA`.
Fechas en `YYYY-MM-DD` (inferidas marcadas `inferida:true`).

---

## 4. Qué leer de los CORREOS por cada proforma (obligatorio)

Para **cada proforma**, abrí su hilo de correos y extraé:
1. **Ticket/pedido Marluvas** (número SAP que Marluvas devuelve al confirmar) + fecha de confirmación + Excel SAP adjunto.
2. **Cotizaciones de flete** aéreo y/o marítimo: monto, carrier/naviera, incoterm (CPT/CIP/FOB), validez.
3. **Datos DUA / nacionalización** (si llega correo de aduana): número DUA, fecha, TC CRC/USD, DAI, Ley 6946, IVA, timbres, costo nacionalizado.
4. **Operador** de la operación (¿MWT intermediario o cliente directo?).
5. **Historial de eventos** con su narrativa: **qué pasó, cómo, cuándo quedó registrado, cuándo empezó el proceso de envío, cómo se resolvió** cualquier incidencia (retrasos, faltantes, cambios de cantidad, problemas de aduana). Cada hecho = un objeto en `eventos` con `que_paso`/`como`/`fecha_evento` y **cita del correo**.
6. **AWB/BL/booking**, carrier/naviera, ETA, origen/destino.
7. Un **`historia_resumen`** de 3-5 frases del ciclo completo.

> Si un dato aparece **solo en el correo** y no en OneDrive (o viceversa), igual se incluye, citando la fuente.

---

## 5. Empaquetado de archivos (.zip por proforma)

Copia los **archivos reales** (de OneDrive **y adjuntos de correo**, incl. **Excel SAP** y **cotizaciones de flete**) a `{numero_proforma}/<tipo>/...`: `proforma/`, `oc_cliente/`, `sap/`, `factura/`, `bl_awb/`, `dua/`, `packing/`, `guia/`, `pago_impuestos/`, `cotizacion_flete/`, `otros/`. Comprime → **`{numero_proforma}.zip`**. Referencia `archivo_zip` + `documentos[].ruta_en_zip`. **NO** rutas absolutas de PC; `origen_onedrive` solo como ruta relativa de trazabilidad.

---

## 6. Compatibilidad con consola (`create-from-oc`)

Consola crea cada línea como `{ sku, size (=talla), qty (=cantidad), unit_price?, client_part_number? }`. Por eso:
- `lineas_producto` = **flat por sku×talla** (no agrupado).
- `numeros_oc` → PO(s) (quitar prefijo `PO `). Una proforma puede tener **varias OC**.
- `cliente` y `marca` → UUID en consola (entregá el **nombre** + `clientes_map.json`). El `client_id` real lo resuelve la consola.
- `ticket_marluvas`/`numero_sap` → se cargan como SAP del expediente/líneas.
- Consola **permite OC/PO duplicadas**: no deduplicar por PO.

---

## 7. Checklist antes de entregar

- [ ] **Se leyeron los correos** (no solo OneDrive): cada proforma tiene `eventos` con narrativa + `historia_resumen` citando correos.
- [ ] `ticket_marluvas` por proforma (del Excel SAP / correo de Marluvas).
- [ ] `cotizaciones_flete` (aéreo/marítimo) capturadas.
- [ ] `dua` completo cuando exista nacionalización.
- [ ] `operador` definido por proforma.
- [ ] `compra_mwt` con FOB+flete+seguro+total+incoterm_factura (CPT/CIP/FOB).
- [ ] `lineas_producto`: una fila por (sku, talla); `total_pares == sum(cantidad)`.
- [ ] `numeros_oc` como **lista**; `numero_sap`/`ticket_marluvas` como **lista**.
- [ ] **Excel SAP y cotizaciones de flete incluidos en el `.zip`** + `documentos[].ruta_en_zip`.
- [ ] Sin rutas absolutas; `indice_correos` para auditar el origen de cada dato.
- [ ] Nada inventado: huecos en `pendientes`.

---

## 8. Arranque

1. **Indexa correos** (Indexador) → hilos por proforma/OC. **Indexa OneDrive** (Carpetas).
2. **Lee las conversaciones** de cada proforma (Lectura) → eventos con narrativa, ticket Marluvas, cotizaciones, DUA, operador, envío.
3. **Parsea tallas** (HTML/XLSX) y **Excel SAP**.
4. **Empaqueta** los archivos reales en `{proforma}.zip`.
5. **Correlaciona correo + OneDrive, valida y escribe** `proformas_consolidado.json`, apendeando por proforma y manteniendo `indice_correos` al día.
