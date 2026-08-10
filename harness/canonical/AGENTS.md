# AGENTS.md — Consola MWT.ONE

> Instrucciones base **portables** para cualquier agente de IA (Claude Code,
> Gemini CLI, Kimi CLI o cualquier CLI compatible con MCP) que opere sobre este
> repositorio. Fuente canónica neutra de proveedor; deriva de `CLAUDE.md` y es la
> entrada del `sync` del harness. **Es un artefacto editable a mano.**
>
> Sigue el estándar AGENTS.md (Agentic AI Foundation / Linux Foundation): secciones
> en prosa, sin campos obligatorios, neutro de CLI. En monorepo aplica
> *nearest-file-wins*: el `AGENTS.md` más cercano al archivo editado gana.

---

## Identidad y propósito

**Consola MWT.ONE** es la plataforma interna de Muito Work Trading: gestiona
expedientes de importación, pipeline comercial, inventario, cobros, un portal B2B
para clientes y un AI Hub. Monorepo con cuatro superficies:

- `frontend/` — SPA React + Vite (UI ejecutiva de alta densidad de datos).
- `backend/` — Django + DRF + JWT (API + reglas de negocio). El esquema **no** lo
  gestiona Django (ver "SQL-first").
- `database/` + `backend/sql/` — esquema **SQL-first** (archivos `.sql` numerados e
  idempotentes; fuente de verdad del esquema).
- `mcp_server/` — servidor MCP (FastMCP) que expone la operación como tools.

Rama principal: `main`. Despliegue público: `https://consola.mwt.one`.

---

## Stack real (no aspiracional)

> Algunas instrucciones antiguas mencionan Next.js 14 + TypeScript + App Router.
> **Eso NO es lo commiteado en `main`.** No asumas Next.js ni App Router; migrar
> requiere un RFC explícito.

**Frontend:** React 18 (hooks, no clases), Vite 5 (dev `:5173`, build → `dist/`),
React Router DOM 6 (routing client-side, **no** App Router), Framer Motion,
Tailwind CSS (tokens MWT vía CSS variables), `xlsx` para export. Lenguaje **JSX**
(no TypeScript). Si se introduce TS, hacerlo por archivo (`.tsx`) con
`tsconfig.json` `strict: true`; nunca `any`.

**Backend:** Django 4 + DRF + SimpleJWT, ~24 apps en `backend/apps/`.

---

## SQL-first — NO hay migraciones Django (crítico)

Esto es **sagrado** y a menudo se malentiende:

- `MIGRATION_MODULES` está **desactivado**: las migraciones de Django no corren.
- Todos los modelos son `managed = False`: Django **no** crea ni altera tablas.
- **No hay foreign keys** en la base de datos. Las relaciones son campos UUID
  sueltos; la integridad referencial se aplica en la capa de aplicación.
