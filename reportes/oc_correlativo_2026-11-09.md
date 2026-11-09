# Correlativo OC por cliente y marca · 2026-11-09

El correlativo dejó de ser un número suelto. Ahora es un código por
cliente y por marca:

```
MAR-UMMIE-GT-04-25
 │    │    │  │  └── 25 · año del código
 │    │    │  └───── 04 · consecutivo editable (1 a 6 dígitos)
 │    │    └──────── GT · ISO-2 del país del cliente
 │    └───────────── UMMIE · nombre corto de la empresa
 └────────────────── MAR · marca (Marluvas)
```

- Próximo = consecutivo + 1. Si dice 04, sigue 05; si se cambia a 11, sigue 12.
- Se edita en **Crear/Editar cliente**, una fila por marca. Hoy solo Marluvas; mañana cualquiera que exista en `brands.marca`.
- Vive en `clientes.cliente_marca_correlativo` (SQL `G25_clientes_correlativo_marca.sql`), una fila por `(client_id, brand_id)`.
- El número viejo `clientes.cliente.oc_correlativo` queda solo como semilla de la migración.

## Semillas (último código usado)

| Cliente | Último | Origen |
|---|---|---|
| Sondel | 505515 | 2522-2026 |
| Sondel Honduras | 700143 | 2466-2026 |
| Sonepar | 110024463 | 2521-2026 |
| Procustomer | 800120 | 2458-2026 |
| Imporcomp | 12544 | ya estaba |
| Ummie | 05 | último descriptivo 2025 |
| Comtek | 05 | último descriptivo 2025 |
| Importaciones | 04 | último descriptivo 2025 |
| Siasa | 01 | último descriptivo 2025 |
| Eguisa, Muito Work | sin código | arrancan en 01 |

## Datos corregidos antes de la migración

`clientes.cliente.oc_correlativo` quedó con el último número de cada serie
numérica: Sondel 505515 (antes 505288), Sondel Honduras 700143, Sonepar
110024463, Procustomer 800120; Imporcomp 12544 ya estaba. Esos valores
alimentan la siembra de G25.
