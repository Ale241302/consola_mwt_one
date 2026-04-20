"""
=====================================================================
MWT.ONE · settings.py
Agente responsable: [AG-BACKEND]
Stack: Django 5.x + Django REST Framework
Reglas:
  - API PURA (sin templates HTML, sin admin renderizado al público).
  - Migrations de Django DESACTIVADAS globalmente: la DB la maneja
    [AG-DATABASE] con archivos .sql crudos.
  - Sin FKs en la DB → cada modelo es `managed = False` y los vínculos
    se hacen por UUID en el ORM (UUIDField sin to= ni related_name).
  - Local-first: corre con `venv` + Postgres local, pero deja todo
    listo para Redis / Celery / MinIO / Paperless en Docker.
=====================================================================
"""

from pathlib import Path
import os
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------
# Núcleo
# --------------------------------------------------------------------
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-change-me")
DEBUG      = os.environ.get("DJANGO_DEBUG", "1") == "1"

# ALLOWED_HOSTS: coma-separada. "*" significa aceptar todos los hosts.
# ALLOWED_HOSTS: coma-separada. "*" significa aceptar todos los hosts.
_DEFAULT_HOSTS = [
    "django", "backend", "localhost", "127.0.0.1",
    "consola-mwt-one-django",
    # Dominio público de producción (Consola MWT.ONE)
    "consola.mwt.one",
]
_extra_hosts = [
    h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")
    if h.strip()
]
ALLOWED_HOSTS = list(dict.fromkeys(_DEFAULT_HOSTS + _extra_hosts))

# --------------------------------------------------------------------
# Apps — un módulo del ERP = una app aislada
# --------------------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
]

THIRD_PARTY = [
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "django_celery_beat",
    "django_celery_results",
    "drf_spectacular",
]

LOCAL_APPS = [
    "apps.core",            # usuarios, roles, auth, audit
    "apps.nodos",           # red física (HQ · oficinas · almacenes · hubs)
    "apps.brands",          # portafolio de marcas
    "apps.clientes",        # cuentas B2B / retail / distribuidores
    "apps.productos",       # catálogo SKU-level
    "apps.proveedores",     # fabricantes / importadores / distribuidores
    "apps.inventario",      # stock + ledger de movimientos
    "apps.expedientes",     # OCs + expedientes + líneas + documentos
    "apps.cobros",          # cobros + pagos (ingreso/egreso) + conciliación
    "apps.analytics",       # KPIs consolidados cross-schema (dashboard · financiero)
    "apps.portal",          # Portal B2B (read-only, scopeado al client_id)
    "apps.transfers",       # transferencias inter-nodo + state machine
    "apps.email_templates", # plantillas Jinja2 multi-idioma / multi-marca
    "apps.notifications",   # historial de envíos (Celery / workflow / cron)
    "apps.storage",         # MinIO/S3 signed URLs + Paperless ingest
    # Los siguientes módulos se irán activando cuando cada app tenga su
    # apps.py + views.py correspondiente. Dejarlos comentados evita que
    # Django falle al arrancar por ImportError durante INSTALLED_APPS.
    # "apps.dashboard",
    # "apps.pipeline",
    # "apps.financiero",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY + LOCAL_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --------------------------------------------------------------------
# Base de datos LOCAL (Postgres con pgvector). Sin FKs gestionadas
# por Django porque la DB la construye [AG-DATABASE] con init.sql.
# --------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE":   "django.db.backends.postgresql",
        "NAME":     os.environ.get("DB_NAME", "mwt_one"),
        "USER":     os.environ.get("DB_USER", "mwt"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "mwt"),
        "HOST":     os.environ.get("DB_HOST", "127.0.0.1"),
        "PORT":     os.environ.get("DB_PORT", "5432"),
        "OPTIONS":  {"options": "-c search_path=core,clientes,expedientes,pipeline,"
                                "financiero,transfers,nodos,brands,productos,"
                                "proveedores,inventario,portal,email_templates,"
                                "notifications,cobros,public"},
    }
}

# --------------------------------------------------------------------
# CERO MIGRATIONS DE DJANGO. Se prohíbe makemigrations/migrate.
# Cualquier app que intente migrar es redirigida a None.
# --------------------------------------------------------------------
class _DisableMigrations:
    def __contains__(self, item):  return True
    def __getitem__(self, item):   return None

MIGRATION_MODULES = _DisableMigrations()

