from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.users"
    label = "users_mwt"   # evita choque con django.contrib.auth (app_label='auth') y users (si se reservara)
    verbose_name = "Users · RBAC · M3 CORE"
