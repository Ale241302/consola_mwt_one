# Harness MWT — Arquitectura del Bucle de Agentes (multi-IA)

> **Estado:** propuesta de arquitectura (v0). Documento de diseño previo al código.
> **Autor/owner:** Alejandro (AG-03) · **Repo:** `consola_mwt_one` · **Ubicación:** `harness/`
> **Léeme antes de scaffoldear nada.** Define las capas, los contratos y la estrategia multi-CLI.

---

## 0. Objetivo en una frase

Construir un **harness de ingeniería de agentes** —un bucle REPL con tools, subagentes y skills— que sea **agnóstico de proveedor** (Claude Code, Gemini CLI, Kimi CLI y cualquier futuro CLI compatible con MCP) y que opere sobre las cuatro superficies de MWT.ONE: **backend Django, base de datos SQL-first, frontend React (Vite)** y el **servidor MCP**.

La decisión de diseño tomada es: **estándar de archivos común + wrap de los CLIs existentes** (no construir nuestro propio orquestador de API desde cero). Es decir: una **fuente de verdad canónica** versionada en el repo, y **transpiladores/sync** que la materializan en el formato nativo de cada CLI. El bucle de ejecución envuelve el CLI elegido.

---

## 1. El bucle del agente (REPL)

El harness no es magia: es el clásico **REPL** aplicado a un agente con herramientas.

```
        ┌──────────────────────────────────────────┐
        │                                            │
        ▼                                            │
   ┌─────────┐    ┌──────────┐    ┌──────────────┐  │
   │  READ   │ ─► │   EVAL   │ ─► │    PRINT     │ ─┘
   │ input   │    │  input   │    │   result     │   LOOP BACK
   └─────────┘    └──────────┘    └──────────────┘
   prompt/tarea   el modelo        resultado de la
   del usuario    decide y         tool / respuesta
   o de la cola   ejecuta tools    → realimenta el
                  (subagentes,      contexto
                   skills, MCP)
```

- **READ** — entra una tarea: prompt del CEO, item de una cola/sprint, o un hand-off de otro agente.
- **EVAL** — el modelo razona y ejecuta: llama **tools** (vía MCP), delega a **subagentes**, o aplica una **skill**. Aquí vive "el código que ejecuta las llamadas a la LLM".
- **PRINT** — el resultado (diff de código, salida de tool, veredicto) se materializa y se muestra/persiste.
- **LOOP** — el resultado realimenta el contexto y el bucle continúa hasta cumplir la condición de parada (tarea resuelta, gate fallado, o límite de iteraciones).

En la estrategia "wrap de CLIs", **cada CLI ya implementa internamente su propio REPL** (read-eval-print de tool-calling). El harness aporta **el bucle de orquestación de un nivel superior**: alimenta tareas, captura salidas, aplica gates (los checklists de `CLAUDE.md` §8) y decide si reintenta, escala a un subagente o se detiene.

---

## 2. Las 5 capas (mapa del diagrama → repo)

El diagrama de capas (tools → subagentes → código que ejecuta llamadas a la LLM → skills → SDK cliente/creador) se mapea así:

| Capa | Qué es | Portabilidad | Dónde vive |
|---|---|---|---|
| **1. Tools** | Funciones que el modelo invoca (leer expediente, crear OC, correr tests…). | **Universal** vía MCP. | `mcp_server/` (ya existe, 88 tools) + tools locales del CLI (Bash, Read, Edit). |
| **2. Subagentes** | Workers especializados con contexto aislado (DB / Backend / Frontend / Reviewer). | **Formato divergente por CLI.** | `harness/agents/` (canónico) → transpila a cada CLI. |
| **3. Código que ejecuta las llamadas a la LLM** | El motor del REPL. | **Lo aporta el CLI** (lo envolvemos, no lo reescribimos). | `harness/runner/` (wrappers + orquestación). |
| **4. Skills** | Procedimientos reutilizables que enseñan al agente *cómo* hacer algo (genera_ui, revisa_ux, deploy…). | **Formato divergente por CLI.** | `harness/skills/` (canónico) → transpila. |
| **5. SDK cliente / creador** | El CLI/SDK que consume todo (Claude Code, Gemini CLI, Kimi CLI). | N/A — es el target. | Externo; configurado por los adapters. |

