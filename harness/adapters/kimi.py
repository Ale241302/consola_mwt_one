"""KimiAdapter — transpila ``canonical/`` → specs Kimi CLI.

Kimi CLI materializa la configuración de forma distinta (hechos de formato, junio
2026):

  - ``AGENTS.md``               — instrucciones de proyecto (estándar AGENTS.md,
                                  cargado vía ``/init``); de ``base_instructions``.
  - ``agents/<id>.yaml``        — agent specs en YAML, con campo ``subagents``.
  - ``mcp-config.json``         — config MCP (fastmcp) para ``--mcp-config-file``.

Todo lo escrito es **derivado** (regenerable con ``python -m harness.sync``); cada
archivo lleva un banner auto-generado. La emisión es idempotente.

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
    ToolConfig,
)
from .claude import ClaudeAdapter  # reuse canonical loader

__all__ = ["KimiAdapter"]

# Banner para Markdown / comentario YAML (ambos usan `#` salvo el .md).
_AUTOGEN_BANNER_MD = (
    "<!-- AUTO-GENERADO por harness — no editar a mano. "
    "Fuente: harness/canonical/. Regenera con `python -m harness.sync`. -->"
)
_AUTOGEN_BANNER_YAML = (
    "# AUTO-GENERADO por harness — no editar a mano.\n"
    "# Fuente: harness/canonical/. Regenera con `python -m harness.sync`."
)


class KimiAdapter(Adapter):
    """Adapter para Kimi CLI (agent specs YAML + mcp-config-file).

    Reusa el cargador canónico de :class:`ClaudeAdapter` (neutro de proveedor) y
    se especializa solo en ``emit``.
    """

    target = "kimi"

    # --- LOAD ---------------------------------------------------------------
    def load(self, canonical_dir: Path) -> CanonicalSpec:
        """Carga ``canonical/`` reusando el parser neutro de ClaudeAdapter."""
        return ClaudeAdapter(self.config).load(canonical_dir)

    # --- model resolution ---------------------------------------------------
    def _resolve_model(self, model: dict[str, str]) -> str | None:
        """Resuelve el modelo del subagente para el target Kimi.

        Prioridad: mapeo explícito ``model.kimi`` > rol neutro ``model.role``
        resuelto contra ``self.config['models']`` > ``None`` (hereda default).
        """
        if "kimi" in model:
            return model["kimi"]
        role = model.get("role")
        if role:
            models_cfg = self.config.get("models")
            if isinstance(models_cfg, dict) and role in models_cfg:
                return str(models_cfg[role])
        return None

    # --- EMIT ---------------------------------------------------------------
    def emit(self, spec: CanonicalSpec, out_dir: Path) -> list[Path]:
        """Emite los specs Kimi. Idempotente. Devuelve rutas escritas."""
        out_dir = Path(out_dir)
        written: list[Path] = []

        agents_md = self._emit_agents_md(spec, out_dir)
        if agents_md is not None:
            written.append(agents_md)

        written += self._emit_agent_specs(spec.agents, out_dir / "agents")

        mcp_path = self._emit_mcp(spec.tools, out_dir / "mcp-config.json")
        if mcp_path is not None:
            written.append(mcp_path)
        return written

    def _emit_agents_md(self, spec: CanonicalSpec, out_dir: Path) -> Path | None:
        """Escribe ``AGENTS.md`` desde ``base_instructions`` (con banner)."""
        if not spec.base_instructions.strip():
            return None
        out_dir.mkdir(parents=True, exist_ok=True)
        doc = f"{_AUTOGEN_BANNER_MD}\n\n{spec.base_instructions.rstrip()}\n"
        path = out_dir / "AGENTS.md"
        path.write_text(doc, encoding="utf-8")
        return path

    def _emit_agent_specs(self, agents: list[AgentSpec], agents_out: Path) -> list[Path]:
        """Emite ``agents/<id>.yaml`` con el shape de spec de Kimi.

        El spec lleva un campo ``subagents`` (lista) — vacía por defecto, ya que
        cada archivo describe un solo agente; un orquestador puede declarar otros
        agentes como subagentes. El system prompt va como bloque literal YAML.
        """
        if not agents:
            return []
        agents_out.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []
        for ag in agents:
            spec_obj: dict[str, object] = {
                "id": ag.id,
                "name": ag.name,
                "description": ag.description,
            }
            model = self._resolve_model(ag.model)
            if model:
                spec_obj["model"] = model
            if ag.tools:
                spec_obj["tools"] = ag.tools
            # Campo subagents requerido por el formato de Kimi (lista de ids).
            spec_obj["subagents"] = ag.extra.get("subagents") or []
            spec_obj["system_prompt"] = ag.system_prompt.rstrip() + "\n"

            body = yaml.safe_dump(
                spec_obj,
                sort_keys=False,
                allow_unicode=True,
                default_flow_style=False,
            ).rstrip()
            doc = f"{_AUTOGEN_BANNER_YAML}\n{body}\n"
            path = agents_out / f"{ag.id}.yaml"
            path.write_text(doc, encoding="utf-8")
            written.append(path)
        return written

    def _emit_mcp(self, tools: list[ToolConfig], mcp_path: Path) -> Path | None:
        """Escribe ``mcp-config.json`` (fastmcp / ``--mcp-config-file``)."""
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
            "_comment": (
                "AUTO-GENERADO por harness — no editar a mano. "
                "Fuente: harness/canonical/tools/."
            ),
            "mcpServers": servers,
        }
        mcp_path.parent.mkdir(parents=True, exist_ok=True)
        mcp_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return mcp_path
