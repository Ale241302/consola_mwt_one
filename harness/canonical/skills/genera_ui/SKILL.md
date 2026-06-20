---
name: genera_ui
description: Genera o refactoriza un componente de UI React+Vite (JSX/TSX) de MWT.ONE pasando el Gate de Componentes antes de entregar. Entrega el codigo completo con la ruta exacta como cabecera del bloque.
trigger: El usuario pide crear, generar o refactorizar una pantalla, componente, tabla o vista del frontend.
---

# genera_ui — generar componente con Gate de Componentes

Esta skill produce codigo de frontend listo para aplicar al repo. **No entregues
nada sin pasar primero el Gate de Componentes.**

## Paso 1 — Pre-check (Gate de Componentes, las 6 preguntas)

Antes de escribir codigo, responde explicitamente:

1. **R1 — Tokens:** que tokens CSS de MWT usaras (cero hex, cero `rgb()` literal).
2. **R3 — Visibilidad:** que datos son `CEO_ONLY` y como se aislan de la rama de
   render `CLIENT_*` para que NO lleguen al DOM (usa `useVisibility`/`<Visibility>`,
   no CSS).
3. **R4 — Policy:** si es una vista de expediente, como consumes `artifact_policy`
   (nunca hardcodear la lista de artefactos).
4. **R5 — Numeros:** que metricas/montos/fechas/IDs llevan `tabular-nums` y las
   fuentes correctas (General Sans / Plus Jakarta Sans / JetBrains Mono).
5. **R6 — Impresion:** si es imprimible, confirma el bloque `@media print` canonico.
6. **Estados + i18n + caché:** botones con `disabled` + loading, errores con
   `<ErrorState />`, mutaciones que invalidan/re-fetchan, copy via `t('clave')` (sin
   strings literales).

## Paso 2 — Reutiliza antes de crear

Busca en `frontend/src/components/` componentes core existentes: `ArtifactSection` +
`ArtifactModal`, `CreditBar`, `ActivityPanel` + `ActivityBadge`, tablas Zebra de
`03_ui_primitives.jsx`, Command Palette. Reusa; no reinventes. Llamadas a API via
`frontend/src/data/`.

## Paso 3 — Genera el codigo

- React 18 + Vite + Tailwind con tokens MWT. JSX (o `.tsx` con `strict: true`, nunca
  `any`). **NO Next.js / App Router.**
- Componentes reutilizables de `components/` documentados con JSDoc (`@typedef` +
  `@param`).
- Mantén la alta densidad de datos y la estetica de precision de la marca.

## Paso 4 — Entrega

Entrega el codigo completo en bloques, cada uno con la **ruta exacta del archivo como
cabecera** (p. ej. `// frontend/src/components/expedientes/ArtifactSection.jsx`),
listo para aplicar manualmente. Cierra con un resumen del Gate marcando cada item
como cumplido.
