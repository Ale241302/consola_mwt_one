# Etapa 4 · Evaluación comparativa de extracción documental (AnyDoc vs extractor MWT)

Fecha: 2026-09-13 · Estado del arte relacionado: `apps/correo/extraccion.py`

## 1. Objetivo

Cerrar el bullet de Etapa 4 «Procesamiento de correos/adjuntos y evaluación
comparativa AnyDoc» (plan §12) con evidencia real, no supuesta. El plan deja la
selección de AnyDoc como decisión abierta (§14: «Selección de AnyDoc tras
evaluación»).

## 2. Muestra autorizada

Se usó la carpeta real **`01 Marluvas`** (documentos operativos de MWT con
Marluvas): 2 206 archivos (1 259 PDF, 510 XLSX, 102 EML, 71 DOC, 37 XLS, 31 DOCX,
etc.), organizados por país/cliente/año con subcarpetas DUA, Factura, Guía,
OC del Cliente, Packing List, Proforma y SAP.

Muestra determinista (semilla 42), ver `etapa4-anydoc-muestra.json`:

| Extensión | Tomados |
|---|---|
| .pdf | 30 |
| .xlsx | 20 |
| .xls | 10 |
| .docx | 8 |
| **Total** | **68** |

## 3. Método

Arnés: `backend/scripts/eval_anydoc_extraction.py` (corre con el venv del
backend). Reutiliza **el mismo extractor de texto** que producción
(`apps.ai_hub.document_extractor._to_text_payload`: PyMuPDF → pypdf → openpyxl →
docx) y **el mismo motor de fechas** (`apps.correo.extraccion.extraer_de_texto`).
No hay caja negra: es exactamente el código que corre en el VPS.

Medimos: cobertura de texto por tipo, fechas detectadas (campo/precisión/tipo de
mención) y tiempo por documento.

## 4. Resultados medidos (extractor MWT, 100 % local)

| Métrica | Valor |
|---|---|
| Documentos procesados | 68 |
| Con texto extraíble | **65 (95,6 %)** |
| Sin texto (PDF escaneado) | 3 |
| Errores | 0 |
| Tiempo total | 16,6 s (**≈ 0,24 s/doc**) |
| Fechas propuestas (tras ajuste) | 4 |
| Correctas (verificación manual) | **4 / 4** |

Campos detectados: `ETD` ×3, `DUE` ×1. Precisión: `EXACTA` ×4.

### 4.1 Hallazgo principal de la evaluación (y corrección aplicada)

La **primera corrida** produjo 50 propuestas, en su mayoría **falsos positivos**
por coincidencia de subcadenas sin límites de palabra:

| Falso positivo | Causa | Ejemplo real |
|---|---|---|
| `BL_AWB` | substring `bl` | «**Bl**oqueado» (xlsx 262746) |
| `DUE` | substring `pago` / `due` | «Forma de **Pago**», documento aduanero «**DUE** 26BR…» |
| `ETA` | substring `llegada` | «90 días desde la **llegada** a puerto» |
| `ETD` | substring `embarque` | «conocimiento de **embarque**» (es BL) |

**Corrección** (`extraccion.py`): keywords reescritas como regex con límites de
palabra, sinónimos específicos y orden que prioriza `BL_AWB` sobre `ETD`. Tras el
ajuste, las 4 propuestas son correctas y desaparecen los falsos positivos de
proforma/bloqueado/términos de pago. Regresión cubierta por el arnés.

### 4.2 Límites confirmados

- **`.xls` y `.doc` legacy**: no parseables por los extractores actuales (se
  decodifican como binario). En producción se **omiten** en `extraer_de_adjuntos`.
- **PDF escaneado / imagen**: sin texto embebido → requieren OCR/visión, no
  disponibles (solo `DEEPSEEK` activo, sin visión). 3/68 en la muestra.

## 5. Comparativa con AnyDoc

**No se pudo correr AnyDoc en vivo**: no hay credenciales/API de AnyDoc en el
entorno y el proyecto no la integra. Inventar métricas suyas sería exactamente lo
que el plan prohíbe. Lo que sí queda listo es la **batería y el criterio**.

### 5.1 Batería lista para correr AnyDoc

1. Muestra: los 68 documentos de `etapa4-anydoc-muestra.json` + los 3 escaneados
   (justo el caso donde AnyDoc aportaría).
2. Verdad de referencia: anotar por documento los campos del plan (producción,
   BL/AWB, vencimiento, ETD/ETA) con fecha y precisión.
3. Métricas a comparar: exactitud por campo, cobertura en escaneados, latencia
   por documento y costo por 1 000 documentos.
4. Criterio de selección (§14): AnyDoc solo se adopta si gana en **escaneados y
   documentos complejos** sin perder exactitud, y si el envío de documentos fuera
   del VPS es aceptable para datos de MWT.

### 5.2 Decisión provisional (fundada)

**Mantener el extractor MWT** para texto nativo: es gratis, local (los
documentos no salen de la infraestructura), determinista y verificable
(4/4 correctas, 0,24 s/doc). **Reevaluar AnyDoc** cuando (a) se aporten
credenciales y (b) el cuello de botella sean escaneados/complejos — hoy el 95,6 %
se resuelve sin proveedor externo.

## 6. Qué quedó implementado (cierre Etapa 4)

- Extracción de fechas **desde adjuntos** (PDF/XLSX/DOCX/TXT), reusando el
  extractor del ai_hub; `.xls/.doc` y escaneados se omiten explícitamente.
- Clasificación **CONSULTA / PROPUESTA / CONFIRMACIÓN**; solo CONFIRMACIÓN
  dispara conflicto/revisión.
- «No hay fecha» → **tarea de insistencia** (día hábil +5).
- Precisión MES/RANGO → **tarea de reconfirmación** (últimos días del mes).
- Fecha confirmada → **artefacto Builder AWB/BL (ART-05)**: `ETD`→Fecha de
  Despacho, `ETA`→Fecha de Arrivo, `BL_AWB`→Tracking; «no hay fecha» deja nota
  pendiente solo si el campo está vacío.
- Arnés reproducible `backend/scripts/eval_anydoc_extraction.py`.
