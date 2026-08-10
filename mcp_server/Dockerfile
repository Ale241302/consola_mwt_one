FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MWT_MCP_TRANSPORT=http \
    MWT_MCP_HOST=0.0.0.0 \
    MWT_MCP_PORT=8765 \
    MWT_MCP_DOMAIN=

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY mwt_mcp /app/mwt_mcp

EXPOSE 8765

# Ola 3.9 · A8 — hardening: correr como usuario no-root (sin shell, sin
# acceso de escritura al filesystem de la imagen). El MCP no necesita root:
# solo hace llamadas HTTP salientes. Se crea el usuario de forma manual
# (grupo+gid 10001) para no depender de `useradd` (ausente en slim), con
# shell `/bin/false` (sin login). Si en el futuro se requiere escribir en un
# volumen, montarlo con permisos del uid 10001.
RUN set -eux; \
    echo "mwtmcp:x:10001:10001::/app:/bin/false" >> /etc/passwd; \
    echo "mwtmcp:x:10001:" >> /etc/group; \
    chown -R 10001:10001 /app
USER 10001

# Por defecto arranca en modo streamable-http (para exponerlo por red).
# Para un servidor de DOMINIO (Ola 2 · 2.14) fija MWT_MCP_DOMAIN:
#   MWT_MCP_DOMAIN=comercial|logistica|finanzas
# Para stdio (Antigravity/Kimi local) corre la imagen con -e MWT_MCP_TRANSPORT=stdio -i.
# MWT_MCP_READONLY=1 es el kill-switch: bloquea toda escritura sin derribar el proceso.
CMD ["python", "-m", "mwt_mcp"]


