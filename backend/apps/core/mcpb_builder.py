"""
MWT.ONE · apps.core.mcpb_builder
Genera el bundle `.MCPB` (Claude Desktop extension) para instalar el MCP remoto
por arrastrar y soltar.

⚠️ CANDIDATO: el formato `.MCPB` es Preview y no tiene schema público verificado.
Este builder arma un zip con un manifest de extensión (best-effort) + la
definición del servidor MCP remoto (type http) + las skills del rol. Se valida
arrastrándolo en Claude Desktop → Extensiones; si lo rechaza, se ajusta con el
error que muestre la app.
"""
from __future__ import annotations

import io
import json
import zipfile

from .skills_views import ROLE_LABELS


def build_mcpb(*, slug: str, razon: str, mcp_url: str, token: str,
               rol: str, role_label: str | None = None,
               skills_base: str = "https://consola.mwt.one/api/skills-mcp") -> tuple[str, bytes]:
    """Devuelve (fname, bytes) del bundle `.MCPB`.

    Contenido (zip):
      extension.json   → manifest de la extensión (metadata + mcp server)
      INSTRUCCIONES.md → mini-guía (opcional, útil al abrir el bundle)
      skills/<rol>/    → skills del rol (si el extractor/Claude las usa)
    """
    role_label = role_label or ROLE_LABELS.get(rol, rol)
    server_name = slug
    manifest = {
        "id": f"mwt-one-{slug}",
        "name": f"mwt-one-{slug}",
        "display_name": f"MWT ONE · {razon}",
        "version": "1.0.0",
        "description": f"Acceso MCP de MWT.ONE para {razon} (rol {role_label}).",
        "author": {"name": "MWT.ONE", "url": "https://consola.mwt.one"},
        "homepage_url": "https://consola.mwt.one",
        "publisher": "MWT.ONE",
        "kind": "mcp",
        "type": "mcp",
        "capabilities": {"mcp_servers": True},
        "mcpServers": {
            server_name: {
                "type": "http",
                "url": mcp_url,
                "headers": {"Authorization": f"DeviceToken {token}"},
            }
        },
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Claude Desktop (DXT) requiere manifest.json en la raíz del bundle.
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr(
            "INSTRUCCIONES.md",
            "# Instalación MWT.ONE · " + razon + "\n\n"
            "Este bundle instala el servidor MCP remoto de MWT.ONE en Claude Desktop.\n\n"
            "1. Arrastrá este archivo .MCPB a la pantalla de Extensiones de Claude Desktop.\n"
            "2. Aceptá la confianza y confirmá.\n"
            "3. Verificá con la tool `mwt_whoami` (rol " + role_label + ").\n\n"
            "Token de un solo uso, vinculado al primer equipo/IP que se conecte.\n",
        )
        zf.writestr("skills/.keep", "")
    buf.seek(0)
    return f"{slug}.MCPB", buf.getvalue()
