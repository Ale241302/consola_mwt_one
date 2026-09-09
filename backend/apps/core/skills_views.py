"""
MWT.ONE · apps.core.skills_views
Endpoint PÚBLICO de descarga de las Skills-MCP por rol.

Las Skills-MCP son guías de operación por (rol, módulo, permiso) que se sirven
como árbol estático `Skills-MCP/<rol>/<modulo>/<permiso>/SKILL.md`. Este módulo
las empaqueta por rol en un ZIP descargable, para que el onboarding por correo
(mcp@mwt.one) incluya el link público y la IA del destinatario las instale.

Rutas:
  GET /api/skills-mcp/                    → manifest {roles:[{slug,skills,download}]}
  GET /api/skills-mcp/<rol>/download      → ZIP `{rol}-skills.zip`

Raíz configurable con MWT_SKILLS_ROOT (default: <repo>/Skills-MCP). Sin auth a
propósito: son guías de rol no sensibles (el RBAC real vive en las tools MCP).
"""
import io
import os
import zipfile
from pathlib import Path

from django.conf import settings
from django.http import HttpResponse, JsonResponse

SKILL_ROLES: tuple[str, ...] = (
    "superadmin", "admin", "manager", "operator",
    "finance", "compras", "viewer", "client_b2b",
)

ROLE_LABELS: dict[str, str] = {
    "superadmin": "Super Admin",
    "admin": "Admin (CEO)",
    "manager": "Manager",
    "operator": "Operador",
    "finance": "Finance",
    "compras": "Compras",
    "viewer": "Viewer (solo lectura)",
    "client_b2b": "Cliente B2B",
}


def _skills_root() -> Path:
    override = (os.environ.get("MWT_SKILLS_ROOT") or "").strip()
    if override:
        return Path(override)
    return Path(settings.BASE_DIR).parent / "Skills-MCP"


def skills_manifest(request):
    """Lista los roles con skills disponibles y su URL de descarga."""
    root = _skills_root()
    roles = []
    for rol in SKILL_ROLES:
        d = root / rol
        n = sum(1 for _ in d.rglob("SKILL.md")) if d.is_dir() else 0
        roles.append({
            "slug": rol,
            "nombre": ROLE_LABELS.get(rol, rol),
            "skills": n,
            "download": f"/api/skills-mcp/{rol}/download",
        })
    return JsonResponse({
        "roles": roles,
        "total_skills": sum(r["skills"] for r in roles),
        "raiz": "Skills-MCP",
    })


def skills_role_download(request, rol: str):
    """Devuelve un ZIP con el árbol Skills-MCP/<rol>/ completo."""
    rol = (rol or "").strip().lower()
    if rol not in SKILL_ROLES:
        return HttpResponse("Rol inválido.", status=404)
    src = _skills_root() / rol
    if not src.is_dir():
        return HttpResponse("Skills no encontradas para ese rol.", status=404)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(src.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(src.parent).as_posix())
    buf.seek(0)
    resp = HttpResponse(buf.getvalue(), content_type="application/zip")
    resp["Content-Disposition"] = f'attachment; filename="{rol}-skills.zip"'
    return resp
