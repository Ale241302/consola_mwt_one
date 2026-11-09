# Dashboard interno — scripts traídos al repo (2026-11-09)

Estos generadores estaban solo en `C:\Users\alvar\.claude-server-commander\dash`
(PC de Álvaro). Ahora viven acá para que el build sea versionado.

| Script | Qué hace |
|---|---|
| `build.py` | Paso 1: arma `base_mwt.json` desde las fuentes crudas (`raw/`, `carpetas.json`, `cobro_cruce.csv`). |
| `build2.py` | Paso 2: genera los `ds_*.csv/json` que consume el artifact. |
| `por_cobrar_curado.py` | Por cobrar revisado contra el log y el resumen de cada carpeta. |
| `flujo.py` | Entradas esperadas por pedido (comisiones, FE, pagos a Marluvas). |
| `clientes_ficha.py` | Ficha por cliente (crédito, tasa, días de pago, saldos, pedidos). |
| `ledger.py` | Facturas de comisión transcritas (entrada de comisiones). |

## Importante

- **Los paths son del entorno donde se corrieron** (`/home/claude/dash/...`).
  Antes de usarlos acá hay que apuntarlos a las carpetas del repo
  (`data/dashboard/entradas`, `data/dashboard/salidas`).
- **No se versionan datos**: las entradas y salidas reales son confidenciales y
  quedan fuera del repo (ver `.gitignore`).
- El orden de ejecución es `build.py` → `build2.py` → `por_cobrar_curado.py` →
  `flujo.py` → `clientes_ficha.py`.

## Lo que sí está listo para usar

- `../sellar.py` — deja `SELLO_FUENTES.json` con fecha y sha256 de cada fuente y salida.
- `../verificar.py` — corre las comprobaciones del doc 04 (sellos, frescura,
  cuadre clientes, datasets del artifact).
