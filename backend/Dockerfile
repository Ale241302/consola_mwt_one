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
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "60"]
