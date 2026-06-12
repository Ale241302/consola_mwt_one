# tests/ — Suite QA integral de Consola MWT.ONE

> **Regla de oro (contrato con el CEO):** todos los tests corren con datos
> de prueba propios y, al finalizar, **los datos de prueba se borran** —
> la base queda EXACTAMENTE con los datos que tenía antes de correr.
> Esto lo garantizan dos capas independientes (ver §Limpieza).

## Estructura

```
tests/
├── run_all.sh / run_all.ps1   # runner unificado (Linux / Windows)
├── db_guard.py                # snapshot → purge → verify (limpieza garantizada)
├── db/test_database.py        # estructura de la DB (solo lectura)
└── e2e/                       # flujos completos contra servidor HTTP real
    ├── run_e2e.sh
    └── test_full_flows.py

backend/tests/                 # suite pytest por módulo (22 archivos, ~500 tests)
frontend/tests/                # suite node --test (56 tests de lib/ crítica)
```

## Cómo correr todo

```bash
# Linux / VPS / CI (requiere DB accesible con las env DB_*)
bash tests/run_all.sh            # todo (incluye E2E con servidor real)
bash tests/run_all.sh --sin-e2e  # sin E2E

# Windows (CEO) — con el postgres del docker compose local levantado
powershell -File tests\run_all.ps1
```

Por capa:

```bash
python3 -m pytest tests/db/ -q                      # estructura DB
cd backend && python3 -m pytest tests/ -q           # backend completo
cd backend && python3 -m pytest -m expedientes -q   # un solo módulo (markers en pytest.ini)
cd frontend && bash tests/run.sh                    # frontend
bash tests/e2e/run_e2e.sh                           # E2E
```

## Limpieza garantizada (dos capas)

1. **Rollback transaccional (pytest):** `backend/tests/conftest.py` corre
   cada test dentro de una transacción que SIEMPRE se revierte
   (`django_db(transaction=False)` aplicado globalmente). Los tests pytest
   no pueden dejar residuos ni en tablas raw-SQL: el rollback de Postgres
   cubre también los `connection.cursor()` de las vistas.
2. **db_guard (snapshot/purge/verify):** antes de la suite captura los PKs
   de TODAS las tablas de negocio; al final borra cualquier fila nueva
   (residuos del E2E, que hace commits reales) y verifica que los conteos
   queden idénticos. `run_all.sh` falla si la verificación no da ✅.

Límites documentados: db_guard no revierte UPDATEs a filas preexistentes
(los tests solo deben mutar filas creadas por ellos mismos) y no resetea
secuencias (MWT usa UUIDs, irrelevante).

## Convenciones de la suite backend

- Auth: `force_authenticate(user=MwtUser(...), token={"role": ...})` — el
  token dict es OBLIGATORIO (RoleBasedPermission exige `request.auth` y el
  claim `role`). Fixtures: `authenticated_client` (admin), `client_authenticated`
  (rol cliente). Son la MISMA instancia de APIClient: para 2 roles en un
  test, crear un `APIClient()` fresco.
- Factories: `tests/factories.py` (módulos originales) y `tests/_factories_v2.py`
  (insert SQL crudo que omite columnas GENERATED). PayloadFactory = dict para
  POST; ModelFactory = inserta vía ORM (pasar `id=uuid4()` a mano).
- El comportamiento ACTUAL del código es el contrato: si un endpoint cambia
  a propósito, se actualiza el test (no al revés).
- Bugs reales se marcan `@pytest.mark.xfail(reason="BUG REAL: ...")` y se
  reportan — nunca se "arreglan" silenciosamente desde el test.

## Bugs reales encontrados por esta suite (2026-06-11)

Corregidos en este sprint:
- **cobros (CRÍTICO):** columnas GENERATED ALWAYS (`monto_pendiente`,
  `monto_neto_usd`, `monto_pendiente_usd`) escritas por el ORM → HTTP 500 en
  todo POST/PATCH de cobros/pagos/vencimientos. Fix: `GeneratedField` en
  `apps/cobros/models.py` + `read_only_fields=("id", ...)` en serializers.
- **R3 leak (CRÍTICO):** `ExpedienteListSerializer.get_proforma_codigo`
  (campo legacy) no tenía gate `_is_client()` → el código de proforma llegaba
  al rol cliente. Fix: gate agregado en `apps/expedientes/serializers.py`.

También corregidos en este sprint (segunda ronda — la suite quedó SIN xfails):
- `apps/brands/models.py`: `BrandDiscountCode` y `BrandImportLog` renombrados a
  las columnas reales del schema (`descuento_pct`, `vigencia_inicio`,
  `rows_total`...); el token de idempotencia del upload masivo vive en
  `summary_json`. Endpoints discount_codes/upload_preview: 500 → 200.
- `apps/proveedores/models.py`: `SupplierCertificacion` (`tipo_certificacion`,
  `numero_certificado`, `archivo_url`), `SupplierAuditEvent` (`delta_resumen`,
  `contexto_json` jsonb) y `SupplierImportLog` alineados al schema real.
- `inventario._aplicar_delta`: `ON CONFLICT` ahora espeja el índice vigente
  `(nodo_id, producto_id, lote, COALESCE(size,''))` — el delta de stock
  funciona (antes 400 en todo movimiento).
- `transfers`: `ValidationError` ya propaga a 400 (antes el except genérico
  la convertía en 500) y el chequeo de `idempotence_token` corre ANTES de
  validar la transición (el retry idempotente devuelve 200, ya no
  "Transición ilegal").

Pendiente menor (solo DX, no afecta producción):
- `manage.py runserver` requiere `--nostatic` (falta STATIC_URL en settings).

## Hallazgos de bootstrap desde cero (sandbox)

El orden lexicográfico de `backend/sql/` ya no reproduce la base desde cero
(la DB del VPS evolucionó con otro orden histórico): `32_clientes_extensions`
usa `codigo_marluvas` que crea `93_schema_extensions`; `public.tg_set_updated_at`
no se define en ningún SQL actual (existe en el VPS por un módulo histórico);
`D5` requiere dropear/recrear la vista de `91g`. Si algún día se necesita
bootstrap limpio: aplicar en multi-pass (reintentar fallidos) + crear
`public.tg_set_updated_at` antes de empezar. No afecta al VPS actual.
