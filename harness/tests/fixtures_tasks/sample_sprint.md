# Sprint 99 · Fixture — Cola de tareas (test)

## 1. Propósito
Sprint sintético usado por `test_tasks.py` para validar el parser de
`load_from_sprints`. No corresponde a ningún módulo real.

## 2. Auditoría de Backend
- [ ] **N+1 CONFIRMADO**: el serializer consulta por fila; reescribir con agregación en lote (Django queries).
- [ ] Añadir índice idempotente en `backend/sql/` para `linea(oc_id)`.
- [x] Endpoint `factura-payload` ya mide con EXPLAIN ANALYZE.

## 3. Auditoría de Frontend
- [ ] Envolver `Expedientes.jsx` en ErrorBoundary de ruta (React + Vite).
- [ ] Verificar que las métricas usan `tabular-nums` (cosmético, opcional).

## 4. Hallazgos y correcciones
- ✅ **CORREGIDO** — el N+1 del listado quedó en 5 queries totales.
- 🟢 **CERRADO** — cronograma-feed dentro de presupuesto.
- 🔴 Pendiente: fuga de visibilidad CEO→CLIENT en el chip de costo (crítico, bloqueante).
