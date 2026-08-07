"""
=====================================================================
MWT.ONE · management command · normalize_storage_keys

Migra campos de storage que históricamente quedaron con URLs firmadas de
MinIO completas (http://host:9000/bucket/key?X-Amz-...) y los convierte a
object keys relativas (key).

Tablas afectadas:
  · productos.producto.imagen_url, ficha_url
  · clientes.cliente.logo_url
  · marcas.marca.logo_url
  · expedientes.documento.storage_url

Uso:
  python manage.py normalize_storage_keys [--dry-run]

--dry-run: imprime lo que haría sin tocar la BD.
=====================================================================
"""
from django.core.management.base import BaseCommand
from django.db import connection
from django.conf import settings

from apps.storage.helpers import normalize_storage_key


TABLE_COLUMNS = [
    ("productos", "producto", ["imagen_url", "ficha_url"]),
    ("clientes", "cliente", ["logo_url"]),
    ("brands", "marca", ["logo_url"]),
    ("expedientes", "documento", ["storage_url"]),
]


class Command(BaseCommand):
    help = "Convierte URLs firmadas de MinIO en object keys relativas"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="No escribe en BD; solo imprime conteos",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        total_changed = 0
        total_scanned = 0

        for schema, table, columns in TABLE_COLUMNS:
            for column in columns:
                changed, scanned = self._normalize_column(schema, table, column, dry_run)
                total_changed += changed
                total_scanned += scanned

        prefix = "[DRY-RUN] " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefix}Listo: {total_changed}/{total_scanned} filas normalizadas."
            )
        )

    def _normalize_column(self, schema: str, table: str, column: str, dry_run: bool):
        changed = 0
        with connection.cursor() as c:
            c.execute(
                f"""
                SELECT id, {column}
                FROM {schema}.{table}
                WHERE {column} IS NOT NULL AND {column} <> ''
                """
            )
            rows = c.fetchall()

            scanned = len(rows)
            for pk, raw in rows:
                normalized = normalize_storage_key(raw)
                # normalize_storage_key devuelve None para vacío; en BD
                # preferimos NULL sobre string vacío.
                if normalized is None:
                    normalized = None
                if normalized == raw:
                    continue

                # Sólo actualizamos si realmente cambia el valor.
                changed += 1
                if dry_run:
                    self.stdout.write(
                        f"[DRY-RUN] {schema}.{table}.{column} id={pk}: "
                        f"{self._trim(raw)} -> {self._trim(normalized)}"
                    )
                    continue

                c.execute(
                    f"""
                    UPDATE {schema}.{table}
                    SET {column} = %s
                    WHERE id = %s
                    """,
                    [normalized, pk],
                )

        return changed, scanned

    @staticmethod
    def _trim(value, max_len=80):
        if value is None:
            return "NULL"
        s = str(value)
        if len(s) > max_len:
            return s[:max_len] + "…"
        return s
