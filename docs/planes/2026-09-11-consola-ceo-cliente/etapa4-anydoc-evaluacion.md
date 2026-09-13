# Etapa 4 · Evaluación comparativa de extracción documental (AnyDoc vs extractor MWT)

Fecha: 2026-09-13 · Motor MWT: `apps/correo/extraccion.py` (vivo en producción)

## 1. Objetivo

Cerrar el bullet de Etapa 4 «Procesamiento de correos/adjuntos y evaluación
comparativa AnyDoc» (plan §12) con evidencia real, no supuesta. El plan deja la
selección como decisión abierta (§14).

AnyDoc = [`github.com/firecrawl/anydoc`](https://github.com/firecrawl/anydoc):
librería en Rust (bindings Node/Python/WASM) que convierte Word, PowerPoint,
Excel, OpenDocument, RTF, EPUB, CSV y PDF a Markdown limpio, local y sin OCR.

## 2. Muestra autorizada

Carpeta real **`01 Marluvas`**: 2 206 archivos (1 259 PDF, 510 XLSX, 102 EML, 71
DOC, 37 XLS, 31 DOCX…), organizados por país/cliente/año (DUA, Factura, Guía,
OC del Cliente, Packing List, Proforma, SAP).

## 3. Método

Dos arneses reproducibles (semilla 42), sobre documentos reales:

| Arnés | Venv | Qué hace |
|---|---|---|
| `backend/scripts/eval_anydoc_extraction.py` | backend | Extractor MWT sobre 68 docs (30 pdf, 20 xlsx, 10 xls, 8 docx) |
| `backend/scripts/probe_anydoc.py` | anydoc | AnyDoc sobre 43 docs (15 pdf, 10 xlsx, 8 xls, 5 docx, 5 doc) |
| `backend/scripts/compare_anydoc_extract.py` | backend | Mismo motor de fechas sobre el texto de MWT y sobre el Markdown de AnyDoc |

Evidencia: `etapa4-anydoc-muestra.json`, `etapa4-anydoc-probe.json`,
`etapa4-anydoc-compare.json`.

## 4. Extractor MWT (baseline)

| Métrica | Valor |
|---|---|
| Documentos procesados | 68 |
| Con texto extraíble | 65 (95,6 %) |
| Sin texto (PDF escaneado) | 3 |
| Tiempo | 16,6 s (**≈ 0,24 s/doc**) |
| Fechas propuestas (tras ajuste) | 4 |
| Correctas (verificación manual) | **4 / 4** |

### 4.1 Hallazgo y corrección

La primera corrida dio 50 propuestas, en su mayoría **falsos positivos** por
subcadenas sin límites de palabra: «**Bl**oqueado»→BL_AWB, «Forma de **Pago**»→DUE,
«**llegada** a puerto»→ETA, «conocimiento de **embarque**»→ETD. Se reescribieron
las keywords como regex con límites de palabra y orden BL_AWB antes de ETD. Tras
el ajuste: 4 propuestas, 4/4 correctas. Regresión cubierta por el arnés.

### 4.2 Límites

- `.xls` y `.doc` legacy: **no parseables** (se omiten en producción).
- PDF escaneado/imagen: sin texto → requieren OCR/visión (no disponibles).

## 5. AnyDoc — ejecución real

`pip install firecrawl-anydoc` y conversión local de los documentos de la muestra.

### 5.1 Cobertura y velocidad (43 docs)

| Métrica | AnyDoc | Extractor MWT |
|---|---|---|
| Convertidos OK | **40 / 43** | 27 / 43 |
| Formatos legacy (`.xls`, `.doc`) | **13 / 13** | **0 / 13** |
| Necesitan OCR | 2 (PDF escaneados) | 3 sin texto |
| Error real | 1 (*Malformed*: DANFE) | 0 |
| Velocidad | **≈ 24 ms/doc** | ≈ 240 ms/doc |

### 5.2 Fechas (mismo motor, distinta entrada)

Sobre los mismos 43 documentos, alimentando el mismo `extraer_de_texto`:

| | Valor |
|---|---|
| Propuestas con texto MWT | 3 |
| Propuestas con Markdown AnyDoc | **9** |
| Docs donde **solo AnyDoc** ve la fecha | **3** |
| Docs con ambas | 0 |

Documentos que AnyDoc desbloquea (que el texto propio de MWT no lograba):

- `Invoice 2414-2026.pdf` → `DOCUMENTO 2026-02-11`
- `Carta Dian Mayo 2024.docx` → `DOCUMENTO 2024-06-18`
- `Carta de retraso hospital mexico 2023….doc` → `PRODUCCION` (un **`.doc` legacy** que MWT no puede leer)

### 5.3 Lo que **no** resuelve AnyDoc

- **Escaneados**: los mismos PDF sin texto fallan con `NeedsOcr`. Hay que optar
  por OCR alojado (Firecrawl Parse) — eso **sí** envía el documento fuera de la
  máquina. Muestra: `MWT_Proforma_2468-2026_Sondel v2.pdf`, `MELEXA …Or. Compra`.
- `Malformed` en un DANFE (PDF atípico).
- No hace seguimiento de correo, tareas ni actualización de expedientes (§10).

## 6. Decisión

**Adoptar AnyDoc como conversor de documentos → Markdown** dentro del pipeline,
**conservando** el motor de fechas/clasificación de MWT (que es lo que publica,
marca conflictos y crea tareas):

1. AnyDoc dobla la cobertura (40 vs 27) y es ~10× más rápido; elimina la deuda de
   `.xls/.doc` y mejora el texto de PDF/DOCX.
2. El valor está en la **conversión**, no en la extracción: el mismo motor de
   fechas sube de 3 a 9 propuestas con la entrada de AnyDoc.
3. **OCR alojado**: decisión aparte, condicionada a que el envío de documentos
   fuera del VPS sea aceptable. Recomendado solo para escaneados, con
   `FIRECRAWL_API_KEY` y registro de qué archivos salen.
4. Costo: local **gratis**; el OCR alojado tiene costo/red (a medir si se activa).

## 7. Qué quedó implementado (cierre Etapa 4)

- Extracción de fechas **desde adjuntos**, hoy con texto propio
  (`_to_text_payload`); se omiten `.xls/.doc` y escaneos.
- Clasificación **CONSULTA / PROPUESTA / CONFIRMACIÓN**; solo CONFIRMACIÓN
  dispara conflicto/revisión.
- «No hay fecha» → **tarea de insistencia** (día hábil +5).
- Precisión MES/RANGO → **tarea de reconfirmación** (día 25 del mes literal).
- Fecha confirmada → **artefacto Builder AWB/BL (ART-05)**: `ETD`→Fecha de
  Despacho, `ETA`→Fecha de Arrivo, `BL_AWB`→Tracking.
- Arneses `eval_anydoc_extraction.py`, `probe_anydoc.py`, `compare_anydoc_extract.py`.

**Siguiente paso propuesto (no bloqueante):** integrar `firecrawl-anydoc` como
convertidor en `extraer_de_adjuntos` (fallback cuando el texto propio es pobre),
con feature-flag; deja fuera de alcance el OCR alojado hasta que se apruebe.
