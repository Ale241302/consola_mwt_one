"""GeminiProvider — lanza Gemini CLI en modo headless vía subprocess.

Gemini CLI soporta un **modo no-interactivo**: ejecuta un prompt, imprime el
resultado en stdout y sale, sin TTY ni REPL. El flag canónico es ``-p`` /
``--prompt`` (one-shot); ``-y`` / ``--yolo`` autoaprueba acciones cuando no hay
TTY interactivo::

    gemini -p "<prompt>"            # imprime y sale
    gemini -p "<prompt>" --yolo     # headless sin confirmaciones

Sigue el mismo contrato que :class:`harness.runner.providers.claude.ClaudeProvider`
(Fase 2): :meth:`run(prompt, *, headless, cwd, timeout_s) -> ProviderResult`.

Robustez:
  - Si el binario ``gemini`` no está en ``PATH``, :meth:`run` lanza
    :class:`ProviderNotAvailable` (NO crashea el import).
  - Un timeout no es excepción: se refleja en ``timed_out`` / ``exit_code=None``.

Ver ``harness/ARCHITECTURE.md`` §7 (contrato I/O delgado).
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

# --- Importación defensiva del contrato (carrera con la Fase 2) -------------
# La Fase 2 provee ``base.py``. Si aún no aterrizó al validar, degradamos a un
# contrato mínimo espejo para que ``py_compile`` no rompa (ver reporte).
try:  # pragma: no cover - depende de qué fase haya aterrizado
    from .base import Provider, ProviderNotAvailable, ProviderResult
except ImportError:  # pragma: no cover - fallback mínimo si base.py no existe aún
    import abc
    from dataclasses import dataclass, field

    class ProviderNotAvailable(RuntimeError):  # type: ignore[no-redef]
        """El CLI subyacente no está instalado / no es ejecutable."""

    @dataclass(slots=True)
    class ProviderResult:  # type: ignore[no-redef]
        stdout: str
        exit_code: int | None
        artifacts: list[Path] = field(default_factory=list)
        stderr: str = ""
        timed_out: bool = False
        duration_s: float = 0.0

        @property
        def ok(self) -> bool:
            return self.exit_code == 0 and not self.timed_out

    class Provider(abc.ABC):  # type: ignore[no-redef]
        name: str = ""

        def __init__(self, config: dict[str, object] | None = None) -> None:
            self.config: dict[str, object] = config or {}

        @abc.abstractmethod
        def run(
            self,
            prompt: str,
            *,
            headless: bool = True,
            cwd: Path,
            timeout_s: float | None = None,
        ) -> "ProviderResult":
            raise NotImplementedError

        def available(self) -> bool:
            return False


__all__ = ["GeminiProvider"]

# (re-emitido para forzar sync del mount)
#: Nombre del ejecutable de Gemini CLI en PATH (override vía config["binary"]).
_DEFAULT_BINARY = "gemini"

#: Flag de prompt one-shot (modo no-interactivo).
_PROMPT_FLAG = "-p"

#: Flag de autoaprobación para correr sin confirmaciones interactivas.
_HEADLESS_FLAG = "--yolo"


class GeminiProvider(Provider):
    """Provider que envuelve Gemini CLI en modo ``-p`` (one-shot).

    Config soportada (de ``harness.config.yaml`` → ``targets.gemini``):
        binary: ruta/nombre del ejecutable (default ``"gemini"``).
        model:  modelo a pasar con ``--model`` / ``-m`` (opcional).
        extra_args: lista de flags adicionales.
        timeout_s: timeout por defecto si :meth:`run` no recibe uno.
    """

    name = "gemini"

    def _binary(self) -> str:
        binary = self.config.get("binary")
        return str(binary) if isinstance(binary, str) and binary else _DEFAULT_BINARY

    def _resolved_binary(self) -> str | None:
        """Ruta absoluta del binario en PATH, o ``None`` si no se encuentra."""
        return shutil.which(self._binary())

    def available(self) -> bool:
        """``True`` si el ejecutable de Gemini CLI está en ``PATH``."""
        return self._resolved_binary() is not None

    def _build_argv(self, prompt: str, *, headless: bool) -> list[str]:
        argv: list[str] = [self._binary(), _PROMPT_FLAG, prompt]
        if headless:
            argv.append(_HEADLESS_FLAG)
        model = self.config.get("model")
        if isinstance(model, str) and model:
            argv += ["--model", model]
        extra = self.config.get("extra_args")
        if isinstance(extra, (list, tuple)):
            argv += [str(a) for a in extra]
        return argv

    def run(
        self,
        prompt: str,
        *,
        headless: bool = True,
        cwd: Path,
        timeout_s: float | None = None,
    ) -> ProviderResult:
        """Lanza ``gemini -p <prompt>`` en ``cwd`` y captura la salida.

        Returns:
            :class:`ProviderResult`. Un timeout marca ``timed_out=True`` y
            ``exit_code=None`` en vez de propagar.

        Raises:
            ProviderNotAvailable: si el binario ``gemini`` no está instalado.
        """
        resolved = self._resolved_binary()
        if resolved is None:
            raise ProviderNotAvailable(
                f"No se encontró el ejecutable {self._binary()!r} en PATH. "
                "Instala Gemini CLI o define targets.gemini.binary en "
                "harness.config.yaml."
            )

        if timeout_s is None:
            cfg_timeout = self.config.get("timeout_s")
            timeout_s = float(cfg_timeout) if isinstance(cfg_timeout, (int, float)) else None

        argv = self._build_argv(prompt, headless=headless)
        argv[0] = resolved  # usa la ruta absoluta resuelta

        start = time.monotonic()
        try:
            completed = subprocess.run(  # noqa: S603 - argv local, sin shell
                argv,
                cwd=str(cwd),
                capture_output=True,
                text=True,
                timeout=timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            duration = time.monotonic() - start
            stdout = exc.stdout or ""
            stderr = exc.stderr or ""
            if isinstance(stdout, bytes):
                stdout = stdout.decode("utf-8", "replace")
            if isinstance(stderr, bytes):
                stderr = stderr.decode("utf-8", "replace")
            return ProviderResult(
                stdout=stdout,
                exit_code=None,
                stderr=stderr,
                timed_out=True,
                duration_s=duration,
            )

        duration = time.monotonic() - start
        return ProviderResult(
            stdout=completed.stdout or "",
            exit_code=completed.returncode,
            stderr=completed.stderr or "",
            timed_out=False,
            duration_s=duration,
        )
