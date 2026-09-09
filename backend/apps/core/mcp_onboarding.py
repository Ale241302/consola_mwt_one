"""
=====================================================================
MWT.ONE · apps.core.mcp_onboarding
Onboarding MCP por correo (Fase 1) — servicio de dominio.

Resuelve el flujo "un correo llega a mcp@mwt.one describiendo a un
usuario (email [+ nombre])":

  · fetch_target()          → ¿existe el usuario? (core.users + scope)
  · mcp_clients_for_target()→ empresas del usuario que tienen app MCP
                              provisionada (core.mcp_app ∩ clientes).
  · decide_scenario()       → ok | no_registrado | inactivo | sin_mcp |
                              elegir_empresa
  · emit_grant()            → crea la credencial device-bound
                              (core.mcp_device_grant) revocando la previa.
  · build_package()         → arma el .json + .md que se adjunta al correo.

Nada de esto toca el transporte de correo (ver mcp_mailbox.py). Es puro
SQL/transacciones contra el mismo esquema que usa auth_views.
=====================================================================
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

from django.db import connection, transaction

log = logging.getLogger("mwt_mcp.onboarding")

# Estampas de vida del grant. El backend (Fase 3) marcará EXPIRED si la
# expira_at ya pasó al validar la conexión.
GRANT_TTL_DAYS = 7
GRANT_ESTADOS_ACTIVOS = ("ISSUED", "ACTIVE")

# Email que recibe las solicitudes (para no auto-detectar "mcp@mwt.one"
# como si fuera el target del cuerpo del correo).
SERVICE_EMAILS = {"mcp@mwt.one", "info@mwt.one", "mail.mwt.one"}

# ── Helpers de hash/secreto ───────────────────────────────────────────

def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def new_secret() -> str:
    """Secret opaco de un solo uso; viaja una única vez en el paquete."""
    return secrets.token_urlsafe(32)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Resolución del target (usuario descrito en el correo) ─────────────

def fetch_target(email: str) -> dict | None:
    """Devuelve el usuario objetivo con su rol y legal_entity_ids, o None.

    Espejo de `McpTokenView._fetch_target` (apps/core/auth_views.py): se
    busca en core.users (tabla de login) y se cruza por EMAIL con
    users.mwtuser para obtener el scope (legal_entity_ids).
    """
    email = (email or "").strip().lower()
    if not email:
        return None

    row = None
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.email_plain, u.full_name, u.role, u.is_active,
                   u.is_staff, u.last_login_at,
                   COALESCE(r.slug, u.role)  AS role_slug,
                   COALESCE(r.name, u.role)  AS role_name
              FROM core.users u
              LEFT JOIN core.user_roles ur ON ur.user_uuid = u.id
              LEFT JOIN core.roles      r  ON r.id         = ur.role_uuid
             WHERE lower(u.email_plain) = %s
               AND u.deleted_at IS NULL
             ORDER BY ur.granted_at ASC NULLS LAST
             LIMIT 1
            """,
            [email],
        )
        row = cur.fetchone()
        if row:
            uid, email_plain = row[0], row[1]
            leis = _user_legal_ids(email_plain)
            return {
                "user_uuid": str(uid),
                "email": (email_plain or "").lower(),
                "full_name": row[2],
                "role": row[3],
                "is_active": bool(row[4]),
                "is_staff": bool(row[5]),
                "role_slug": row[7] or row[3],
                "role_name": row[8],
                "legal_entity_ids": [str(x).lower() for x in leis if x],
            }

    # Fallback a users.mwtuser: un usuario "registrado" puede existir en
    # mwtuser (perfil/rol/legal_entity_ids) SIN fila en core.users — p.ej. si
    # se creó SIN password (invitación) o está inactivo y nunca se sincronizó
    # a la tabla de login. Sin esto, un usuario inactivo se veía como
    # "no registrado" en vez de "inactivo" (le mandaba el link de registro).
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT id::text, email_plain, full_name, is_active,
                       role_default, contact_email
                  FROM users.mwtuser
                 WHERE lower(trim(email_plain)) = %s
                 ORDER BY (CASE WHEN is_active THEN 0 ELSE 1 END),
                          updated_at DESC NULLS LAST
                 LIMIT 1
                """,
                [email],
            )
            mw = cur.fetchone()
            if mw:
                mid, email_plain, full_name, is_active, role_default, _ = mw
                leis = _user_legal_ids(email_plain or email)
                return {
                    "user_uuid": str(mid),
                    "email": (email_plain or email).lower(),
                    "full_name": full_name or "",
                    "role": role_default or "client_b2b",
                    "is_active": bool(is_active),
                    "is_staff": bool(is_active),
                    "role_slug": role_default or "client_b2b",
                    "role_name": role_default or "client_b2b",
                    "legal_entity_ids": [str(x).lower() for x in leis if x],
                }
    except Exception:  # noqa: BLE001
        pass
    return None


def _user_legal_ids(email_plain: str) -> list[str]:
    ids: list[str] = []
    if not email_plain:
        return ids
    try:
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                  FROM users.mwtuser
                 WHERE lower(trim(email_plain)) = %s
                    OR lower(trim(COALESCE(contact_email, ''))) = %s
                 ORDER BY (CASE WHEN is_active THEN 0 ELSE 1 END),
                          cardinality(COALESCE(legal_entity_ids, '{}'::TEXT[])) DESC,
                          updated_at DESC NULLS LAST
                 LIMIT 1
                """,
                [email_plain, email_plain],
            )
            mrow = cur.fetchone()
            if mrow and mrow[0]:
                ids = [str(x) for x in mrow[0] if x]
    except Exception:  # noqa: BLE001 — users.mwtuser puede no existir (legacy)
        pass
    return ids


