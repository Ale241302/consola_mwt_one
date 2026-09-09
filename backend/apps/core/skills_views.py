"""
MWT.ONE · apps.core.skills_views
Endpoint PÚBLICO de descarga de las Skills-MCP por rol.

Las Skills-MCP son guías de operación por (rol, módulo, permiso) que se sirven
como árbol `Skills-MCP/<rol>/<modulo>/<permiso>/SKILL.md`. Este módulo las
empaqueta por rol en un ZIP descargable, para que el onboarding por correo
(mcp@mwt.one) incluya el link público y la IA del destinatario las instale.

Origen de datos (por orden):
  1. Carpeta local `Skills-MCP/` del repo (dev / si está montada en la imagen).
  2. Bucket MinIO `skills-mcp` (producción: el contenido se espejea ahí).

Rutas (sin auth a propósito: son guías de rol no sensibles):
  GET /api/skills-mcp/                 → manifest {roles:[{slug,nombre,skills,download}]}
  GET /api/skills-mcp/<rol>/download   → ZIP `{rol}-skills.zip`
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

_SKILLS_BUCKET = (os.environ.get("MWT_SKILLS_BUCKET") or "").strip() or "skills-mcp"


def _skills_root() -> Path:
    override = (os.environ.get("MWT_SKILLS_ROOT") or "").strip()
    if override:
        return Path(override)
    return Path(settings.BASE_DIR).parent / "Skills-MCP"


def _local_role_dir(rol: str) -> Path | None:
    d = _skills_root() / rol
    return d if d.is_dir() else None


def _minio_client():
    """Cliente MinIO lazy (misma config que apps.storage). None si no configurado."""
    endpoint = (getattr(settings, "MINIO_ENDPOINT", "") or "").strip()
    access = (getattr(settings, "MINIO_ACCESS_KEY", "") or "").strip()
    secret = (getattr(settings, "MINIO_SECRET_KEY", "") or "").strip()
    if not (endpoint and access and secret):
        return None
    from urllib.parse import urlparse

    from minio import Minio  # noqa: PLC0415
    parsed = urlparse(endpoint if "://" in endpoint else "http://" + endpoint)
    host = parsed.netloc or parsed.path
    secure = (parsed.scheme == "https") or bool(getattr(settings, "MINIO_SECURE", False))
    return Minio(host, access_key=access, secret_key=secret, secure=secure)


def _minio_entries(rol: str) -> list[tuple[str, object]] | None:
    """Devuelve [(object_name, size)] bajo skills-mcp/<rol>/ o None si no hay bucket."""
    client = _minio_client()
    if client is None:
        return None
    prefix = f"{rol}/"
    try:
        objs = list(client.list_objects(_SKILLS_BUCKET, prefix=prefix, recursive=True))
    except Exception:  # noqa: BLE001 - bucket no existe / sin acceso → None
        return None
    if not objs:
        return None
    return [(o.object_name, o.size) for o in objs if not o.object_name.endswith("/")]


def _count_role(rol: str) -> int:
    local = _local_role_dir(rol)
    if local is not None:
        return sum(1 for _ in local.rglob("SKILL.md"))
    entries = _minio_entries(rol)
    if entries is None:
        return 0
    return sum(1 for (name, _size) in entries if name.endswith("SKILL.md"))


def _build_zip(rol: str) -> bytes:
    """Arma el ZIP con el árbol del rol (local o MinIO). Devuelve bytes o lanza."""
    local = _local_role_dir(rol)
    buf = io.BytesIO()
    if local is not None:
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for p in sorted(local.rglob("*")):
                if p.is_file():
                    zf.write(p, p.relative_to(local.parent).as_posix())
    else:
        entries = _minio_entries(rol)
        if not entries:
            raise FileNotFoundError(rol)
        client = _minio_client()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for (name, _size) in sorted(entries):
                try:
                    data = client.get_object(_SKILLS_BUCKET, name).read()
                except Exception:  # noqa: BLE001 - un objeto fallido no tumba el zip
                    continue
                zf.writestr(name, data)
    buf.seek(0)
    return buf.getvalue()


def skills_manifest(request):
    """Lista los roles con skills disponibles y su URL de descarga."""
    roles = []
    for rol in SKILL_ROLES:
        roles.append({
            "slug": rol,
            "nombre": ROLE_LABELS.get(rol, rol),
            "skills": _count_role(rol),
            "download": f"/api/skills-mcp/{rol}/download",
        })
    return JsonResponse({
        "roles": roles,
        "total_skills": sum(r["skills"] for r in roles),
        "raiz": f"Skills-MCP (local | bucket {_SKILLS_BUCKET})",
    })


def skills_role_download(request, rol: str):
    """Devuelve un ZIP con el árbol de skills del rol."""
    rol = (rol or "").strip().lower()
    if rol not in SKILL_ROLES:
        return HttpResponse("Rol inválido.", status=404)
    try:
        data = _build_zip(rol)
    except FileNotFoundError:
        return HttpResponse("Skills no encontradas para ese rol.", status=404)
    resp = HttpResponse(data, content_type="application/zip")
    resp["Content-Disposition"] = f'attachment; filename="{rol}-skills.zip"'
    return resp
