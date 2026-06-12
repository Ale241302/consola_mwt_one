"""
=====================================================================
MWT.ONE · tests/_factories_v2.py
Agente responsable: [AG-QA-BACKEND-2]  (archivo NUEVO — no tocar
factories.py ni _common.py, que pertenecen a otro agente).

Helpers de creación de datos que NO pueden vivir en factories.py:

  · crear_via_sql(factory_cls, **kwargs)
    Las tablas cobros.cobro / cobros.pago / cobros.vencimiento tienen
    columnas GENERATED ALWAYS (monto_pendiente, monto_neto_usd,
    monto_pendiente_usd). El ORM de Django las incluye en cada
    INSERT/UPDATE → psycopg.errors.GeneratedAlways. Este helper inserta
    vía cursor crudo OMITIENDO esas columnas y devuelve la instancia
    ORM re-leída de la DB (con los valores generados ya calculados).

  · Wrappers de conveniencia: crear_cobro / crear_pago / crear_vencimiento.

  · Helpers genéricos de insert raw para los módulos nuevos
    (tickets, finance, analytics, fusión) — ver insert_row().
=====================================================================
"""
from __future__ import annotations

import json
import uuid

from django.db import connection
from django.utils import timezone

# Columnas GENERATED ALWAYS por tabla (verificado contra
# information_schema.columns en la DB real).
GENERATED_ALWAYS = {
    'cobros"."cobro':       {"monto_pendiente"},
    'cobros"."pago':        {"monto_neto_usd"},
    'cobros"."vencimiento': {"monto_pendiente_usd"},
}


def _adapt(value, field=None):
    """Adapta valores Python → parámetros SQL (jsonb como texto json)."""
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return value


def crear_via_sql(factory_cls, **kwargs):
    """
    Construye la instancia con factory_cls.build(**kwargs) (sin tocar DB)
    y la inserta vía SQL crudo omitiendo las columnas GENERATED ALWAYS.
    Devuelve la instancia ORM re-leída (model.objects.get(pk=...)).
    """
    obj = factory_cls.build(**kwargs)
    model = type(obj)
    table = model._meta.db_table
    skip = GENERATED_ALWAYS.get(table, set())

    cols, phs, vals = [], [], []
    for f in model._meta.concrete_fields:
        if f.column in skip:
            continue
        v = getattr(obj, f.attname)
        # auto_now / auto_now_add quedan en None con build(): usar now()
        if v is None and (getattr(f, "auto_now", False) or getattr(f, "auto_now_add", False)):
            v = timezone.now()
        if v is None:
            continue  # dejar que aplique el DEFAULT de la columna
        ph = "%s"
        if f.get_internal_type() == "JSONField":
            ph = "%s::jsonb"
        cols.append(f'"{f.column}"')
        phs.append(ph)
        vals.append(_adapt(v, f))

    sql = f'INSERT INTO "{table}" ({", ".join(cols)}) VALUES ({", ".join(phs)})'
    with connection.cursor() as c:
        c.execute(sql, vals)
    return model.objects.get(pk=obj.pk)


def crear_lote_sql(factory_cls, n, **kwargs):
    """Equivalente a create_batch(n) pero vía SQL crudo."""
    return [crear_via_sql(factory_cls, **kwargs) for _ in range(n)]


# ─────────────────────────────────────────────────────────────────────
# Wrappers de conveniencia (cobros)
# ─────────────────────────────────────────────────────────────────────
def crear_cobro(**kwargs):
    from tests.factories import CobroModelFactory
    # monto_pendiente es GENERATED (monto_total - monto_pagado): si el
    # test lo pide explícito, lo traducimos a monto_total/monto_pagado.
    pendiente = kwargs.pop("monto_pendiente", None)
    if pendiente is not None and "monto_total" not in kwargs:
        kwargs["monto_total"] = pendiente
        kwargs.setdefault("monto_pagado", "0.00")
    return crear_via_sql(CobroModelFactory, **kwargs)


def crear_pago(**kwargs):
    from tests.factories import PagoModelFactory
    kwargs.pop("monto_neto_usd", None)
    return crear_via_sql(PagoModelFactory, **kwargs)


def crear_vencimiento(**kwargs):
    from tests.factories import VencimientoModelFactory
    kwargs.pop("monto_pendiente_usd", None)
    return crear_via_sql(VencimientoModelFactory, **kwargs)


# ─────────────────────────────────────────────────────────────────────
# Insert genérico fila→tabla (módulos nuevos sin factory)
# ─────────────────────────────────────────────────────────────────────
def insert_row(table: str, **cols):
    """
    INSERT crudo en `table` (formato schema.tabla). Convierte dict/list
    a jsonb. Devuelve el dict de columnas insertadas (incluye id).
    cols con valor None se omiten (aplica DEFAULT de la columna).
    """
    cols = {k: v for k, v in cols.items() if v is not None}
    names, phs, vals = [], [], []
    for k, v in cols.items():
        names.append(f'"{k}"')
        if isinstance(v, (dict, list)):
            phs.append("%s::jsonb")
            vals.append(json.dumps(v))
        else:
            phs.append("%s")
            vals.append(v)
    schema, _, tname = table.partition(".")
    sql = f'INSERT INTO "{schema}"."{tname}" ({", ".join(names)}) VALUES ({", ".join(phs)})'
    with connection.cursor() as c:
        c.execute(sql, vals)
    return cols


def new_id() -> str:
    return str(uuid.uuid4())