**Insight central:** solo **dos capas son verdaderamente portables hoy** — las **tools (MCP)** y las **instrucciones base (AGENTS.md)**. Las demás (subagentes, skills, slash-commands, hooks) tienen **formato propio en cada CLI**. Por eso la arquitectura gira en torno a un **compilador de configuración**: una fuente canónica + transpiladores por destino.

---

## 3. Lo que es portable y lo que no (matriz real, junio 2026)

| Capacidad | Claude Code | Gemini CLI | Kimi CLI | ¿Estándar común? |
|---|---|---|---|---|
| **Instrucciones de proyecto** | `CLAUDE.md` (preferido) + soporta `AGENTS.md` | `GEMINI.md` | `AGENTS.md` (vía `/init`) | **`AGENTS.md`** ← canónico |
| **Tools externas** | `.mcp.json` (MCP) | `mcpServers` en `settings.json` (MCP) | `--mcp-config-file` (MCP, fastmcp) | **MCP** ← universal |
| **Subagentes** | `.claude/agents/*.md` (frontmatter YAML) | `agents/*.md` en extensión (preview) | specs YAML en `agents/` + campo `subagents` | ❌ formato distinto |
| **Skills** | `.claude/skills/<n>/SKILL.md` | "agent skills" en extensión | skills (bundle) | ❌ formato distinto |
| **Slash commands** | `.claude/commands/*.md` (legacy) / skills | `commands/*.toml` | `/comandos` builtin | ❌ formato distinto |
| **Hooks** | `settings.json` → `hooks` | hooks en extensión | — (limitado) | ❌ |
| **Empaquetado** | plugin / marketplace | **extensión** (bundlea todo) | agent spec | ❌ |

> **`AGENTS.md`** es ahora un estándar gobernado por la Agentic AI Foundation (Linux Foundation), con 28+ herramientas con soporte nativo. En monorepo aplica **nearest-file-wins**: el `AGENTS.md` más cercano al archivo editado gana — útil para dar instrucciones distintas a `backend/`, `frontend/` y `mcp_server/`.

**Conclusión de diseño:** la fuente de verdad es **canónica y neutra**; un paso de `sync` genera `.claude/`, las extensiones de Gemini y los specs de Kimi. **No editamos a mano los archivos de cada CLI** — son artefactos derivados (igual que el esquema SQL-first: una fuente, salidas idempotentes).

---

## 4. Estructura de directorios propuesta (`harness/`)

```
harness/
├── ARCHITECTURE.md            # ← este documento
├── harness.config.yaml        # config raíz: targets activos, modelos, rutas
│
├── canonical/                 # FUENTE DE VERDAD (neutra, editable a mano)
│   ├── AGENTS.md              # instrucciones base portables (deriva de CLAUDE.md)
│   ├── agents/                # subagentes canónicos (un .md con frontmatter neutro)
│   │   ├── db-architect.md        # SQL-first, idempotente, sin FKs (regla §1)
│   │   ├── backend-engineer.md    # Django/DRF, managed=False, sin migrate
│   │   ├── frontend-architect.md  # React+Vite, R1–R6, tokens MWT
│   │   ├── mcp-toolsmith.md       # mantiene mcp_server/ (88 tools)
│   │   └── reviewer.md            # aplica Gate de Componentes + R1/R3 críticos
│   ├── skills/                # skills canónicas
│   │   ├── genera_ui/SKILL.md      # activa el Gate de Componentes
│   │   ├── revisa_ux/SKILL.md      # audita R1–R6 + a11y + visibilidad
│   │   ├── nueva_migracion_sql/    # crea .sql numerado idempotente
│   │   └── deploy_vps/             # git push + redeploy_vps.sh
│   └── tools/                 # manifiesto de tools MCP que el harness expone
│       └── mwt.mcp.json            # apunta a mcp_server/ (stdio/http)
│
├── adapters/                  # TRANSPILADORES (canónico → nativo)
│   ├── claude.py              # → .claude/agents, .claude/skills, .mcp.json, CLAUDE.md merge
│   ├── gemini.py             # → extensión Gemini (GEMINI.md, agents/, commands/*.toml, settings)
│   ├── kimi.py               # → agent specs YAML + mcp-config-file
│   └── base.py               # interfaz Adapter común (load() → emit())
│
├── runner/                    # EL BUCLE (wrap de CLIs)
│   ├── repl.py               # orquestación REPL: read → eval(cli) → print → loop + gates
│   ├── providers/            # cómo lanzar cada CLI (subprocess + I/O contract)
│   │   ├── claude.py · gemini.py · kimi.py
│   ├── gates.py              # checklists §8 de CLAUDE.md como funciones verificables
│   └── tasks.py              # cola de tareas / sprints (entrada del READ)
│
└── tests/                     # golden files: canónico→nativo + smoke del runner
```

