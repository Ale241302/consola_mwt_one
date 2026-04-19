"""
=====================================================================
MWT.ONE · apps.core.auth_views
Agente responsable: [AG-BACKEND]

Flujo de autenticación:
  1. POST /api/auth/login/
     Body: { usuario: "alejandro@muitowork.com" | "admin", password: "…" }
     · Se busca el usuario por email_plain (case-insensitive) o por el
       segmento local del email (antes del @).
     · Se hashea el password con SHA-256 y se compara contra
       core.users.password_hash. Si el hash_kind es otro (pbkdf2, bcrypt,
       argon2) se delega a Django / passlib. Por ahora la semilla usa
       'sha256' así que ese es el camino activo.
     · Se emite JWT access + refresh (SimpleJWT) usando el UUID como
       identificador.
     · Se adjunta el perfil + permisos del rol asociado (core.user_roles
       → core.roles.permissions).

  2. POST /api/auth/refresh/   → rota access con un refresh válido.
  3. POST /api/auth/logout/    → blacklist (si está activado) del refresh.
  4. GET  /api/auth/me/        → devuelve el perfil del usuario autenticado.

Notas:
  · Nunca se toca el ORM de Django para persistir; la DB la gestiona
    [AG-DATABASE] con SQL plano. Aquí solo leemos con psycopg/Django-DB
    helpers y emitimos JWTs.
  · SECURITY: SHA-256 plano cumple con el pedido explícito. Para producción
    usar pbkdf2_sha256 / bcrypt / argon2 — este módulo ya tolera hash_kind.
=====================================================================
"""
import hashlib
import uuid
from datetime import datetime, timezone

from django.db import connection
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _sha256(plain: str) -> str:
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def _row_to_dict(cursor, row):
    cols = [c[0] for c in cursor.description]
    return dict(zip(cols, row))


