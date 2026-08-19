"""
=====================================================================
MWT.ONE · apps.core.scoped_querysets
Sprint 2026-05-22 (AG-BACKEND)

Helper centralizado de visibilidad por cliente (multi-tenancy logico).

Regla canonica (R3 · POL_VISIBILIDAD):
  - Roles en BYPASS_ROLES (superadmin, admin)  -> sin filtro.
  - Resto de roles                             -> filtra por client_field IN
                                                  request.user.legal_entity_ids.
  - Usuario no-bypass con legal_entity_ids=[]  -> qs.none() (defense-in-depth:
    NUNCA exponer toda la data a un user que olvidaron asignarle clientes).

Convencion del repo: managed=False, sin FK fisicas, querysets explicitos.

Uso tipico:
    from apps.core.scoped_querysets import filter_by_user_clients

    def list(self, request):
        qs = Cobro.objects.filter(is_active=True)
        qs = filter_by_user_clients(qs, request.user, client_field="client_id")
        ...

Para scope dual (cliente OR operadora, como en expedientes):
        qs = filter_by_user_clients(
            qs, request.user,
            client_field="client_id",
            extra_fields=("operating_company_id",),
        )

Para raw SQL (KPIs, agregados):
        scope_sql, scope_params = filter_by_user_clients_sql(
            request.user, column="client_id",
        )
        if scope_sql == "FALSE":
            return Response(zeros)  # user sin scope -> KPIs en cero
        sql = "SELECT ... WHERE is_active = TRUE"
        if scope_sql:
            sql += f" AND ({scope_sql})"
            params += scope_params
=====================================================================
"""
from __future__ import annotations
from typing import Iterable, Optional, Tuple, List
from django.db.models import Q, QuerySet


# Spec del CEO (2026-05-22): SOLO estos roles bypassean el scope.
# NO incluir ceo / manager / finance / operator / viewer / client_b2b.
BYPASS_ROLES: Tuple[str, ...] = ("superadmin", "admin")


def _user_role(user) -> str:
    """Extrae el rol del MwtUser, normalizado a lowercase."""
    if user is None:
        return ""
    role = (getattr(user, "role_default", "") or
            getattr(user, "role", "") or "")
    return str(role).lower().strip()