> `harness/` convive con `backend/`, `frontend/`, `mcp_server/` sin tocarlos. Los archivos generados (`.claude/`, extensión Gemini, specs Kimi) se escriben en sus rutas convencionales por el paso `sync`, y se marcan como derivados (no editar a mano).

---

## 5. Contratos canónicos (formato neutro)

La clave para que un solo archivo alimente a 3 CLIs es **un frontmatter mínimo y neutro** que cada adapter expande.

### 5.1 Subagente canónico (`canonical/agents/*.md`)

```markdown
---
id: frontend-architect
name: Frontend Architect (AG-03)
description: Construye/refactoriza UI React+Vite de alta densidad respetando R1–R6.
model: { claude: opus, gemini: gemini-2.x-pro, kimi: k2.5 }   # mapeo por target
tools: [mcp:mwt.*, fs.read, fs.edit, bash]                     # capacidades neutras
scope: frontend/                                               # nearest-file / boundary
visibility: CEO                                                # gating R3
---

(System prompt del subagente, en prosa. Reusa identidad AG-03 y las 6 reglas de oro.)
```

El adapter de **Claude** lo emite como `.claude/agents/frontend-architect.md` (frontmatter Claude). El de **Gemini** como `agents/frontend-architect.md` dentro de la extensión. El de **Kimi** como spec YAML con `subagents`. El `tools` neutro se resuelve al nombre real de cada runtime.

### 5.2 Skill canónica (`canonical/skills/<n>/SKILL.md`)

Mismo patrón: frontmatter `name`/`description`/`trigger` + cuerpo procedimental. Las skills MWT existentes (`genera_ui`, `revisa_ux`) se formalizan aquí como fuente única.

### 5.3 Tools (MCP) — sin transpilación

Las tools **no se transpilan**: se referencian. El `mcp_server/` ya expone 88 tools sobre la API REST. Cada adapter solo escribe la **entrada de configuración MCP** correspondiente (`.mcp.json`, `mcpServers`, `--mcp-config-file`) apuntando al mismo servidor. Una sola implementación, tres consumidores.

---

## 6. Cobertura por superficie de MWT.ONE

El harness debe operar las cuatro superficies respetando sus reglas duras (de `CLAUDE.md`):

- **Base de datos (SQL-first).** El subagente `db-architect` y la skill `nueva_migracion_sql` **nunca** corren `makemigrations`/`migrate`. Generan un `.sql` numerado e idempotente en `backend/sql/`, backward-compatible (deploy rolling). Sin FKs; relaciones por UUID; tenancy por `operating_company_id`; cantidades `integer`.
- **Backend (Django/DRF).** `backend-engineer` trabaja con modelos `managed=False`, exige excepción específica + log estructurado (nada de `except Exception` ciego), y para cambios en `apps/ai_hub/` dispara eval cases + baseline.
- **Frontend (React+Vite).** `frontend-architect` aplica las **6 reglas de oro** (cero hex, JSDoc/TS estricto, aislamiento de visibilidad `POL_VISIBILIDAD`, artefactos policy-driven, `tabular-nums`, `@media print`) y reutiliza los componentes core (`ArtifactSection`, `CreditBar`, `ActivityPanel`, tablas Zebra).
- **MCP.** `mcp-toolsmith` mantiene `mcp_server/` (FastMCP, token de servicio de larga vida) y lo mantiene en sync con la API REST.