# ── Empresas del usuario con app MCP provisionada ─────────────────────

def mcp_clients_for_target(target: dict) -> list[dict]:
    """Clientes (legal entities) del usuario que tienen MCP provisionado.

    Solo apps core.mcp_app estado='PROVISIONED', con mcp_url presente y
    cuyo cliente esté ACTIVO (is_active AND estado='ACTIVO').
    """
    leis = target.get("legal_entity_ids") or []
    if not leis:
        return []
    rows = []
    try:
        with connection.cursor() as cur:
            # Comparación por ::text: psycopg2 adapta la lista Python a un
            # array de texto; la comparación uuid=ANY(uuid[]) fallaba en silencio.
            cur.execute(
                """
                SELECT a.cliente_id::text, a.slug, a.nombre,
                       COALESCE(NULLIF(a.mcp_url, ''), NULL) AS mcp_url,
                       COALESCE(c.razon_social, a.nombre) AS razon_social,
                       c.nombre_comercial
                  FROM core.mcp_app a
                  JOIN clientes.cliente c ON c.id = a.cliente_id
                 WHERE a.cliente_id::text = ANY(%s)
                   AND a.estado = 'PROVISIONED'
                   AND a.mcp_url IS NOT NULL AND a.mcp_url <> ''
                   AND c.is_active = TRUE
                   AND c.estado = 'ACTIVO'
                 ORDER BY c.razon_social ASC
                """,
                [[str(x).lower() for x in leis]],
            )
            cols = [d[0] for d in cur.description]
            for r in cur.fetchall():
                rows.append(dict(zip(cols, r)))
    except Exception:  # noqa: BLE001
        log.exception("mcp_clients_for_target falló para %s", target.get("email"))
    return rows


# ── Coincidencia difusa de empresa (para el cuerpo del correo) ─────────

def _norm_name(s: str) -> str:
    """Normaliza texto: minúsculas, sin acentos, sin puntuación."""
    n = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", n.lower()).strip()


def match_clients_by_hint(clients: list[dict], hint: str) -> list[dict]:
    """Empareja un texto de empresa (posiblemente parcial) contra los MCP
    clients del usuario. Devuelve las coincidencias (substring en cualquier
    dirección, sin acentos/mayúsculas)."""
    nh = _norm_name(hint or "")
    if not nh:
        return []
    out = []
    for c in clients:
        cand = " ".join(x for x in [c.get("razon_social"), c.get("nombre"), c.get("slug")] if x)
        nc = _norm_name(cand)
        if nh and nc and (nh in nc or nc in nh):
            out.append(c)
    return out


