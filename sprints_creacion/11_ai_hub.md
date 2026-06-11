# Creación 11 · AI Hub — Chat, Skills y Gobernanza

## Objetivo
Capa de IA: chat con agentes (threads persistentes), ruteo de skills a LLM, gobernanza de prompts/instrucciones, y los pipelines IA embebidos (matchmaker de documentos, OCR DUA, análisis de confirmación SAP, veredicto financiero).

## Base de datos (schema `ai_hub` + pgvector)
*   `ai_hub.agent`: id, nombre, modelo, system_prompt, is_active. `ai_hub.skill`: id, codigo, descripcion, config jsonb. `ai_hub.thread`: id, user_id (idx), agente_id, titulo, created_at. `ai_hub.message`: id, thread_id (idx), role, contenido, tokens, created_at.
*   Logs de pipelines: `document_match_log` (96c), `ocr_parsing_log`; embeddings pgvector con índice (ivfflat/hnsw) si hay búsqueda semántica.
*   SQL: `A0_ai_module.sql`, `91j/91k_skill_ocr_aduanas*`.

## Backend (app `ai_hub`)
*   `services.py`: cliente LLM con timeout + reintentos con backoff NO bloqueante; streaming hacia el frontend.
*   `skill_routing_views.py`: enruta solicitudes a la skill/modelo correcto.
*   CRUD de agentes/skills/instrucciones (gobernanza, ADMIN-only) y de threads/messages del usuario.
*   ⚠️ Regla del repo (§11): cambios en services/routing/matchmaker/ocr exigen eval cases + baseline antes de merge — construir la suite de evals DESDE EL DÍA 1.

## Frontend
*   **Ver registros**: `/ai` — `AIHub.jsx`: lista de threads del usuario + agentes disponibles.
*   **Ver detalle**: `/ai/chat/:threadId` — `AIChat.jsx`: conversación con streaming (abortable con `signal` al navegar), markdown render.
*   **Crear**: nuevo thread (elige agente) y nuevos mensajes; en gobernanza: “+ Nuevo agente / skill” FormView (nombre, modelo, prompt).
*   **Editar**: `/ai/governance` (CEO-only): editar prompts/instrucciones con confirmación y versionado.
*   **Eliminar**: thread propio con modal → soft-delete; agente/skill solo se desactiva.

## Criterios de aceptación
- [ ] Chat con streaming estable; navegar fuera aborta el stream sin spinner colgado.
- [ ] Gobernanza versionada: se puede ver qué prompt estaba activo en una fecha.
- [ ] Toda skill productiva tiene eval cases reproducibles antes de tocar producción.
