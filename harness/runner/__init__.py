"""Harness MWT — runner: el bucle REPL de orden superior + gates.

Esta es la **Fase 2** del harness (ver ``harness/ARCHITECTURE.md`` §7 y §8). El
runner *envuelve* un CLI de agente (Claude Code hoy; Gemini/Kimi en la Fase 3) y
aporta la orquestación de un nivel superior sobre el REPL interno del CLI:

    READ  → toma una tarea (prompt directo o item de cola).
    EVAL  → invoca el CLI vía un :class:`~harness.runner.providers.base.Provider`
            en modo headless (inversión de dependencia: el runner no conoce el
            CLI concreto).
    PRINT → captura stdout / diff / artefactos.
    GATE  → corre los checklists verificables (``gates.py``): cero hex (R1),
            tabular-nums (R5), fuga de visibilidad CEO→CLIENT (R3), bloqueo de
            migraciones Django (SQL-first), build real de Vite con esbuild.
    LOOP  → si un gate CRÍTICO falla → realimenta el error y reintenta o escala;
            si pasa → entrega. Condición de parada: resuelto / gate fallado N
            veces / límite de iteraciones.

Piezas públicas (consumidas por las Fases 3 y 4):

    - :class:`~harness.runner.repl.ReplLoop`         — el bucle.
    - :class:`~harness.runner.providers.base.Provider` — interfaz de lanzamiento.
    - :class:`~harness.runner.providers.base.ProviderResult`
    - :class:`~harness.runner.gates.GateResult` / :func:`~harness.runner.gates.run_gates`
"""

from __future__ import annotations

__all__ = ["__phase__"]

#: Fase del harness que implementa este subpaquete.
__phase__ = "2 — runner REPL + gates"
