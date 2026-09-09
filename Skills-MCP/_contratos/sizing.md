# Contrato · módulo `sizing` — Motor de Tallas

- **Categoría:** CATALOGOS
- **Descripción:** Matriz de tallas, equivalencias y corridas por familia/marca.

## Frontend
- `frontend/src/pages/SizingEngine.jsx`
- `frontend/src/components/marluvas/`

## Backend
- `backend/apps/sizing/`

## Tools MCP (tool → acción RBAC)
  - `tallas_listar` — view

## Flujos operativos

### Motor de tallas
```
    tallas_listar() → UUIDs de tallas para productos
    sizing.create/update para mantener el catálogo
```
> Anti-patrones:
    - Tallas dobles (33/34, 35/36, 45/46) existen en ops.tallas.
    - No inventes tallas: referenciá por UUID.


## Notas / anti-patrones
- tallas_listar usa sizing.view.
- Soporta tallas dobles (33/34, 35/36, 45/46) en ops.tallas.

## Referencia completa de tools (docstrings)

### `tallas_listar` — view
`def tallas_listar(tipo_producto: str = "calzado") -> Any:`

`{results:[{id, nombre, talla_base, br, eu, ...}]}`. **El `id` (UUID) es lo que se
pone en `producto_crear` (`tallas` y `especificaciones.sizes`)**; el `nombre`/`talla_base`

