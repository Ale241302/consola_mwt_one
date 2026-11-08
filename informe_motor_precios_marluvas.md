# Motor de precios Marluvas — estado y plan (2026-11-08)

## Fuente oficial usada

`Tabela de preços COMEX 2026 - v10.xlsx` (correo de Marluvas, 2026-08-21) →
hoja **Tabela de Preços**, columna *Preço 26 v9 (R$)*.

- 386 SKUs con precio en BRL (ninguno vacío).
- Hoja **Banda Cambial**: 12 bandas, divisores 4.07 → 6.21 (idénticos a `BANDAS_MARLUVAS`).
- Hoja **Tabela de indices**: índice ME/ MI por plazo (90 d → ME 1.03).

## Modelo de cálculo (el mismo del panel)

```
base(banda)     = (BRL / divisor[banda]) × 1.0183^(comisión %) × 1.03
lista(banda)    = base + ajuste_usd + base × sobreprecio_pct
precio(banda,d) = lista × factor[d]     (90:1 · 60:0.99 · 30:0.9825 · 8:0.9725 · 15:0.996)
```

Se congela en `pricing.marluvas_client_sku_pricing.prices_matrix`
(`{banda: {dias: precio_usd}}`), que es lo que lee
`/api/portal/products/sku_pricing_matrix/` y por tanto el wizard y el portal.

## Cobertura del catálogo (59 productos activos)

| Caso | Cantidad | Detalle |
|---|---|---|
| Precio BRL por SKU | 47 | directo de la tabla |
| Precio BRL por referencia | 5 | 700572, 702064, 702155, 702156, 702169 |
| Sin precio en la tabla | 7 | 700377, 700653, 701392, 701756, 701840, 701909, 701956 |

## Comisiones configuradas (`clientes.comision_regla`)

| Cliente | Comisión |
|---|---|
| COMERCIALIZADORA UMMIE | 10.00 % |
| DISTRIBUIDORA COMTEK | 5.61 % (100AWORKF 5 %, 70B22 10 %) |
| EQUIPOS Y GUANTES (EGUISA) | 6.06 % |
| IMPORCOMP | 10.00 % |
| IMPORTACIONES Y COMPRAS | 10.00 % |
| MUITO WORK LIMITADA | 0.00 % |
| PRO CUSTOMER | 10.00 % |
| SONEPAR / SONDEL / SONDEL HN / SIASA | sin regla → 0 % (a definir) |

## Estado del motor en producción

Sólo **10 filas activas**: Muito Work 4 SKUs, Sondel 4 SKUs, y un cliente de
prueba (`e6aa34d7…`) 2 SKUs. Todo lo demás devuelve `no_active_pricing_row`.

## Hallazgo importante

Las 4 matrices guardadas (MWT y Sondel, SKUs 700059 / 700097 / 700209 / 700728)
**no cuadran** con la tabla v10 + comisión: diferencias de +2.70 a +12.05 USD en
banda 1 / 90 d. Se generaron con una tabla anterior y/o con sobreprecio manual.
Cargar la tabla vigente **cambia esos precios**.

## Decisión pendiente

1. ¿Se carga la tabla COMEX 2026 v10 + comisión para todos los clientes
   (reemplaza las 10 filas existentes)?
2. ¿Qué precio se usa para los 7 SKUs sin fila en la tabla?
3. ¿Comisión para SONDEL / SONEPAR / SONDEL HN / SIASA (hoy sin regla)?
