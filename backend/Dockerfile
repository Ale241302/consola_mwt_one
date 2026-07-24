# =====================================================================
# Consola MWT.ONE · backend/Dockerfile
# Agente responsable: [AG-BACKEND]
#
# Imagen: python 3.12-slim · gunicorn · psycopg(binary)
# Incluye `psql` y `wait-for` para esperar a Postgres antes de arrancar.
# =====================================================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=America/Mexico_City

# -- Paquetes del sistema -----------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        postgresql-client \
        curl \
        netcat-openbsd \
        tzdata \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# -- Dependencias Python ------------------------------------------------
COPY requirements.txt /app/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

# -- Código -------------------------------------------------------------
COPY . /app

# -- Entrypoint: espera Postgres → corre init.sql/02_auth_admin.sql si
#    los volúmenes los exponen → ejecuta el comando final.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["docker-entrypoint.sh"]
# Sprint 2026-05-02 (AG-03): timeout=120s. Antes 60s — insuficiente para
# el matchmaker IA con PDFs de 10+ líneas (OpenAI tarda 15-30s, más SDK
# retries internos). Con timeout=120s damos margen al request más lento
# del sistema (extract_document → cross_match → persist).
# Sprint 2026-05-31 · concurrencia gthread. Antes: 3 workers sync → el
# dashboard dispara ~18 requests en paralelo y endpoints I/O-bound (ej. el
# FX externo USD/BRL, hasta ~12s en cache fria) saturaban los 3 workers →
# nginx timeout → Cloudflare 520. Con gthread una request bloqueada en I/O
# no mata a las demas. 4 workers x 8 threads = 32 slots concurrentes.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4", "--threads", "8", "--worker-class", "gthread", "--timeout", "120", "--graceful-timeout", "30"]