def is_bypass(user, bypass_roles: Iterable[str] = BYPASS_ROLES) -> bool:
    """¿El usuario puede ver TODOS los datos sin filtro?

    Ola 1 · 1.2 — Guard anti-bypass: un token del MCP con scope forzado
    (`user.mcp_scoped=True`, inyectado por MwtJWTAuthentication.get_user
    cuando el JWT trae `legal_entity_ids`/`tenant_id` del claim) NUNCA
    bypasea, aunque el rol sea admin/superadmin. Así un admin conectado a
    una app de cliente solo ve SU cliente (P0-6).
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    # Token MCP con scope del claim → el bypass no aplica (fail-closed).
    if getattr(user, "mcp_scoped", False):
        return False
    # is_superuser cubre el bootstrap (seed_admins) por si role_default
    # quedo vacio. NO usamos `is_staff` porque MwtUser.is_staff=True para
    # manager/ceo y la spec excluye explicitamente esos roles.
    if getattr(user, "is_superuser", False):
        return True
    return _user_role(user) in {r.lower() for r in bypass_roles}


# Backward-compat: el resto del codebase (cobros, notifications,
# finance, expedientes) importa `_is_bypass`. Mantenemos el alias.
_is_bypass = is_bypass


def _scope_ids(user) -> List[str]:
    """Lista canonica de UUIDs (lowercase) de empresas asignadas al usuario.

    Ola 1 · 1.2 — si el token MCP trae un `tenant_id` quemado (cliente de la
    app), el scope se fija a ESE único cliente (ignora el resto de
    legal_entity_ids del usuario). Es la garantía de aislamiento por app.
    """
    forced = getattr(user, "tenant_id", None)
    if forced:
        return [str(forced).lower()]
    raw = list(getattr(user, "legal_entity_ids", None) or [])
    return [str(x).lower() for x in raw if x]


def filter_by_user_clients(
    qs: QuerySet,
    user,
    *,
    client_field: str = "client_id",
    bypass_roles: Iterable[str] = BYPASS_ROLES,
    extra_fields: Optional[Iterable[str]] = None,
) -> QuerySet:
    """Scope un queryset al pool de clientes del usuario.

    Args:
        qs:           QuerySet base.
        user:         request.user (MwtUser proxy).
        client_field: columna FK logica que apunta a clientes.cliente.id.
        bypass_roles: roles que bypasean el filtro (default superadmin/admin).
        extra_fields: columnas adicionales con scope dual (OR).
                      Ej. ("operating_company_id",) para expedientes,
                      donde un user-operador puede aparecer SOLO ahi.

    Returns:
        qs sin filtrar si el user es bypass.
        qs.filter(<scope>) si no.
        qs.none() si user no-bypass tiene legal_entity_ids=[].
    """
    if _is_bypass(user, bypass_roles):
        return qs

    scope = _scope_ids(user)
    if not scope:
        # CRITICAL: no devolver qs sin filtrar a un user no-bypass sin scope.
        return qs.none()

    q = Q(**{f"{client_field}__in": scope})
    for f in (extra_fields or ()):
        q |= Q(**{f"{f}__in": scope})
    return qs.filter(q)


def filter_by_user_clients_sql(
    user,
    *,
    column: str = "client_id",
    bypass_roles: Iterable[str] = BYPASS_ROLES,
    extra_columns: Optional[Iterable[str]] = None,
) -> Tuple[str, list]:
    """Variante para raw SQL (kpis, agregados).

    Returns:
        (where_clause, params):
          - ("", [])           si user es bypass -> no filtres
          - ("FALSE", [])      si user no-bypass sin scope -> agregados = 0
          - ("col::text IN (%s,%s,...) OR ...", scope) si scope normal

    Uso tipico:
        scope_sql, scope_params = filter_by_user_clients_sql(
            request.user, column="client_id",
        )
        if scope_sql == "FALSE":
            return Response(zeros)
        sql = "SELECT ... WHERE is_active = TRUE"
        if scope_sql:
            sql += f" AND ({scope_sql})"
            params += scope_params
    """
    if _is_bypass(user, bypass_roles):
        return ("", [])
    scope = _scope_ids(user)
    if not scope:
        return ("FALSE", [])
    cols = [column, *(extra_columns or [])]
    placeholders = ",".join(["%s"] * len(scope))
    or_parts = [f"{c}::text IN ({placeholders})" for c in cols]
    params: list = list(scope) * len(cols)
    return (" OR ".join(or_parts), params)


def scoped_expediente_ids(user, *, only_active: bool = True) -> Optional[List[str]]:
    """Resuelve la lista de expediente_ids visibles al usuario.

    Usado por modelos que NO tienen client_id directo pero si expediente_id
    (Linea, Documento, NotificationLog, etc.).

    Returns:
        None  → bypass (no aplicar filtro).
        []    → user sin scope (aplicar qs.none()).
        [...] → lista de UUIDs en string.
    """
    if _is_bypass(user):
        return None
    # Import diferido para no crear ciclo con apps.expedientes.
    from apps.expedientes.models import Expediente

    qs = Expediente.objects.all()
    if only_active:
        qs = qs.filter(is_active=True)
    qs = filter_by_user_clients(
        qs, user,
        client_field="client_id",
        extra_fields=("operating_company_id",),
    )
    # Fix 2026-08-19 · los callers comparan con str(...) (ej. _user_can_access_key).
    # Antes se devolvían objetos UUID → la comparación str(UUID) not in [UUID...]
    # nunca matcheaba y el download/scope de documentos fallaba con 403 para
    # client_b2b aunque el expediente estuviera en su scope.
    return [str(x) for x in qs.values_list("id", flat=True)]
