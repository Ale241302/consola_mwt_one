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
    "apps.ocr",             # Wizard OCR (parse-oc / resolve-line)
    "apps.ai_hub",          # AI Hub — chat conversacional + agentes + skills + telemetría
    "apps.commercial",      # Capa comercial (pricing + early-payment + commissions) [Sprint 22-23]
    "apps.sizing",          # Sizing Engine — catálogo de tallas calzado/plantilla [Sprint Sizing v1]
    "apps.users",           # M3 CORE · identidad — usuarios + addresses + activity feed + password reset tokens
    "apps.roles",           # M3 CORE · RBAC — role_cat + module_cat + role_permission + user_role_bridge
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
                                "notifications,cobros,dashboard,ai,public"},
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
    # JWT custom: NO usamos simplejwt.JWTAuthentication directo porque
    # internamente hace get_user_model() → auth.User → SELECT auth_user
    # (tabla que no existe; MWT vive en core.users via SQL raw).
    # Ver apps/core/jwt_auth.py para el detalle del lookup.
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.core.jwt_auth.MwtJWTAuthentication",
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
# MinIO (S3-compatible) — endpoint del VPS compartido.
#
# IMPORTANTE: la lib Python usa la API S3 en el puerto 9000.
# La consola web (UI de admin) corre en 9001 — esa NO va acá.
#
# Hardcodeado al servidor de producción para que no dependa de env vars
# (las env vars suelen "perderse" entre restarts si docker-compose no
# está bien configurado). Las env vars siguen funcionando como override
# para dev local o staging — si las defines, ganan sobre el default.
# --------------------------------------------------------------------
MINIO_ENDPOINT   = os.environ.get("MINIO_ENDPOINT",   "http://187.77.218.102:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "MuitoWork2026?")
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

# --------------------------------------------------------------------
# AI Hub — Anthropic / OpenAI / file upload
# Consumido por apps.ai_hub.services (ChatService + FileProcessor).
# --------------------------------------------------------------------
AI_HUB = {
    "ANTHROPIC_API_KEY":   os.environ.get("ANTHROPIC_API_KEY", ""),
    "DEFAULT_MODEL":       os.environ.get("AI_HUB_DEFAULT_MODEL", "claude-sonnet-4-6"),
    "FALLBACK_MODEL":      os.environ.get("AI_HUB_FALLBACK_MODEL", "claude-haiku-4-5-20251001"),
    "MAX_TOKENS":          int(os.environ.get("AI_HUB_MAX_TOKENS", "4096")),
    "TEMPERATURE":         float(os.environ.get("AI_HUB_TEMPERATURE", "0.30")),
    # Retries con backoff exponencial (max 5 retries, base 1s, cap 60s, jitter).
    "MAX_RETRIES":         int(os.environ.get("AI_HUB_MAX_RETRIES", "5")),
    "RETRY_BASE_SECONDS":  float(os.environ.get("AI_HUB_RETRY_BASE", "1.0")),
    "RETRY_CAP_SECONDS":   float(os.environ.get("AI_HUB_RETRY_CAP", "60.0")),
    # Uploads (limit soft — nginx puede tener el suyo).
    "MAX_UPLOAD_MB":       int(os.environ.get("AI_HUB_MAX_UPLOAD_MB", "25")),
    "UPLOAD_BUCKET":       os.environ.get("AI_HUB_UPLOAD_BUCKET", MINIO_BUCKET),
    # Si True, desactiva las llamadas reales al LLM y devuelve respuestas
    # canned (útil para dev/tests sin API key).
    "DRY_RUN":             os.environ.get("AI_HUB_DRY_RUN", "0") == "1",
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --------------------------------------------------------------------
# Templates · necesario para render_to_string de plantillas de email
# --------------------------------------------------------------------
TEMPLATES = [
    {
        "BACKEND":  "django.template.backends.django.DjangoTemplates",
        "DIRS":     [],
        "APP_DIRS": True,           # carga templates desde apps/<app>/templates/
        "OPTIONS":  {
            "context_processors": [
                "django.template.context_processors.request",
            ],
        },
    },
]


# --------------------------------------------------------------------
# Email / SMTP
# --------------------------------------------------------------------
# Backend canónico (usa SMTP real si EMAIL_HOST_PASSWORD está seteado;
# si no, cae a console y los mensajes salen en stdout para debug).
EMAIL_BACKEND      = os.environ.get(
    "EMAIL_BACKEND",
    "django.core.mail.backends.smtp.EmailBackend"
    if os.environ.get("EMAIL_HOST_PASSWORD")
    else "django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST         = os.environ.get("EMAIL_HOST",         "mail.mwt.one")
EMAIL_PORT         = int(os.environ.get("EMAIL_PORT",      "465"))
EMAIL_USE_SSL      = os.environ.get("EMAIL_USE_SSL", "True").lower() in ("1", "true", "yes")
EMAIL_USE_TLS      = os.environ.get("EMAIL_USE_TLS", "False").lower() in ("1", "true", "yes")
EMAIL_HOST_USER    = os.environ.get("EMAIL_HOST_USER",    "info@mwt.one")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "info@mwt.one")
EMAIL_TIMEOUT      = int(os.environ.get("EMAIL_TIMEOUT",   "20"))

# Cuenta secundaria (envío de proformas / documentos comerciales)
EMAIL_DOC_USER     = os.environ.get("EMAIL_DOC_USER",     "mw_doc@mwt.one")
EMAIL_DOC_PASSWORD = os.environ.get("EMAIL_DOC_PASSWORD", "")
DEFAULT_REPLY_TO   = os.environ.get("DEFAULT_REPLY_TO",   "trade@mwt.one")
