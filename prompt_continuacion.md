# PROMPT DE CONTINUACIÓN — REMEDIACIÓN COSTA RICA (Muito Work) · consola.mwt.one

> **Para:** KIMI CLI / Claude / Antigravity
> **Alcance EXCLUSIVO:** Expedientes operados por **Muito Work Limitada** en **Costa Rica** (cliente final = Sondel S.A. u otro según la OC).
> **OneDrive:** `01 Ventas / 01 Marluvas / 01 M Costa Rica / 02 M Muito Work / <año> / <proforma>`.
> **Objetivo:** Completar y corregir los expedientes que ya existen y procesar los restantes, aplicando las soluciones para los campos `codigo` y el trigger de `product_count`.

---

# 0 · CONEXIÓN Y DESCARGA DEL MCP `mwt-one` (OBLIGATORIO)

> ⚠️ El paquete `mwt-mcp` debe reinstalarse de forma forzada para limpiar cualquier caché y contar con la nueva herramienta `documento_editar`.

```bash
pip uninstall -y mwt-mcp
pip install --no-cache-dir --force-reinstall "git+https://github.com/Ale241302/consola_mwt_one.git#subdirectory=mcp_server"
```

### Verificar la versión antes de empezar:
```bash
MWT_MCP_TOKEN=dummy python - <<'PY'
import asyncio; from mwt_mcp.server import mcp
req = {"expediente_buscar","expediente_editar","oc_editar","marca_listar",
       "producto_alias_crear","expediente_eliminar","documento_eliminar",
       "documento_editar","tallas_listar","expedientes_crear_lote"}
names = {t.name for t in asyncio.run(mcp.list_tools())}
falt = req - names
print("TOTAL TOOLS:", len(names))
print("FALTANTES:", falt or "ninguna ✅")
assert not falt, "MCP DESACTUALIZADO: vuelve a hacer el force-reinstall del PASO 0"
PY
```

---

# 1 · ROLES DE AGENTES (ORQUESTADO)

Para garantizar la máxima calidad en cada expediente, dividan el trabajo en tres roles senior:
* **🧭 Orquestador senior**: Arma la worklist de proformas CR·MuitoWork, las agrupa en **lotes de 10**, las entrega al Operativo en orden, lleva el checklist de estado, dispara el **email por lote** al cerrar cada ciclo y no avanza ningún expediente hasta que esté auditado y aprobado.
* **⚙️ Operativo senior**: Ejecuta el **checklist de remediación** paso por paso, lee OneDrive/correo, realiza los mapeos de SKU, crea los alias y llama a las tools del MCP correspondientes.
* **🔎 Auditor senior**: Re-verifica cada punto con el MCP contra las reglas del **Gate de Auditoría**. Si detecta fallos, devuelve al Operativo indicando la corrección necesaria; si pasa, aprueba y marca como `hecho`.

---

# 2 · RESILIENCIA Y HARNESS (REPL RESILIENTE)

El proceso debe correr sobre un loop de control por expediente para tolerar desconexiones de IMAP/MCP:
1. **READ por expediente**: Descarga y lee únicamente el material local y el hilo de correo de la proforma en proceso. Así, cualquier caída de red no compromete el progreso general.
2. **Reconexión Automática**: Si hay un fallo de socket o error de API, reintenta el mismo expediente hasta 5 veces reconectando el MCP e IMAP.
3. **Idempotencia**: Consulta antes de escribir (`expediente_buscar`, `expediente_lineas`, `documento_listar`, `transferencia_listar`) para no duplicar datos al reanudar.
4. **Resumen de Lote**: Al cerrar cada lote de 10, envía un correo a `alejandro@muitowork.com` con el resumen ejecutivo de lo completado y corregido.

---

# 3 · CHECKLIST DE REMEDIACIÓN (Operativo)

