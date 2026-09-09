# Contrato · módulo `storage` — Storage

- **Categoría:** ALMACEN
- **Descripción:** Subida/descarga de archivos a MinIO (artefactos y documentos).

## Frontend
- `frontend/src/components/`
- `frontend/src/pages/`

## Backend
- `backend/apps/storage/`

## Tools MCP (tool → acción RBAC)
  - `storage_subir_archivo` — create
  - `artefacto_archivo_descargar` — download_doc

## Flujos operativos

### Storage (MinIO)
```
    storage_subir_archivo(...) → key MinIO
    artefacto_archivo_descargar(key) [URL firmada]
```
> Anti-patrones:
    - La key devuelta es la que persiste en storage_url del documento.


## Notas / anti-patrones
- storage_subir_archivo (storage.create) devuelve la key MinIO.
- artefacto_archivo_descargar usa storage.download_doc.

## Referencia completa de tools (docstrings)

### `storage_subir_archivo` — create
`def storage_subir_archivo(file_path: str, scope: str = "artifact-field/misc", filename: str | None = None) -> Any:`

Necesario para los CAMPOS DE ARCHIVO de un artefacto del Builder (AWB/BL pdf,
factura comercial Marluvas, etc.), porque nodo_artefacto_crear/transfer_artefacto_crear
solo mandan JSON. Flujo de 4 pasos:
  1) `storage_subir_archivo(file_path, scope="artifact-field/<field_id>", filename)`  → obtienes `key`.
  2) construye el valor del campo file dentro de `data[<field_id>]` como objeto:
     {"key": <key>, "url": "https://consola.mwt.one/api/storage/download/?key=<key>",
      "name": <filename>, "mime": <content_type>, "size": <size>}  (mínimo imprescindible: key)
  3) crea el artefacto con nodo_artefacto_crear / transfer_artefacto_crear pasando ese `data`.

### `artefacto_archivo_descargar` — download_doc
`def artefacto_archivo_descargar(key: str, ttl_minutes: int | None = None) -> Any:`

Útil para los CAMBOS de archivo de un artefacto del Builder (AWB/BL, factura),
evidencias de pago, etc.: obtienes el `key` desde el detalle/proyección y aquí
se firma una URL GET (léete) temporal. El backend valida el acceso según el key
(documentos respetan expediente+audience; otros activos, staff autenticado).
`ttl_minutes`: vigencia (default 15, máx 60). Si `key` es un objeto con la clave

