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
- 🔴 **PENDIENTE (bloqueo)** — `ai_hub/services.py:597-639` llamada a Anthropic con `time.sleep()` de backoff BLOQUEANTE dentro del request, sin async. ⚠️ Zona con eval-gate (§11 CLAUDE.md): el fix requiere eval cases + baseline ANTES de merge — no se toca en esta pasada.
- 🔴 **PENDIENTE (bloqueo)** — `inventario/inbound_ocr.py:99-139` (compartido con sprint 06): OpenAI síncrono timeout=60s.
- 🟡 **PENDIENTE (frontend)** — `AIChat.jsx`: abortar stream al navegar (adoptar `signal` de apiFetch).
- 🟢 482 `except Exception` en el backend (expedientes 58, finance 24, portal 16, inventario 15 los peores) — la mayoría defensivos en serializers; triage progresivo por módulo según §11 del repo.
