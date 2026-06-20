"""ClaudeAdapter — transpila ``canonical/`` → formato Claude Code.

Emite:
  - ``.claude/agents/<id>.md``      — subagentes con frontmatter Claude.
  - ``.claude/skills/<name>/SKILL.md`` (+ recursos) — skills Claude.
  - ``.mcp.json``                   — config MCP apuntando a ``mcp_server/``.
  - bloque gestionado en ``CLAUDE.md`` (merge no destructivo con marcadores).

Todo lo escrito bajo ``.claude/`` es **derivado** y se marca como auto-generado.
``CLAUDE.md`` es el único archivo que se *mergea* en vez de sobrescribirse: solo se
toca el contenido entre los marcadores ``HARNESS:BEGIN``/``HARNESS:END``, dejando
intacto el resto (la fuente manual del CEO).

Ver ``harness/ARCHITECTURE.md`` §5 y ``CLAUDE.md`` §1/§11/§12.
"""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from .base import (
    Adapter,
    AgentSpec,
    CanonicalSpec,
    SkillSpec,
    ToolConfig,
)

__all__ = ["ClaudeAdapter"]

# Cabecera que marca un archivo como derivado (no editar a mano).
_AUTOGEN_BANNER = (
    "<!-- AUTO-GENERADO por harness — no editar a mano. "
    "Fuente: harness/canonical/. Regenera con `python -m harness.sync`. -->"
)

# Marcadores del bloque gestionado dentro de CLAUDE.md.
_CLAUDE_MD_BEGIN = "<!-- HARNESS:BEGIN -->"
_CLAUDE_MD_END = "<!-- HARNESS:END -->"


