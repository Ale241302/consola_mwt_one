# Accesibilidad — guía de migración (Ola 3 · 3.25)

Objetivo: **0 controles sin nombre accesible** y **modales con foco contenido**,
sin rediseño visual. Esta guía es la receta incremental para las ~19 pantallas
que no entraron en el piloto (Clientes, Users, UploadDocumentModal,
ReceiveBatchModal, Login, ProfilePage ya migrados).

## Reglas rápidas

1. **Todo `input/select/textarea` necesita nombre accesible.** Tres formas válidas:
   - Envolver en `<label>` (asociación implícita): funciona, es lo mínimo.
   - `id` + `htmlFor` explícitos (preferido): usa `Field` o `useAutoId`.
   - `aria-label` cuando no hay label visible (icon-only, búsqueda, etc.).

2. **Modal → focus trap + Escape + restore.** Usa `useDialogA11y({ open, onClose })`:
   ```jsx
   import { useDialogA11y } from "../lib/a11y/useDialogA11y.js";
   import { useAutoId } from "../lib/a11y/useAutoId.js";
   const titleId = useAutoId("mi-modal-title");
   const dialogRef = useDialogA11y({ open, onClose });
   // ...
   <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
     <h2 id={titleId}>Título</h2>
   </div>
   ```

3. **Modal nuevo → usa `ui/Modal.jsx`** (ya trae trap + Escape + restore + overlay):
   ```jsx
   import { Modal } from "./ui/index.js";
   <Modal open={open} onClose={onClose} title="Título" footer={<button>OK</button>}>
     ...contenido...
   </Modal>
   ```

4. **Campo nuevo → usa `ui/Field.jsx`** (render-prop: el hijo recibe `id`/`aria-*`):
   ```jsx
   import { Field } from "./ui/index.js";
   <Field label="Nombre" required>
     {({ id, ...a11y }) => <input id={id} {...a11y} value={v} onChange={onChange} />}
   </Field>
   ```

## Checklist por archivo

- [ ] Cada input/select/textarea tiene `<label>`/`htmlFor`/`aria-label`.
- [ ] El modal declara `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
- [ ] El modal usa `useDialogA11y` (Escape cierra, Tab cicla, foco vuelve al disparador).
- [ ] Los `role="button"` (dropzones, chips clickeables) responden a Enter/Space.
- [ ] En `@media print` los overlays de modal no se imprimen (`.mwt-modal-overlay{display:none}`).
- [ ] Iconos decorativos tienen `aria-hidden` o `alt=""`; iconos de acción tienen `aria-label`.

## Prefijos CSS reservados

Los estilos nuevos viven en `src/styles/app.css` con prefijo estricto `mwt-`:
`.mwt-modal*`, `.mwt-field*`, `.mwt-vtable*`. No reutilices clases sin prefijo de
otra pantalla para cosas nuevas (riesgo de colisión en el app.css monolítico).

## Verificación

```powershell
cd frontend
node --test tests/a11y_modal.test.mjs   # focus trap + Escape
npm run build
```

Smoke manual: abre cada modal piloto → Tab cicla dentro, Escape cierra, foco
vuelve al botón que lo abrió. Lighthouse/axe-core opcional sobre `/clientes`.
