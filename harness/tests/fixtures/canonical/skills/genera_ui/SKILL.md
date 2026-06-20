---
name: genera_ui
description: Activa el Gate de Componentes y entrega JSX/TSX completo con ruta exacta.
trigger: Cuando el CEO pide generar o refactorizar un componente de UI.
---

Procedimiento `genera_ui`:

1. Activa el Gate de Componentes (checklist §8 de CLAUDE.md).
2. Aplica R1-R6 (cero hex, JSDoc, visibilidad, policy-driven, tabular-nums, print).
3. Reutiliza componentes core antes de crear nuevos.
4. Entrega el bloque con la ruta exacta como cabecera (p. ej.
   `// frontend/src/components/foo/Bar.jsx`).
