# =====================================================================
# Consola MWT.ONE · frontend/Dockerfile  (multi-stage)
# Agente responsable: [AG-FRONTEND]
#
# Stage 1 (builder): node:20-alpine
#   · npm ci  (instala dependencias)
#   · npm run build  (Vite → /app/dist)
#
# Stage 2 (runtime): nginx:1.27-alpine
#   · Sirve /usr/share/nginx/html (los assets buildeados)
#   · nginx.conf: SPA fallback (try_files) + proxy /api → django:8000
# =====================================================================
ARG NODE_VERSION=20-alpine
ARG NGINX_VERSION=1.27-alpine

# ---------- 1) Builder ------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
# Mock mode kill-switch: 1 = apaga el backend (salvo /auth/*), 0 = backend real.
# Default 0 (backend ON). Para activar: docker compose build --build-arg VITE_USE_MOCKS=1
ARG VITE_USE_MOCKS=0
ENV VITE_USE_MOCKS=${VITE_USE_MOCKS}
RUN npm run build

# ---------- 2) Runtime ------------------------------------------------
FROM nginx:${NGINX_VERSION} AS runtime

# Limpieza de la página default de nginx
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Configuración propia (SPA + /api proxy)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Build de la SPA
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
