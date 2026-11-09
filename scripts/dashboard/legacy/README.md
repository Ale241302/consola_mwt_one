# Dashboard interno — scripts traídos al repo (2026-11-09)

Estos generadores estaban solo en `C:\Users\alvar\.claude-server-commander\dash`
(PC de Álvaro). Ahora viven acá y **corren desde el repo**, con UTF-8 y rutas
configurables.

## Cómo correrlo

```bash
python scripts/dashboard/build.py
```

Eso ejecuta `build.py` (paso 1) y `build2.py` (paso 2 + por_cobrar + flujo +
fichas de cliente) con `-X utf8`.

| Ruta | Qué contiene | Variable |
|---|---|---|
| `data/dashboard/entradas` | `base_mwt.json`, `carpetas.json`, `cobro_cruce.csv`, `raw/` | `DASH_ENTRADAS` |
| `data/dashboard/entradas/raw` | `lista.txt`, `det.txt`, `comisiones.json` | `DASH_RAW` |
| `data/dashboard/salidas` | `ds_*.csv`, `ds_*.json`, `ped.json` | `DASH_SALIDAS` |

`data/dashboard/` está en `.gitignore`: son datos reales de clientes.

## Qué se corrigió al traerlos

- `/home/claude/dash/raw/`, `/home/claude/dash/base_mwt.json` y
  `/mnt/user-data/uploads/.claude-server-commander/cobro_cruce.csv` → rutas de
  `_paths.py`.
- `runpy.run_path('clientes_ficha.py')` (y los otros dos) → ruta absoluta, porque
  el build trabaja con `cwd` en `salidas/`.
- Los `open()` de escritura heredaban la codificación del sistema y en Windows
  rompían los CSV; ahora se invocan con `-X utf8` desde `build.py`.

## D1 · PF-2026-0001 es 2491-2026

El expediente de 2491-2026 se cargó en mwt.one con el código `PF-2026-0001`. El
build lo contaba como **dos** pedidos: la tabla por cliente sumaba 59 y la ficha
mostraba 60. `build2.py` ahora los funde en el código canónico conservando el
valor de mwt.one (3.586 USD, cerrado). Resultado: 59 = 59 en `ds_pedidos`,
`ds_clientes_anio` y `ds_clientes_ficha`.

Confirmado con el correo: «Faturas MUITO WORK - 2480-2026 E 2491-2026» (Bianca,
10/09/2026) y el packing «13 Volumes PF 2491-2026 Pedido 283303 Muito Work.pdf».

## ds_fichas.json — reconstruido

`fichas.py` arma la ficha y el respaldo de cada pedido (170 entradas):
proforma, cliente, país, negocio, estado, OC y SAP, monto, pares, las cuatro
fechas, cobro con su evidencia, carpeta, filas del LOG y las últimas 3
anotaciones con su fuente.

- **OC y SAP**: primero del nombre de la carpeta (`PO 555`, `SAP 777`); si no
  están, del `oc_codigos` de mwt.one y del frontmatter del RESUMEN.
- **Carpeta y LOG**: recorre `01 Marluvas` (`DASH_CARPETAS_RAIZ`) y lee
  `LOG_EXPEDIENTE_<pf>.csv`.
- **Cobro**: `ds_por_cobrar.csv` (situación y evidencia); si el pedido no está
  ahí, `ds_flujo.csv` (concepto, fecha y supuesto).
- **Pares**: de las líneas de mwt.one, excluyendo el SKU 801048.

Lo que no se reproduce igual que el original: el texto curado a mano de
`cobro` (ahora se deriva de las salidas) y las 7 fichas que no son pedidos
(`FE 132…`, `FE-2611`, `PF-2026-0001`), que necesitan su propia fuente.