```
[ ] 1.  LOCALIZAR     → expediente_buscar(proforma) → expediente_id, oc_id. (NO crear).
[ ] 1b. RESPALDO REAL → Si no existe carpeta en OneDrive ni hilo de correo, es un EXPEDIENTE FANTASMA.
                         Llama a expediente_eliminar(expediente_id) y regístralo como borrado.
[ ] 2.  CABECERA      → expediente_obtener: operador=Muito Work (operating_company_id), cliente final correcto,
                         brand_id=Marluvas (marca_listar → expediente_editar + oc_editar), modo_operacion="COMISION".
[ ] 3.  CÓDIGOS       → Actualizar `codigo` de la OC a `po` (ej. "504990") vía `oc_editar` y `codigo` del expediente
                         a `f"EXP-{po}"` vía `expediente_editar`. (No enviar "po_number" porque la API lo ignora).
[ ] 4.  MATCH Part Nº → Resuelve cada Part No a producto MWT por ALIAS o por NOMBRE (§5-TER). Si es necesario,
                         crea el producto/tallas y registra el alias: producto_alias_crear.
[ ] 5.  LÍNEAS        → Quita la línea dummy "PENDING" (expediente_edit_full_patch lines_removed) y agrega una
                         línea por (producto×TALLA real) con las cantidades del documento real.
[ ] 6.  PRECIOS       → lineas_actualizar_precios([{linea_id, unit_price_mwt, unit_price_client}]) con valores reales.
[ ] 7a. LIMPIAR DOCS  → documento_listar(expediente=eid): si hay un documento OC con código "SIN-PO" u "OC-AUTO-...",
                         y tiene archivo (storage_url != null), edita su código al PO correcto usando `documento_editar(doc_id, {"codigo": po})`.
                         Si no tiene archivo (storage_url = null o file_size_bytes = 0), bórralo con `documento_eliminar`.
[ ] 7b. SUBIR OC      → Si falta el documento físico de la OC, haz documento_subir(kind="OC", codigo=po, expediente_id, oc_id, file_path, audience="CLIENT").
[ ] 7c. PROFORMA real → si está en OneDrive y falta, súbela: documento_subir(kind="PROFORMA", codigo=proforma, file_path=...).
[ ] 7d. PROFORMA sist.→ proforma_generar(expediente_id, audience="CLIENT"/"ADMIN_ONLY") SOLO después de cargar líneas.
[ ] 7e. OTROS DOCS    → BL/AWB, DUA, Factura Marluvas, Packing, Pago de Impuestos (documento_subir kind=...).
[ ] 8.  SAP           → sap_analizar(file SAP) → sap_confirmar(sap_id, fecha, lineas_confirmadas=TODAS, file_path).
[ ] 9.  ESTADOS       → expediente_avanzar_estado hasta el estado actual del expediente.
[ ] 10. NODOS         → Verificar Hub de entrada según método de envío (HUB-CR-AEREO/HUB-CR-MARITIMO) y Bodega del Cliente Final.
                         Si no existen en `nodo_listar`, créalos con `nodo_crear`.
[ ] 11. RECEPCIÓN     → recepcion_crear en el Hub de entrada con los SKUs y cantidades reales del expediente.
[ ] 12. MOVIMIENTO    → transferencia_crear(origen=Hub, destino=Bodega Cliente, legal_context="NATIONALIZATION").
                         Avanzar transferencia: aprobar → despachar → recibir → conciliar.
[ ] 13. COSTOS/DUA    → Agregar costos del DUA (FLETE, SEGURO, DAI, LEY_6946, IVA, Servicios aduanales) sobre el movimiento
                         vía transfer_costo_agregar y liquidar la transferencia: transfer_liquidar.
```

---

# 4 · LECCIONES DEL PILOTO: DETALLE DE SOLUCIÓN DE CÓDIGOS

* **PATCH en OC**:
  `M.oc_editar(oc_id, {"codigo": "504990"})` (Actualiza el PO de la OC).
* **PATCH en Expediente**:
  `M.expediente_editar(expediente_id, {"codigo": "EXP-2026-0005"})` o `M.expediente_editar(expediente_id, {"codigo": "EXP-504990"})` (Actualiza el código del viaje logístico).
* **Edición de Documentos**:
  La UI lee `oc_codigos` prefiriendo los códigos de los documentos tipo `OC` sobre los de la OC principal. Si el documento se subió inicialmente como `"SIN-PO"`, debes actualizarlo usando:
  `M.documento_editar(documento_uuid, {"codigo": po_number})`

---

# 5 · NODOS, TRANSFERENCIAS Y COSTOS DUA

### A. Estructura de Nodos en Costa Rica
- **Hub de entrada**: Bodega de nacionalización inicial.
  - Aéreo: `HUB-CR-AEREO` (Hub Aéreo Costa Rica).
  - Marítimo: `HUB-CR-MARITIMO` (Hub Marítimo Costa Rica).
- **Bodega Destino (Cliente Final)**: Bodega de entrega de Sondel S.A. u otro.
  - Ejemplo: `CR-SONDEL` (Sondel CR) -> Asociado al `client_id` real de la OC.

### B. Liquidación y Distribución de Costos (DUA)
Aplica los montos reales del DUA sobre la transferencia usando `transfer_costo_agregar` con los siguientes tipos (`kind`):
- `FLETE`: Flete internacional.
- `SEGURO`: Seguro internacional.
- `DAI`: DAI según NCM del calzado/plantillas.
- `LEY_6946`: Ley 6946 (1% CIF).
- `IVA`: IVA aduanal (13% sobre CIF+DAI+Ley).
- `OTRO` (con `label="Servicios aduanales"` o `label="Transporte terrestre"`): Gastos en destino.
Finalmente ejecuta `transfer_liquidar(transferencia_id, method="BY_VALUE")`.

---

# 6 · AUDITORÍA (Auditor)

El Auditor debe aplicar las siguientes reglas para aprobar y cerrar cada expediente:

| Gate | Verifica | Con | Rechaza si... |
|---|---|---|---|
| **A** | Operador y Cliente | `expediente_obtener` | Operador no es Muito Work, o el cliente final es Muy Work (debe ser Sondel S.A. u otro de la OC). |
| **B** | Códigos de PO | `oc_codigos` / `codigo` | Sigue saliendo `"SIN-PO"` en `oc_codigos` (olvidaste hacer `documento_editar` sobre el PDF de la OC). |
| **C** | Líneas reales | `expediente_lineas` | Queda la línea dummy `"PENDING"` o `"TBD"`, o faltan tallas de la matriz de la proforma. |
| **D** | Precios y Totales | `expediente_lineas` | `total_price` no coincide con la cantidad por precio cliente o el FOB total de la OC. |
| **E** | Documentos | `documento_listar` | Falta adjuntar la OC original, la proforma o el SAP, o hay documentos duplicados huérfanos. |
| **F** | Movimiento y Nodos| `transferencia_listar` | No se creó la transferencia de Hub al cliente final, o no está en estado `CONCILIADO` / `LIQUIDADO`. |
| **G** | Costos DUA | `transfer_costos_listar` | No se aplicaron los costos del DUA o no se corrió la liquidación del movimiento. |

`APROBADO` -> Marca el expediente como `hecho` en el estado JSON.
`RECHAZADO` -> Devuelve al Operativo con las correcciones requeridas.
