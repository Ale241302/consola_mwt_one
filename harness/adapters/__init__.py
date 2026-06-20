"""Transpiladores canónico → nativo (un adapter por CLI target).

Cada adapter implementa :class:`harness.adapters.base.Adapter`: lee la fuente
canónica (``canonical/``) y emite los artefactos derivados en el formato nativo
de su CLI. La interfaz y los dataclasses neutros viven en
:mod:`harness.adapters.base` y son el contrato estable que consumen las Fases 2 y 3.
"""

from __future__ import annotations

from .base import (
    Adapter,
    AgentSpec,
    CanonicalSpec,
    SkillSpec,
    ToolConfig,
)

__all__ = [
    "Adapter",
    "AgentSpec",
    "CanonicalSpec",
    "SkillSpec",
    "ToolConfig",
]
