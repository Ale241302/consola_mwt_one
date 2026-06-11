# Creación 02 · Clientes — Cuentas B2B y Crédito

## Objetivo
Catálogo de clientes finales y entidades legales con jerarquía padre-hijo, datos comerciales (plazos, FOB, dirección, contacto) y límite/banda de crédito que alimenta el CreditBar y el reloj de crédito.

## Base de datos (schema `clientes`)
*   `clientes.cliente`: id uuid, razon_social, nombre_comercial, codigo, pais_iso2, direccion, email, telefono, dias_credito int, limite_credito numeric(14,2), credit_band varchar, parent_id uuid (jerarquía, index), is_active, timestamps. Índice trigram en razon_social (búsqueda parcial).
*   Auditoría: `clientes.cliente_audit` (quién/qué/cuándo).
*   SQL: `30_clientes.sql`, `31_clientes_audit.sql`, `32/32b_extensions+relax`, `33_clientes_parent_child.sql`.

## Backend (apps `clientes`, `portal`)
*   ViewSet CRUD completo (destroy = soft). Acción `select/` ligera (id+nombre) para dropdowns.
*   Crédito: endpoint que agrega consumo del pool EN UN SOLO QUERY (`client_id IN (...)`) — nunca cursor por cliente.
*   Scope: CLIENT_* solo ve su(s) entidad(es) (`filter_by_user_clients`).

## Frontend
*   **Ver registros**: `/clientes` — `Clientes.jsx`: tabla Zebra (razón social, país, crédito usado/límite con CreditBar, banda, estado), búsqueda por nombre, filtro por banda.
*   **Ver detalle**: `/clientes/:clienteId` — `ClienteDetail.jsx`: ficha + CreditBar (tooltip role-aware), subsidiarias, expedientes del cliente.
*   **Crear**: `/clientes/nuevo` — `ClienteFormView.jsx`: datos fiscales/comerciales, días de crédito, límite, padre opcional.
*   **Editar**: `/clientes/:clienteId/editar` — mismo FormView precargado (la ruta `/nuevo` va ANTES de `/:id` en el router).
*   **Eliminar**: modal de confirmación (advierte si tiene expedientes activos) → soft-delete.
*   Portal B2B: `/portal` — vista read-only de SUS pedidos (sin datos internos).

## Criterios de aceptación
- [ ] CRUD completo con validación de razón social y unicidad de código.
- [ ] CreditBar muestra consumo real agregado; CEO ve descomposición, CLIENT solo disponible (R3).
- [ ] Selector ligero `select/` usado por todos los dropdowns del sistema.
