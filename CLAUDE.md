# CLAUDE.md — Consola MWT.ONE

> Manifiesto operativo para agentes (Claude / Claude Code / Cowork) que trabajen sobre este repositorio.
> **Léeme antes de tocar nada.** Este archivo es la fuente de verdad sobre el stack, las reglas y los flujos del proyecto.

---

## 0. Identidad y propósito

**Consola MWT.ONE** es la plataforma interna de control de Muito Work Trading (MWT) — gestiona expedientes de importación, pipeline comercial, inventario, cobros, portal B2B para clientes y un AI Hub. Monorepo con:

- `frontend/` — SPA React + Vite (UI ejecutiva, alta densidad de datos)
- `backend/` — Django + DRF + JWT (API + reglas de negocio). **El esquema NO lo gestiona Django** (ver §1).
- `database/` + `backend/sql/` — **esquema SQL-first**. `database/01_init.sql` + `database/02_auth_admin.sql` son el bootstrap; `backend/sql/*.sql` (≈50 archivos numerados e idempotentes) son la fuente de verdad del esquema. Schemas Postgres: `core`, `clientes`, `expedientes`, `nodos`, `brands`, `productos`, `proveedores`, `inventario`, `cobros`, `transfers`, `pipeline`, `financiero`, `portal`, `dashboard`, `email_templates`, `notificaciones`, `ai`.
- `infra/`, `scripts/`, `.github/workflows/` — DevOps (Docker Compose en VPS Hostinger)

Repo: <https://github.com/Ale241302/consola_mwt_one> · rama principal: `main`
Despliegue público: `https://consola.mwt.one` · Detalles operativos en [`DEPLOY.md`](./DEPLOY.md).

---

## 1. Stack real (no aspiracional)

> ⚠️ Algunas instrucciones de proyecto describen Next.js 14 + TypeScript + App Router. **Eso NO es lo que está commiteado en `main`.** El stack real, verificable en `frontend/package.json`, es el siguiente. Si quieres migrar a Next.js, abre un RFC explícito; no lo asumas.

### Frontend (`frontend/`)

| Pieza | Versión | Notas |
|---|---|---|
| React | 18.3.1 | Hooks, no clases |
| Vite | 5.4.8 | Dev server `:5173`, build → `dist/` |
| React Router DOM | 6.26.2 | Routing client-side, NO App Router |
| Framer Motion | 11.11.0 | Animaciones |
| Tailwind CSS | configurado en `frontend/tailwind.config.js` | Tokens MWT vía CSS variables |
| xlsx | 0.18.5 | Export de tablas |
| Lenguaje | **JSX** (no TypeScript) | Si quieres TS, hazlo gradual con `.tsx` y `tsconfig.json` opt-in |

Estructura de `frontend/src/`:

```
frontend/src/
├── 00_mock_data.jsx        # fixtures
├── 01_icons.jsx            # iconografía
├── 02_i18n.jsx             # textos ES/EN
├── 03_ui_primitives.jsx    # botones, inputs, tablas base
├── 04_shell.jsx            # AppShell + sidebar + topbar
├── 05_screen_dashboard.jsx
├── 06_screen_expedientes.jsx
├── 06b_screen_oc_detail.jsx
├── 07_screen_expediente_detail.jsx
├── 07b_artifacts_board.jsx
├── 08_screen_pipeline.jsx
├── 09_screen_pagos.jsx
├── 10_screen_wizard.jsx
├── 11_screen_inventario.jsx
├── 12_screen_portal.jsx          # B2B (clientes)
├── 13_command_palette.jsx
├── 14_tweaks_panel.jsx
├── 15_app_root.jsx
├── App.jsx
├── main.jsx                # entry Vite
├── components/             # extracciones reutilizables
├── context/                # React Context (auth, tenant, theme)
├── data/                   # adapters / fetchers
├── hooks/
├── lib/                    # utilidades puras
├── pages/                  # rutas registradas en React Router
└── styles/                 # tokens CSS, globals
```

### Backend (`backend/`)

