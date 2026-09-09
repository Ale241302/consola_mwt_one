# Skills-MCP — skills del MCP server por rol · módulo · permiso

Estructura generada a partir de la matriz real `core.roles.permissions` y el mapeo
`tool_rbac.TOOL_MODULES` del MCP server.

```
Skills-MCP/
  _contratos/<modulo>.md        # contrato por módulo (frontend+backend+tools)
  <rol>/<modulo>/<accion>/SKILL.md
  README.md
```

## Roles
- `superadmin` — Super Admin (131 skills)
- `admin` — Admin (CEO) (132 skills)
- `manager` — Manager (127 skills)
- `operator` — Operador (70 skills)
- `finance` — Finance (51 skills)
- `compras` — Compras (66 skills)
- `viewer` — Viewer (solo lectura) (52 skills)
- `client_b2b` — Cliente B2B (23 skills)

## Acciones (permiso → carpeta)
- `create` → `crear/` (crear)
- `view` → `leer/` (consultar/listar)
- `update` → `editar/` (actualizar/modificar)
- `delete` → `eliminar/` (eliminar/borrar)
- `upload_doc` → `subir-documento/` (subir un archivo/documento)
- `download_doc` → `descargar-documento/` (descargar un archivo/documento)
- `view_doc` → `ver-documento/` (ver/listar documentos)

## Herramientas globales (sin módulo, siempre visibles)
- `mwt_whoami`
- `mwt_health`
- `mwt_audit_write_registry`
- `tipo_cambio`

## Regenerar

```bash
python Skills-MCP/generar.py
```

Total de SKILL.md generados: **652**.
