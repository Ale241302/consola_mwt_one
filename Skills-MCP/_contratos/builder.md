# Contrato · módulo `builder` — MWT Builder

- **Categoría:** CORE
- **Descripción:** Gobernanza de plantillas del Builder externo (builder.muito.work). Solo operadores MWT.

## Frontend
- `frontend/src/pages/AIGovernance.jsx`
- `frontend/src/pages/AIHub.jsx`

## Backend
- `backend/apps/ai_hub/`
- `mcp_server/mwt_mcp/builder_client.py`

## Tools MCP (tool → acción RBAC)
  - `builder_artefacto_crear` — create
  - `builder_artefacto_eliminar` — delete
  - `builder_artefacto_editar` — update
  - `builder_structure_construir` — view
  - `builder_artefacto_listar` — view
  - `builder_artefacto_obtener` — view

## Flujos operativos

### MWT Builder (externo)
```
    builder_structure_construir(...)
    builder_artefacto_crear/editar/eliminar(...)
```
> Anti-patrones:
    - Habla con builder.muito.work, NO con la BD; solo operadores MWT (admin/superadmin).


## Notas / anti-patrones
- Solo admin/superadmin (module builder).
- tools builder_* hablan con el Builder externo, no con la BD.

## Referencia completa de tools (docstrings)

### `builder_artefacto_crear` — create
`def builder_artefacto_crear(title: str, secciones: list, status: str = "Published") -> Any:`

`title`: nombre de la plantilla (ej. "ART-05: AWB/BL").
`secciones`: especificación declarativa (misma forma que `builder_structure_construir`).
`status`: "Published" (default) | "Draft".
Construye el `structure_json` internamente y crea el artefacto. Devuelve el

### `builder_artefacto_eliminar` — delete
`def builder_artefacto_eliminar(artefacto_id: int) -> Any:`

(sin docstring)

### `builder_artefacto_editar` — update
`def builder_artefacto_editar(artefacto_id: int, title: str | None = None, secciones: list | None = None, status: str | None = None) -> Any:`

`artefacto_id`: id (entero). Pasa al menos un campo a cambiar:
`title`, `secciones` (spec declarativa → se reconstruye el structure_json)

### `builder_structure_construir` — view
`def builder_structure_construir(secciones: list) -> Any:`

a partir de una especificación declarativa de secciones/columnas/campos.

`secciones` = lista de dicts; cada uno:
  {"columnas": <int 1-4>, "permisos": {"view","edit"}, "campos": [
      {"type": "text|number|textarea|date|checkbox|file|select|radio|code",
       "label": "...", "options": ["a","b"],   # select/radio
       "value": <valor por defecto>,           # opcional (se ignora en la plantilla)
       "permisos": {"view","edit"}, "code": "..."}  # code: python
  ]}
`options` puede ser lista de strings o de dicts {id, label}.
Devuelve `{"sections": [...]}` listo para `builder_artefacto_crear`. Valida

### `builder_artefacto_listar` — view
`def builder_artefacto_listar(limit: int | None = None, offset: int | None = None) -> Any:`

(sin docstring)

### `builder_artefacto_obtener` — view
`def builder_artefacto_obtener(artefacto_id: int) -> Any:`

(sin docstring)

