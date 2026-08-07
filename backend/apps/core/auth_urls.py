"""MWT.ONE · apps.core.auth_urls — rutas de autenticación."""
from django.urls import path

from .auth_views import (
    LoginView, LogoutView, MeView, RefreshView,
    PasswordResetConfirmView, McpTokenView,
)


urlpatterns = [
    path("login/",   LoginView.as_view(),   name="auth-login"),
    path("logout/",  LogoutView.as_view(),  name="auth-logout"),
    path("refresh/", RefreshView.as_view(), name="auth-refresh"),
    path("me/",      MeView.as_view(),      name="auth-me"),
    path("mcp-token/", McpTokenView.as_view(), name="auth-mcp-token"),
    path("password-reset-confirm/",
         PasswordResetConfirmView.as_view(),
         name="auth-password-reset-confirm"),
]
