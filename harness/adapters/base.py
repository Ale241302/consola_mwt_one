"""Contrato del harness: modelo canónico neutro + interfaz ``Adapter``.

Este módulo es **el contrato público** del harness. Las Fases 2 (runner) y 3
(adapters Gemini/Kimi) lo importan; por eso está diseñado para ser **estable**:
piensa dos veces antes de cambiar una firma.

Modelo de datos (todo neutro de proveedor):

    CanonicalSpec
    ├── agents:  list[AgentSpec]   # subagentes (canonical/agents/*.md)
    ├── skills:  list[SkillSpec]   # skills      (canonical/skills/<name>/SKILL.md)
    ├── tools:   list[ToolConfig]  # servidores MCP (canonical/tools/*.json)
    └── base_instructions: str     # contenido de canonical/AGENTS.md

Cada CLI difiere en cómo materializa subagentes, skills y slash-commands, pero
**dos capas son portables**: las instrucciones base (AGENTS.md) y las tools (MCP).
El adapter traduce lo demás. Ver ``harness/ARCHITECTURE.md`` §5.

Flujo de un adapter:

    spec = adapter.load(canonical_dir)      # canónico -> modelo neutro
    written = adapter.emit(spec, out_dir)   # modelo neutro -> archivos nativos
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "AgentSpec",
    "SkillSpec",
    "ToolConfig",
    "CanonicalSpec",
    "Adapter",
]


# Mapeo rol-neutro -> nombre de modelo del CLI. Las claves son los nombres de
# target ("claude", "gemini", "kimi"); los valores, el modelo nativo. El front-
# matter canónico puede declarar un mapeo por target o un rol neutro que el
# adapter resuelve contra harness.config.yaml.
ModelMap = dict[str, str]


@dataclass(slots=True)
class AgentSpec:
    """Subagente canónico, neutro de proveedor.

    Deriva de un ``canonical/agents/<id>.md`` con frontmatter neutro + cuerpo en
    prosa (el system prompt). Cada adapter lo expande al formato de su CLI
    (frontmatter Claude, extensión Gemini, spec YAML Kimi).

    Atributos:
        id: Identificador estable y único (slug, p.ej. ``"frontend-architect"``).
            Suele coincidir con el nombre de archivo.
        name: Nombre legible (p.ej. ``"Frontend Architect (AG-03)"``).
        description: Una línea: cuándo/para qué usar este subagente.
        system_prompt: Cuerpo en prosa (Markdown) = instrucciones del subagente.
        model: Mapeo target -> modelo, o ``{"role": "architect"}`` para resolución
            diferida contra la config. Vacío = hereda el default del CLI.
        tools: Capacidades neutras concedidas (p.ej. ``"mcp:mwt.*"``, ``"fs.read"``,
            ``"fs.edit"``, ``"bash"``). El adapter las resuelve al nombre real.
        scope: Boundary de carpeta para *nearest-file-wins* (p.ej. ``"frontend/"``).
            ``None`` = ámbito global del repo.
        visibility: Etiqueta de gating R3 (p.ej. ``"CEO"``, ``"ADMIN"``). Metadato;
            no concede acceso por sí mismo.
        extra: Bolsa de metadatos del frontmatter que un adapter concreto pueda
            necesitar sin romper el contrato. Evítalo para datos portables.
    """

    id: str
    name: str
    description: str
    system_prompt: str
    model: ModelMap = field(default_factory=dict)
    tools: list[str] = field(default_factory=list)
    scope: str | None = None
    visibility: str | None = None
    extra: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class SkillSpec:
    """Skill canónica (procedimiento reutilizable), neutra de proveedor.

    Deriva de ``canonical/skills/<name>/SKILL.md`` (frontmatter
    ``name``/``description``/``trigger`` + cuerpo procedimental).

    Atributos:
        name: Slug de la skill (p.ej. ``"genera_ui"``). Único.
        description: Una línea: qué hace y cuándo dispararla.
        body: Cuerpo procedimental en Markdown (el "cómo").
        trigger: Pista de cuándo invocarla (frase/condición). ``None`` si no aplica.
        resources: Rutas (relativas al dir de la skill) de archivos auxiliares que
            acompañan a ``SKILL.md`` y deben copiarse junto a la skill.
        extra: Metadatos adicionales del frontmatter (no portables).
    """

    name: str
    description: str
    body: str
    trigger: str | None = None
    resources: list[Path] = field(default_factory=list)
    extra: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class ToolConfig:
    """Configuración de un servidor MCP — se referencia, no se transpila.

    Las tools no se traducen: una sola implementación (``mcp_server/``) servida a
    N CLIs. Cada adapter escribe la entrada de config MCP de su CLI apuntando aquí.

    Atributos:
        name: Id lógico del servidor en la config del CLI (p.ej. ``"mwt"``).
        command: Ejecutable para transporte stdio (p.ej. ``"python"``).
        args: Argumentos del comando (p.ej. ``["-m", "mwt_mcp"]``).
        cwd: Working dir del proceso, relativo a la raíz del repo (p.ej.
            ``"mcp_server/"``). ``None`` = raíz.
        transport: ``"stdio"`` o ``"http"`` (FastMCP streamable-http).
        env: Variables de entorno a inyectar (pueden contener placeholders
            ``${VAR}`` resueltos por el operador, no por el adapter).
        url: URL del endpoint cuando ``transport == "http"``. ``None`` para stdio.
    """

    name: str
    command: str | None = None
    args: list[str] = field(default_factory=list)
    cwd: str | None = None
    transport: str = "stdio"
    env: dict[str, str] = field(default_factory=dict)
    url: str | None = None


@dataclass(slots=True)
class CanonicalSpec:
    """Modelo canónico completo cargado desde ``canonical/``.

    Resultado de :meth:`Adapter.load`; entrada de :meth:`Adapter.emit`.

    Atributos:
        base_instructions: Contenido crudo de ``canonical/AGENTS.md``.
        agents: Subagentes canónicos (vacío si ``canonical/agents/`` no existe aún).
        skills: Skills canónicas (vacío si ``canonical/skills/`` no existe aún).
        tools: Servidores MCP referenciados.
        source_dir: Carpeta canónica de la que se cargó (para resolver recursos).
    """

    base_instructions: str = ""
    agents: list[AgentSpec] = field(default_factory=list)
    skills: list[SkillSpec] = field(default_factory=list)
    tools: list[ToolConfig] = field(default_factory=list)
    source_dir: Path | None = None


class Adapter(abc.ABC):
    """Interfaz común de un transpilador canónico → nativo (un adapter por CLI).

    Subclases concretas: :class:`harness.adapters.claude.ClaudeAdapter` (Fase 0),
    y en la Fase 3 los adapters de Gemini y Kimi. El runner (Fase 2) instancia un
    adapter, llama :meth:`load` y luego :meth:`emit`.

    Contrato:
        - :meth:`load` es de solo lectura y **degrada con gracia**: si faltan
          subdirectorios opcionales (``agents/``, ``skills/``) devuelve listas
          vacías en vez de lanzar.
        - :meth:`emit` escribe artefactos **derivados** (regenerables); debe
          marcarlos como auto-generados y ser idempotente (re-ejecutar produce el
          mismo resultado). Devuelve las rutas escritas.
    """

    #: Nombre del target (clave en ``harness.config.yaml`` → ``targets``).
    #: Las subclases lo sobreescriben (p.ej. ``"claude"``).
    target: str = ""

    def __init__(self, config: dict[str, object] | None = None) -> None:
        """Crea el adapter.

        Args:
            config: Sub-config del target desde ``harness.config.yaml`` (modelos,
                ``out_dir``, etc.). Opcional para usos puntuales/tests.
        """
        self.config: dict[str, object] = config or {}

    @abc.abstractmethod
    def load(self, canonical_dir: Path) -> CanonicalSpec:
        """Lee la fuente canónica y devuelve el modelo neutro.

        Solo lectura. Degrada con gracia ante subdirectorios ausentes.

        Args:
            canonical_dir: Ruta a ``harness/canonical/``.

        Returns:
            El :class:`CanonicalSpec` poblado.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def emit(self, spec: CanonicalSpec, out_dir: Path) -> list[Path]:
        """Materializa el modelo neutro en los archivos nativos del CLI.

        Idempotente. Marca cada archivo generado como auto-generado/derivado.

        Args:
            spec: El modelo canónico (de :meth:`load`).
            out_dir: Carpeta de salida del CLI (p.ej. ``.claude/``).

        Returns:
            Lista de rutas escritas o actualizadas.
        """
        raise NotImplementedError

    def sync(self, canonical_dir: Path, out_dir: Path) -> list[Path]:
        """Helper de conveniencia: ``load`` seguido de ``emit``.

        Args:
            canonical_dir: Ruta a ``harness/canonical/``.
            out_dir: Carpeta de salida del CLI.

        Returns:
            Lista de rutas escritas o actualizadas.
        """
        spec = self.load(canonical_dir)
        return self.emit(spec, out_dir)
