"""
=====================================================================
MWT.ONE · apps.ai_hub
Agente responsable: [AG-BACKEND-API]

AI Hub — módulo conversacional MWT.ONE.
Cubre catálogos de gobernanza (Agentes / Skills / Instrucciones), hilos
de chat con anclaje multi-contexto, mensajes con snapshot de contexto,
adjuntos persistentes y telemetría append-only.

Tablas mapeadas (schema `ai`, gestionadas por A0_ai_module.sql):
    · ai.agent          → AiAgent
    · ai.skill          → AiSkill
    · ai.instruction    → AiInstruction
    · ai.thread         → AiThread
    · ai.thread_context → AiThreadContext
    · ai.message        → AiMessage
    · ai.attachment     → AiAttachment
    · ai.usage_log      → AiUsageLog
=====================================================================
"""

default_app_config = "apps.ai_hub.apps.AiHubConfig"
