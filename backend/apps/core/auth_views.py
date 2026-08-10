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
import logging
import uuid
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

from django.db import connection
from django.contrib.auth.hashers import make_password, check_password
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from .authentication import MwtServiceTokenAuthentication, ServiceTokenUser


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


def _verify_password(plain: str, user: dict) -> tuple[bool, bool]:
    """Verifica password y devuelve (ok, needs_rehash).

    Soporta hashes legados SHA-256 (sin salt, inseguro) y hashes modernos
    gestionados por Django (pbkdf2_sha256, argon2, bcrypt). En producción
    todas las contraseñas nuevas se guardan con PBKDF2/Argon2.
    """
    kind = (user.get("hash_kind") or "sha256").lower()
    expected = user.get("password_hash") or ""
    if not expected:
        return False, False

    if kind == "sha256":
        ok = _sha256(plain) == expected
        return ok, ok  # si era correcto, migrar a hash moderno

    # Hashes Django: pbkdf2_sha256$..., argon2$..., bcrypt$...
    try:
        ok = check_password(plain, expected)
    except Exception:
        ok = False
    # check_password no levanta si el hash es inválido; devuelve False.
    return ok, False


def _rehash_password(user_uuid: str, plain: str) -> None:
    """Reemplaza un hash SHA-256 legado por pbkdf2_sha256."""
    new_hash = make_password(plain)
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE core.users
               SET password_hash = %s,
                   hash_kind     = 'pbkdf2_sha256',
                   updated_at    = NOW()
             WHERE id = %s::uuid
            """,
            [new_hash, user_uuid],
        )


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
    """Shape canónico del usuario para /api/auth/me/ y similares.

    Sprint 2026-05-20 · Portal multi-empresa:
      `legal_entity_ids` se incluye en la respuesta para que el frontend
      del Portal sepa cuántas empresas tiene asignadas el usuario y
      pueda mostrar (o no) el filtro de empresa. Lectura desde
      `users.mwtuser.legal_entity_ids TEXT[]` (Sprint A4d).
    """
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
        # Array de UUIDs de empresas (clientes.cliente.id) asignadas al usuario.
        # Vacío [] si es staff interno sin restricción de empresa.
        "legal_entity_ids": list(user.get("legal_entity_ids") or []),
    }


# ---------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

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
        if not _verify_password(password, user)[0]:
            return Response(
                {"detail": "Usuario o contraseña incorrectos"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        _touch_last_login(user["id"])

        # Migración transparente: si era SHA-256, rehash a PBKDF2.
        if (user.get("hash_kind") or "sha256").lower() == "sha256":
            try:
                _rehash_password(str(user["id"]), password)
            except Exception:
                # No bloquear login si el rehash falla; loguear para revisión.
                log.exception("Rehash de password falló para user=%s", user["id"])

        # Sync de password consola -> Authentik (Mecanismo B · Fugu Ola 3).
        # La consola guarda hashes; la password SOLO está en claro en el login.
        # Cada login exitoso alinea la password de Authentik con la de la
        # consola, para que el usuario entre al MCP (Claude) con la misma clave.
        # Fail-safe: una caída de Authentik NUNCA bloquea el login de consola.
        try:
            _email_low = (user.get("email_plain") or "").strip().lower()
            if _email_low and password:
                from apps.users.authentik_sync import set_password as _ak_set_password  # noqa: PLC0415
                _ak_set_password(_email_low, password)
        except Exception:  # noqa: BLE001
            log.exception("authentik sync on login failed for %s", user.get("email_plain"))

        tokens = _make_tokens(user)

        # Sprint 2026-07-16 · el login ahora incluye legal_entity_ids (Portal
        # multi-empresa). Sin esto el frontend del cliente B2B no sabe a qué
        # empresa pertenece → el buscador de productos del wizard marca todo
        # como "NO ASIGNADO". Fuente: users.mwtuser (misma que /auth/me/).
        try:
            _email_low = (user.get("email_plain") or "").strip().lower()
            if _email_low:
                with connection.cursor() as _c:
                    _c.execute(
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
                        [_email_low, _email_low],
                    )
                    _r = _c.fetchone()
                    if _r and _r[0]:
                        user["legal_entity_ids"] = [str(x) for x in _r[0] if x]
        except Exception:  # noqa: BLE001
            pass

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
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "logout"

    def _deny_token(self, token, token_type, revoked_by):
        """Inserta el jti de un token en la denylist, si existe."""
        if not token:
            return
        try:
            jti = token.get("jti")
            exp = token.get("exp")
        except Exception:
            return
        if not jti or not exp:
            return
        try:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO core.token_denylist (jti, token_type, user_uuid, expires_at, revoked_by)
                    VALUES (%s, %s, %s::uuid, to_timestamp(%s)::timestamptz, %s::uuid)
                    ON CONFLICT (jti) DO NOTHING
                    """,
                    [jti, token_type, str(revoked_by), int(exp), str(revoked_by)],
                )
        except Exception:
            log.exception("Logout denylist falló para jti=%s", jti)

    def post(self, request):
        # Revocar el access token actual (si hay auth).
        user = getattr(request, "user", None)
        user_uuid = getattr(user, "id", None) if user else None
        access = getattr(request, "auth", None)
        self._deny_token(access, "access", user_uuid)

        raw = request.data.get("refresh")
        if raw:
            try:
                rt = RefreshToken(raw)
                self._deny_token(rt, "refresh", user_uuid)
            except Exception:
                pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordResetConfirmView(APIView):
    """POST /api/auth/password-reset-confirm/

    Body: { "token": "<raw-token-del-link>", "new_password": "..." }

    Flujo:
      1. SHA-256(token) → busca en users.password_reset_token activo y no expirado.
      2. Si válido: actualiza core.users.password_hash con PBKDF2/Argon2(new_password).
      3. Marca el token como consumido (consumed_at = NOW).
      4. Devuelve 200 con {ok: True, email: <email>}.
    """
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_reset"

    def post(self, request):
        import hashlib
        from datetime import datetime, timezone as _tz
        from django.utils import timezone as _dj_tz

        raw_token    = (request.data.get("token") or "").strip()
        new_password = request.data.get("new_password") or ""

        if not raw_token:
            return Response({"detail": "Falta el token."}, status=400)
        if len(new_password) < 8:
            return Response({"detail": "La nueva contraseña debe tener al menos 8 caracteres."},
                            status=400)

        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

        with connection.cursor() as cur:
            # Buscar el token vigente
            cur.execute("""
                SELECT t.id, t.user_id, t.expires_at, t.consumed_at,
                       u.id, u.email_plain
                  FROM users.password_reset_token t
                  LEFT JOIN core.users u ON u.id = t.user_id
                 WHERE t.token_hash = %s
                 LIMIT 1
            """, [token_hash])
            row = cur.fetchone()

        if not row:
            return Response({"detail": "Token inválido o ya consumido."}, status=400)

        token_id, user_id, expires_at, consumed_at, core_uid, email = row

        if consumed_at is not None:
            return Response({"detail": "Este enlace ya fue utilizado."}, status=400)

        # Comparar expires_at vs ahora · ambos deben ser tz-aware
        now = _dj_tz.now()
        if expires_at and expires_at < now:
            return Response({"detail": "Este enlace ha expirado. Solicita uno nuevo."}, status=400)

        # El user_id en password_reset_token apunta a users.mwtuser.id.
        # core.users PUEDE tener el mismo UUID (si fue sembrado por seed_admins
        # o auto-sincronizado) o uno distinto (caso legacy). Buscamos por email.
        if not email:
            # Lookup en mwtuser para obtener el email
            with connection.cursor() as cur:
                cur.execute("SELECT email_plain FROM users.mwtuser WHERE id = %s", [user_id])
                r = cur.fetchone()
                email = r[0] if r else None

        if not email:
            return Response({"detail": "Usuario asociado no encontrado."}, status=404)

        new_hash = make_password(new_password)

        # Update password en core.users (la tabla del login).
        # Si por algún motivo no existe la fila, hacer UPSERT.
        with connection.cursor() as cur:
            cur.execute("""
                UPDATE core.users
                   SET password_hash = %s,
                       hash_kind     = 'pbkdf2_sha256',
                       updated_at    = NOW()
                 WHERE lower(email_plain) = lower(%s)
            """, [new_hash, email])
            updated = cur.rowcount
            if updated == 0:
                # Auto-create en core.users si no existe (caso edge).
                import uuid as _uuid
                cur.execute("""
                    INSERT INTO core.users
                        (id, email_plain, password_hash, hash_kind, full_name,
                         role, is_active, is_staff, created_at, updated_at)
                    VALUES
                        (%s, %s, %s, 'pbkdf2_sha256', '', 'viewer', TRUE, FALSE, NOW(), NOW())
                """, [str(_uuid.uuid4()), email, new_hash])

            # Marcar token consumido
            cur.execute("""
                UPDATE users.password_reset_token
                   SET consumed_at = NOW()
                 WHERE id = %s
            """, [token_id])

        return Response({
            "ok":    True,
            "email": email,
            "message": "Contraseña actualizada correctamente. Ya puedes iniciar sesión.",
        }, status=200)


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

            # Sprint 2026-05-21 · Portal multi-empresa · single source.
            # `MwtJWTAuthentication.get_user` ya inyecta legal_entity_ids
            # en `request.user` (joineando users.mwtuser por email/id).
            # Leemos de ahí primero (canónico). El SQL queda solo como
            # fallback de seguridad si el campo no fue hidratado.
            user["legal_entity_ids"] = list(
                getattr(getattr(request, "user", None), "legal_entity_ids", None) or []
            )
            email_low = (user.get("email_plain") or "").strip().lower()
            try:
                if not user["legal_entity_ids"] and email_low:
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
                        [email_low, email_low],
                    )
                    mrow = cur.fetchone()
                    if mrow and mrow[0]:
                        user["legal_entity_ids"] = list(mrow[0])

                # Fallback por id (ambientes con UUIDs sincronizados)
                if not user["legal_entity_ids"]:
                    cur.execute(
                        """
                        SELECT COALESCE(legal_entity_ids, '{}'::TEXT[]) AS ids
                          FROM users.mwtuser
                         WHERE id::text = %s
                         LIMIT 1
                        """,
                        [user["id"]],
                    )
                    mrow = cur.fetchone()
                    if mrow and mrow[0]:
                        user["legal_entity_ids"] = list(mrow[0])
            except Exception:
                # Tabla users.mwtuser puede no existir en ambientes legacy.
                user["legal_entity_ids"] = user.get("legal_entity_ids") or []

        return Response(_serialize_user(user), status=200)


