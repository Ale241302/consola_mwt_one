"""
=====================================================================
MWT.ONE · apps.core.authentication
Agente responsable: [AG-BACKEND]
Ola 1 — F3: autenticación por ServiceToken opaco.

Uso:
    Authorization: ServiceToken <64-hex>

El token se hashea con SHA-256 y se busca en core.service_token.
Si es válido, no expirado y no revocado, se construye un MwtUser con rol
"service" y permisos derivados de core.service_token_scope.
=====================================================================
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

from django.db import connection
from rest_framework import authentication, exceptions

from .jwt_auth import MwtUser


SERVICE_TOKEN_HEADER = "HTTP_AUTHORIZATION"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class ServiceTokenUser(MwtUser):
    """MwtUser especializado para tokens de servicio."""

    is_service_token = True

    def __init__(self, token_id, name, role_slug, scopes, client_ids, permissions):
        super().__init__(
            user_id=str(token_id),
            email=f"service:{name}",
            full_name=name,
            role=role_slug,
            permissions=permissions,
            is_active=True,
            legal_entity_ids=[str(x).lower() for x in (client_ids or []) if x],
        )
        self.scopes = list(scopes or [])
        self.client_ids = list(self.legal_entity_ids)
        self.token_id = str(token_id)

    def has_scope(self, scope: str) -> bool:
        if not scope:
            return False
        if scope in self.scopes:
            return True
        # wildcard: "mcp:*" coincide con "mcp:read" si está en scopes.
        prefix = scope.split(":", 1)[0] + ":*"
        return prefix in self.scopes


class MwtServiceTokenAuthentication(authentication.BaseAuthentication):
    """
    Autentica requests con:
        Authorization: ServiceToken <token>
    """

    keyword = "ServiceToken"

    def authenticate(self, request):
        auth_header = request.META.get(SERVICE_TOKEN_HEADER, "")
        if not auth_header:
            return None

        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != self.keyword.lower():
            return None

        token = parts[1]
        if not token:
            raise exceptions.AuthenticationFailed("Token vacío")

        token_hash = _hash_token(token)

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT t.id, t.name, t.role_slug, t.expires_at, t.revoked_at,
                       array_agg(DISTINCT s.scope) FILTER (WHERE s.scope IS NOT NULL) AS scopes,
                       array_agg(DISTINCT s.client_id) FILTER (WHERE s.client_id IS NOT NULL) AS client_ids
                FROM core.service_token t
                LEFT JOIN core.service_token_scope s ON s.service_token_id = t.id
                WHERE t.token_hash = %s
                  AND t.is_active = TRUE
                GROUP BY t.id
                LIMIT 1
                """,
                [token_hash],
            )
            row = cur.fetchone()

        if not row:
            raise exceptions.AuthenticationFailed("Token inválido")

        token_id, name, role_slug, expires_at, revoked_at, scopes, client_ids = row

        if revoked_at:
            raise exceptions.AuthenticationFailed("Token revocado")

        if expires_at and expires_at < _now():
            raise exceptions.AuthenticationFailed("Token expirado")

        if role_slug in ("admin", "superadmin"):
            raise exceptions.AuthenticationFailed(
                "Rol de servicio no puede ser admin/superadmin"
            )

        # Derivar permisos a partir de scopes para que RoleBasedPermission
        # pueda evaluar required_module sin cambios mayores.
        modules = set()
        actions = set()
        for sc in (scopes or []):
            if sc.startswith("mcp:"):
                modules.add("mcp")
                if sc in ("mcp:read", "mcp:write", "mcp:token_exchange"):
                    actions.add(f"mcp.{sc.split(':')[1]}")
            elif ":" in sc:
                mod = sc.split(":", 1)[0]
                modules.add(mod)
                actions.add(f"{mod}.{sc.split(':')[1]}")
            else:
                modules.add(sc)

        permissions = {"modules": sorted(modules), "actions": sorted(actions)}

        user = ServiceTokenUser(
            token_id=token_id,
            name=name,
            role_slug=role_slug or "service",
            scopes=scopes or [],
            client_ids=client_ids or [],
            permissions=permissions,
        )

        # Actualizar last_used_at de forma best-effort (no falla auth).
        try:
            with connection.cursor() as cur:
                cur.execute(
                    "UPDATE core.service_token SET last_used_at = NOW() WHERE id = %s",
                    [token_id],
                )
        except Exception:
            pass

        return (user, {
            "token_id": str(token_id),
            "name": name,
            "scopes": scopes or [],
            "client_ids": [str(x) for x in (client_ids or []) if x],
        })
