# Sprint 10 · Communications — Notificaciones, Email y Tickets

## 1. Propósito
Comunicación interna y con clientes: feed de notificaciones (ActivityPanel), plantillas de correo transaccional y tickets de soporte con extras de email.

## 2. Mapeo Tecnológico
*   **Base de datos**: `92_notifications.sql` + `92b_audit`, `91_email_templates.sql` + `91b_audit`, `B4_tickets.sql`, `B5_ticket_email_extras.sql`.
*   **Backend**: apps `notifications`, `email_templates`, `tickets`.
*   **Frontend**: `Notificaciones.jsx`, `EmailTemplates.jsx`, `Tickets.jsx`, `TicketDetail.jsx`; `ActivityPanel`/`ActivityBadge` (`/api/analytics/activity/` — se monta en el shell, corre en TODAS las pantallas).

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] **ActivityPanel global**: ¿polling? ¿cada cuánto? Un feed pesado castiga TODA la app — limitar ventana + índice por `(created_at DESC)` y por usuario.
- [ ] Notificaciones: marcar-leído en lote, no un PATCH por item.
- [ ] Tickets: listado con filtros indexados (estado, asignado).
- [ ] Envío de email (proformas/SAP sync NOTIFY_CLIENT): no bloquear el request del flujo principal.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] El polling del ActivityBadge debe pausarse/abortarse al perder foco y NUNCA tumbar el shell si el endpoint falla (catch + badge silencioso).
- [ ] `TicketDetail`: hilos largos con scroll virtual o paginación.
- [ ] `EmailTemplates`: preview de plantilla con HTML sandboxeado (sin romper el layout).

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** mide la frecuencia real de `/analytics/activity/` durante 5 min de uso.
2. **Backend** ajusta ventana/since-cursor; **SQL** confirma índice del feed.
3. Cierre: navegación rápida con el panel abierto sin requests huérfanos.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (WAVE A)** — TicketListSerializer batcheado (`batch_msg_count` + catálogos reason/status a dict UNA vez en el list). El serializer de detalle (un solo ticket) quedó intacto por diseño.
- ✅ **CORREGIDO (WAVE A)** — `notification_log` con `?limit=` default 200, cap 1000.
- ✅ **CORREGIDO (WAVE B/D)** — `ActivityPanel` con `alive`+cleanup; índice `notification_log(created_at DESC)` en E6.
- ✅ `Notificaciones.jsx:76-82` valida `Array.isArray` antes de mapear (patrón correcto).