# ---------------------------------------------------------------------------
# Parsing de frontmatter (YAML) + cuerpo Markdown
# ---------------------------------------------------------------------------
def _split_frontmatter(text: str) -> tuple[dict[str, object], str]:
    """Separa un documento ``---\\nYAML\\n---\\ncuerpo`` en (dict, cuerpo).

    Si no hay frontmatter, devuelve ``({}, text)``.
    """
    stripped = text.lstrip("﻿")  # tolera BOM
    if not stripped.startswith("---"):
        return {}, text
    lines = stripped.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    end_idx: int | None = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        return {}, text
    fm_block = "\n".join(lines[1:end_idx])
    body = "\n".join(lines[end_idx + 1 :])
    data = yaml.safe_load(fm_block) or {}
    if not isinstance(data, dict):
        data = {}
    return data, body.lstrip("\n")


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------
class ClaudeAdapter(Adapter):
    """Adapter para Claude Code (target primario)."""

    target = "claude"

    # --- LOAD ---------------------------------------------------------------
    def load(self, canonical_dir: Path) -> CanonicalSpec:
        """Carga ``canonical/`` en un :class:`CanonicalSpec` (degrada con gracia)."""
        canonical_dir = Path(canonical_dir)
        spec = CanonicalSpec(source_dir=canonical_dir)

        agents_md = canonical_dir / "AGENTS.md"
        if agents_md.is_file():
            spec.base_instructions = agents_md.read_text(encoding="utf-8")

        spec.agents = self._load_agents(canonical_dir / "agents")
        spec.skills = self._load_skills(canonical_dir / "skills")
        spec.tools = self._load_tools(canonical_dir / "tools")
        return spec

    def _load_agents(self, agents_dir: Path) -> list[AgentSpec]:
        if not agents_dir.is_dir():
            return []
        out: list[AgentSpec] = []
        for md in sorted(agents_dir.glob("*.md")):
            fm, body = _split_frontmatter(md.read_text(encoding="utf-8"))
            agent_id = str(fm.get("id") or md.stem)
            model = fm.get("model") or {}
            if not isinstance(model, dict):
                model = {}
            tools = fm.get("tools") or []
            if not isinstance(tools, list):
                tools = [str(tools)]
            known = {"id", "name", "description", "model", "tools", "scope", "visibility"}
            extra = {k: v for k, v in fm.items() if k not in known}
            out.append(
                AgentSpec(
                    id=agent_id,
                    name=str(fm.get("name") or agent_id),
                    description=str(fm.get("description") or ""),
                    system_prompt=body,
                    model={str(k): str(v) for k, v in model.items()},
                    tools=[str(t) for t in tools],
                    scope=(str(fm["scope"]) if fm.get("scope") else None),
                    visibility=(str(fm["visibility"]) if fm.get("visibility") else None),
                    extra=extra,
                )
            )
        return out

    def _load_skills(self, skills_dir: Path) -> list[SkillSpec]:
        if not skills_dir.is_dir():
            return []
        out: list[SkillSpec] = []
        for skill_md in sorted(skills_dir.glob("*/SKILL.md")):
            fm, body = _split_frontmatter(skill_md.read_text(encoding="utf-8"))
            name = str(fm.get("name") or skill_md.parent.name)
            resources = [
                p
                for p in sorted(skill_md.parent.rglob("*"))
                if p.is_file() and p.name != "SKILL.md"
            ]
            known = {"name", "description", "trigger"}
            extra = {k: v for k, v in fm.items() if k not in known}
            out.append(
                SkillSpec(
                    name=name,
                    description=str(fm.get("description") or ""),
                    body=body,
                    trigger=(str(fm["trigger"]) if fm.get("trigger") else None),
                    resources=resources,
                    extra=extra,
                )
            )
        return out

    def _load_tools(self, tools_dir: Path) -> list[ToolConfig]:
        if not tools_dir.is_dir():
            return []
        out: list[ToolConfig] = []
        for jf in sorted(tools_dir.glob("*.json")):
            try:
                data = json.loads(jf.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            # Acepta el shape estándar de MCP: {"mcpServers": {name: {...}}}.
            servers = data.get("mcpServers") if isinstance(data, dict) else None
            if isinstance(servers, dict):
                for name, srv in servers.items():
                    if not isinstance(srv, dict):
                        continue
                    out.append(
                        ToolConfig(
                            name=str(name),
                            command=srv.get("command"),
                            args=[str(a) for a in (srv.get("args") or [])],
                            cwd=(str(srv["cwd"]) if srv.get("cwd") else None),
                            transport=str(srv.get("transport") or ("http" if srv.get("url") else "stdio")),
                            env={str(k): str(v) for k, v in (srv.get("env") or {}).items()},
                            url=(str(srv["url"]) if srv.get("url") else None),
                        )
                    )
        return out

    # --- EMIT ---------------------------------------------------------------
    def emit(self, spec: CanonicalSpec, out_dir: Path) -> list[Path]:
        """Emite los artefactos Claude. Idempotente. Devuelve rutas escritas."""
        out_dir = Path(out_dir)
        written: list[Path] = []
        written += self._emit_agents(spec.agents, out_dir / "agents")
        written += self._emit_skills(spec.skills, out_dir / "skills", spec.source_dir)
        mcp_path = self._emit_mcp(spec.tools, out_dir.parent / ".mcp.json")
        if mcp_path is not None:
            written.append(mcp_path)
        claude_md = out_dir.parent / "CLAUDE.md"
        merged = self._merge_claude_md(spec, claude_md)
        if merged is not None:
            written.append(merged)
        return written

    def _resolve_model(self, model: dict[str, str]) -> str | None:
        """Resuelve el modelo del subagente para el target Claude.

        Prioridad: mapeo explícito ``model.claude`` > rol neutro ``model.role``
        resuelto contra ``self.config['models']`` > ``None`` (hereda default).
        """
        if "claude" in model:
            return model["claude"]
        role = model.get("role")
        if role:
            models_cfg = self.config.get("models")
            if isinstance(models_cfg, dict) and role in models_cfg:
                return str(models_cfg[role])
        return None

    def _emit_agents(self, agents: list[AgentSpec], agents_out: Path) -> list[Path]:
        if not agents:
            return []
        agents_out.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        for ag in agents:
            fm: dict[str, object] = {
                "name": ag.id,
                "description": ag.description,
            }
            model = self._resolve_model(ag.model)
            if model:
                fm["model"] = model
            if ag.tools:
                fm["tools"] = ag.tools
            fm_yaml = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True).strip()
            doc = (
                f"---\n{fm_yaml}\n---\n"
                f"{_AUTOGEN_BANNER}\n\n"
                f"{ag.system_prompt.rstrip()}\n"
            )
            path = agents_out / f"{ag.id}.md"
            path.write_text(doc, encoding="utf-8")
            written.append(path)
        return written

    def _emit_skills(
        self, skills: list[SkillSpec], skills_out: Path, source_dir: Path | None = None
    ) -> list[Path]:
        if not skills:
            return []
        written: list[Path] = []
        for sk in skills:
            skill_dir = skills_out / sk.name
            skill_dir.mkdir(parents=True, exist_ok=True)
            fm: dict[str, object] = {"name": sk.name, "description": sk.description}
            fm_yaml = yaml.safe_dump(fm, sort_keys=False, allow_unicode=True).strip()
            doc = (
                f"---\n{fm_yaml}\n---\n"
                f"{_AUTOGEN_BANNER}\n\n"
                f"{sk.body.rstrip()}\n"
            )
            path = skill_dir / "SKILL.md"
            path.write_text(doc, encoding="utf-8")
            written.append(path)
            # Copia recursos auxiliares preservando su ruta relativa al dir de la
            # skill canónica (canonical/skills/<name>/...).
            canonical_skill_dir = (
                (source_dir / "skills" / sk.name) if source_dir else None
            )
            for res in sk.resources:
                if canonical_skill_dir is not None:
                    try:
                        rel = res.relative_to(canonical_skill_dir)
                    except ValueError:
                        rel = Path(res.name)
                else:
                    rel = Path(res.name)
                dest = skill_dir / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(res.read_bytes())
                written.append(dest)
        return written

    def _emit_mcp(self, tools: list[ToolConfig], mcp_path: Path) -> Path | None:
        if not tools:
            return None
        servers: dict[str, object] = {}
        for t in tools:
            entry: dict[str, object] = {}
            if t.transport == "http" and t.url:
                entry["url"] = t.url
                entry["transport"] = "http"
            else:
                if t.command:
                    entry["command"] = t.command
                if t.args:
                    entry["args"] = t.args
                if t.cwd:
                    entry["cwd"] = t.cwd
            if t.env:
                entry["env"] = t.env
            servers[t.name] = entry
        payload = {
            "_comment": "AUTO-GENERADO por harness — no editar a mano. "
            "Fuente: harness/canonical/tools/.",
            "mcpServers": servers,
        }
        mcp_path.parent.mkdir(parents=True, exist_ok=True)
        mcp_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return mcp_path

    def _build_managed_block(self, spec: CanonicalSpec) -> str:
        """Construye el contenido del bloque gestionado para CLAUDE.md."""
        agent_lines = (
            "\n".join(
                f"- `{a.id}` — {a.description}" for a in spec.agents
            )
            or "- (sin subagentes canónicos aún — los crea la Fase 1)"
        )
        skill_lines = (
            "\n".join(f"- `{s.name}` — {s.description}" for s in spec.skills)
            or "- (sin skills canónicas aún — los crea la Fase 1)"
        )
        return (
            f"{_CLAUDE_MD_BEGIN}\n"
            "<!-- Bloque gestionado por harness — NO editar a mano. "
            "Regenera con `python -m harness.sync --target claude`. -->\n\n"
            "## Harness — subagentes y skills canónicos\n\n"
            "Estos subagentes y skills se sincronizan desde `harness/canonical/` "
            "hacia `.claude/`. La fuente de verdad es canónica; `.claude/` es "
            "derivado.\n\n"
            "### Subagentes\n\n"
            f"{agent_lines}\n\n"
            "### Skills\n\n"
            f"{skill_lines}\n\n"
            f"{_CLAUDE_MD_END}"
        )

    def _merge_claude_md(self, spec: CanonicalSpec, claude_md: Path) -> Path | None:
        """Mergea el bloque gestionado en CLAUDE.md sin pisar lo manual.

        Si el archivo no existe, no lo crea (CLAUDE.md es propiedad del CEO).
        """
        if not claude_md.is_file():
            return None
        block = self._build_managed_block(spec)
        text = claude_md.read_text(encoding="utf-8")
        begin = text.find(_CLAUDE_MD_BEGIN)
        end = text.find(_CLAUDE_MD_END)
        if begin != -1 and end != -1 and end > begin:
            end += len(_CLAUDE_MD_END)
            new_text = text[:begin] + block + text[end:]
        else:
            # Anexa el bloque al final, separado por blank line.
            sep = "" if text.endswith("\n\n") else ("\n" if text.endswith("\n") else "\n\n")
            new_text = text + sep + "\n" + block + "\n"
        if new_text == text:
            return None
        claude_md.write_text(new_text, encoding="utf-8")
        return claude_md