# --------------------------------------------------------------------
# Django REST Framework — API pura
# --------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
        "apps.core.permissions.RoleBasedPermission",
    ),
    "DEFAULT_RENDERER_CLASSES": (
        "rest_framework.renderers.JSONRenderer",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.LimitOffsetPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":  timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES":      ("Bearer",),
    "USER_ID_FIELD":          "id",
    "USER_ID_CLAIM":          "user_uuid",
}

# --------------------------------------------------------------------
# Sistema de roles (consumido por apps.core.permissions.RoleBasedPermission)
# --------------------------------------------------------------------
MWT_ROLES = (
    "superadmin",   # acceso total
    "admin",        # gestión organizacional
    "manager",      # gestión por área (expedientes, pipeline, finanzas)
    "operator",     # operación día a día
    "finance",      # acceso a financiero / cobros / transfers
    "viewer",       # solo lectura
    "client_b2b",   # portal externo
)

# --------------------------------------------------------------------
# CORS / CSRF
#   - dev local:           Vite en :5173, opcional :3000
#   - docker compose:      frontend (nginx) en :3100, backend en :8100
#   - prod:                añade la IP/dominio del VPS vía env
#
# Env overrides (coma-separadas):
#   DJANGO_CORS_ALLOWED_ORIGINS="http://mi-dominio.com,https://mi-dominio.com"
#   DJANGO_CSRF_TRUSTED_ORIGINS="http://mi-dominio.com,https://mi-dominio.com"
# --------------------------------------------------------------------
_DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3100",
    "http://localhost:5173",
    "http://127.0.0.1:3100",
    "http://127.0.0.1:5173",
    # Dominio público de producción (Consola MWT.ONE) — HTTP y HTTPS
    "http://consola.mwt.one",
    "https://consola.mwt.one",
]

_extra_cors = [
    o.strip() for o in os.environ.get("DJANGO_CORS_ALLOWED_ORIGINS", "").split(",")
    if o.strip()
]
_extra_csrf = [
    o.strip() for o in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")
    if o.strip()
]

CORS_ALLOWED_ORIGINS  = list(dict.fromkeys(_DEFAULT_ORIGINS + _extra_cors))
CSRF_TRUSTED_ORIGINS  = list(dict.fromkeys(_DEFAULT_ORIGINS + _extra_cors + _extra_csrf))
CORS_ALLOW_CREDENTIALS = True

# Si DEBUG está apagado, confía en el reverse proxy (nginx) para el esquema
USE_X_FORWARDED_HOST   = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --------------------------------------------------------------------
# Redis  (broker + cache).  Local: redis-server.  Docker: service "redis".
# --------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")

CACHES = {
    "default": {
        "BACKEND":  "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

# --------------------------------------------------------------------
# Celery (Worker + Beat).  Listo para activar cuando quieras.
# --------------------------------------------------------------------
CELERY_BROKER_URL          = REDIS_URL
CELERY_RESULT_BACKEND      = "django-db"
CELERY_BEAT_SCHEDULER      = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_TASK_TRACK_STARTED  = True
CELERY_TASK_TIME_LIMIT     = 60 * 30
CELERY_ACCEPT_CONTENT      = ["json"]
CELERY_TASK_SERIALIZER     = "json"
CELERY_RESULT_SERIALIZER   = "json"
CELERY_TIMEZONE            = "America/Mexico_City"

# --------------------------------------------------------------------
# MinIO (S3-compatible).  Local: docker compose up minio.
# --------------------------------------------------------------------
MINIO_ENDPOINT   = os.environ.get("MINIO_ENDPOINT",   "http://127.0.0.1:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "mwt-access")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "mwt-secret")
MINIO_BUCKET     = os.environ.get("MINIO_BUCKET",     "mwt-one")
MINIO_SECURE     = os.environ.get("MINIO_SECURE", "0") == "1"

# --------------------------------------------------------------------
# Paperless-ngx (gestión documental, opcional)
# --------------------------------------------------------------------
PAPERLESS_URL    = os.environ.get("PAPERLESS_URL",    "http://127.0.0.1:8010")
PAPERLESS_TOKEN  = os.environ.get("PAPERLESS_TOKEN",  "")

# --------------------------------------------------------------------
# i18n / tz
# --------------------------------------------------------------------
LANGUAGE_CODE = "es-mx"
TIME_ZONE     = "America/Mexico_City"
USE_I18N      = True
USE_TZ        = True

# --------------------------------------------------------------------
# OpenAPI
# --------------------------------------------------------------------
SPECTACULAR_SETTINGS = {
    "TITLE":       "MWT.ONE API",
    "DESCRIPTION": "ERP/Sistema Operativo B2B — API pura",
    "VERSION":     "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
