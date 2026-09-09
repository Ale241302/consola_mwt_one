"""apps.core.entra_views — validación del token Entra (M365 Copilot MCP).

POST /api/entra/validate   body {token}
  → valida el token Entra y mapea al usuario de la consola MWT (por email).
  Devuelve identidad + empresas con MCP. Activo solo con MWT_ENTRA_ENABLED=1.
"""
import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

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
