# Sprint 02 · Clientes — Cuentas B2B y Límites de Crédito

## 1. Propósito
Gestión de clientes finales y entidades legales: datos comerciales, jerarquía padre-hijo, límites/banda de crédito (CreditBar) y el Portal B2B donde el cliente ve SOLO sus pedidos.

## 2. Mapeo Tecnológico
*   **Base de datos**: schema `clientes` (`30-33_clientes*.sql`, `33_clientes_parent_child.sql`), crédito (`B8_finance_credit_clock.sql`, `D6_expedientes_credit_days_dual.sql`).
*   **Backend**: apps `clientes`, `portal`; scoping CLIENT_* vía `ClientScopedManager`/`scoped_querysets`.
*   **Frontend**: `Clientes.jsx`, `ClienteDetail.jsx`, `ClienteFormView.jsx`, `Portal.jsx`, `PortalDiag.jsx`; `CreditBar` (tooltips diferenciados por rol — R3).

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] `clientes.*`: índice trigram/GIN para búsqueda parcial por razón social (Cmd+K y selectores).
- [ ] Cálculo de crédito usado: ¿se agrega en SQL o se itera expediente por expediente en Python?
- [ ] `clientesApi.list()` se llama desde MUCHAS pantallas (Expedientes, Cronograma, modales) — evaluar payload reducido (`?fields=` o select_ligero) y cache cliente.
- [ ] Hidratación por lotes en `load()` de Expedientes (un `clientesApi.get` por cliente único): proponer endpoint batch.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `ClienteDetail`: accesos anidados (`cliente?.especificaciones?...`) protegidos; loading/error explícitos.
- [ ] `Portal.jsx`: al navegar rápido Portal↔Expedientes no debe quedar estado stale del cliente anterior.
- [ ] Selectores de cliente (modales export/wizard): degradación sin crash si el fetch del catálogo falla.

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** lista todas las pantallas que llaman `clientesApi.list()` y la frecuencia real al navegar.
2. **Backend** propone endpoint liviano `clientes/select/` (id+nombre) y/o batch `?ids=`.
3. **SQL** valida índices para los filtros del listado y la búsqueda parcial.
4. Cierre: Frontend confirma reducción de llamadas y latencia; documenta aquí.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (WAVE A)** — `get_subsidiarias_count` + `get_expedientes_activos` + consumo de crédito ahora se precomputan en 3 queries TOTALES (`_build_cliente_list_batches` en views.py: Count por parent_id, expedientes activos con réplica exacta del filtro, y el MISMO SQL del modelo con `GROUP BY` pool) con fallback por-fila.
- ✅ **CORREGIDO (WAVE B)** — `Clientes.jsx`: `CLIENTS = Array.isArray(apiClients) ? apiClients : []` blinda reduce/filter/memos.
- ✅ Mitigado transversalmente: ErrorBoundary por ruta + `signal` disponible en `apiFetch` (sprint 01).