Django 4 + DRF + SimpleJWT. **24 apps** en `backend/apps/`:
`ai_hub`, `analytics`, `brands`, `clientes`, `cobros`, `commercial`, `core` (auth + permisos + JWT), `email_templates`, `expedientes` (con wizard y document matchmaker), `finance` (pagos v2 con análisis IA), `finanzas` (vistas CEO-only: márgenes/comisiones), `inventario` (con OCR de inbound), `nodos`, `notifications`, `ocr`, `portal` (B2B), `productos`, `proveedores`, `roles` (RBAC matriz CRUD por rol×módulo), `sizing`, `storage` (MinIO/S3), `tickets`, `transfers`, `users`.

> ⚠️ **Notas de redundancia conocida:** `cobros` (v1) y `finance` (v2) coexisten — `finance` es el módulo moderno con verdict IA y log append-only; `cobros` sigue activo para morosidad/retenciones. `users.MwtUser` (staff) vs `portal.MwtUser` (cliente B2B) son tablas separadas.

#### ⚠️ Esquema SQL-first — NO hay migraciones Django

Esto es **crítico** y a menudo malentendido. Verificable en `backend/config/settings.py`:

- `MIGRATION_MODULES = _DisableMigrations()` → **las migraciones de Django están desactivadas**.
- **Todos los modelos son `managed = False`** → Django NO crea ni altera tablas.
- **No hay foreign keys en la base de datos.** Las relaciones son campos UUID sueltos; la integridad referencial se aplica en la capa de aplicación, no en Postgres.
- El esquema vive en `backend/sql/*.sql` — archivos numerados (`05_…`, `10_…`, `70_expedientes.sql`, `91l_cost_line_scope.sql`…) aplicados en orden por `docker-entrypoint.sh`, **idempotentes** (`CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- `search_path` del Postgres incluye todos los schemas (`core,clientes,expedientes,pipeline,…`).

**Para cambiar el esquema: NUNCA `makemigrations`/`migrate`.** Escribe un nuevo archivo SQL numerado e idempotente en `backend/sql/`, backward-compatible (el deploy es rolling sobre VPS único). Ver §6 y §12.

### Infra

Docker Compose con 4 servicios (`postgres pgvector:pg16`, `redis`, `django`, `frontend`). Auto-deploy en cada `push` a `main` vía `.github/workflows/deploy.yml`. Detalles completos en [`DEPLOY.md`](./DEPLOY.md).

---

## 2. Las 6 Reglas de Oro Frontend (adaptadas al stack real)

**R1 — Cero Hex Hardcodeados.**
Prohibido `#013A57`, `rgb(...)` literales en JSX o Tailwind arbitrary values con hex. Usa exclusivamente tokens CSS de MWT: `--brand-primary`, `--brand-accent`, `--surface-raised`, `--surface-alt`, `--text-primary`, `--text-secondary`, `--border-subtle`, etc. Definidos en `frontend/src/styles/`. En Tailwind, exponlos como `bg-[var(--surface-raised)]` o, mejor, registrados en `tailwind.config.js` (`theme.extend.colors.brand.primary: 'var(--brand-primary)'`).

**R2 — Tipado consistente (TS opcional, JSDoc obligatorio).**
El repo es JSX hoy. No metas `any` en TS solo porque el archivo es `.jsx`. Mientras no haya migración formal:
- Documenta props con JSDoc `@typedef` + `@param` en cualquier componente reutilizable de `components/`.
- `propTypes` no es suficiente; preferimos JSDoc + ESLint estricto.
- Si introduces TS, hazlo por archivo (`.tsx`) con `tsconfig.json` `strict: true`. Nunca `any`.

**R3 — Aislamiento de Visibilidad (`POL_VISIBILIDAD`).**
La UI cambia radicalmente según `role`. Reglas duras:
- `role` viene del backend (`/api/auth/me/`) y se cachea en `context/auth`.
- Roles `CLIENT_*` (Portal B2B en `12_screen_portal.jsx`) **NUNCA** ven: tabs de gobernanza, precios de costo, márgenes, botones de transición de estado, logs de auditoría, exposición financiera bruta.
- Roles `ADMIN | CEO` ven todo.
- Centraliza el gating en un hook `useVisibility(scope)` o `<Visibility scope="CEO_ONLY">`. Renderizar y luego ocultar con CSS es violación: el dato no debe llegar al DOM.

**R4 — Arquitectura Policy-Driven (Expedientes).**
El frontend **no decide** qué artefactos mostrar en un expediente. Consume el campo `artifact_policy` (array) que envía `backend/apps/expedientes/`. Si el backend no envía el artefacto, no se renderiza. `ArtifactSection` y `ArtifactModal` (en `components/`) deben recibir la policy como prop y mapear contra `ARTIFACT_UI_REGISTRY` (constantes UI). Nunca hardcodees una lista de artefactos en el front.

**R5 — Tipografía de Precisión.**
- Display: `General Sans` (titulares, KPIs grandes)
- Body: `Plus Jakarta Sans` (texto general)
- Mono: `JetBrains Mono` (UUIDs, códigos, IDs de expediente)
- Fuentes locales en `frontend/fonts/`, declaradas en `styles/fonts.css`.
- **Toda métrica financiera, fecha o número en tabla** usa la clase `tabular-nums` (utility de Tailwind). Sin esto, las columnas de tablas Zebra bailan al scroll.

**R6 — Impresión Estricta (`POL_PRINT`).**
Cualquier vista con botón "Imprimir" (proformas, facturas, packing lists) DEBE incluir el bloque canónico:

```css
@media print {
  .topbar, .sidebar, .actions, [data-no-print] { display: none !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { margin: 12mm; }
}
```

Define `data-no-print` en cualquier control interactivo (botones, dropdowns) que no deba aparecer en papel.

---

## 3. Componentes Core (reutilización obligatoria)

No reinventes. Antes de crear nuevo componente, busca en `frontend/src/components/`:

- **`ArtifactSection`** + **`ArtifactModal`** — gestión de artefactos por expediente, leen `artifact_policy`.
- **`CreditBar`** — exposición financiera del cliente. Tooltips diferenciados por rol (CEO ve descomposición de costo; CLIENT solo ve disponible).
- **`ActivityPanel`** + **`ActivityBadge`** — feed de notificaciones (`/api/analytics/activity/`).
- **Tablas Zebra de alta densidad** — alternancia `bg-alt` / `bg-surface`, estados de fila `.row-selected`, `.row-critical`, `.row-warning`. Patrón en `03_ui_primitives.jsx`.
- **Command Palette** (`13_command_palette.jsx`) — Cmd+K para navegación rápida.

---

## 4. Convenciones de mutación y caché

- Toda llamada a API pasa por `frontend/src/data/` (un fetcher por dominio).
- `POST` / `PATCH` / `DELETE` → invalida o re-fetcha optimistamente la query relacionada. No dejes UI con datos stale.
- Errores de API se renderizan con `<ErrorState />`, nunca con `alert()` ni `console.log()` solo.
- Loading states explícitos en cada botón de acción (`disabled` + spinner). Botón sin estado de loading es bug.

---

## 5. i18n

Textos en `02_i18n.jsx`. ES por defecto, EN como fallback. Nunca strings literales en JSX para copy de UI: siempre `t('expediente.detail.heading')`.

---

## 6. Comandos rápidos

### Frontend
```bash
cd frontend
npm install
npm run dev         # vite dev server :5173
npm run build       # build de producción → dist/
npm run preview     # serve estático del build
```

### Backend
```bash
cd backend
python manage.py runserver 0.0.0.0:8000
# ❌ NO uses `migrate` / `makemigrations`: el esquema es SQL-first (ver §1).
# El esquema se aplica corriendo los .sql numerados contra Postgres, p.ej.:
#   docker exec -i consola-mwt-one-postgres psql -U mwt -d mwt_one < backend/sql/<archivo>.sql
# El bootstrap inicial (init + admin CEO) lo ejecuta docker-entrypoint.sh al primer arranque.
```

### Stack completo (Docker, igual que en VPS)
```bash
docker compose up -d --build
docker compose logs -f django
docker compose logs -f frontend
```

---

## 7. Estructura del repo (mapa rápido)

```
consola_mwt_one/
├── CLAUDE.md                  # ← este archivo
├── DEPLOY.md                  # guía VPS Hostinger + GitHub Actions
├── .github/workflows/deploy.yml
├── backend/
│   ├── apps/                  # 24 apps (ver lista completa en §1)
│   │   ├── ai_hub/            # chat, skills, ruteo a LLM (Anthropic)
│   │   ├── analytics/         # KPIs cross-schema, snapshots dashboard
│   │   ├── brands/  clientes/  productos/  proveedores/  nodos/
│   │   ├── commercial/        # pricing, early-payment, comisiones
│   │   ├── cobros/            # pagos v1 (morosidad/retenciones)
│   │   ├── core/              # auth JWT + permisos + exception handler
│   │   ├── email_templates/  notifications/
│   │   ├── expedientes/       # OC + expediente + wizard + matchmaker docs
│   │   ├── finance/           # pagos v2 (análisis IA + audit append-only)
│   │   ├── finanzas/          # vistas CEO-only (márgenes, comisiones)
│   │   ├── inventario/        # stock multi-nodo + inbound + OCR
│   │   ├── ocr/  storage/  sizing/  tickets/  transfers/
│   │   ├── portal/            # B2B (cliente)
│   │   ├── roles/  users/     # RBAC + identidad
│   │   └── config/            # settings.py (MIGRATION_MODULES desactivado), urls.py
│   ├── sql/                   # ⚠️ ESQUEMA REAL: *.sql numerados e idempotentes (§1)
│   └── Dockerfile
├── frontend/
│   ├── src/                   # SPA React+Vite (ver §1)
│   ├── tailwind.config.js
│   ├── vite.config.js
│   ├── nginx.conf             # nginx interno del contenedor frontend
│   └── Dockerfile
├── database/                  # 01_init.sql + 02_auth_admin.sql (bootstrap)
├── infra/nginx/consola.conf   # routing público (consola.mwt.one)
└── scripts/                   # deploy_consola.ps1, bootstrap_vps.sh, redeploy_vps.sh, etc.
```

---

## 8. Antes de hacer commit

- [ ] No hay hex literales nuevos (R1)
- [ ] Cualquier dato `CEO_ONLY` está aislado de la rama de render `CLIENT_*` (R3)
- [ ] Mutaciones invalidan caché o re-fetch
- [ ] Botones de acción tienen `disabled` + loading
- [ ] Métricas y montos usan `tabular-nums`
- [ ] Si tocas vista imprimible, el bloque `@media print` está intacto
- [ ] Si tocas un expediente, sigues consumiendo `artifact_policy` (no hardcodeas)
- [ ] i18n: ningún string nuevo hardcodeado en el JSX

---

## 9. Comandos de los agentes (skills MWT)

- **`genera_ui`** → activa el "Gate de Componentes" (checklist §8) y entrega TSX/JSX completo con la ruta exacta como cabecera del bloque.
- **`revisa_ux`** → audita un componente buscando violaciones de R1–R6, falta de loading/error states, problemas de a11y o de visibilidad por rol.

Entrega: bloques de código con la ruta como header (ej. `// frontend/src/components/expedientes/ArtifactSection.jsx`), listos para que el CEO los aplique manualmente al repo.

---

## 10. Skill routing

Cuando la solicitud del usuario coincida con una skill disponible, invócala vía la herramienta Skill. Ante la duda, invoca la skill.

Reglas clave:

- Producto / brainstorming de ideas → `/office-hours`
- Estrategia / scope → `/plan-ceo-review`
- Arquitectura → `/plan-eng-review`
- Design system / revisión de plan visual → `/design-consultation` o `/plan-design-review`
- Pipeline completo de revisión → `/autoplan`
- Bugs / errores → `/investigate`
- QA / probar comportamiento del sitio → `/qa` o `/qa-only`
- Code review / verificación de diff → `/review`
- Pulido visual → `/design-review`
- Ship / deploy / PR → `/ship` o `/land-and-deploy`
- Guardar progreso → `/context-save`
- Restaurar contexto → `/context-restore`
- Documentos Word (.docx) → `docx`
- Hojas de cálculo (.xlsx) → `xlsx`
- Presentaciones (.pptx) → `pptx`
- PDFs → `pdf`
- Crear / editar skills → `skill-creator`
- Tareas programadas → `schedule`

---

## 11. gstack

Esta sección habilita la carga de skills del ecosistema **gstack** sobre este repositorio. gstack es un toolkit de skills para revisión de código, planificación CEO/Eng/Design, QA y deploy, que vive en `~/.claude/skills/gstack/` y se invoca con prefijos `/plan-*`, `/review`, `/ship`, `/qa`, `/investigate`, `/autoplan`, etc.

### Modo del repo

`REPO_MODE: solo` — Alejandro es el único arquitecto que opera sobre `main`. Los agentes pueden investigar y proponer fixes proactivos en cualquier zona del repo (no solo la rama actual).

### Convenciones

- **Idioma operativo:** español para conversación con el CEO; los commits, identificadores y código quedan en inglés.
- **Branch base:** `main`. Detección automática vía `git symbolic-ref refs/remotes/origin/HEAD`.
- **Plataforma git:** GitHub (`github.com/Ale241302/consola_mwt_one`).
- **Plan/CEO docs:** persistidos en `~/.gstack/projects/consola_mwt_one/` (fuera del repo, scope local del CEO).
- **Design docs promovidos:** `docs/designs/{FEATURE}.md` cuando un plan CEO aceptado merece visibilidad para el equipo.

### Reglas para reviews automatizadas

Cuando una skill de gstack (ej. `/plan-eng-review`, `/review`) audite cambios en este repo, aplica con extra severidad:

1. **R1 (cero hex)** y **R3 (aislamiento de visibilidad)** son críticos — cualquier violación es **CRITICAL GAP**, no warning.
2. **R4 (policy-driven artifacts)** — si una vista de expediente hardcodea artefactos, es defecto bloqueante.
3. **Catch-all en backend Python** (`except Exception`, `except:`) es smell — exigir excepción específica + log estructurado.
4. **Migraciones Django** deben ser backward-compatible (zero-downtime) porque el deploy es rolling sobre Docker Compose en VPS único.
5. **LLM/AI changes en `apps/ai_hub/`** requieren eval cases + comparación de baseline antes de merge.

### Patrones de archivo para "Prompt/LLM changes"

`backend/apps/ai_hub/services.py`, `backend/apps/ai_hub/skill_routing_views.py`, `backend/apps/expedientes/document_matchmaker.py`, `backend/apps/inventario/inbound_ocr.py` — cualquier cambio aquí dispara el bloque "test ambition check" + eval suites.

### Telemetría y memoria

- Telemetría local de gstack vive en `~/.gstack/analytics/` (fuera del repo).
- Aprendizajes durables sobre este proyecto se guardan en `~/.gstack/projects/consola_mwt_one/learnings.jsonl`.
- Nada de esto entra al árbol de git.

### Routing declined / proactive

- `proactive: true` — los agentes pueden sugerir skills (`/qa`, `/investigate`) sin pedir permiso.
- `routing_declined: false` — esta sección de skill routing (§10) está aceptada y vigente.

---

## 12. Cosas que NO hacer

- ❌ **No correr `python manage.py makemigrations` / `migrate`.** El esquema es SQL-first (`MIGRATION_MODULES` desactivado, modelos `managed = False`, sin FKs). Cambios de esquema = nuevo `.sql` numerado e idempotente en `backend/sql/` (ver §1).
- ❌ No introducir Next.js, Server Components ni App Router sin RFC previo. El stack es Vite + React.
- ❌ No agregar dependencias UI grandes (Material UI, Chakra, Ant Design). El sistema visual MWT es propio.
- ❌ No commitear `node_modules/`, `.env`, `dist/`, `pgdata/` (ya en `.gitignore`).
- ❌ No dejar `console.log` en producción.
- ❌ No commitear `vite.config.js.timestamp-*.mjs` (artefactos de Vite — agregar al `.gitignore` si vuelven a aparecer).
- ❌ No tocar `database/init.sql` ni `database/02_auth_admin.sql` sin coordinar con el CEO; son idempotentes pero un cambio mal hecho rompe el bootstrap del VPS.

---

## 13. Contacto y ownership

- **CEO / Arquitecto:** Alejandro (alejandro@muitowork.com)
- **Single source of truth:** `main` en GitHub. Todo lo demás es derivado.
- **Producción:** un único VPS Hostinger en `187.77.218.102`. Sin staging permanente — `docker compose` local cumple ese rol.

> *"El frontend es la cara de la marca. Cada pixel y cada interacción comunica precisión, confianza y solvencia. Si dudas entre velocidad y calidad: calidad."* — AG-03

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