Cada subagente lleva su `AGENTS.md` de scope (nearest-file-wins) para que cualquier CLI cargue automáticamente las reglas correctas al editar en esa carpeta.

---

## 7. El runner: cómo se "envuelve" cada CLI

`runner/repl.py` implementa el bucle de orden superior:

1. **READ** — toma una tarea de `tasks.py` (cola/sprint o prompt directo).
2. **EVAL** — invoca el CLI elegido vía `providers/<cli>.py` (subprocess en modo no-interactivo / headless), pasándole el prompt y la config ya transpilada por el adapter.
3. **PRINT** — captura stdout/diff/artefactos, los persiste.
4. **GATE** — `gates.py` corre el checklist verificable (lint de hex hardcodeados, `tabular-nums`, fuga de datos CEO en rama CLIENT, build de Vite real con esbuild, etc.).
5. **LOOP** — si el gate falla → realimenta el error y reintenta o escala a `reviewer`; si pasa → entrega bloque de código con ruta exacta (convención AG-03) y líneas de `git push` + `redeploy_vps.sh`.

El contrato I/O entre runner y CLI es deliberadamente delgado: **prompt de entrada + flag de modo headless + parsing de salida**. Si mañana aparece otro CLI compatible con MCP, basta un nuevo `providers/x.py` + `adapters/x.py`.

---

## 8. Plan por fases

1. **Fase 0 — Esqueleto.** Crear `harness/` con `harness.config.yaml`, `canonical/AGENTS.md` (derivado de `CLAUDE.md`), y `adapters/claude.py` (el target que ya usas). Resultado: un `sync` que regenera `.claude/` desde lo canónico. *Riesgo bajo, valor inmediato.*
2. **Fase 1 — Subagentes + skills canónicos.** Formalizar los 5 subagentes y las skills `genera_ui`/`revisa_ux` en `canonical/`, con `db-architect`/`backend-engineer`/`frontend-architect` cubriendo las reglas duras.
3. **Fase 2 — Runner REPL + gates.** `repl.py` + `gates.py` envolviendo Claude Code headless, con los checklists §8 como funciones verificables (esbuild real, lint de hex, fuga R3).
4. **Fase 3 — Multi-CLI.** Añadir `adapters/gemini.py` (extensión) y `adapters/kimi.py` (specs YAML) + sus providers. Tests golden de transpilación.
5. **Fase 4 — Cola de tareas.** Integrar `tasks.py` con `sprints/` para correr el bucle sobre items reales.

---

## 9. Riesgos y reglas no negociables

- **Drift de formatos.** Los CLIs evolucionan (subagentes de Gemini están en *preview*, Kimi es muy nuevo). Mitigación: adapters aislados + tests golden; el canónico nunca depende de un detalle inestable.
- **No reintroducir contradicciones de stack.** El frontend real es **Vite + React (JSX)**, no Next.js (ver `CLAUDE.md` §1). El harness no asume App Router.
- **SQL-first es sagrado.** Ningún subagente puede emitir `migrate`. Gate que bloquea PRs con migraciones Django.
- **R1 y R3 son CRITICAL.** Cero hex y aislamiento de visibilidad son gates bloqueantes, no warnings.
- **Artefactos derivados ≠ fuente.** Editar `.claude/` a mano es como editar `dist/`: se pierde en el próximo `sync`.

---

## 10. Decisión abierta para validar

La estrategia elegida (estándar de archivos + wrap de CLIs) optimiza **reutilización y bajo mantenimiento**, a costa de **depender de las features de cada CLI**. Si en el futuro necesitas control fino del bucle (paralelismo masivo de subagentes, políticas de retry propias, observabilidad por token), se puede añadir un **núcleo orquestador propio vía API** como `runner/native/` sin romper lo anterior (híbrido). No es necesario ahora.
