# PROMPT — AUDITOR MWT (re-auditar y CORREGIR expedientes ya creados)

> **Para:** KIMI CLI (o Claude / Antigravity / Cursor).
> **Qué hace:** audita los expedientes que YA se crearon en `consola.mwt.one`, **detecta hallazgos** (talla "UNICA", "SIN-PO", SAP sin cargar, documentos rotos/sin archivo, códigos sucios, precios/cantidades mal, estados/fechas faltantes), **dice en qué PROFORMA / OC / PO están y cuál es el problema**, y los **corrige uno por uno** usando el material real de **OneDrive y correos** — sin recrear nada.
> **Modo:** multi-agente. Un **Orquestador** delega cada expediente a un **Operativo**; cada Operativo deja el expediente **completo y sin errores** y lo verifica.
> 🚫 **PROHIBIDO `expediente_crear` en este modo.** Solo se corrige lo existente.

---

# 0 · CONÉCTATE AL MCP `mwt-one`

## Instalación (una línea)
```bash
pip install "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```

## Registro (JSON estándar — Claude Desktop / Cursor / KIMI CLI)
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

## Registro (Kimi CLI directo)
```bash
kimi mcp add mwt-one \
  --command python --args "-m,mwt_mcp" \
  --env MWT_MCP_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjo0OTM1NDM1NjQ2LCJpYXQiOjE3ODE4MzU2NDYsImp0aSI6ImY4OTllMTEyODFjODRmZDI5ZGNjNGVhZDVlOWFhNDFlIiwidXNlcl91dWlkIjoiNTA3MmZjZTItZTY2ZS00YmY3LThmZDItNjIzY2ZkM2FmYWY2IiwiZW1haWwiOiJhbGVqYW5kcm9AbXVpdG93b3JrLmNvbSIsInJvbGUiOiJhZG1pbiIsIm1jcCI6dHJ1ZX0.yeS-5L0LNapR7E6FJuH8g0d2hPobeMwWoke-TqKTetk \
  --env MWT_API_BASE=https://consola.mwt.one/api
```

Verifica con **`mwt_whoami`** → `alejandro@muitowork.com`, rol `admin`. Si falla el token, **detente**.

---

# 1 · FUENTES DE VERDAD (de aquí sale la corrección)

La plataforma puede estar mal; **la verdad está en OneDrive y los correos**. Para cada expediente, lee y cruza:
- **Correos** (IMAP `alvaro@muitowork.com` / backup): hilos por proforma/OC; **fecha de cada correo** (cabecera `Date:`); ticket SAP, AWB/BL, DUA, operador.
- **OneDrive** `01 Ventas/01 Marluvas/<país>/<cliente>/<año>/<proforma> PO <po>/`: subcarpetas `Proforma/`, `OC del Cliente/`, `SAP/`, `Factura/`, `Guia/`, `Packing List Detallado/`, `DUA/`, `Pago de Impuestos/`.
- **PDF / Word / Excel**: OC (nº PO, fecha, líneas, precios), proforma (matriz de tallas + `precio_mwt`/`precio_cliente`), **SAP Excel** (ticket + líneas + FOB), BL/AWB, DUA.
- **Descarga cada archivo a una ruta local** — la necesitas para re-subirlo (`file_path`).

### Reglas que el dato correcto SIEMPRE cumple
- **Operador:** `Muito Work Limitada` es **cliente operador**; el cliente final es otro → `operating_company_id = Muito Work Limitada`, `client_id = cliente final`. Si opera el cliente, `operating_company_id = client_id`.
- **Tallas:** del calzado son reales (34-49), una **línea por SKU×talla**; en la línea van como label `"39"`, **nunca "UNICA"**. En el catálogo del producto van como **UUID** (`tallas_listar`).
- **Precios:** los de la OC/proforma/correo, no los de la BD. **`unit_price_mwt = unit_price_client`** salvo margen real → `total_price == qty × precio_cliente`.
- **Códigos limpios:** OC = `"503295"`, proforma = `"2228-2024"` (sin "PO"/"PF"/"Proforma"/"SAP"/filename). **Nunca "SIN-PO".** El sistema antepone PF/PO.
- **SAP:** si el documento/correo trae nº SAP, el expediente DEBE tenerlo cargado con su `.xlsx` y sus líneas.
- **Fechas de estado:** inicio/fin de cada estado salen de las fechas de correos/documentos (o un aproximado), hasta el estado actual.

---

# 2 · MULTI-AGENTE (orquestador + operativos)

