"""Harness MWT — bucle de agentes multi-IA (Claude / Gemini / Kimi).

Paquete raíz del harness de ingeniería de agentes de MWT.ONE. Implementa la
estrategia "estándar de archivos común + wrap de CLIs": una fuente canónica
versionada (``harness/canonical/``) y transpiladores por destino
(``harness/adapters/``) que la materializan en el formato nativo de cada CLI.

Ver ``harness/ARCHITECTURE.md`` para el contrato de diseño completo.
"""

from __future__ import annotations

__all__ = ["__version__"]

#: Versión del harness (Fase 0 — esqueleto).
__version__ = "0.0.0"