def decide_scenario(email: str) -> dict:
    """Clasifica la solicitud para saber qué correo responder.

    Devuelve: {scenario, target?, client?, clients[], target_email}
    scenario ∈ ok | no_registrado | inactivo | sin_mcp | elegir_empresa
    """
    out: dict[str, Any] = {"target_email": (email or "").strip().lower()}
    target = fetch_target(email)
    if not target:
        out["scenario"] = "no_registrado"
        return out
    out["target"] = target
    if not target.get("is_active"):
        out["scenario"] = "inactivo"
        return out

    clients = mcp_clients_for_target(target)
    out["clients"] = clients
    if not clients:
        out["scenario"] = "sin_mcp"
        return out
    if len(clients) > 1:
        out["scenario"] = "elegir_empresa"
        return out

    out["client"] = clients[0]
    out["scenario"] = "ok"
    return out


# ── Emisión del grant (device-bound, single-active) ───────────────────

def emit_grant(
    target: dict,
    cliente_id: str,
    *,
    creado_via: str = "email",
    ip: str | None = None,
    mac: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """Crea la credencial device-bound para (usuario, empresa).

    - Revoca en la misma transacción cualquier grant ISSUED/ACTIVE previo
      del mismo par → "un solo paquete activo"; generar uno nuevo mata al
      anterior.
    - `ip`/`mac` se guardan como dato de la emisión (el vínculo real de la
      1ª conexión se registra al validar — Fase 3).
    - El secret se devuelve UNA sola vez aquí; en DB solo su hash.

    Devuelve dict con grant_id, secret, secret_prefix, expira_at, estado.
    """
    secret = new_secret()
    secret_prefix = secret[:8]
    expires = _now() + timedelta(days=GRANT_TTL_DAYS)

    with transaction.atomic():
        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE core.mcp_device_grant
                   SET estado = 'REVOKED', revocado_at = now(),
                       revoke_reason = 'replaced', updated_at = now()
                 WHERE user_uuid = %s AND cliente_id = %s
                   AND estado IN ('ISSUED', 'ACTIVE')
                """,
                [target["user_uuid"], cliente_id],
            )
            cur.execute(
                """
                INSERT INTO core.mcp_device_grant
                    (user_uuid, email, cliente_id, secret_hash, secret_prefix,
                     estado, creado_via, ip_vinculada, mac_reportado,
                     user_agent, expira_at)
                VALUES (%s, %s, %s, %s, %s, 'ISSUED', %s, %s, %s, %s, %s)
                RETURNING id, expira_at
                """,
                [
                    target["user_uuid"],
                    target["email"],
                    cliente_id,
                    hash_secret(secret),
                    secret_prefix,
                    creado_via,
                    (ip or None),
                    (mac or None),
                    (user_agent or None),
                    expires,
                ],
            )
            gid, exp = cur.fetchone()

    return {
        "grant_id": str(gid),
        "secret": secret,
        "secret_prefix": secret_prefix,
        "expira_at": exp,
        "expira_iso": exp.isoformat() if exp else None,
        "estado": "ISSUED",
        "user_uuid": str(target["user_uuid"]),
        "cliente_id": str(cliente_id),
    }


def find_active_grant(user_uuid: str, cliente_id: str) -> dict | None:
    """Devuelve el grant ISSUED/ACTIVE del par si existe (para listar en UI)."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, email, secret_prefix, estado, creado_via,
                   expira_at, revocado_at, revoke_reason,
                   ip_vinculada::text, primera_conexion_at
              FROM core.mcp_device_grant
             WHERE user_uuid = %s AND cliente_id = %s
               AND estado IN ('ISSUED', 'ACTIVE')
             ORDER BY created_at DESC LIMIT 1
            """,
            [user_uuid, cliente_id],
        )
        row = cur.fetchone()
        if not row:
            return None
        cols = ["grant_id", "email", "secret_prefix", "estado", "creado_via",
                "expira_at", "revocado_at", "revoke_reason", "ip_vinculada",
                "primera_conexion_at"]
        return dict(zip(cols, row))


# ── Paquete de credenciales (.json + .md) ─────────────────────────────

def _slug_fname(slug: str, suffix: str) -> str:
    safe = "".join(ch for ch in (slug or "mcp").lower() if ch.isalnum() or ch in "-_")
    return f"mwt-{safe}{suffix}"


def build_package(client: dict, target: dict, grant: dict) -> dict:
    """Construye el contenido de los adjuntos .json y .md del correo."""
    slug = client.get("slug") or "mcp"
    razon = client.get("razon_social") or client.get("nombre") or slug
    # Endpoint de conexión del DeviceToken: nginx /device proxya directo al
    # MCP (sin ContextForge/OAuth). Sobrescribible con MWT_MCP_DEVICE_URL.
    mcp_url = (os.environ.get("MWT_MCP_DEVICE_URL") or "").strip() or "https://mcp.mwt.one/device"
    secret = grant["secret"]
    email = target["email"]
    full_name = target.get("full_name") or ""

    # Rol del usuario (role_default). El paquete entrega las Skills-MCP de ese rol.
    from .skills_views import ROLE_LABELS as _SKILL_ROLE_LABELS
    from .skills_views import SKILL_ROLES as _SKILL_ROLES
    rol = (target.get("role_slug") or target.get("role") or "client_b2b").lower()
    if rol not in _SKILL_ROLES:
        rol = "client_b2b"
    rol_nombre = _SKILL_ROLE_LABELS.get(rol, rol)
    # Base pública de descarga de skills (sobrescribible por entorno).
    skills_base = (os.environ.get("MWT_SKILLS_BASE") or "").strip() \
        or "https://consola.mwt.one/api/skills-mcp"
    skills_url = f"{skills_base}/{rol}/download"

    json_payload = {
        "tipo": "credencial-mcp-mwt",
        "version": 1,
        "usuario": {
            "email": email,
            "nombre": full_name,
            "empresa": razon,
            "rol": rol,
            "rol_nombre": rol_nombre,
        },
        "credencial": {
            "esquema": "DeviceToken",
            "token": secret,
            "mcp_url": mcp_url,
            "emitido_iso": datetime.now(timezone.utc).isoformat(),
            "expira_iso": grant.get("expira_iso"),
            "empresa_id": client.get("cliente_id"),
        },
        "reglas": {
            "single_use": True,
            "device_binding": "ip+secret",
            "reemitir_revoca_anterior": True,
        },
        # Config estándar para clientes MCP que aceptan servidores remotos
        # por URL con headers (Claude Desktop, opencode, Antigravity, etc.).
        # Según el cliente de IA, la forma de pegar esto varía — ver el .md.
        "mcpServers": {
            slug: {
                "url": mcp_url,
                "headers": {"Authorization": f"DeviceToken {secret}"},
            }
        },
        # Skills-MCP del rol: la IA del destinatario debe descargar este ZIP
        # e instalarlo para operar con guías (flujos + anti-patrones) del rol.
        "skills": {
            "rol": rol,
            "rol_nombre": rol_nombre,
            "carpeta": f"Skills-MCP/{rol}",
            "descargar": skills_url,
            "instalar": (
                "Descarga el ZIP de la URL 'descargar', extráelo en la carpeta "
                "de skills de tu agente (p. ej. ~/.claude/skills/ o .opencode/skills/ "
                "del proyecto) y quedará el árbol <modulo>/<permiso>/SKILL.md. "
                "Cada SKILL.md se detecta por su frontmatter name=... y describe "
                "las tools MCP permitidas para ese rol/módulo/permiso, sus flujos "
                "y anti-patrones."
            ),
        },
    }

    md_lines = [
        f"# Credencial MCP · {razon}",
        "",
        f"- **Usuario:** {full_name} <{email}>",
        f"- **Empresa:** {razon}",
        f"- **Tu rol en MWT.ONE:** {rol_nombre} ({rol})",
        f"- **Servidor MCP:** {mcp_url or '(por confirmar en la activación)'}",
        "",
        "## Qué hacer con este paquete (pásalo a tu IA)",
        "",
        "Este `.md` + el `.json` adjunto son para que **tu asistente de IA** "
        "(Claude Code, opencode, Gemini CLI, ChatGPT, Cursor, etc.) configure su "
        "acceso. Dale ambos archivos y pídele que haga estos 3 pasos:",
        "",
        "### 1 · Conectar el servidor MCP",
        "",
        "Registrar el servidor MCP remoto usando el contenido del `.json` "
        "(o agregar un servidor con la `url` y el header "
        "`Authorization: DeviceToken <token>` que ahí aparecen).",
        "Tras conectarlo debería **listar las tools del portal MWT.ONE** "
        f"correspondientes a tu rol **{rol_nombre} ({rol})**.",
        "",
        f"### 2 · Instalar las Skills-MCP de tu rol **{rol_nombre} ({rol})**",
        "",
        "Descarga el ZIP de skills de tu rol desde esta URL pública:",
        "",
        f"    {skills_url}",
        "",
        "Extrae el ZIP en la carpeta de skills de tu agente:",
        "- Claude Code: `~/.claude/skills/` (o `.claude/skills/` en el proyecto).",
        "- opencode: `.opencode/skills/` (o la carpeta que uses para skills).",
        "- Otros agentes compatibles con SKILL.md: su carpeta de skills.",
        "",
        "Quedará el árbol `{rol}/<módulo>/<permiso>/SKILL.md`. Cada SKILL.md es una "
        "guía de operación para UNA tool/acción de tu rol: qué tool usar, su firma, "
        "los flujos correctos y los anti-patrones. Son skills 'avanzadas' para que "
        "la IA opere con criterio, no a ciegas.",
        "",
        "### 3 · Verificar",
        "",
        "Pídele a tu IA que ejecute `mwt_whoami` para confirmar que conecta con el "
        f"rol **{rol}** y que ya ve las tools de su matriz de permisos.",
        "",
        "> IMPORTANTE · UN SOLO USO POR EQUIPO",
        ">",
        f"> Esta credencial se vincula al primer equipo/IP desde el que se conecte (token `{grant['secret_prefix']}…`).",
        "> Si intentas usarla desde OTRO computador, el servidor la rechaza "
        "y debes generar una nueva.",
        "> Generar un paquete nuevo para tu cuenta REVOCA automáticamente "
        "este (deja de funcionar en el equipo anterior).",
        "",
        "## Si algo falla",
        "",
        "- El paquete expira el " + (grant.get("expira_iso") or "…") +
        " si no se usa.",
        "- Si la IA no ve una tool, puede ser que tu rol no tenga ese permiso "
        "(matriz de /roles). Para regenerar credenciales, escribe a **mcp@mwt.one** "
        "desde tu correo registrado indicando tu email y empresa.",
        "- No compartas este archivo: es tu llave de acceso.",
        "",
        "— MWT.ONE",
    ]
    md_text = "\n".join(md_lines)

    return {
        "fname_json": _slug_fname(slug, ".credencial.json"),
        "json_text": json.dumps(json_payload, ensure_ascii=False, indent=2),
        "fname_md": _slug_fname(slug, ".INSTRUCCIONES.md"),
        "md_text": md_text,
        "mime_json": "application/json",
        "mime_md": "text/markdown",
        "slug": slug,
        "razon_social": razon,
    }


def full_package_for_email(email: str) -> dict:
    """Helper para tests/CLI: decide + emite + arma paquete (o None)."""
    decision = decide_scenario(email)
    if decision.get("scenario") != "ok":
        return {"decision": decision, "package": None}
    target = decision["target"]
    client = decision["client"]
    grant = emit_grant(target, client["cliente_id"], creado_via="email")
    package = build_package(client, target, grant)
    return {"decision": decision, "grant": grant, "package": package}
