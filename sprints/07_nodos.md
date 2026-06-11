# Sprint 07 · Nodos — Distribución y Logística

## 1. Propósito
Nodos de distribución (almacenes/hubs por país): catálogo, detalle con stock y costos recibidos, artefactos del Builder por nodo y auditoría de cambios.

## 2. Mapeo Tecnológico
*   **Base de datos**: schema `nodos` (`10_nodos.sql`, `10b_relax`, `11_nodos_audit.sql`, `11b_nodos_artefactos.sql`, `B1/B2_nodos_builder_artifact*.sql`).
*   **Backend**: app `nodos`; endpoints `nodoAssignmentsApi.transferenciaCostosPorNodo`, builder artifacts API (`/api/builder/templates/`).
*   **Frontend**: `Nodos.jsx`, `NodoDetail.jsx` (tab Costos), `NodeInventoryGrid` (widget del Dashboard).

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] `transferenciaCostosPorNodo`: filas por (cost × exp × prod × talla) filtradas por `scope_json` — revisar si el filtro JSONB necesita índice GIN.
- [ ] Inventario por nodo (widget Dashboard): `inventory_coverage_by_node` — agregación en SQL, no en Python.
- [ ] Catálogo de nodos: payload pequeño y cacheable (se usa en selects de varios wizards).

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `NodoDetail` tabs: cambiar de tab cancela/ignora respuestas viejas.
- [ ] Widget `NodeInventoryGrid`: ya envuelto en SafeWidget — verificar empty states.
- [ ] Navegación Nodos → NodoDetail → atrás, rápida, sin estados cruzados.

## 5. Flujo de Trabajo Colaborativo
1. **SQL** perfila la query de costos por nodo con `EXPLAIN ANALYZE` (scope_json).
2. **Backend** ajusta el shape del response si el frontend solo usa subtotales.
3. **Frontend** confirma tiempos en NodoDetail/tab Costos.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (WAVE B)** — `Nodos.jsx`: KPIs derivan SOLO de los nodos reales del API; el valor sin fuente real muestra "—"; `NODE_INVENTORY` (mock) eliminado del cálculo y del import.
- ✅ **CORREGIDO (WAVE D)** — `E6`: índice GIN en `transfers.cost_line(scope_json)` (guardado por information_schema).
- 🟢 Catálogo de nodos pequeño: sin límite necesario (decisión cerrada).
