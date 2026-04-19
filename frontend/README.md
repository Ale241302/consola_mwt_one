# MWT.ONE — Frontend (Control Center)

Réplica **fiel** de `MWT ONE.html`, reescrita como proyecto **React + Vite
modular**. Estilos, fuentes (`Plus Jakarta Sans` + `JetBrains Mono`), tokens de
diseño (`:root { --brand-primary: … }`), sidebar navy, topbar, command palette,
tweaks panel y las 15 pantallas fueron portadas 1:1 — el CSS se tomó **verbatim**
del HTML (`src/styles/app.css`), igual que los `@font-face` y todas las variables
de tema/densidad/acento.

## Cómo correrlo

```bash
cd mwt-one/frontend
npm install
npm run dev        # http://localhost:5173
```

El proxy de Vite reenvía `/api/*` a `http://localhost:8000` (Django backend).

## Módulos navegables

| #  | Módulo           | Ruta                 | Estado                                  |
|----|------------------|----------------------|-----------------------------------------|
| 1  | Dashboard        | `/dashboard`         | **Implementado** — KPIs, sparklines     |
| 2  | Expedientes      | `/expedientes`       | **Implementado** — lista + OC + detalle |
| 3  | Pipeline         | `/pipeline`          | **Implementado** — kanban drag-drop     |
| 4  | Portal B2B       | `/portal`            | **Implementado** — vista cliente        |
| 5  | Financiero       | `/financiero`        | **Implementado** — pagos & cobros       |
| 6  | Inventario       | `/inventario`        | **Implementado**                        |
| 7  | Nuevo expediente | `/wizard`            | **Implementado** — wizard 4 pasos       |
| 8  | Transferencias   | `/transferencias`    | Stub "Próximamente"                     |
| 9  | Nodos            | `/nodos`             | Stub                                    |
| 10 | Clientes         | `/clientes`          | Stub                                    |
| 11 | Marcas           | `/marcas`            | Stub                                    |
| 12 | Productos        | `/productos`         | Stub                                    |
| 13 | Proveedores      | `/proveedores`       | Stub                                    |
| 14 | Plantillas email | `/templates`         | Stub                                    |
| 15 | Notificaciones   | `/notificaciones`    | Stub                                    |
| —  | Cobros           | `/cobros`            | Stub                                    |

## Atajos

- `⌘ K` / `Ctrl K` — Command Palette
- Icono de sliders (topbar) — Tweaks (theme / accent / density / sidebar / idioma)
- Toggle `ES` / `EN` — persistente en `localStorage` (`mwt-tweaks`)

## Estructura

```
frontend/
├── index.html                 ← shell Vite (entry: /src/main.jsx)
├── vite.config.js             ← React plugin + /api proxy → :8000
├── package.json               ← react 18 · react-router 6 · framer-motion
├── public/
│   └── fonts/*.woff2          ← Plus Jakarta Sans + JetBrains Mono
├── src/
│   ├── main.jsx               ← ReactDOM.createRoot + BrowserRouter
│   ├── App.jsx                ← <Routes> bajo <AppLayout>
│   ├── styles/
│   │   ├── index.css          ← agregador (@import fonts/tokens/app)
│   │   ├── fonts.css          ← @font-face verbatim del HTML
│   │   ├── tokens.css         ← :root vars verbatim del HTML
│   │   └── app.css            ← CSS de componentes verbatim del HTML
│   ├── data/mockData.js       ← MOCK_*, HERO_ID, OCS, EXPEDIENTES, BRANDS, …
│   ├── lib/
│   │   ├── icons.jsx          ← ~50 iconos inline SVG (estilo lucide)
│   │   └── i18n.js            ← STRINGS.{es,en} + tr() + fmtMoney()
│   ├── components/
│   │   ├── ui/primitives.jsx  ← Badge, StatusBadge, Sparkline, BarChart, …
│   │   ├── layout/
│   │   │   ├── AppLayout.jsx  ← Sidebar + TopBar + <Outlet/>  ← entrada real
│   │   │   ├── Sidebar.jsx
│   │   │   └── TopBar.jsx
│   │   ├── CommandPalette.jsx
│   │   ├── TweaksPanel.jsx
│   │   └── ArtifactsBoard.jsx ← board de artefactos por expediente
│   └── pages/
│       ├── Dashboard.jsx
│       ├── Expedientes.jsx
│       ├── OCDetail.jsx
│       ├── ExpedienteDetail.jsx
│       ├── Pipeline.jsx
│       ├── Portal.jsx
│       ├── Pagos.jsx
│       ├── Inventario.jsx
│       ├── Wizard.jsx
│       ├── Transfers.jsx      ← stub
│       ├── Nodos.jsx          ← stub
│       ├── Clientes.jsx       ← stub
│       ├── Brands.jsx         ← stub
│       ├── Productos.jsx      ← stub
│       ├── Proveedores.jsx    ← stub
│       ├── EmailTemplates.jsx ← stub
│       ├── Notificaciones.jsx ← stub
│       └── Cobros.jsx         ← stub
└── tailwind.config.js         ← legado, no se usa (reemplazado por tokens.css)
```

## Próximos pasos

1. Reemplazar `data/mockData.js` por llamadas `fetch("/api/...")` contra el
   backend DRF (`mwt-one/backend/apps/*`).
2. Montar las pantallas reales sobre los 9 stubs (`/transferencias`, `/nodos`,
   `/clientes`, `/marcas`, `/productos`, `/proveedores`, `/templates`,
   `/notificaciones`, `/cobros`).
3. Autenticación JWT contra `/api/auth/*` (ya preconfigurada en Django).

> **Nota:** los archivos `src/00_*.jsx … 15_*.jsx` son el bundle original
> cargado en su día vía Babel-in-browser; quedaron como referencia y **no** se
> importan desde ningún sitio (Vite los ignora). Pueden eliminarse sin riesgo.
