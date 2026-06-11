# Creación 10 · Communications — Notificaciones, Email y Tickets

## Objetivo
Comunicación del sistema: feed de notificaciones in-app (ActivityPanel/Badge), plantillas de correo transaccional (proformas, SAP, avisos al cliente) y tickets de soporte.

## Base de datos
*   `notifications.notification_log`: id, user_id (idx), tipo, titulo, payload jsonb, leida bool, created_at (idx DESC), is_active.
*   `email_templates.template`: id, codigo (unique), asunto, html, variables jsonb, is_active + audit.
*   `tickets.ticket`: id, codigo, user_id, asunto, estado (idx), prioridad, asignado_a, created_at, is_active. `tickets.mensaje`: id, ticket_id (idx), autor, cuerpo, adjuntos jsonb, created_at. Extras de email (`B5`).
*   SQL: `92/92b`, `91/91b`, `B4`, `B5`.

## Backend (apps `notifications`, `email_templates`, `tickets`)
*   Notificaciones: list con `?since=` (cursor) y límite default; marcar-leído EN LOTE (`POST mark-read {ids}`); creación interna desde otros módulos (transiciones, sync SAP).
*   Email: CRUD de plantillas + `preview/` (render con variables de prueba) + envío asíncrono (no bloquear el request del flujo que lo dispara).
*   Tickets: CRUD + hilo de mensajes (mensajes/adjuntos agregados en lote, no por ticket) + cambio de estado/asignación.

## Frontend
*   **Ver registros**: `/notificaciones` (tabla con tipo/fecha/leída), `/templates` (lista de plantillas), `/tickets` (tabla con estado/prioridad/asignado, filtros).
*   **Ver detalle**: `/tickets/:ticketId` — hilo de mensajes con adjuntos + responder; preview de plantilla en `/templates`.
*   **Crear**: “+ Nuevo ticket” (asunto, prioridad, mensaje inicial, adjuntos) — disponible también para CLIENT (widget flotante TicketWidget); “+ Nueva plantilla” FormView (código, asunto, HTML, variables).
*   **Editar**: plantilla (FormView precargado + preview); ticket: estado/asignado/prioridad.
*   **Eliminar**: plantilla y notificaciones con modal → soft-delete; ticket se CIERRA (no se borra).
*   Shell: `ActivityBadge` (contador) + `ActivityPanel` (panel del topbar) con polling suave, abortable y a prueba de fallos (nunca tumba el shell).

## Criterios de aceptación
- [ ] Marcar 50 notificaciones leídas = 1 request.
- [ ] Plantilla con preview fiel; envío no bloquea el flujo que lo origina.
- [ ] CLIENT crea/ve SOLO sus tickets; adjuntos via signed URL.
