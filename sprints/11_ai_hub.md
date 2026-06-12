# Sprint 11 · AI Hub — Chat, Skills y Gobernanza de Prompts

## 1. Propósito
Capa de IA del sistema: chat de agentes, ruteo de skills a LLM, gobernanza de prompts y los pipelines IA embebidos en flujos (analyze-sap-confirmation, document matchmaker, OCR DUA, finance ai_verdict).

## 2. Mapeo Tecnológico
*   **Base de datos**: `A0_ai_module.sql` (schema `ai_hub`), `91j/91k_skill_ocr_aduanas*.sql`, `96c_document_match_log.sql`; pgvector.
*   **Backend**: app `ai_hub` (`services.py`, `skill_routing_views.py`) — **ZONA SENSIBLE** per CLAUDE.md §11: cualquier cambio aquí exige eval cases + comparación de baseline antes de merge. También `expedientes/document_matchmaker.py` e `inventario/inbound_ocr.py`.
*   **Frontend**: `AIHub.jsx`, `AIChat.jsx`, `AIGovernance.jsx`.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] Llamadas LLM síncronas dentro de requests de usuario (analyze-sap, matchmaker): timeouts configurados y streaming/async donde aplique.
- [ ] Logs de matcheo (`document_match_log`): crecimiento e índices por documento/fecha.
- [ ] Embeddings pgvector: índices ivfflat/hnsw si hay búsqueda semántica en caliente.
- [ ] Reintentos ante fallos del proveedor LLM: backoff sin bloquear el worker.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `AIChat`: stream interrumpido al navegar → abortar y no dejar spinner eterno.
- [ ] Flujos IA embebidos (UploadDocumentModal → wizard de revisión): si la IA falla, el upload del documento NO debe perderse (ya sucede: doc primero, IA después — verificar).
- [ ] `AIGovernance`: edición de prompts con confirmación; nunca persistir borradores a producción sin gate.

## 5. Flujo de Trabajo Colaborativo
1. **Backend** inventaria todos los puntos donde un request de usuario espera a un LLM y mide p95.
2. **Frontend** define UX de espera/cancelación para cada uno.
3. **SQL** revisa volumen de logs IA y propone retención.
4. ⚠️ Regla dura: cualquier fix en `ai_hub/services.py`, `skill_routing_views.py`, `document_matchmaker.py` o `inbound_ocr.py` pasa por eval suite + baseline ANTES de commit.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- 🟢 **DESCARTADO (decisión CEO 2026-06-11)** — La optimización de `ai_hub/services.py` (sleep bloqueante) e `inbound_ocr.py` NO se necesita: el volumen actual no la justifica y la regla §11 (evals + baseline) hace el costo mayor que el beneficio. Se retira del backlog; el ErrorBoundary y los estados de error del frontend acotan el impacto. Reabrir solo si el p95 de esos flujos degrada la operación.
- ✅ **MITIGADO (WAVE C)** — Triage de excepts instrumentado: todo crash de frontend (render + window.onerror + unhandledrejection) ahora se PERSISTE en `analytics.client_error_log` (E6) vía `POST /analytics/client-errors/` — los errores silenciados dejan de ser invisibles. Los 482 `except Exception` del backend quedan catalogados por app (expedientes 58, finance 24, portal 16, inventario 15) para conversión progresiva a excepciones específicas; los del hot-path de listados ya quedaron neutralizados por los atajos batch (el fallback nunca corre en el list).
