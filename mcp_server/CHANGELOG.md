# MWT.ONE MCP — Changelog

Todos los cambios notables del servidor MCP `mwt_mcp` (y el backend que lo
soporta). Versionado con `__version__` en `mcp_server/mwt_mcp/__init__.py`.

Formato: [Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

## [1.0.0] — 2026-08-10

### Ola 3.9 — Operación (Ejes H2/H3/A8)
- Suite de tests completa: `redact.py`, `_safe_role`, `tool_rbac.py` (RBAC +
  fail-closed), `jwt_minter.py` (token exchange fail-closed), auditoría,
  contratos. **61 tests**.
- CI en GitHub Actions (`.github/workflows/mcp-ci.yml`): compila el paquete +
  corre los tests + sanity de mapeo de tools en cada push/PR que toque
  `mcp_server/`.
- Docker hardening (A8): contenedor corre como usuario **no-root** (uid 10001,
  sin shell), chown de `/app`; `MWT_MCP_READONLY=1` como kill-switch.

### Ola 3.8 — Skills y documentación (Eje G)
- Skill `mwt-operations` (`harness/canonical/skills/mwt-operations/SKILL.md`):
  manual del operador con flujos, orden y anti-patrones.
- `SECURITY.md` del MCP: autenticación, 3 capas de protección, catálogo de
  campos redactados y procedimientos de respuesta ante incidentes.
- `examples/README.md`: 8 flujos end-to-end documentados.
- README mejorado a nivel antvis: diagrama de arquitectura, tabla de tools por
  dominio y tabla de permisos por rol.

### Ola 3.7 — Calidad y contrato (Ejes C1/C2/C5/D1)
- `campos` (proyección) extendido a las tools de detalle que faltaban.
- Validadores de contratos para dicts opacos (`schemas.py`).
- Errores con `hint` accionable (`_err_hint`).
- `mwt_health` ampliado: token, DB, Redis (`GET /api/auth/system-health/`).

### Ola 3.6 — Auditoría durable y diagnóstico (Ejes A3/A4/D2/D5)
- Persistencia en `core.mcp_audit` vía `POST /api/auth/mcp-audit/` (writes +
  reads sensibles).
- Throttle por usuario (mcp-token/audit/diag/health).
- `mwt_whoami` enriquecido (`mwt_rbac`).
- `mwt_diag_scope(email|user_id)` CEO-only.

### Ola 3.5 — Redacción por rol (Eje B)
- `redact.py`: catálogo CEO_ONLY/B2B + `_strip` recursivo.
- `_safe_role`: frontera de errores + redacción; 96 tools de negocio migradas.

## [0.9.0] — Antes de la Ola 3.5 (histórico)
- RBAC por rol en `list_tools` + fail-closed de identidad (Ola 2).
- Token exchange OAuth→JWT con identidad real (`jwt_minter.py`).
- `write_tool` guard estructural + auditoría JSON a stderr.
- Paginación/proyección (`campos`) + schemas Pydantic iniciales.
- Split por dominio (comercial|logistica|finanzas) y monolito `mwt-one`.
