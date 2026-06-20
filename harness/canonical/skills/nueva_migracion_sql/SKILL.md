---
name: nueva_migracion_sql
description: Crea un nuevo archivo .sql numerado e idempotente en backend/sql/ para evolucionar el esquema SQL-first de MWT.ONE. NUNCA usa migraciones Django (makemigrations/migrate).
trigger: El usuario necesita cambiar el esquema de la base de datos (nueva tabla, columna, indice, vista, funcion).
---

# nueva_migracion_sql — cambio de esquema SQL-first

En MWT.ONE el esquema es **SQL-first**: las migraciones de Django estan desactivadas
y los modelos son `managed = False`. **NUNCA** corras `makemigrations` ni `migrate`.
Un cambio de esquema = un nuevo archivo .sql numerado e idempotente en `backend/sql/`.

## Procedimiento

### 1. Elige el numero del archivo

Lista `backend/sql/` y revisa los archivos vecinos para elegir un prefijo numerico
coherente con la secuencia y respetar el orden de dependencias (los archivos se
aplican en orden por `docker-entrypoint.sh`). Nombra:
`backend/sql/<NN><sufijo>_<descripcion_corta>.sql`.

### 2. Escribe SQL 100% idempotente

Reaplicar el archivo N veces debe dejar el mismo estado, sin error. Usa solo:

- `CREATE SCHEMA IF NOT EXISTS <schema>;`
- `CREATE TABLE IF NOT EXISTS <schema>.<tabla> (...);`
- `ALTER TABLE <schema>.<tabla> ADD COLUMN IF NOT EXISTS <col> <tipo> ...;`
- `CREATE INDEX IF NOT EXISTS <tabla>_<col>_idx ON ...;`
- `CREATE OR REPLACE VIEW / FUNCTION ...;`
- Para constraints/enums sin `IF NOT EXISTS`: envuelve en `DO $$ BEGIN IF NOT EXISTS
  (SELECT 1 FROM pg_catalog...) THEN ... END IF; END $$;`.

### 3. Backward-compatible (deploy rolling sobre VPS unico)

El codigo viejo y el nuevo conviven durante el rollout:

- Columnas nuevas: **nullable** o con `DEFAULT`. Nunca `NOT NULL` sin default en una
  tabla con datos.
- No renombres ni borres columnas/tablas en uso en el mismo paso que el codigo que las
  usa: expand-then-contract en pasos separados.
- Evita locks largos en tablas grandes en horario productivo.

### 4. Reglas de modelado MWT

- **Sin foreign keys.** Relaciones por campo UUID suelto (no `REFERENCES`). La
  integridad referencial vive en la capa de aplicacion.
- **Tenancy por `operating_company_id`** (UUID). No `tenant_id`, no RLS.
- **Cantidades: `integer`.** Montos monetarios: `numeric` con precision explicita.
- PKs UUID con `gen_random_uuid()`. Coloca cada objeto en su schema correcto.
- **No toques** `database/01_init.sql` ni `database/02_auth_admin.sql` sin coordinar
  con el CEO (bootstrap del VPS).

### 5. Aplica/valida (sin Django)

```bash
docker exec -i consola-mwt-one-postgres psql -U mwt -d mwt_one < backend/sql/<archivo>.sql
# Reaplicar el mismo archivo no debe fallar (prueba de idempotencia).
```

## Entrega

El contenido completo del nuevo .sql con su ruta exacta como cabecera (p. ej.
`-- backend/sql/92_<descripcion>.sql`), una linea sobre que cambia y por que es
backward-compatible, y la prueba de idempotencia hecha.
