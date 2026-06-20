# AGENTS.md — Fixture canónico (tests de transpilación)

Instrucciones base portables de ejemplo usadas por los tests golden. Neutras de
proveedor; cada adapter debe materializarlas en su archivo de instrucciones
(`GEMINI.md` para Gemini, `AGENTS.md` para Kimi).

## Reglas duras de ejemplo

- SQL-first: nunca `makemigrations` / `migrate`.
- Cero hex hardcodeados en frontend (R1).
- Aislamiento de visibilidad CEO→CLIENT (R3).