class McpTokenView(APIView):
    """
    POST /api/auth/mcp-token/

    Emite un AccessToken JWT para un usuario MWT a partir de la identidad
    propagada por el gateway MCP (headers X-Forwarded-User-*).

    El caller DEBE autenticarse con un ServiceToken (Authorization: ServiceToken
    <token>) que tenga el scope `mcp:token_exchange`. El JWT emitido hereda
    los límites del ServiceToken: los legal_entity_ids se intersectan con los
    permitidos por el token de servicio.

    Request headers:
      X-Forwarded-User-Email: <email del usuario objetivo>
      X-Forwarded-User-Id:    <uuid del usuario objetivo> (fallback)
    O body JSON:
      { "email": "...", "user_id": "..." }

    Response:
      { "access": "<jwt>", "user": { ... } }

    El token de servicio nunca se expone al frontend; este endpoint solo
    es consumido por el MCP server interno.
    """

    authentication_classes = [MwtServiceTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mcp-token"

    def _service_token(self, request):
        user = request.user
        if isinstance(user, ServiceTokenUser):
            return user
        return None

    def _target_email(self, request):
        email = (
            request.META.get("HTTP_X_FORWARDED_USER_EMAIL")
            or request.data.get("email")
            or request.data.get("target_email")
        )
        return (email or "").strip().lower()

    def _target_id(self, request):
        uid = (
            request.META.get("HTTP_X_FORWARDED_USER_ID")
            or request.data.get("user_id")
            or request.data.get("target_id")
        )
        return (uid or "").strip().lower()

    def _fetch_target(self, email, uid):
        """Resuelve el usuario objetivo (core.users) con sus permisos reales.

        Fugu · Ola 2 · 2.15-fix — RBAC por rol, no por bridge:
          El JWT emitido debe reflejar los permisos del ROL del usuario tal como
          los lee el enforcement (`RoleBasedPermission._permissions_for_role`).
          Antes se resolvía por `core.user_roles` (LEFT JOIN): si el usuario no
          tenía fila en el bridge (caso normal: solo hay 1 bridge en producción)
          el JWT salía con `permissions={}` → el filtrado de tools por rol del
          MCP ocultaba TODO para ese usuario. Ahora:
            - role_slug se resuelve del bridge SI existe, si no de `u.role`.
            - permissions se calcula SIEMPRE desde core.roles.permissions por
              role_slug (misma fuente que el enforcement), con wildcard para
              admin/superadmin.
        """
        from .permissions import permissions_for_role_exact

        def _legal_ids(cursor, email_plain):
            ids = []
            try:
                email_low = (email_plain or "").strip().lower()
                if not email_low:
                    return ids
                cursor.execute(
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
                    [email_low, email_low],
                )
                mrow = cursor.fetchone()
                if mrow and mrow[0]:
                    ids = [str(x) for x in mrow[0] if x]
            except Exception:  # noqa: BLE001
                # users.mwtuser puede no existir en ambientes legacy.
                pass
            return ids

        def _finish(cursor, row):
            if not row:
                return None
            data = dict(
                zip(
                    ["id", "email_plain", "full_name", "role", "is_active",
                     "is_staff", "last_login_at", "role_slug", "role_name"],
                    row,
                )
            )
            role_slug = data.get("role_slug") or data.get("role") or ""
            # Permisos desde core.roles por slug, TAL CUAL están en la matriz
            # (sin wildcard forzado para admin/superadmin). Así el JWT del MCP
            # refleja lo que el CEO configura en /roles: si deshabilita
            # clientes.create, la tool cliente_crear no aparece ni para admin.
            data["permissions"] = permissions_for_role_exact(str(role_slug))
            data["legal_entity_ids"] = _legal_ids(cursor, data.get("email_plain"))
            return data

        with connection.cursor() as cur:
            if email:
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
                    return _finish(cur, row)
            if uid:
                cur.execute(
                    """
                    SELECT u.id, u.email_plain, u.full_name, u.role, u.is_active,
                           u.is_staff, u.last_login_at,
                           COALESCE(r.slug, u.role)  AS role_slug,
                           COALESCE(r.name, u.role)  AS role_name
                      FROM core.users u
                      LEFT JOIN core.user_roles ur ON ur.user_uuid = u.id
                      LEFT JOIN core.roles      r  ON r.id         = ur.role_uuid
                     WHERE u.id = %s::uuid
                       AND u.deleted_at IS NULL
                     ORDER BY ur.granted_at ASC NULLS LAST
                     LIMIT 1
                    """,
                    [uid],
                )
                row = cur.fetchone()
                if row:
                    return _finish(cur, row)
        return None

    def _normalize_permissions(self, permissions):
        if isinstance(permissions, dict):
            return permissions
        if isinstance(permissions, str):
            try:
                return json.loads(permissions)
            except Exception:
                return {}
        return {}

    def post(self, request):
        st = self._service_token(request)
        if not st or not st.has_scope("mcp:token_exchange"):
            return Response(
                {"detail": "Se requiere ServiceToken con scope mcp:token_exchange"},
                status=status.HTTP_403_FORBIDDEN,
            )

        email = self._target_email(request)
        uid = self._target_id(request)
        if not email and not uid:
            return Response(
                {"detail": "Falta X-Forwarded-User-Email o user_id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        row = self._fetch_target(email, uid)
        if not row:
            return Response(
                {"detail": "Usuario objetivo no encontrado"},
                status=status.HTTP_404_NOT_FOUND,
            )

        uid = row["id"]
        email_plain = row["email_plain"]
        full_name = row["full_name"]
        is_active = row["is_active"]
        is_staff = row["is_staff"]
        last_login_at = row["last_login_at"]
        role_slug = row["role_slug"]
        role_name = row["role_name"]
        _role_str = row["role"]
        permissions = row["permissions"]
        target_legal_ids = row.get("legal_entity_ids") or []

        if not is_active:
            return Response(
                {"detail": "Usuario objetivo inactivo"},
                status=status.HTTP_403_FORBIDDEN,
            )

        role = role_slug or _role_str
        perms = self._normalize_permissions(permissions)

        # Nota de seguridad (Fugu · Ola 2 - 2.15): los legal_entity_ids se
        # toman del USUARIO OBJETIVO (users.mwtuser vía _fetch_target), NO de
        # request.user (que es el ServiceTokenUser). Se intersectan contra los
        # client_ids del ServiceToken cuando existan. El JWT emitido NUNCA
        # amplía tenants, solo los restringe.
        user_legal_ids = set(target_legal_ids)
        service_legal_ids = set(st.client_ids or [])
        if service_legal_ids:
            user_legal_ids = user_legal_ids & service_legal_ids

        access = AccessToken()
        access["user_uuid"] = str(uid)
        access["email"] = email_plain
        access["role"] = role
        access["mcp"] = True
        access["modules"] = perms.get("modules") or []
        access["legal_entity_ids"] = sorted(user_legal_ids)
        access.set_exp(lifetime=timedelta(hours=1))

        user = {
            "id": str(uid),
            "email_plain": email_plain,
            "full_name": full_name,
            "role": role,
            "role_slug": role,
            "role_name": role_name,
            "is_active": is_active,
            "is_staff": is_staff,
            "last_login_at": last_login_at,
            "permissions": perms,
            "legal_entity_ids": sorted(user_legal_ids),
        }
        return Response({
            "access": str(access),
            "user": _serialize_user(user),
        }, status=status.HTTP_200_OK)


# =========================================================================== #
# Ola 3.6 · Auditoría durable del MCP (Eje A3) y diagnóstico de scope (Eje D5)
# =========================================================================== #
class McpAuditView(APIView):
    """POST /api/auth/mcp-audit/

    Puerta de persistencia para la auditoría del MCP. El MCP server hace un
    POST best-effort por cada tool-call (writes + reads sensibles) con el
    ServiceToken (scope mcp:token_exchange) y este view persiste en
    `core.mcp_audit` vía `services.audit_write`.

    Body (todos opcionales salvo tool/event):
      {event, tool, identity_sub, identity_roles, args_sanitized,
       ok, http_status, duration_ms, idempotency_key}

    La escritura es best-effort: nunca devuelve 500 por un fallo de auditoría.
    """

    authentication_classes = [MwtServiceTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mcp_audit"

    def post(self, request):
        from .services import audit_write, _audit_sanitize

        data = request.data or {}
        tool = str(data.get("tool") or "").strip()
        event = str(data.get("event") or "write").strip()[:32]
        if not tool:
            return Response({"detail": "tool es obligatorio"}, status=400)
        # El ServiceToken es la identidad que firma (sub = token id/name).
        st = request.user
        identity_sub = getattr(st, "email", None) or str(getattr(st, "token_id", ""))
        roles = getattr(st, "scopes", None) or None

        ok = bool(data.get("ok", True))
        try:
            http_status = int(data.get("http_status")) if data.get("http_status") is not None else None
        except (TypeError, ValueError):
            http_status = None
        try:
            duration_ms = int(data.get("duration_ms")) if data.get("duration_ms") is not None else None
        except (TypeError, ValueError):
            duration_ms = None

        saved = audit_write(
            event=event,
            tool=tool,
            identity_sub=identity_sub,
            identity_roles=roles,
            args_sanitized=_audit_sanitize(data.get("args_sanitized") or {}),
            ok=ok,
            http_status=http_status,
            duration_ms=duration_ms,
            idempotency_key=data.get("idempotency_key"),
        )
        if saved:
            return Response({"saved": True, "event": event, "tool": tool})
        # No romper al MCP; el registro quedó solo en stderr.
        return Response(
            {"saved": False, "detail": "auditoría no persistida (best-effort)"},
            status=200,
        )


class McpDiagView(APIView):
    """POST /api/auth/mcp-diag/

    Diagnóstico de scope para soporte (Eje D5 · `mwt_diag_scope`).

    El caller autentica con ServiceToken (scope mcp:token_exchange) y envía
    en el body el usuario objetivo:
      { email }  o  { user_id }
    Respuesta: mismo shape de perfil que `/api/auth/mcp-token/` (rol,
    permisos, legal_entity_ids) SIN emitir JWT — es solo lectura.

    La autorización CEO-only la valida el MCP (el gateway propaga el rol del
    usuario conectado; esta tool es `mwt_` y se filtra por RBAC si el CEO lo
    desactiva). Aquí solo resolvemos el perfil objetivo.
    """

    authentication_classes = [MwtServiceTokenAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "mcp_diag"

    def post(self, request):
        email = (
            request.META.get("HTTP_X_FORWARDED_USER_EMAIL")
            or request.data.get("email")
            or request.data.get("target_email")
        )
        uid = (
            request.META.get("HTTP_X_FORWARDED_USER_ID")
            or request.data.get("user_id")
            or request.data.get("target_id")
        )
        email = (email or "").strip().lower()
        uid = (uid or "").strip().lower()
        if not email and not uid:
            return Response({"detail": "Falta email o user_id"}, status=400)

        # Reutiliza la resolución de perfil de McpTokenView (sin minting).
        row = self._fetch_target(email, uid)
        if not row:
            return Response({"detail": "Usuario objetivo no encontrado"},
                            status=404)
        return Response({
            "id": str(row["id"]),
            "email_plain": row["email_plain"],
            "full_name": row["full_name"],
            "role_slug": row["role_slug"] or row["role"],
            "role_name": row["role_name"],
            "is_active": row["is_active"],
            "permissions": row["permissions"],
            "legal_entity_ids": row.get("legal_entity_ids") or [],
        })

    def _fetch_target(self, email, uid):
        """Misma resolución que McpTokenView._fetch_target (rol + permisos + legal_ids)."""
        from .permissions import permissions_for_role_exact

        def _legal_ids(cursor, email_plain):
            ids = []
            try:
                email_low = (email_plain or "").strip().lower()
                if not email_low:
                    return ids
                cursor.execute(
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
                    [email_low, email_low],
                )
                mrow = cursor.fetchone()
                if mrow and mrow[0]:
                    ids = [str(x) for x in mrow[0] if x]
            except Exception:  # noqa: BLE001
                pass
            return ids

        def _finish(cursor, row):
            if not row:
                return None
            data = dict(
                zip(
                    ["id", "email_plain", "full_name", "role", "is_active",
                     "is_staff", "last_login_at", "role_slug", "role_name"],
                    row,
                )
            )
            role_slug = data.get("role_slug") or data.get("role") or ""
            data["permissions"] = permissions_for_role_exact(str(role_slug))
            data["legal_entity_ids"] = _legal_ids(cursor, data.get("email_plain"))
            return data

        with connection.cursor() as cur:
            if email:
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
                    return _finish(cur, row)
            if uid:
                cur.execute(
                    """
                    SELECT u.id, u.email_plain, u.full_name, u.role, u.is_active,
                           u.is_staff, u.last_login_at,
                           COALESCE(r.slug, u.role)  AS role_slug,
                           COALESCE(r.name, u.role)  AS role_name
                      FROM core.users u
                      LEFT JOIN core.user_roles ur ON ur.user_uuid = u.id
                      LEFT JOIN core.roles      r  ON r.id         = ur.role_uuid
                     WHERE u.id = %s::uuid
                       AND u.deleted_at IS NULL
                     ORDER BY ur.granted_at ASC NULLS LAST
                     LIMIT 1
                    """,
                    [uid],
                )
                row = cur.fetchone()
                if row:
                    return _finish(cur, row)
        return None
