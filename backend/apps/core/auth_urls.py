"""MWT.ONE · apps.core.auth_urls — rutas de autenticación."""
from django.urls import path

from .auth_views import (
    LoginView, LogoutView, MeView, RefreshView,
    PasswordResetConfirmView, McpTokenView, McpAuditView, McpDiagView,
    ServiceTokenRenewView, SystemHealthView,
)


urlpatterns = [
    path("login/",   LoginView.as_view(),   name="auth-login"),
    path("logout/",  LogoutView.as_view(),  name="auth-logout"),
    path("refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("me/",      MeView.as_view(),      name="auth-me"),
    path("mcp-token/", McpTokenView.as_view(), name="auth-mcp-token"),
    path("service-token/renew/", ServiceTokenRenewView.as_view(),
         name="auth-service-token-renew"),
    path("mcp-audit/", McpAuditView.as_view(), name="auth-mcp-audit"),
    path("mcp-diag/",  McpDiagView.as_view(),  name="auth-mcp-diag"),
    path("system-health/", SystemHealthView.as_view(), name="auth-system-health"),
    path("password-reset-confirm/",
         PasswordResetConfirmView.as_view(),
         name="auth-password-reset-confirm"),
]
