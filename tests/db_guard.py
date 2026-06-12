#!/usr/bin/env python3
"""
=====================================================================
MWT.ONE · tests/db_guard.py — Guardián de datos de prueba
Agente responsable: [AG-06-QA] + [AG-DATABASE]

CONTRATO (regla del CEO):
  "Al correr los tests, todos con datos de prueba; al FINALIZAR,
   los datos de prueba SE BORRAN — solo quedan los que estaban."

CÓMO LO GARANTIZA
=================
1. `snapshot`  → antes de la suite: captura el conjunto de PKs (id::text)
                 de TODAS las tablas base de TODOS los schemas de negocio.
                 Tablas sin PK simple → solo conteo (no se pueden purgar
                 selectivamente; se reportan).
2. `purge`     → después de la suite: BORRA cualquier fila cuyo PK no
                 estuviera en el snapshot (orden inverso no necesario:
                 MWT no tiene FKs físicas).
3. `verify`    → re-cuenta y compara contra el snapshot. Exit 0 solo si
                 la base quedó EXACTAMENTE con los datos originales.

CAPAS DE DEFENSA
================
· Los tests pytest corren con django_db(transaction=False): cada test es
  una transacción con ROLLBACK — en teoría nunca hay residuo.
· Los tests E2E (servidor real, commits reales) dependen 100% de purge.
· db_guard es independiente de Django: psycopg directo, usable como CLI
  o importado (el conftest lo invoca como fixture de sesión).

LÍMITES (documentados, no sorpresas)
====================================
· No revierte UPDATEs a filas preexistentes: los tests SOLO deben mutar
  filas creadas por ellos mismos (regla de la suite).
· No resetea secuencias (MWT usa UUIDs; irrelevante).

USO CLI
=======
    python3 tests/db_guard.py snapshot   # antes
    python3 tests/db_guard.py verify     # diagnóstico (no borra)
    python3 tests/db_guard.py purge      # borra residuos + verifica
Variables: DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (mismas que Django).
Snapshot en  tests/.db_guard_snapshot.json  (override: DB_GUARD_FILE).
=====================================================================
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    import psycopg  # psycopg3 (el del backend)
except ImportError:  # pragma: no cover
    import psycopg2 as psycopg  # fallback

SYSTEM_SCHEMAS = ("pg_catalog", "information_schema", "pg_toast")
DEFAULT_FILE = Path(__file__).resolve().parent / ".db_guard_snapshot.json"


def _dsn() -> str:
    return (
        f"host={os.environ.get('DB_HOST', '127.0.0.1')} "
        f"port={os.environ.get('DB_PORT', '5432')} "
        f"dbname={os.environ.get('DB_NAME', 'mwt_one')} "
        f"user={os.environ.get('DB_USER', 'mwt')} "
        f"password={os.environ.get('DB_PASSWORD', 'mwt')}"
    )


def _snapshot_path() -> Path:
    return Path(os.environ.get("DB_GUARD_FILE", str(DEFAULT_FILE)))


def _list_tables(cur) -> list[tuple[str, str]]:
    cur.execute(
        """
        SELECT table_schema, table_name
          FROM information_schema.tables
         WHERE table_type = 'BASE TABLE'
           AND table_schema <> ALL(%s)
         ORDER BY 1, 2
        """,
        (list(SYSTEM_SCHEMAS),),
    )
    return [(r[0], r[1]) for r in cur.fetchall()]


def _single_pk_column(cur, schema: str, table: str) -> str | None:
    cur.execute(
        """
        SELECT a.attname
          FROM pg_index i
          JOIN pg_class c      ON c.oid = i.indrelid
          JOIN pg_namespace n  ON n.oid = c.relnamespace
          JOIN pg_attribute a  ON a.attrelid = c.oid
                              AND a.attnum = ANY (i.indkey)
         WHERE i.indisprimary AND n.nspname = %s AND c.relname = %s
        """,
        (schema, table),
    )
    cols = [r[0] for r in cur.fetchall()]
    return cols[0] if len(cols) == 1 else None


def snapshot() -> dict:
    data: dict = {"tables": {}}
    with psycopg.connect(_dsn()) as conn, conn.cursor() as cur:
        for schema, table in _list_tables(cur):
            key = f"{schema}.{table}"
            pk = _single_pk_column(cur, schema, table)
            cur.execute(f'SELECT count(*) FROM "{schema}"."{table}"')
            count = cur.fetchone()[0]
            entry: dict = {"pk": pk, "count": count}
            if pk is not None:
                cur.execute(f'SELECT "{pk}"::text FROM "{schema}"."{table}"')
                entry["ids"] = sorted(r[0] for r in cur.fetchall())
            data["tables"][key] = entry
    path = _snapshot_path()
    path.write_text(json.dumps(data))
    total = sum(t["count"] for t in data["tables"].values())
    print(f"[db_guard] snapshot: {len(data['tables'])} tablas, {total} filas → {path}")
    return data


def _load() -> dict:
    path = _snapshot_path()
    if not path.exists():
        print(f"[db_guard] ERROR: no existe snapshot en {path} — corre 'snapshot' primero.")
        sys.exit(2)
    return json.loads(path.read_text())


def _diff(cur, snap: dict) -> tuple[dict, dict]:
    """→ (nuevas_por_tabla {tabla: [ids]}, desviaciones_conteo {tabla: (antes, ahora)})."""
    new_rows: dict = {}
    count_drift: dict = {}
    current = dict(_list_tables(cur))
    for key, entry in snap["tables"].items():
        schema, table = key.split(".", 1)
        if current.get(schema) is None and (schema, table) not in [
            (s, t) for s, t in _list_tables(cur)
        ]:
            pass  # tabla pudo ser dropeada por un test de DDL — se reporta abajo
        try:
            cur.execute(f'SELECT count(*) FROM "{schema}"."{table}"')
            now = cur.fetchone()[0]
        except Exception:
            count_drift[key] = (entry["count"], "TABLA AUSENTE")
            continue
        if entry.get("pk"):
            cur.execute(f'SELECT "{entry["pk"]}"::text FROM "{schema}"."{table}"')
            now_ids = {r[0] for r in cur.fetchall()}
            extra = now_ids - set(entry["ids"])
            missing = set(entry["ids"]) - now_ids
            if extra:
                new_rows[key] = sorted(extra)
            if missing:
                count_drift[key] = (entry["count"], f"{now} (faltan {len(missing)} filas originales)")
            elif now != entry["count"] and not extra:
                count_drift[key] = (entry["count"], now)
        elif now != entry["count"]:
            count_drift[key] = (entry["count"], now)
    return new_rows, count_drift


def verify(purge_first: bool = False) -> int:
    snap = _load()
    with psycopg.connect(_dsn()) as conn, conn.cursor() as cur:
        if purge_first:
            new_rows, _ = _diff(cur, snap)
            purged = 0
            for key, ids in new_rows.items():
                schema, table = key.split(".", 1)
                pk = snap["tables"][key]["pk"]
                cur.execute(
                    f'DELETE FROM "{schema}"."{table}" WHERE "{pk}"::text = ANY(%s)',
                    (ids,),
                )
                purged += cur.rowcount
            conn.commit()
            if purged:
                print(f"[db_guard] purge: {purged} filas de prueba eliminadas.")
            else:
                print("[db_guard] purge: 0 residuos (rollback transaccional funcionó).")
        new_rows, count_drift = _diff(cur, snap)
    ok = not new_rows and not count_drift
    if new_rows:
        print("[db_guard] ❌ RESIDUOS de datos de prueba:")
        for key, ids in new_rows.items():
            print(f"    {key}: +{len(ids)} filas → {ids[:5]}{'…' if len(ids) > 5 else ''}")
    if count_drift:
        print("[db_guard] ⚠️  DESVIACIÓN de conteos (filas originales tocadas):")
        for key, (before, now) in count_drift.items():
            print(f"    {key}: {before} → {now}")
    if ok:
        print("[db_guard] ✅ La base quedó EXACTAMENTE con los datos originales.")
    return 0 if ok else 1


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "snapshot":
        snapshot()
        return 0
    if cmd == "verify":
        return verify(purge_first=False)
    if cmd == "purge":
        return verify(purge_first=True)
    print(f"uso: {sys.argv[0]} snapshot|verify|purge")
    return 2


if __name__ == "__main__":
    sys.exit(main())
