---
name: revisa_ux
description: Audita un componente o vista del frontend de MWT.ONE buscando violaciones de tokens (R1), falta de loading/error states, problemas de a11y y fugas de visibilidad por rol (R3). Solo lectura; emite veredicto accionable.
trigger: El usuario pide revisar, auditar o validar la UX/UI de un componente, pantalla o diff del frontend.
---

# revisa_ux — auditoria de UX/UI

Esta skill audita codigo de frontend existente. No edites; emite un veredicto con
hallazgos accionables citando archivo:linea.

## Que auditas (en orden de severidad)

### CRITICAL (bloqueante)

- **R1 — Cero hex.** Busca `#hex`, `rgb(...)` literales y arbitrary values con hex en
  JSX y Tailwind. Solo se permiten tokens CSS de MWT (`--brand-primary`,
  `--surface-raised`, `--text-primary`, ...). Cualquier hex literal es CRITICAL.
- **R3 — Fuga de visibilidad por rol.** Verifica que ningun dato `CEO_ONLY` (costos,
  margenes, exposicion financiera, gobernanza, transiciones de estado, logs de
  auditoria) pueda llegar al DOM de un rol `CLIENT_*`. Renderizar y ocultar con CSS es
  violacion: el dato no debe llegar al DOM. El gating debe estar centralizado
  (`useVisibility`/`<Visibility>`).

### Importante (reportar)

- **Loading/error states (§ mutaciones y caché).** Cada boton de accion debe tener
  `disabled` + spinner; los errores van a `<ErrorState />`, nunca `alert()` ni solo
  `console.log()`; las mutaciones invalidan o re-fetchan (no UI stale).
- **Accesibilidad (a11y).** Roles/labels ARIA en controles, foco gestionado en
  modales, contraste suficiente, navegacion por teclado, `alt` en imagenes, targets
  tactiles razonables.
- **R5 — `tabular-nums`** en toda metrica/monto/fecha/numero de tabla.
- **R6 — `@media print`** intacto en vistas imprimibles.
- **i18n** — copy via `t('clave')`, sin strings literales en JSX.
- **R2 — JSDoc** en componentes reutilizables de `components/`.
- `console.log` residual.

## Como procedes

1. Lee el componente y los archivos relacionados (fetchers en `data/`, contexto de
   auth, tokens en `styles/`).
2. Usa `bash`/grep para localizar hex, `console.log`, `except`, ausencia de
   `tabular-nums`, etc.
3. Para cada hallazgo registra archivo:linea, regla violada y por que importa.

## Entrega

Veredicto en tres bloques: (1) CRITICAL GAPS, (2) hallazgos importantes/warnings,
(3) decision final (APROBADO / NECESITA CAMBIOS) con la lista priorizada de fixes.
