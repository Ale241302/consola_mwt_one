# Creación 07 · Nodos — Distribución y Logística

## Objetivo
Catálogo de nodos (almacenes/hubs por país) con detalle operativo: stock, costos de transferencias recibidas, artefactos del Builder y auditoría.

## Base de datos (schema `nodos`)
*   `nodos.nodo`: id, codigo, nombre, pais_iso2, tipo, direccion, contacto, is_active, timestamps.
*   `nodos.nodo_audit` (cambios) · `nodos.builder_artifact` + `builder_artifact_line` (plantillas/artefactos por nodo).
*   SQL: `10_nodos.sql`, `10b_relax`, `11/11b_audit+artefactos`, `B1/B2_builder*`.

## Backend (app `nodos`)
*   CRUD completo (soft-delete) + `select/` ligero para dropdowns de wizards.
*   `transferencia-costos-por-nodo` (filas por cost×exp×prod×talla filtradas por scope) y `inventory-coverage` (agregado para dashboard) — ambos agregados en SQL.

## Frontend
*   **Ver registros**: `/nodos` — `Nodos.jsx`: cards/tabla con nombre, país, unidades en stock, cobertura.
*   **Ver detalle**: `/nodos/:nodeId` — `NodoDetail.jsx`: ficha + tabs (Stock, Costos recibidos, Artefactos, Auditoría).
*   **Crear**: `/nodos` botón “+ Nuevo nodo” → FormView (código, nombre, país, tipo, dirección, contacto).
*   **Editar**: desde el detalle, mismo FormView precargado.
*   **Eliminar**: modal de confirmación (bloquea si tiene stock > 0) → soft-delete.

## Criterios de aceptación
- [ ] CRUD completo; el selector de nodos alimenta wizards de inventario y transfers.
- [ ] Tab Costos pagina/limita y no recalcula por celda.
- [ ] Nodo con stock no puede eliminarse (validación server-side con mensaje claro).
