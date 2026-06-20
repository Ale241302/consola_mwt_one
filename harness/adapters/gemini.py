"""GeminiAdapter — transpila ``canonical/`` → una **extensión Gemini CLI**.

El empaquetado nativo de Gemini CLI es una *extensión*: un directorio que bundlea
instrucciones, subagentes, slash-commands y la config MCP. Este adapter emite esa
estructura (hechos de formato, junio 2026):

  - ``GEMINI.md``                 — instrucciones de proyecto (de ``base_instructions``).
  - ``gemini-extension.json``     — manifiesto de la extensión + ``mcpServers``
                                    (config MCP apuntando a ``mcp_server/``).
  - ``agents/<id>.md``            — subagentes (frontmatter YAML + cuerpo).
  - ``commands/<name>.toml``      — skills → slash-commands en formato TOML.

Todo lo escrito es **derivado** (regenerable con ``python -m harness.sync``); cada
archivo lleva un banner auto-generado. La emisión es idempotente: re-ejecutar
produce byte-por-byte el mismo resultado.

Ver ``harness/ARCHITECTURE.md`` §3 (matriz de portabilidad) y §5.
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
from .claude import ClaudeAdapter, _split_frontmatter  # reuse canonical loader

__all__ = ["GeminiAdapter"]

# Banner que marca un archivo Markdown como derivado (no editar a mano).
_AUTOGEN_BANNER = (
    "<!-- AUTO-GENERADO por harness — no editar a mano. "
    "Fuente: harness/canonical/. Regenera con `python -m harness.sync`. -->"
)

# Banner equivalente para archivos TOML (comentario con `#`).
_AUTOGEN_BANNER_TOML = (
    "# AUTO-GENERADO por harness — no editar a mano.\n"
    "# Fuente: harness/canonical/. Regenera con `python -m harness.sync`."
)


def _toml_escape(value: str) -> str:
    """Escapa una cadena para un string básico TOML (comillas dobles)."""
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


class GeminiAdapter(Adapter):
    """Adapter para Gemini CLI (empaqueta una extensión).

    Reusa el cargador canónico de :class:`ClaudeAdapter` (``load`` es neutro de
    proveedor) y se especializa solo en ``emit``.
    """

    target = "gemini"

    # --- LOAD ---------------------------------------------------------------
    def load(self, canonical_dir: Path) -> CanonicalSpec:
        """Carga ``canonical/`` reusando el parser neutro de ClaudeAdapter."""
        return ClaudeAdapter(self.config).load(canonical_dir)

    # --- model resolution ---------------------------------------------------
    def _resolve_model(self, model: dict[str, str]) -> str | None:
        """Resuelve el modelo del subagente para el target Gemini.

        Prioridad: mapeo explícito ``model.gemini`` > rol neutro ``model.role``
        resuelto contra ``self.config['models']`` > ``None`` (hereda default).
        """
        if "gemini" in model:
            return model["gemini"]
        role = model.get("role")
        if role:
            models_cfg = self.config.get("models")
            if isinstance(models_cfg, dict) and role in models_cfg:
                return str(models_cfg[role])
        return None

    # --- EMIT ---------------------------------------------------------------
    def emit(self, spec: CanonicalSpec, out_dir: Path) -> list[Path]:
        """Emite la extensión Gemini completa. Idempotente. Devuelve rutas."""
        out_dir = Path(out_dir)
        written: list[Path] = []

        gemini_md = self._emit_gemini_md(spec, out_dir)
        if gemini_md is not None:
            written.append(gemini_md)

        manifest = self._emit_manifest(spec, out_dir)
        written.append(manifest)

        written += self._emit_agents(spec.agents, out_dir / "agents")
        written += self._emit_commands(spec.skills, out_dir / "commands", spec.source_dir)
        return written

    def _emit_gemini_md(self, spec: CanonicalSpec, out_dir: Path) -> Path | None:
        """Escribe ``GEMINI.md`` desde ``base_instructions`` (con banner)."""
        if not spec.base_instructions.strip():
            return None
        out_dir.mkdir(parents=True, exist_ok=True)
        doc = f"{_AUTOGEN_BANNER}\n\n{spec.base_instructions.rstrip()}\n"
        path = out_dir / "GEMINI.md"
        path.write_text(doc, encoding="utf-8")
        return path

    def _emit_manifest(self, spec: CanonicalSpec, out_dir: Path) -> Path:
        """Escribe ``gemini-extension.json`` (manifiesto + mcpServers)."""
        out_dir.mkdir(parents=True, exist_ok=True)
        name = str(self.config.get("name") or "mwt")
        version = str(self.config.get("version") or "0.1.0")
        manifest: dict[str, object] = {
            "_comment": (
                "AUTO-GENERADO por harness — no editar a mano. "
                "Fuente: harness/canonical/. Regenera con `python -m harness.sync`."
            ),
            "name": name,
            "version": version,
            "description": str(
                self.config.get("description")
                or "Extensión MWT.ONE generada por el harness (subagentes, "
                "slash-commands y tools MCP)."
            ),
            "contextFileName": "GEMINI.md",
            "mcpServers": self._build_mcp_servers(spec.tools),
        }
        path = out_dir / "gemini-extension.json"
        path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return path

    def _build_mcp_servers(self, tools: list[ToolConfig]) -> dict[str, object]:
        """Construye el bloque ``mcpServers`` (shape nativo de Gemini settings)."""
        servers: dict[str, object] = {}
        for t in tools:
            entry: dict[str, object] = {}
            if t.transport == "http" and t.url:
                entry["httpUrl"] = t.url
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
        return servers

    def _emit_agents(self, agents: list[AgentSpec], agents_out: Path) -> list[Path]:
        """Emite ``agents/<id>.md`` (frontmatter YAML + cuerpo)."""
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

    def _emit_commands(
        self,
        skills: list[SkillSpec],
        commands_out: Path,
        source_dir: Path | None = None,
    ) -> list[Path]:
        """Emite ``commands/<name>.toml`` (skills → slash-commands TOML).

        El formato de slash-command de Gemini es TOML con campos ``description`` y
        ``prompt``. El cuerpo procedimental de la skill se inyecta como ``prompt``
        (basic multi-line string TOML, ``\"\"\"...\"\"\"``).
        """
        if not skills:
            return []
        commands_out.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        for sk in skills:
            prompt_parts: list[str] = []
            if sk.trigger:
                prompt_parts.append(f"Trigger: {sk.trigger}")
            prompt_parts.append(sk.body.rstrip())
            prompt = "\n\n".join(p for p in prompt_parts if p.strip())
            # TOML multiline basic string: escapa backslash y triple-quote.
            prompt_ml = prompt.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')
            doc = (
                f"{_AUTOGEN_BANNER_TOML}\n"
                f'description = "{_toml_escape(sk.description)}"\n'
                f'prompt = """\n{prompt_ml}\n"""\n'
            )
            path = commands_out / f"{sk.name}.toml"
            path.write_text(doc, encoding="utf-8")
            written.append(path)
        return written
