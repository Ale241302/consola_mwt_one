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

# Por defecto arranca en modo streamable-http (para exponerlo por red).
# Para un servidor de DOMINIO (Ola 2 · 2.14) fija MWT_MCP_DOMAIN:
#   MWT_MCP_DOMAIN=comercial|logistica|finanzas
# Para stdio (Antigravity/Kimi local) corre la imagen con -e MWT_MCP_TRANSPORT=stdio -i.
CMD ["python", "-m", "mwt_mcp"]

