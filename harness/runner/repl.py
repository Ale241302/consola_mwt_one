"""ReplLoop — el bucle de orden superior: read → eval → print → gate → loop.

Envuelve un CLI de agente (vía un :class:`~harness.runner.providers.base.Provider`
**inyectado**) y aporta la orquestación que el CLI no da: alimentar tareas,
capturar salida, correr los gates verificables (``gates.py``) y decidir si
reintenta, escala o se detiene.

    READ  → :meth:`ReplLoop.read`     toma una tarea.
    EVAL  → :meth:`ReplLoop.evaluate` invoca el provider (subprocess headless).
    PRINT → :meth:`ReplLoop.print_result` persiste/loggea la salida.
    GATE  → :meth:`ReplLoop.gate`      corre :func:`~harness.runner.gates.run_gates`.
    LOOP  → :meth:`ReplLoop.loop`      orquesta con condición de parada:
            tarea resuelta / gate crítico fallado N veces / límite de iteraciones.

Inversión de dependencia: el bucle **no** conoce ningún CLI concreto. Recibe un
``Provider`` (Fase 2 = Claude; Fase 3 = Gemini/Kimi) y una fuente de tareas
(``task_source``, opcional — la Fase 4 conecta ``tasks.py``).

Ver ``harness/ARCHITECTURE.md`` §7/§8.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path

from .gates import GateVerdict, run_gates
from .providers.base import Provider, ProviderNotAvailable, ProviderResult

__all__ = ["StopReason", "IterationRecord", "LoopOutcome", "ReplLoop"]

_log = logging.getLogger("harness.runner.repl")


class StopReason(str, Enum):
    """Por qué el bucle se detuvo."""

    RESOLVED = "resolved"               # gates pasaron (entrega lista)
    GATE_EXHAUSTED = "gate_exhausted"   # gate crítico falló N veces seguidas
    MAX_ITERATIONS = "max_iterations"   # se agotó el presupuesto de iteraciones
    PROVIDER_ERROR = "provider_error"   # el CLI falló de forma no recuperable
    NO_TASK = "no_task"                 # READ no devolvió ninguna tarea


@dataclass(slots=True)
class IterationRecord:
    """Traza de una iteración del bucle (para PRINT/telemetría)."""

    index: int
    prompt: str
    result: ProviderResult | None
    verdict: GateVerdict | None
    note: str = ""


@dataclass(slots=True)
class LoopOutcome:
    """Resultado final de :meth:`ReplLoop.loop`."""

    stop_reason: StopReason
    iterations: list[IterationRecord] = field(default_factory=list)

    @property
    def resolved(self) -> bool:
        return self.stop_reason is StopReason.RESOLVED

    @property
    def last(self) -> IterationRecord | None:
        return self.iterations[-1] if self.iterations else None


# Firma de una fuente de tareas: devuelve la siguiente tarea (str) o None si la
# cola está vacía. La Fase 4 (tasks.py) implementará una concreta.
TaskSource = Callable[[], "str | None"]

# Firma de un colector de artefactos: dado el resultado del provider, devuelve
# las rutas a inspeccionar por los gates (p.ej. parsear `git diff`). Opcional.
ArtifactCollector = Callable[[ProviderResult], "list[Path]"]


class ReplLoop:
    """Bucle REPL de orden superior sobre un CLI inyectado.

    Args:
        provider: El :class:`Provider` que lanza el CLI (inyección de dependencia).
        cwd: Working dir del CLI (raíz del repo, normalmente).
        task_source: Callable que entrega la siguiente tarea (o ``None``). Si se
            omite, usa la(s) tarea(s) pasadas a :meth:`loop`/:meth:`run_once`.
        frontend_dir: Carpeta ``frontend/`` para el gate de build (opcional).
        max_iterations: Tope duro de iteraciones del bucle.
        max_gate_retries: Cuántas veces reintentar tras un fallo de gate crítico
            antes de rendirse (``GATE_EXHAUSTED``).
        artifact_collector: Cómo derivar paths a inspeccionar desde el resultado
            del provider. Por defecto usa ``result.artifacts``.
        provider_timeout_s: Timeout por invocación del CLI.
        printer: Sink de salida (default: logging). Recibe texto ya formateado.
    """

    def __init__(
        self,
        provider: Provider,
        *,
        cwd: Path,
        task_source: TaskSource | None = None,
        frontend_dir: Path | None = None,
        max_iterations: int = 6,
        max_gate_retries: int = 2,
        artifact_collector: ArtifactCollector | None = None,
        provider_timeout_s: float | None = None,
        printer: Callable[[str], None] | None = None,
    ) -> None:
        if max_iterations < 1:
            raise ValueError("max_iterations debe ser >= 1")
        if max_gate_retries < 0:
            raise ValueError("max_gate_retries debe ser >= 0")
        self.provider = provider
        self.cwd = cwd
        self.task_source = task_source
        self.frontend_dir = frontend_dir
        self.max_iterations = max_iterations
        self.max_gate_retries = max_gate_retries
        self.artifact_collector = artifact_collector
        self.provider_timeout_s = provider_timeout_s
        self._printer = printer or _log.info

    # ------------------------------------------------------------------ READ
    def read(self) -> str | None:
        """READ — obtiene la siguiente tarea de ``task_source`` (o ``None``)."""
        if self.task_source is None:
            return None
        return self.task_source()

    # ------------------------------------------------------------------ EVAL
    def evaluate(self, task: str) -> ProviderResult:
        """EVAL — invoca el CLI inyectado en modo headless con ``task``.

        Args:
            task: El prompt a ejecutar.

        Returns:
            El :class:`ProviderResult` del CLI.

        Raises:
            ProviderNotAvailable: si el CLI no está instalado (lo propaga
                :meth:`Provider.run`); :meth:`loop` lo captura y para con
                ``PROVIDER_ERROR``.
        """
        return self.provider.run(
            task,
            headless=True,
            cwd=self.cwd,
            timeout_s=self.provider_timeout_s,
        )

    # ----------------------------------------------------------------- PRINT
    def print_result(self, record: IterationRecord) -> None:
        """PRINT — materializa/loggea el resultado de una iteración."""
        lines = [f"[iter {record.index}] prompt: {record.prompt[:80]}"]
        if record.result is not None:
            r = record.result
            status = "timeout" if r.timed_out else f"exit={r.exit_code}"
            lines.append(f"  provider: {status} ({r.duration_s:.1f}s)")
            if r.stdout:
                lines.append(f"  stdout: {r.stdout.strip()[:200]}")
        if record.verdict is not None:
            lines.append("  " + record.verdict.summary().replace("\n", "\n  "))
        if record.note:
            lines.append(f"  note: {record.note}")
        self._printer("\n".join(lines))

    # ------------------------------------------------------------------ GATE
    def gate(
        self,
        result: ProviderResult,
        *,
        contents: Mapping[str, str] | None = None,
    ) -> GateVerdict:
        """GATE — corre el checklist verificable sobre los artefactos tocados.

        Deriva las rutas a inspeccionar con ``artifact_collector`` (o usa
        ``result.artifacts``) y delega en :func:`~harness.runner.gates.run_gates`.

        Args:
            result: Resultado del provider de esta iteración.
            contents: Fuentes en memoria a auditar (override/añadido; útil en tests
                cuando el CLI no escribe a disco).
        """
        if self.artifact_collector is not None:
            paths: list[Path] = self.artifact_collector(result)
        else:
            paths = list(result.artifacts)
        return run_gates(
            paths,
            frontend_dir=self.frontend_dir,
            contents=contents,
        )

    # ------------------------------------------------------------------ LOOP
    def _build_retry_prompt(self, original: str, verdict: GateVerdict) -> str:
        """Compone el prompt de reintento realimentando los gates fallados."""
        failures = verdict.critical_failures
        bullet = []
        for r in failures:
            bullet.append(f"- [{r.name}] {r.details}")
            for v in r.violations[:10]:
                bullet.append(f"    · {v}")
        return (
            f"{original}\n\n"
            "Los siguientes GATES CRÍTICOS fallaron en tu último intento. "
            "Corrige SOLO estas violaciones y vuelve a entregar:\n"
            + "\n".join(bullet)
        )

    def run_once(
        self,
        task: str,
        *,
        contents: Mapping[str, str] | None = None,
    ) -> LoopOutcome:
        """Ejecuta el ciclo EVAL→PRINT→GATE→reintento para una sola tarea.

        Reintenta mientras un gate crítico falle, hasta ``max_gate_retries`` o
        ``max_iterations``. Para con ``RESOLVED`` en cuanto los gates pasan.

        Args:
            task: La tarea/prompt inicial.
            contents: Fuentes en memoria a auditar en cada GATE (tests/pipe).

        Returns:
            El :class:`LoopOutcome`.
        """
        iterations: list[IterationRecord] = []
        prompt = task
        gate_failures = 0

        for i in range(1, self.max_iterations + 1):
            # EVAL
            try:
                result = self.evaluate(prompt)
            except ProviderNotAvailable as exc:
                rec = IterationRecord(i, prompt, None, None, note=f"provider no disponible: {exc}")
                iterations.append(rec)
                self.print_result(rec)
                return LoopOutcome(StopReason.PROVIDER_ERROR, iterations)

            # GATE
            verdict = self.gate(result, contents=contents)
            rec = IterationRecord(i, prompt, result, verdict)
            iterations.append(rec)
            self.print_result(rec)

            # ¿Resuelto?
            if verdict.passed:
                return LoopOutcome(StopReason.RESOLVED, iterations)

            # Gate crítico falló → ¿reintentar?
            gate_failures += 1
            if gate_failures > self.max_gate_retries:
                return LoopOutcome(StopReason.GATE_EXHAUSTED, iterations)
            if i >= self.max_iterations:
                break
            prompt = self._build_retry_prompt(task, verdict)

        return LoopOutcome(StopReason.MAX_ITERATIONS, iterations)

    def loop(
        self,
        tasks: Iterable[str] | None = None,
    ) -> list[LoopOutcome]:
        """LOOP — orquesta el bucle sobre una o varias tareas.

        Fuentes de tareas (en orden de prioridad):
          1. ``tasks`` explícito (iterable de prompts).
          2. ``task_source`` inyectado (se drena hasta que devuelva ``None``).

        Cada tarea pasa por :meth:`run_once`. Devuelve un outcome por tarea.

        Args:
            tasks: Prompts a ejecutar. Si ``None``, drena ``task_source``.

        Returns:
            Lista de :class:`LoopOutcome` (uno por tarea procesada). Vacía si no
            hubo ninguna tarea (``task_source`` agotado y ``tasks`` ausente).
        """
        outcomes: list[LoopOutcome] = []

        if tasks is not None:
            for task in tasks:
                outcomes.append(self.run_once(task))
            return outcomes

        # Drena la fuente inyectada.
        if self.task_source is None:
            self._printer("READ: sin task_source ni tasks explícitas; nada que hacer.")
            outcomes.append(LoopOutcome(StopReason.NO_TASK))
            return outcomes

        while True:
            task = self.read()
            if task is None:
                break
            outcomes.append(self.run_once(task))

        if not outcomes:
            outcomes.append(LoopOutcome(StopReason.NO_TASK))
        return outcomes
