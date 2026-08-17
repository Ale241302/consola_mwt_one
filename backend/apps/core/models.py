"""
=====================================================================
MWT.ONE · apps.core.models
Modelos Django `managed = False` para tablas creadas por SQL puro.
Agente responsable: [AG-DATABASE]
=====================================================================
"""
from django.db import models


class TokenDenylist(models.Model):
    """Ver backend/sql/06_core_token_denylist.sql."""
    jti = models.TextField(primary_key=True)
    token_type = models.TextField(default="access")
    user_uuid = models.UUIDField(null=True, blank=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(auto_now_add=True)
    revoked_by = models.UUIDField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'core"."token_denylist'


class ServiceToken(models.Model):
    """Token opaco de servicio (MCP gateway, otros servicios internos).
    Ver backend/sql/07_core_service_tokens.sql.
    """
    id = models.UUIDField(primary_key=True)
    name = models.TextField()
    token_hash = models.TextField(unique=True)
    role_slug = models.TextField(default="service")
    is_active = models.BooleanField(default=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_by_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'core"."service_token'


class ServiceTokenScope(models.Model):
    """Scope + client_id permitidos para un ServiceToken."""
    id = models.UUIDField(primary_key=True)
    service_token = models.ForeignKey(
        ServiceToken,
        on_delete=models.CASCADE,
        db_column="service_token_id",
        related_name="scopes",
    )
    scope = models.TextField()
    client_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = 'core"."service_token_scope'


class McpApp(models.Model):
    """App MCP por cliente (Ola 1 · 1.5). Ver backend/sql/H1_mcp_app_por_cliente.sql.

    Relaciona un Cliente (clientes.cliente) con su Application en Authentik y
    su ServiceToken scopeado. Expone en la consola la URL del servidor MCP
    remoto y las credenciales OAuth (Client ID/Secret).
    """
    id = models.UUIDField(primary_key=True)
    cliente_id = models.UUIDField(unique=True)
    slug = models.TextField(unique=True)
    nombre = models.TextField(default="")
    authentik_application_uid = models.UUIDField(null=True, blank=True)
    authentik_provider_pk = models.IntegerField(null=True, blank=True)
    oauth_client_id = models.TextField(null=True, blank=True)
    oauth_client_secret = models.TextField(null=True, blank=True)
    mcp_url = models.TextField(null=True, blank=True)
    service_token_id = models.UUIDField(null=True, blank=True)
    estado = models.TextField(default="PROVISIONED")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'core"."mcp_app'