def _fetch_user(usuario: str):
    """
    Busca usuario por email_plain o por segmento local (antes del @).
    Devuelve el dict del registro + permisos agregados del rol, o None.
    """
    usuario_l = (usuario or "").strip().lower()
    if not usuario_l:
        return None

    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.email_plain, u.password_hash, u.hash_kind,
                   u.full_name, u.role, u.is_active, u.is_staff,
                   u.last_login_at
              FROM core.users u
             WHERE u.deleted_at IS NULL
               AND (LOWER(u.email_plain) = %s
                    OR LOWER(SPLIT_PART(u.email_plain, '@', 1)) = %s)
             LIMIT 1
            """,
            [usuario_l, usuario_l],
        )
        row = cur.fetchone()
        if not row:
            return None
        user = _row_to_dict(cur, row)

        # Rol + permisos (si existe core.roles; si no, fallback por u.role)
        cur.execute(
            """
            SELECT r.id, r.slug, r.name, r.description, r.permissions
              FROM core.user_roles ur
              JOIN core.roles r ON r.id = ur.role_uuid
             WHERE ur.user_uuid = %s
             ORDER BY ur.granted_at ASC
             LIMIT 1
            """,
            [user["id"]],
        )
        rrow = cur.fetchone()
        if rrow:
            role = _row_to_dict(cur, rrow)
            user["role_uuid"] = role["id"]
            user["role_slug"] = role["slug"]
            user["role_name"] = role["name"]
            user["permissions"] = role["permissions"] or {}
        else:
            # Fallback: no hay fila en core.user_roles → usamos el string u.role
            user["role_uuid"] = None
            user["role_slug"] = user["role"]
            user["role_name"] = user["role"].title() if user["role"] else None
            user["permissions"] = {"modules": ["*"]} if user["role"] in ("admin", "superadmin") else {}

    return user


def _verify_password(plain: str, user: dict) -> bool:
    kind = (user.get("hash_kind") or "sha256").lower()
    expected = user.get("password_hash") or ""
    if kind == "sha256":
        return _sha256(plain) == expected
    if kind.startswith("pbkdf2") or kind in ("argon2", "bcrypt"):
        # Delegamos a Django password hashers si aplica
        try:
            from django.contrib.auth.hashers import check_password
            return check_password(plain, expected)
        except Exception:
            return False
    return False


def _touch_last_login(user_uuid):
    with connection.cursor() as cur:
        cur.execute(
            "UPDATE core.users SET last_login_at = %s, updated_at = %s WHERE id = %s",
            [datetime.now(timezone.utc), datetime.now(timezone.utc), user_uuid],
        )


def _make_tokens(user: dict) -> dict:
    """
    SimpleJWT normalmente consume un `django.contrib.auth.User`, pero aquí
    nuestro 'usuario' es una fila de core.users (managed=False). Creamos el
    refresh manualmente e inyectamos los claims necesarios.
    """
    refresh = RefreshToken()
    refresh["user_uuid"] = str(user["id"])
    refresh["email"]     = user["email_plain"]
    refresh["role"]      = user.get("role_slug") or user.get("role")
    access = refresh.access_token
    access["user_uuid"] = str(user["id"])
    access["email"]     = user["email_plain"]
    access["role"]      = user.get("role_slug") or user.get("role")
    return {"access": str(access), "refresh": str(refresh)}


def _serialize_user(user: dict) -> dict:
    return {
        "id":           str(user["id"]),
        "email":        user["email_plain"],
        "full_name":    user["full_name"],
        "role":         user.get("role_slug") or user["role"],
        "role_name":    user.get("role_name"),
        "permissions":  user.get("permissions") or {},
        "is_active":    bool(user["is_active"]),
        "is_staff":     bool(user["is_staff"]),
        "last_login_at": user.get("last_login_at").isoformat() if user.get("last_login_at") else None,
    }


# ---------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        usuario  = request.data.get("usuario")  or request.data.get("email") or request.data.get("username")
        password = request.data.get("password")
        if not usuario or not password:
            return Response(
                {"detail": "Usuario y contraseña son obligatorios"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = _fetch_user(usuario)
        if not user or not user["is_active"]:
            return Response(
                {"detail": "Usuario o contraseña incorrectos"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        if not _verify_password(password, user):
            return Response(
                {"detail": "Usuario o contraseña incorrectos"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        _touch_last_login(user["id"])
        tokens = _make_tokens(user)

        return Response({
            "access":  tokens["access"],
            "refresh": tokens["refresh"],
            "user":    _serialize_user(user),
        }, status=status.HTTP_200_OK)


class RefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw = request.data.get("refresh")
        if not raw:
            return Response({"detail": "refresh requerido"}, status=400)
        try:
            rt = RefreshToken(raw)
            access = rt.access_token
            return Response({"access": str(access)}, status=200)
        except Exception as e:
            return Response({"detail": f"Refresh inválido: {e}"}, status=401)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        raw = request.data.get("refresh")
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except Exception:
                pass  # si el blacklist app no está activo, ignoramos
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # JWTAuthentication deja el user_uuid en request.auth["user_uuid"] a través del claim.
        user_uuid = None
        try:
            user_uuid = request.auth.get("user_uuid")
        except Exception:
            pass
        if not user_uuid:
            return Response({"detail": "Token sin user_uuid"}, status=400)

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT u.id, u.email_plain, u.full_name, u.role, u.is_active, u.is_staff,
                       u.last_login_at
                  FROM core.users u
                 WHERE u.id = %s AND u.deleted_at IS NULL
                """,
                [user_uuid],
            )
            row = cur.fetchone()
            if not row:
                return Response({"detail": "Usuario no encontrado"}, status=404)
            user = _row_to_dict(cur, row)

            cur.execute(
                """
                SELECT r.slug, r.name, r.permissions
                  FROM core.user_roles ur
                  JOIN core.roles r ON r.id = ur.role_uuid
                 WHERE ur.user_uuid = %s
                 LIMIT 1
                """,
                [user["id"]],
            )
            rrow = cur.fetchone()
            if rrow:
                role = _row_to_dict(cur, rrow)
                user["role_slug"]  = role["slug"]
                user["role_name"]  = role["name"]
                user["permissions"] = role["permissions"] or {}
            else:
                user["role_slug"]  = user["role"]
                user["role_name"]  = (user["role"] or "").title()
                user["permissions"] = {"modules": ["*"]} if user["role"] in ("admin", "superadmin") else {}

        return Response(_serialize_user(user), status=200)
