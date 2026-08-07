"""
=====================================================================
MWT.ONE · apps.core.management.commands.audit_numeric_fields
Agente responsable: [AG-BACKEND]
Ola 1 — F1: Saneamiento de campos numéricos en artefactos del Builder.

Recorre las tablas:
  - expedientes.builder_artifact_instance
  - nodos.builder_artifact_instance

Busca campos declarados como type="number" en structure_snapshot cuyo
valor en data sea string, NaN o no finito. Genera filas en
core.data_quality_issue y, con --apply, corrige los casos inequívocos.

Uso:
    python manage.py audit_numeric_fields --dry-run
    python manage.py audit_numeric_fields --apply
    python manage.py audit_numeric_fields --schema expedientes --table builder_artifact_instance
====================================================================="""
import re
from decimal import Decimal, InvalidOperation

from django.core.management.base import BaseCommand
from django.db import connection, transaction


# -------------------------------------------------------------------------
# Parseo locale-es-CR (debe coincidir con frontend/src/lib/numbers.js)
# -------------------------------------------------------------------------
def parse_locale_number(value):
    if value is None:
        return None, None
    if isinstance(value, (int, float)):
        if value != value:  # NaN
            return None, "NaN"
        return value, None

    s = str(value).strip()
    if s == "":
        return None, None

    s = re.sub(r"\s", "", s)
    s = re.sub(r"[₡$€£¥]", "", s)

    has_dot = "." in s
    has_comma = "," in s

    if has_dot and has_comma:
        last_dot = s.rfind(".")
        last_comma = s.rfind(",")
        if last_comma > last_dot:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif has_comma:
        parts = s.split(",")
        if len(parts) > 2:
            return None, "invalid_number"
        s = s.replace(",", ".")
    elif has_dot:
        parts = s.split(".")
        if len(parts) == 2:
            decimals = len(parts[1])
            if decimals <= 2:
                pass  # punto decimal tolerado
            elif decimals == 3:
                s = s.replace(".", "")  # separador de miles
            else:
                pass  # punto decimal
        else:
            if all(len(p) == 3 for p in parts[1:]):
                s = s.replace(".", "")
            else:
                return None, "invalid_number"

    try:
        n = Decimal(s)
    except (InvalidOperation, ValueError):
        return None, "invalid_number"

    if not n.is_finite():
        return None, "NaN"
    return float(n), None


def is_ambiguous(value):
    if not isinstance(value, str):
        return False
    s = re.sub(r"\s", "", value)
    s = re.sub(r"[₡$€£¥]", "", s)
    if "," in s or "." not in s:
        return False
    parts = s.split(".")
    return len(parts) == 2 and len(parts[1]) == 3


# -------------------------------------------------------------------------
# Helpers SQL
# -------------------------------------------------------------------------
SCHEMAS = [
    ("expedientes", "builder_artifact_instance"),
    ("nodos", "builder_artifact_instance"),
]


def fetch_instances(schema, table, cursor, only_id=None):
    sql = f"""
        SELECT id, structure_snapshot, data
        FROM {schema}.{table}
        WHERE is_active = TRUE
    """
    params = []
    if only_id:
        sql += " AND id = %s"
        params.append(only_id)
    cursor.execute(sql, params)
    return cursor.fetchall()


def extract_number_field_ids(structure_snapshot):
    """Devuelve set de field.id cuyo type es 'number'."""
    if not structure_snapshot:
        return set()
    ids = set()
    sections = structure_snapshot.get("sections") or []
    for sec in sections:
        for col in sec.get("columns") or []:
            for field in col.get("fields") or []:
                if field.get("type") == "number" and field.get("id"):
                    ids.add(field["id"])
    return ids


