> **Documento histÃ³rico.** Refleja el estado del MCP en la fecha en que se escribiÃ³
> (los conteos de tools que aparecen abajo â€”99 / 105 / 125â€” quedaron obsoletos).
> Hoy el servidor registra **182** herramientas (169 @mcp.tool() Ãºnicos + 13 de
> presentaciÃ³n); un admin ve 182, el rol gente_mcp 177 y client_b2b 51.
> Fuente vigente: docs/rol-agente-mcp-propuesta.md. No se reescribe el cuerpo
> para preservar el registro.
# Plan — Investigación profunda: Aplicaciones MCP por cliente (multi-tenant aislado)

Fecha: 2026-08-14 · Solicitado por: Alejandro (MWT)

## Objetivo
Diseñar y auditar todo lo necesario para tener **una aplicación MCP por cliente** (cliente_id quemado),
con aislamiento total de información entre clientes, validación de pertenencia vía Authentik,
una aplicación admin sin restricción, golden examples para las IAs consumidoras, y paso a paso detallado.
Entregables: `.md` + `.docx`.

## Etapa 1 — Investigación / Auditoría (6 subagentes `explore` en paralelo, solo lectura)
1. **Backend_Auditor** — `backend/` local: modelo Cliente, RBAC, scoping por empresas del usuario,
   endpoints (`/api/clientes/`, `/api/portal/me/`), qué valida hoy y qué falta para filtro duro por cliente.
2. **MCP_Auditor** — `mcp_server/` local: server.py (99 tools), autenticación JWT/Authentik, resolución de
   identidad, filtrado por cliente por tool, brechas de fuga de datos.
3. **Frontend_Auditor** — `frontend/` local: flujo OIDC con Authentik, manejo multi-empresa, selector de empresa.
4. **VPS_Inspector** — SSH `root@187.77.218.102:2222`: `/opt/consola-mwt-one`, `/opt/mcp-gateway`
   (ContextForge + Authentik), nginx, docker-compose, versión desplegada vs local, configuración de
   `mcp.mwt.one` e `idp.mwt.one`.
5. **Authentik_Disenador** — diseño de providers/applications por cliente en Authentik, claims con
   cliente_id, grupos, validación de pertenencia, revocación al desactivar cliente.
6. **MCP_Investigador** — protocolo MCP (auth OAuth 2.1, RFC 8707), patrones multi-tenant,
   golden examples / few-shot para tools MCP, mejores prácticas anti-fuga.

## Etapa 2 — Redacción (1 subagente `coder`, stage-gate)
Sintetizar Etapa 1 en `investigacion_mcp_por_cliente.md`:
- Auditoría del estado actual (backend, MCP, frontend, VPS) con evidencia.
- Arquitectura objetivo: app MCP por cliente con cliente_id quemado + app admin.
- Protocolo de comunicación y validación end-to-end (Authentik → token → MCP → backend).
- Garantías anti-fuga (capas de defensa, qué pasa al desactivar/eliminar cliente).
- Golden examples de respuestas para múltiples casos.
- Paso a paso de implementación detallado.

## Etapa 3 — Conversión (1 subagente `coder`)
Convertir el `.md` final a `.docx` usando `md_to_docx.py` existente en el workspace.

## Reglas
- Ningún subagente de Etapa 1 modifica código (solo lectura/auditoría).
- Etapa 2 no inicia hasta validar los 6 reportes.
- Idioma: español.
