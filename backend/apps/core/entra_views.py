"""apps.core.entra_views — validación y OAuth Entra ID (M365 Copilot MCP).

  POST /api/entra/validate                → valida un Bearer token Entra
  GET  /api/entra/.well-known/oauth-authorization-server → metadatos OAuth
  GET  /api/entra/oauth/authorize         → redirige al login de Entra
  GET  /api/entra/oauth/callback          → intercambia el code
"""
import json

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import entra_oauth
from .entra_token import EntraTokenError, enabled, mwt_identity_from_claims, validate_entra_token


@csrf_exempt
@require_POST
def entra_validate(request):
    if not enabled():
        return JsonResponse({"detail": "Canal Entra desactivado."}, status=404)
    try:
        body = json.loads(request.body or b"{}")
    except Exception:  # noqa: BLE001
        body = {}
    token = str(body.get("token") or "").strip()
    if not token:
        return JsonResponse({"detail": "Falta token.", "code": "TOKEN_REQUERIDO"},
                            status=400)
    try:
        claims = validate_entra_token(token)
    except EntraTokenError as exc:
        return JsonResponse({"detail": exc.detail, "code": exc.code},
                            status=401 if exc.code not in ("NO_CONFIGURADO", "JWKS_FALLO")
                            else 502)
    ident = mwt_identity_from_claims(claims)
    if not ident.get("ok"):
        return JsonResponse({"detail": ident.get("detail"), "code": ident.get("code")},
                            status=403)
    return JsonResponse({
        "ok": True,
        "entra": {"email": claims.get("email") or claims.get("upn")
                             or claims.get("preferred_username"),
                  "tid": claims.get("tid"), "oid": claims.get("oid")},
        "usuario": ident["target"],
        "empresas_mcp": ident["clients"],
    })


def oauth_metadata(request):
    """Metadatos del authorization server (RFC 8414) para el cliente OAuth."""
    if not enabled():
        return JsonResponse({"detail": "Canal Entra desactivado."}, status=404)
    base = request.build_absolute_uri("/api/entra")
    return JsonResponse({
        "issuer": entra_oauth.issuer(),
        "authorization_endpoint": entra_oauth.authorization_endpoint(),
        "token_endpoint": entra_oauth.token_endpoint(),
        "jwks_uri": f"{entra_oauth.issuer().rstrip('/')}/.well-known/openid-configuration",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "scopes_supported": ["openid", "profile", "email", "offline_access"],
        "code_challenge_methods_supported": ["S256"],
        "service_documentation": base,
    })


def oauth_authorize(request):
    """Redirige al login de Entra (authorization code + PKCE)."""
    if not enabled():
        return JsonResponse({"detail": "Canal Entra desactivado."}, status=404)
    state = request.GET.get("state", "")
    url = entra_oauth.build_authorize_url(state=state)
    return HttpResponse(
        f'<html><body><a href="{url}">Autorizar con Microsoft</a> · '
        f'<script>window.location.href="{url}";</script></body></html>',
        status=302,
    )


def oauth_callback(request):
    """Recibe el code de Entra y lo intercambia por tokens."""
    if not enabled():
        return JsonResponse({"detail": "Canal Entra desactivado."}, status=404)
    code = request.GET.get("code") or ""
    if not code:
        return JsonResponse({"detail": "Falta code.",
                             "error": request.GET.get("error"),
                             "error_description": request.GET.get("error_description")},
                            status=400)
    try:
        tokens = entra_oauth.exchange_code(code=code)
    except Exception as exc:  # noqa: BLE001
        return JsonResponse({"detail": str(exc)[:300]}, status=502)
    email = (tokens.get("id_token_claims") or {}).get("email") \
        or tokens.get("id_token", "")[:40]
    return JsonResponse({
        "ok": True,
        "token_type": tokens.get("token_type"),
        "expires_in": tokens.get("expires_in"),
        "scope": tokens.get("scope"),
        "access_token": tokens.get("access_token", "")[:24] + "…" if tokens.get("access_token") else None,
        "id_token": (tokens.get("id_token") or "")[:24] + "…" if tokens.get("id_token") else None,
        "email": email,
        "nota": "En producción este callback completa el flujo y redirige; aquí solo confirma el intercambio.",
    })