# -------------------------------------------------------------------------
class Command(BaseCommand):
    help = "Audita y corrige campos numéricos en builder_artifact_instance."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Aplica correcciones inequívocas y marca applied_at.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Solo imprime el resumen sin escribir nada.",
        )
        parser.add_argument(
            "--schema",
            default=None,
            help="Restringe a un schema (expedientes | nodos).",
        )
        parser.add_argument(
            "--table",
            default=None,
            help="Restringe a una tabla.",
        )
        parser.add_argument(
            "--id",
            default=None,
            help="Solo procesa el UUID indicado.",
        )

    # -----------------------------------------------------------------
    def handle(self, *args, **opts):
        apply = opts["apply"]
        dry_run = opts["dry_run"]
        filter_schema = opts.get("schema")
        filter_table = opts.get("table")
        only_id = opts.get("id")

        if apply and dry_run:
            self.stderr.write(self.style.ERROR(
                "No se puede usar --apply y --dry-run juntos."
            ))
            return

        schemas = [
            (s, t) for s, t in SCHEMAS
            if (filter_schema is None or s == filter_schema)
            and (filter_table is None or t == filter_table)
        ]

        total_issues = {"NaN": 0, "invalid_number": 0, "ambiguous_separator": 0, "corrected": 0}

        with connection.cursor() as cur:
            for schema, table in schemas:
                self.stdout.write(self.style.MIGRATE_HEADING(
                    f"\n» {schema}.{table}"
                ))
                rows = fetch_instances(schema, table, cur, only_id)
                for row in rows:
                    row_id, structure_snapshot, data = row
                    number_ids = extract_number_field_ids(structure_snapshot)
                    for field_id in number_ids:
                        raw_value = (data or {}).get(field_id)
                        if raw_value is None:
                            continue

                        parsed, issue = parse_locale_number(raw_value)

                        if issue == "NaN":
                            self._record_issue(
                                cur, schema, table, row_id, field_id,
                                raw_value, "NaN", None, apply, dry_run
                            )
                            total_issues["NaN"] += 1
                        elif issue == "invalid_number":
                            self._record_issue(
                                cur, schema, table, row_id, field_id,
                                raw_value, "invalid_number", None, apply, dry_run
                            )
                            total_issues["invalid_number"] += 1
                        elif isinstance(raw_value, str) and is_ambiguous(raw_value):
                            self._record_issue(
                                cur, schema, table, row_id, field_id,
                                raw_value, "ambiguous_separator", parsed, apply, dry_run
                            )
                            total_issues["ambiguous_separator"] += 1
                        elif apply and isinstance(raw_value, str) and parsed is not None:
                            # Corrección inequívoca de string a número.
                            self._correct(cur, schema, table, row_id, field_id, parsed)
                            self._record_issue(
                                cur, schema, table, row_id, field_id,
                                raw_value, "mismatch", parsed, apply=True, dry_run=False,
                            )
                            total_issues["corrected"] += 1

        self.stdout.write("\n" + self.style.MIGRATE_HEADING("Resumen"))
        for k, v in total_issues.items():
            self.stdout.write(f"  {k}: {v}")

        if dry_run:
            self.stdout.write(self.style.WARNING("\nDry-run: no se escribieron cambios."))
        elif apply:
            self.stdout.write(self.style.SUCCESS("\nCorrecciones aplicadas."))
        else:
            self.stdout.write(self.style.NOTICE(
                "\nUsa --apply para corregir inequívocos."
            ))

    # -----------------------------------------------------------------
    def _record_issue(self, cur, schema, table, row_id, field_id, raw_value,
                      issue_type, proposed_value, apply, dry_run):
        if dry_run:
            self.stdout.write(
                f"  [DRY-RUN] {schema}.{table} {row_id} :: {field_id} "
                f"raw={raw_value!r} issue={issue_type} proposed={proposed_value}"
            )
            return

        cur.execute(
            """
            INSERT INTO core.data_quality_issue
                (schema_name, table_name, row_id, field_path, raw_value,
                 detected_issue, proposed_value, applied_at, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
            ON CONFLICT (schema_name, table_name, row_id, field_path, detected_issue)
            WHERE is_active = TRUE
            DO UPDATE SET
                raw_value = EXCLUDED.raw_value,
                proposed_value = EXCLUDED.proposed_value,
                applied_at = EXCLUDED.applied_at,
                is_active = TRUE,
                created_at = NOW()
            """,
            [schema, table, row_id, field_id, str(raw_value)[:1000], issue_type,
             proposed_value, NOW() if apply else None],
        )

    def _correct(self, cur, schema, table, row_id, field_id, value):
        cur.execute(
            f"""
            UPDATE {schema}.{table}
               SET data = jsonb_set(
                   COALESCE(data, '{{}}'::jsonb),
                   %s,
                   to_jsonb(%s::numeric),
                   true
               ),
               updated_at = NOW()
             WHERE id = %s
            """,
            [f"{{{field_id}}}", value, row_id],
        )
