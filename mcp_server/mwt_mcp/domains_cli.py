"""Ola 2 · 2.14 — Puntos de entrada por dominio (console scripts).

Uso (tras `pip install -e .` o construir la imagen):
    mwt-mcp-comercial          # servidor MCP dominio comercial
    mwt-mcp-logistica          # servidor MCP dominio logística
    mwt-mcp-finanzas           # servidor MCP dominio finanzas

Cada uno monta SOLO su subset de tools (más las compartidas) para reducir el
costo fijo de contexto por conversación. Mismo transporte que el monolito
(stdio por defecto; MWT_MCP_TRANSPORT=http para streamable-http).
"""
from __future__ import annotations

from .__main__ import run_domain


def main_comercial() -> None:
    run_domain("comercial")


def main_logistica() -> None:
    run_domain("logistica")


def main_finanzas() -> None:
    run_domain("finanzas")