1. **🧭 Orquestador** — inventaria los expedientes existentes y, **por cada OC/PO/proforma**, crea una **tarea** con su material de OneDrive/correo. Delega cada tarea a un Operativo. Lleva el tablero `pendiente → auditando → corrigiendo → verificando → hecho/rechazado`. Va **uno por uno**: no cierra un expediente hasta dejarlo completo y sin errores. Acumula los **hallazgos globales** para el reporte.
2. **⚙️ Operativos (N)** — cada uno toma UNA tarea de expediente y corre el **CHECKLIST (§3)** de punta a punta: detecta hallazgos, los corrige con el material real, re-verifica con el MCP, y reporta qué corrigió. No recrea; edita en sitio.

### Inventario inicial (Orquestador)
1. `mwt_whoami`.
2. Por cada cliente (Sondel, Muito Work Limitada, Comtek, Sonepar, Imporcomp, Procostumer, Magnesita, Agrofortres…): `cliente_listar(q="<cliente>")` → `client_id`; `expediente_listar(client=<client_id>)` → expedientes con `oc_codigos`/`proforma_codigos`/`sap_codigos`/`estado`.
3. Cruza con OneDrive/correo: arma la **ficha objetivo** de cada expediente (cliente, operador, SKUs+tallas+cantidades+precios, OC limpia, SAP, fechas de estado, rutas locales de archivos).

---

# 3 · CHECKLIST POR EXPEDIENTE (OC / PO / PROFORMA) — el Operativo lo completa entero

Por **cada** expediente, ejecuta y marca cada actividad `hecho / corregido / omitido(motivo)`:

```
[ ] 1.  CLIENTE existe        → cliente_listar/obtener; si falta, cliente_crear. Operador correcto (MWT vs cliente).
[ ] 2.  SKUs existen          → producto_obtener por cada SKU; si falta o sin tallas, producto_crear/editar con
                                 tallas UUID (tallas_listar) en `tallas` + `especificaciones.sizes` + NCM + producto_alias_crear.
[ ] 3.  EXPEDIENTE sin duplicar→ expediente_buscar(oc_number, proforma, client_id). Si hay >1 del MISMO, conserva el
                                 más completo; si son SAP/operadores distintos legítimos → expediente_fusionar.
[ ] 4.  CÓDIGO limpio         → revisa oc_codigos/proforma_codigos: nada de "SIN-PO", filename ni prefijos.
[ ] 5.  LÍNEAS correctas      → expediente_lineas: una por SKU×TALLA real ("39", nunca UNICA), cantidades = proforma.
[ ] 6.  PRECIOS               → lineas_actualizar_precios: = OC/proforma; total = qty × precio_cliente.
[ ] 7.  DOCUMENTOS (OC/Proforma) subidos y SANOS en MinIO (ver §4).
[ ] 8.  SAP                   → si hay nº SAP: sap_analizar→sap_confirmar(.xlsx + TODAS las líneas); si no está en
                                 REGISTRO, sap_upsert. Verifica con sap_obtener.
[ ] 9.  ESTADOS + FECHAS      → entra al detalle del SAP: avanza hasta el estado actual (expediente_avanzar_estado)
                                 y pon fecha INICIO y FIN de cada estado (expediente_phase_durations_set) según las
                                 fechas de los correos/documentos (o aproximado).
[ ] 10. LOTE/MOVIMIENTO (si ya llegó): nodo + recepción + artefactos AWB/BL + factura + movimiento + costos + pagos.
[ ] 11. RE-VERIFICA todo con el MCP (gate §5). Marca el expediente `hecho` solo si pasa.
```

Detalle de cada paso = el flujo normal del MCP (los "cómo" son los mismos que en el playbook de carga; aquí la diferencia es que **editas en vez de crear**).

---

# 4 · VERIFICACIÓN Y REPARACIÓN DE ARCHIVOS (clave)

Para cada expediente:
1. `documento_listar(expediente=<expediente_id>)` (y/o `oc=<oc_id>`).
2. Por cada documento revisa **`storage_url`** y **`file_size_bytes`**:
   - Si `storage_url = null` **o** `file_size_bytes = 0` (o el archivo está roto / no abre) → **bórralo**: `documento_eliminar(documento_id)`.
   - Luego **re-sube el archivo real** encontrado en OneDrive/correo:
     - OC del cliente → `match_subir(expediente_id, document_type="ART-01_OC", file_path="<oc.pdf>")` (o, si el expediente está en creación, el OC va con su `file_path`).
     - Proforma → `match_subir(expediente_id, document_type="ART-02_PROFORMA", file_path="<proforma>")` (con `documento_subir` usa `codigo="2228-2024"`).
     - SAP → dentro de `sap_confirmar`/`sap_upsert` con `file_path`.
     - BL/AWB, DUA, factura Marluvas, packing → `documento_subir(file_path, kind=<...>, codigo="<limpio>")` (+ artefacto con archivo cuando aplique).
