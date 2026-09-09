# Contrato · módulo `nodos` — Nodos

- **Categoría:** ALMACEN
- **Descripción:** Nodos/almacenes y artefactos del Builder (AWB/BL, guías).

## Frontend
- `frontend/src/pages/Nodos.jsx`
- `frontend/src/pages/NodoDetail.jsx`

## Backend
- `backend/apps/nodos/`

## Tools MCP (tool → acción RBAC)
  - `nodo_crear` — create
  - `nodo_artefacto_crear` — create
  - `nodo_editar` — update
  - `artefacto_editar` — update
  - `artefacto_publicar` — update
  - `nodo_listar` — view
  - `nodo_obtener` — view
  - `nodo_artefactos_listar` — view
  - `builder_templates_listar` — view
  - `builder_template_obtener` — view

## Flujos operativos

### Nodos y artefactos de envío
```
    nodo_listar → nodo_obtener(id)
    nodo_crear({tipo, nombre, pais_iso2, ...})
    nodo_artefacto_crear(nodo_id, {tipo:'AWB'|'BL', nombre, data}) [fuente de tracking/carrier/ETD/ETA]
    builder_templates_listar() / builder_template_obtener(id)
```
> Anti-patrones:
    - El artefacto de envío del nodo es la fuente de verdad de tracking/carrier.
    - expediente_envio_backfill lee ese artefacto (no inventes tracking a mano).


## Notas / anti-patrones
- El artefacto de envío del nodo es fuente de verdad de tracking/carrier/ETD/ETA.
- builder_template_* y artefacto_* caen en nodos.*.
- artefacto_publicar(publicado=True) hace visible el artefacto (tracking/packing list) al client_b2b.

## Referencia completa de tools (docstrings)

### `nodo_crear` — create
`def nodo_crear(datos: dict) -> Any:`

(sin docstring)

### `nodo_artefacto_crear` — create
`def nodo_artefacto_crear(nodo_id: str, template_id: int, template_title: str, data: dict, structure_snapshot: dict | None = None, lines: list | None = None) -> Any:`

Primero lee la estructura con `builder_template_obtener(template_id)` (devuelve
`structure_json` con los campos: id, type, label). `data` se indexa por **field.id**
(ej. "field-0072") con estos valores según `type`:
  - text/textarea/code/date → string  (date = "YYYY-MM-DD")
  - number → número
  - select/radio → el **label** de la opción (ej. "awb", "aéreo", "USD"), NO el id
  - checkbox → booleano
  - file → objeto {"key": <key de storage_subir_archivo>, "url": "/api/storage/download/?key=<urlenc>",
                   "name": <archivo>, "mime": <content_type>, "size": <size>}
`structure_snapshot` = el `structure_json` del template tal cual.
`lines` = alcance [{expediente_id, producto_id, talla, qty}] (de

### `nodo_editar` — update
`def nodo_editar(nodo_id: str, cambios: dict) -> Any:`

Edita un nodo (PATCH parcial).

### `artefacto_editar` — update
`def artefacto_editar(nodo_id: str, artifact_id: str, cambios: dict) -> Any:`

`cambios` admite un subconjunto de: `data` (valores por field.id),
`structure_snapshot` (snapshot del template) y `lines`. Para el flag de
visibilidad cliente usa `artefacto_publicar`. Devuelve el artefacto completo

### `artefacto_publicar` — update
`def artefacto_publicar(nodo_id: str, artifact_id: str, publicado: bool = True) -> Any:`

Con `publicado=true` el artefacto se vuelve visible para clientes (roles
client_b2b) en el nodo; con `false` queda solo visible internamente.

### `nodo_listar` — view
`def nodo_listar(tipo: str | None = None, pais: str | None = None, status: str | None = None, q: str | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None) -> Any:`

`limit`/`offset`: paginación (default limit=50, máx 200).

### `nodo_obtener` — view
`def nodo_obtener(nodo_id: str, campos: str | None = None) -> Any:`

Detalle de un nodo. `campos`: lista separada por comas para proyectar.

### `nodo_artefactos_listar` — view
`def nodo_artefactos_listar(nodo_id: str, template_id: int | None = None, limit: int | None = None, offset: int | None = None, campos: str | None = None) -> Any:`

`limit`/`offset`: paginación (default limit=50, máx 200).

### `builder_templates_listar` — view
`def builder_templates_listar(only_published: bool = True) -> Any:`

Lista los templates de artefactos disponibles en el Builder (campos, tipos, opciones).

### `builder_template_obtener` — view
`def builder_template_obtener(template_id: int) -> Any:`

Obtiene la definición/estructura de un template del Builder por su id (entero).

