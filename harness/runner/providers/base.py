"""Contrato de provider: cómo el runner lanza un CLI de agente.

Un **provider** es la fina capa de adaptación entre el bucle REPL
(:class:`~harness.runner.repl.ReplLoop`) y un CLI concreto (Claude Code, Gemini
CLI, Kimi CLI). El runner depende de esta interfaz, **no** de un CLI concreto
(inversión de dependencia): así, añadir un CLI nuevo en la Fase 3 es solo un
``providers/x.py`` que implementa :class:`Provider`.

El contrato I/O es deliberadamente delgado (ver ``ARCHITECTURE.md`` §7):

    prompt de entrada  +  flag de modo headless  +  parsing de salida.

Las Fases 3 implementarán :class:`Provider` para gemini/kimi en este mismo
subpaquete. **No** asumas que solo existe ``claude``.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from pathlib import Path

__all__ = ["ProviderResult", "Provider", "ProviderNotAvailable"]


class ProviderNotAvailable(RuntimeError):
    """El CLI subyacente no está instalado / no es ejecutable.

    Se lanza en *tiempo de ejecución* (no en import) cuando el binario del CLI
    no se encuentra en ``PATH``, para que importar el módulo del provider nunca
    rompa el harness aunque el CLI no esté instalado.
    """


@dataclass(slots=True)
class ProviderResult:
    """Resultado de una invocación headless de un CLI de agente.

    Es la salida de :meth:`Provider.run` y la entrada de la fase GATE del REPL.

    Atributos:
        stdout: Salida estándar capturada del CLI (texto).
        exit_code: Código de salida del proceso (``0`` = éxito convencional).
            ``None`` si el proceso fue terminado por timeout antes de retornar.
        artifacts: Rutas de archivos que el CLI creó/modificó y que los gates
            deben inspeccionar (diffs, archivos editados). Puede ir vacío si el
            provider no puede determinarlas; los gates aceptan paths explícitos.
        stderr: Salida de error capturada (diagnóstico). Vacío si no hubo.
        timed_out: ``True`` si la invocación se cortó por ``timeout``.
        duration_s: Duración de la invocación en segundos (para telemetría).
    """

    stdout: str
    exit_code: int | None
    artifacts: list[Path] = field(default_factory=list)
    stderr: str = ""
    timed_out: bool = False
    duration_s: float = 0.0

    @property
    def ok(self) -> bool:
        """``True`` si el proceso terminó con código 0 y sin timeout."""
        return self.exit_code == 0 and not self.timed_out


class Provider(abc.ABC):
    """Interfaz común para lanzar un CLI de agente en modo headless.

    Subclases concretas: :class:`harness.runner.providers.claude.ClaudeProvider`
    (esta fase), y en la Fase 3 los providers de Gemini y Kimi. El runner
    instancia un provider (o recibe uno inyectado) y llama :meth:`run`.

    Contrato:
        - El import del módulo **nunca** debe fallar por ausencia del binario.
          Si el CLI no está, :meth:`run` lanza :class:`ProviderNotAvailable`
          (o :meth:`available` devuelve ``False``).
        - :meth:`run` es síncrono y bloqueante: lanza el CLI, espera (con
          ``timeout``), y devuelve un :class:`ProviderResult`. Un timeout no es
          una excepción: se refleja en ``timed_out``/``exit_code``.
    """

    #: Nombre del target (clave en ``harness.config.yaml`` → ``targets``).
    #: Las subclases lo sobreescriben (p.ej. ``"claude"``).
    name: str = ""

    def __init__(self, config: dict[str, object] | None = None) -> None:
        """Crea el provider.

        Args:
            config: Sub-config del target desde ``harness.config.yaml`` (modelos,
                binario, flags). Opcional para usos puntuales/tests.
        """
        self.config: dict[str, object] = config or {}

    @abc.abstractmethod
    def run(
        self,
        prompt: str,
        *,
        headless: bool = True,
        cwd: Path,
        timeout_s: float | None = None,
    ) -> ProviderResult:
        """Lanza el CLI con ``prompt`` y devuelve el resultado.

        Args:
            prompt: El prompt/tarea a pasar al CLI.
            headless: Si ``True`` (default), modo no-interactivo (sin TTY,
                imprime y sale). El runner siempre opera headless.
            cwd: Working dir del proceso (la raíz del repo, normalmente).
            timeout_s: Límite en segundos; ``None`` = sin límite explícito.

        Returns:
            Un :class:`ProviderResult` con stdout, exit code y artefactos.

        Raises:
            ProviderNotAvailable: Si el binario del CLI no está disponible.
        """
        raise NotImplementedError

    def available(self) -> bool:
        """Indica si el CLI subyacente está instalado y es invocable.

        Default conservador: ``False``. Las subclases comprueban el binario en
        ``PATH``. Permite al runner degradar con gracia (skip/escala) en vez de
        crashear cuando un CLI no está instalado.
        """
        return False