- El esquema vive en `backend/sql/*.sql` — archivos numerados, aplicados en orden,
  **idempotentes** (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- Tenancy por `operating_company_id` (no `tenant_id`, no RLS). Cantidades en tablas
  nuevas: tipo `integer`.

**Para cambiar el esquema: NUNCA `makemigrations` / `migrate`.** Escribe un nuevo
`.sql` numerado e idempotente en `backend/sql/`, backward-compatible (el deploy es
rolling sobre un VPS único).

---

## Las 6 Reglas de Oro del Frontend

**R1 — Cero hex hardcodeados.** Prohibido `#013A57`, `rgb(...)` literales o
arbitrary values con hex. Usa solo tokens CSS de MWT (`--brand-primary`,
`--surface-raised`, `--text-primary`, `--border-subtle`, …) definidos en
`frontend/src/styles/`, expuestos en `tailwind.config.js`. **Violación = CRITICAL.**

**R2 — Tipado consistente (TS opcional, JSDoc obligatorio).** Documenta props con
JSDoc (`@typedef` + `@param`) en todo componente reutilizable de `components/`.
`propTypes` no basta. Si introduces TS, `strict: true`, nunca `any`.

**R3 — Aislamiento de visibilidad (`POL_VISIBILIDAD`).** La UI cambia según `role`
(viene de `/api/auth/me/`, cacheado en el contexto de auth). Los roles `CLIENT_*`
(Portal B2B) **NUNCA** ven gobernanza, precios de costo, márgenes, transiciones de
estado, logs de auditoría ni exposición financiera bruta. `ADMIN | CEO` ven todo.
Centraliza el gating (hook `useVisibility(scope)` o `<Visibility scope="CEO_ONLY">`).
**El dato sensible no debe llegar al DOM** (ocultar con CSS es violación).
**Violación = CRITICAL.**

**R4 — Arquitectura policy-driven (Expedientes).** El frontend **no decide** qué
artefactos mostrar: consume `artifact_policy` (array) del backend. Si el backend no
lo envía, no se renderiza. Nunca hardcodees la lista de artefactos.

**R5 — Tipografía de precisión.** Display: General Sans; Body: Plus Jakarta Sans;
Mono: JetBrains Mono (UUIDs, códigos, IDs). Toda métrica financiera, fecha o número
en tabla usa la clase `tabular-nums`.

**R6 — Impresión estricta (`POL_PRINT`).** Toda vista con "Imprimir" (proformas,
facturas, packing lists) incluye el bloque canónico `@media print` (ocultar
`.topbar`, `.sidebar`, `.actions`, `[data-no-print]`; `print-color-adjust: exact`;
`@page { margin: 12mm }`). Marca con `data-no-print` los controles interactivos.

---

## Componentes core (reutilización obligatoria)

Antes de crear, busca en `frontend/src/components/`: `ArtifactSection` +
`ArtifactModal` (leen `artifact_policy`), `CreditBar` (tooltips por rol),
`ActivityPanel` + `ActivityBadge`, tablas Zebra de alta densidad (patrón en
`03_ui_primitives.jsx`), Command Palette (`13_command_palette.jsx`, Cmd+K).

---

## Convenciones de mutación y caché

- Toda llamada a API pasa por `frontend/src/data/` (un fetcher por dominio).
- `POST`/`PATCH`/`DELETE` invalida o re-fetcha la query relacionada. No dejes UI
  con datos stale.
- Errores de API → `<ErrorState />`, nunca `alert()` ni solo `console.log()`.
- Loading states explícitos en cada botón de acción (`disabled` + spinner). Botón
  sin estado de loading es bug.

---

## i18n

Textos en `frontend/src/02_i18n.jsx`. Español por defecto, inglés como fallback.
Nunca strings literales en JSX para copy de UI: siempre `t('clave.de.texto')`.

---

## Backend — reglas duras

- Modelos `managed = False`; sin FKs; relaciones por UUID; tenancy por
  `operating_company_id`.
- Prohibido `except Exception` / `except:` ciego: exige excepción específica + log
  estructurado.
- Cambios en `backend/apps/ai_hub/` (y prompts/LLM en
  `document_matchmaker.py`, `inbound_ocr.py`) requieren eval cases + comparación de
  baseline antes de merge.
- `jsonb` crudo tras `connection.cursor()` puede llegar como string: aplica
  `json.loads` si es `str` antes de tratarlo como dict.

---

## Tools (MCP)

La operación se expone como tools MCP desde `mcp_server/` (FastMCP, 110 tools sobre
la API REST, redactadas por rol y auditadas en `core.mcp_audit`). Prefiere las
tools MCP `mwt.*` para leer/mutar datos de negocio
(expedientes, clientes, productos, inventario, pagos) en vez de tocar la API a mano.
El servidor se lanza con `python -m mwt_mcp` (transporte stdio por defecto) y
requiere `MWT_API_BASE` + `MWT_MCP_TOKEN` (token de servicio de larga vida).

---

## Comandos rápidos

**Frontend** (`cd frontend`): `npm install`, `npm run dev` (Vite `:5173`),
`npm run build` (→ `dist/`), `npm run preview`.

**Backend** (`cd backend`): `python manage.py runserver 0.0.0.0:8000`.
**NO** uses `migrate` / `makemigrations` (esquema SQL-first). Para aplicar esquema:
`docker exec -i consola-mwt-one-postgres psql -U mwt -d mwt_one < backend/sql/<archivo>.sql`.

**Stack completo (Docker):** `docker compose up -d --build`,
`docker compose logs -f django|frontend`.

---

## Skills del proyecto

- **`genera_ui`** — activa el "Gate de Componentes" (checklist de pre-commit) y
  entrega JSX/TSX completo con la ruta exacta del archivo como cabecera del bloque.
- **`revisa_ux`** — audita un componente buscando violaciones de R1–R6, falta de
  loading/error states, problemas de a11y y de visibilidad por rol.
- **`mwt-operations`** — manual del operador del MCP `mwt-one`: qué tool usar en
  cada flujo (expedientes, SAP, recepción, transferencias, liquidación, pagos),
  el orden correcto, anti-patrones y cómo leer los errores. Referencia:
  `mcp_server/README.md` §5–6 y `mcp_server/examples/README.md`.

Entrega: bloques de código con la ruta como header
(p. ej. `// frontend/src/components/expedientes/ArtifactSection.jsx`), listos para
aplicar al repo manualmente.

---

## Checklist antes de hacer commit

- [ ] Sin hex literales nuevos (R1).
- [ ] Todo dato `CEO_ONLY` aislado de la rama de render `CLIENT_*` (R3).
- [ ] Mutaciones invalidan caché o re-fetch.
- [ ] Botones de acción con `disabled` + loading.
- [ ] Métricas y montos con `tabular-nums`.
- [ ] Vistas imprimibles con el bloque `@media print` intacto.
- [ ] Expedientes siguen consumiendo `artifact_policy` (no hardcodeado).
- [ ] Sin strings de UI hardcodeados (i18n).
- [ ] Sin `console.log` en producción.

---

## Cosas que NO hacer

- ❌ `makemigrations` / `migrate` (esquema SQL-first).
- ❌ Introducir Next.js / Server Components / App Router sin RFC. El stack es
  Vite + React (JSX).
- ❌ Añadir librerías UI grandes (Material UI, Chakra, Ant Design). El sistema
  visual MWT es propio.
- ❌ Commitear `node_modules/`, `.env`, `dist/`, `pgdata/`.
- ❌ Dejar `console.log` en producción.
- ❌ Tocar `database/01_init.sql` ni `database/02_auth_admin.sql` sin coordinar
  (bootstrap del VPS).
- ❌ `git add -A` (el working tree tiene churn CRLF): stagear solo el archivo
  objetivo.
