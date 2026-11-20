"""Importa el Excel COMEX al motor de precios (snapshot marca+SKU).

Uso:
    python manage.py marluvas_engine_import <archivo.xlsx|archivo.json> \
        --brand 51db751c-2e74-4dd3-a592-d4bd2cc38b25 \
        [--plazo 90] [--banda 10] [--file-name "Tabela ... v10.xlsx"] \
        [--no-products] [--dry-run]

Qué hace:
  1. Parsea el Excel (Material + Preço … vN/R$) o lee un JSON [{sku, ref, brl}].
  2. Guarda el precio base BRL por SKU en `pricing.marluvas_engine_sku`
     (el "último Excel del motor").
  3. Materializa la matriz 12 bandas × plazos para TODOS los clientes
     activos, con la comisión de cada uno.
  4. Aplica la gobernanza a los productos existentes de esa marca:
     `especificaciones.client_prices`, `precio_lista`, `precio_mwt`.

Es idempotente: volver a correr el mismo archivo deja los mismos valores.
"""
from __future__ import annotations

import json
import os

from django.core.management.base import BaseCommand, CommandError

from apps.commercial import engine


class Command(BaseCommand):
    help = "Importa el Excel COMEX al motor de precios marca+SKU."

    def add_arguments(self, parser):
        parser.add_argument("path", help="Ruta del .xlsx o .json con las filas")
        parser.add_argument("--brand", required=True,
                            help="UUID de la marca (ej. Marluvas)")
        parser.add_argument("--plazo", type=int, default=engine.PLAZO_DEFAULT,
                            help="Plazo ancla en días (default 90)")
        parser.add_argument("--banda", type=int, default=None,
                            help="Banda ancla 1..12 (default: la vigente por TC)")
        parser.add_argument("--file-name", default=None,
                            help="Nombre a registrar como fuente del Excel")
        parser.add_argument("--no-products", action="store_true",
                            help="No tocar productos existentes")
        parser.add_argument("--dry-run", action="store_true",
                            help="Solo parsear y mostrar el resumen")

    def handle(self, *args, **options):
        path = options["path"]
        if not os.path.isfile(path):
            raise CommandError(f"No existe el archivo: {path}")

        if path.lower().endswith((".xlsx", ".xlsm", ".xls")):
            rows = engine.parse_xlsx(path)
        else:
            with open(path, encoding="utf-8") as fh:
                rows = json.load(fh)
        if not isinstance(rows, list) or not rows:
            raise CommandError("No se detectaron filas (sku + brl).")

        file_name = options.get("file_name") or os.path.basename(path)
        anchor = engine.anchor_actual(options.get("banda"), options.get("plazo"))

        self.stdout.write(
            f"Filas: {len(rows)} · banda {anchor['banda']['id']} "
            f"({anchor['banda']['rango']}) · plazo {anchor['plazo_dias']}d "
            f"· TC {anchor.get('tc_usd_brl')}"
        )
        if options["dry_run"]:
            for row in rows[:5]:
                self.stdout.write(f"  {row}")
            self.stdout.write(self.style.WARNING("dry-run: no se guardó nada"))
            return

        res = engine.importar(
            options["brand"],
            rows,
            file_name=file_name,
            banda_id=options.get("banda"),
            plazo_dias=options.get("plazo"),
            aplicar_productos=not options["no_products"],
        )
        self.stdout.write(json.dumps(res, ensure_ascii=False, indent=1))
        self.stdout.write(self.style.SUCCESS(
            f"OK · {res['skus']} SKUs · "
            f"{res['clientes']['clientes_ok']}/{res['clientes']['clientes']} "
            f"clientes · {res['productos']['applied']} productos con "
            f"gobernanza aplicada"
        ))
