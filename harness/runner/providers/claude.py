"""ClaudeProvider — lanza Claude Code en modo headless vía subprocess.

Claude Code soporta un **modo no-interactivo** ("print mode") que ejecuta un
prompt, imprime el resultado en stdout y sale, sin TTY ni REPL interactivo. El
flag canónico es ``-p`` / ``--print``::

    claude -p "<prompt>"            # imprime y sale
    claude --print "<prompt>" --output-format text

Este provider envuelve ese modo: construye el argv, lanza el proceso en ``cwd``,
aplica timeout, captura stdout/stderr y devuelve un :class:`ProviderResult`.

Robustez:
  - Si el binario ``claude`` no está en ``PATH``, :meth:`run` lanza
    :class:`ProviderNotAvailable` con un mensaje claro (NO crashea el import).
  - Un timeout no es excepción: se refleja en ``timed_out`` / ``exit_code=None``.

Ver ``harness/ARCHITECTURE.md`` §7 (contrato I/O delgado: prompt + headless +
parsing de salida).
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path

from .base import Provider, ProviderNotAvailable, ProviderResult

__all__ = ["ClaudeProvider"]

#: Nombre del ejecutable de Claude Code en PATH (override vía config["binary"]).
_DEFAULT_BINARY = "claude"

#: Flag de modo headless / print (no-interactivo). Documentado arriba.
_HEADLESS_FLAG = "--print"


class ClaudeProvider(Provider):
    """Provider que envuelve el CLI de Claude Code en modo ``--print``.

    Config soportada (de ``harness.config.yaml`` → ``targets.claude``):
        binary: ruta/nombre del ejecutable (default ``"claude"``).
        model:  modelo a pasar con ``--model`` (opcional).
        extra_args: lista de flags adicionales (p.ej. permisos/output-format).
        timeout_s: timeout por defecto si :meth:`run` no recibe uno.
    """

    name = "claude"

    def _binary(self) -> str:
        binary = self.config.get("binary")
        return str(binary) if isinstance(binary, str) and binary else _DEFAULT_BINARY

    def _resolved_binary(self) -> str | None:
        """Ruta absoluta del binario en PATH, o ``None`` si no se encuentra."""
        return shutil.which(self._binary())

    def available(self) -> bool:
        """``True`` si el ejecutable de Claude Code está en ``PATH``."""
        return self._resolved_binary() is not None

    def _build_argv(self, prompt: str, *, headless: bool) -> list[str]:
        argv: list[str] = [self._binary()]
        if headless:
            argv.append(_HEADLESS_FLAG)
        model = self.config.get("model")
        if isinstance(model, str) and model:
            argv += ["--model", model]
        extra = self.config.get("extra_args")
        if isinstance(extra, (list, tuple)):
            argv += [str(a) for a in extra]
        argv.append(prompt)
        return argv

    def run(
        self,
        prompt: str,
        *,
        headless: bool = True,
        cwd: Path,
        timeout_s: float | None = None,
    ) -> ProviderResult:
        """Lanza ``claude --print <prompt>`` en ``cwd`` y captura la salida.

        Args:
            prompt: El prompt/tarea para Claude Code.
            headless: ``True`` (default) añade ``--print``.
            cwd: Working dir del proceso.
            timeout_s: Timeout; ``None`` cae al ``config["timeout_s"]`` si existe.

        Returns:
            :class:`ProviderResult`. Un timeout marca ``timed_out=True`` y
            ``exit_code=None`` en vez de propagar la excepción.

        Raises:
            ProviderNotAvailable: si el binario ``claude`` no está instalado.
        """
        resolved = self._resolved_binary()
        if resolved is None:
            raise ProviderNotAvailable(
                f"No se encontró el ejecutable {self._binary()!r} en PATH. "
                "Instala Claude Code (https://docs.claude.com/claude-code) o "
                "define targets.claude.binary en harness.config.yaml."
            )

        if timeout_s is None:
            cfg_timeout = self.config.get("timeout_s")
            timeout_s = float(cfg_timeout) if isinstance(cfg_timeout, (int, float)) else None

        argv = self._build_argv(prompt, headless=headless)
        argv[0] = resolved  # usa la ruta absoluta resuelta

        start = time.monotonic()
        try:
            completed = subprocess.run(  # noqa: S603 - argv construido localmente, sin shell
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