3. **Re-verifica** con `documento_listar`: cada documento debe quedar con `storage_url ≠ null` y `file_size_bytes > 0`. Si falta el OC o la proforma y existe en OneDrive/correo → súbelo.
4. **Nunca dejes** un documento "registro antiguo / sin archivo": o tiene binario real o se borra.

---

# 5 · GATE DE AUDITORÍA A–J (el Operativo re-verifica con el MCP)

| # | Verifica | Con | RECHAZA si… | Corrige con |
|---|---|---|---|---|
| A | Cliente/operador | `cliente_obtener` | operador = cliente final cuando opera MWT | `expediente_edit_full_patch(operating_company_id, client_id)` |
| B | SKUs con tallas | `producto_obtener` | SKU sin `tallas`/`sizes` o inexistente | `producto_crear/editar` (UUID) + `producto_alias_crear` |
| C | Sin duplicado | `expediente_buscar` | >1 del mismo OC+proforma | conservar el completo / `expediente_fusionar` |
| D | Líneas | `expediente_lineas` | `size`="UNICA", faltan tallas, cantidades ≠ proforma | `expediente_edit_full_patch(lines_removed, lines_added por SKU×talla)` |
| E | Precios | `expediente_lineas` | `total_price ≠ qty × precio_cliente` o ≠ OC | `lineas_actualizar_precios` |
| F | SAP | `sap_obtener` | doc trae SAP y no está / líneas sin `sap` / sin ART-04 | `sap_analizar`→`sap_confirmar`/`sap_upsert` |
| G | Documentos | `documento_listar` | `storage_url=null`/`file_size_bytes=0` / falta OC o proforma | `documento_eliminar` + re-subir (§4) |
| H | Códigos | `oc_codigos`/`proforma_codigos` | "SIN-PO" / filename / prefijos | corregir código/po_number limpio |
| I | Estados+fechas | `expediente_phase_durations_get`, `expediente_eventos` | no llegó al estado actual / faltan fechas inicio-fin | `expediente_avanzar_estado` + `expediente_phase_durations_set` |
| J | Lote/movimiento | `inventario_artefactos_expediente`, `transferencia_obtener` | faltan si ya llegó | completar paso 10 |

Veredicto por expediente: **APROBADO** (todo A–J pasa) → `hecho`; **RECHAZADO** → corrige y re-audita. No se pasa al siguiente hasta APROBADO o registrar el motivo del rechazo.

---

# 6 · REPORTE DE HALLAZGOS (lo que pediste)

Mientras audita, el Orquestador acumula y, al final (y de forma incremental), entrega una tabla de **hallazgos por PROFORMA / OC / PO**:

```
## HALLAZGOS
| Proforma | OC/PO | Expediente | Problemas encontrados | Corrección aplicada | Estado |
|---|---|---|---|---|---|
| 2228-2024 | OC-AUTO | EXP-OC-AUTO | sin PO real; líneas en UNICA; OC sin archivo | PO=503xxx; 12 líneas por talla; OC re-subida | ✅ corregido |
| 2225-2024 | 503295 | EXP-PO 503295 | código con filename; SAP 178589 no cargado | código limpio; SAP confirmado con .xlsx | ✅ corregido |
| 2393-2025 | 504xxx | (no creado) | sin Excel en OneDrive | — | ⚠️ pendiente (falta fuente) |
```

Y un consolidado: total auditados, corregidos, pendientes (con motivo), y por tipo de hallazgo (UNICA, SIN-PO, SAP faltante, documento roto, código sucio, precios, fechas). **Di siempre en qué proforma/OC/PO está cada problema y qué se hizo.**

---

# 7 · ARRANQUE

1. Conéctate al MCP (`mwt_whoami`).
2. **Orquestador:** inventaria expedientes por cliente (`expediente_listar`) y cruza con OneDrive/correo → ficha objetivo por expediente.
3. **Por cada expediente (uno por uno):** delega a un Operativo → corre el CHECKLIST §3 → repara archivos §4 → pasa el GATE §5 → marca `hecho`. Registra los hallazgos §6.
4. Entrega el **reporte de hallazgos** (incremental y final). **Nunca uses `expediente_crear`**: este modo solo audita y corrige lo existente.
