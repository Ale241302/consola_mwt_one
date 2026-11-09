"""Enmascarado de secretos de credenciales (harness Ajuste B1).

El Client Secret de la app MCP del cliente es secreto: no debe viajar en cada
respuesta de cliente (`cliente_obtener`, `cliente_editar`, `GET mcp-app/`).
`mcp_server/mwt_mcp/redact.py` ya lo lista en `CEO_ONLY_KEYS`, pero el rol
`agente_mcp` y el propio backend lo devolvían completo. El 08/11/2026 salió la
clave completa de Importaciones y Compras al enlazarla con Imporcomp.

Regla: toda lectura devuelve el marcador. La única entrega deliberada del
secreto es la respuesta de `mcp-app/provision` (alta o rotación), que queda
registrada en el log de la vista.
"""
from __future__ import annotations

SECRET_MASK = "***"


def mask_secret(value) -> str | None:
    """Devuelve el secreto enmascarado, o None si no hay secreto."""
    if not value:
        return None
    return SECRET_MASK


def secret_is_set(value) -> bool:
    """True si hay secreto guardado, sin revelarlo."""
    return bool(value)
