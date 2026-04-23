from django.apps import AppConfig


class RolesConfig(AppConfig):
    """App independiente de M3-CORE · catálogo de roles, módulos y matriz RBAC.

    Aunque las tablas viven en el schema `users.*` de Postgres (compartido
    con apps.users por razones de coherencia transaccional — el SQL es uno
    solo), la lógica de Django se separa aquí para facilitar gobernanza y
    despliegues independientes.

    label = "roles_mwt" evita colisiones con cualquier paquete externo que
    reclame el app_label='roles'.
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.roles"
    label = "roles_mwt"
    verbose_name = "Roles · RBAC · M3 CORE"
