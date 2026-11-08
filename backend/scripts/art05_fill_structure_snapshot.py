"""ART-05: completa structure_snapshot vacío con la plantilla vigente del
Builder y verifica TODOS los artefactos del template 9 (por nodo).

Uso: python art05_fill_verify.py [--apply]
"""
import json
import os
import sys

sys.path.insert(0, "/app")

import django
import requests

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from django.db import connection  # noqa: E402

APPLY = "--apply" in sys.argv
TEMPLATE_ID = 9
OLD_ID, NEW_ID = "field-0071", "field-0084"


def template_structure():
    base = os.environ.get("BUILDER_API_BASE", "https://builder.muito.work/api").rstrip("/")
    tok = requests.post(
        f"{base}/login/",
        json={"username": os.environ.get("BUILDER_USERNAME", "Admin"),
              "password": os.environ.get("BUILDER_PASSWORD", "")},
        timeout=20,
    ).json()["access"]
    tpl = requests.get(f"{base}/artefactos/{TEMPLATE_ID}/",
                       headers={"Authorization": f"Bearer {tok}"}, timeout=20).json()
    struct = tpl.get("structure_json")
    return json.loads(struct) if isinstance(struct, str) else struct


TPL = template_structure()
print("plantilla: secciones", len(TPL.get("sections", [])))

cur = connection.cursor()
cur.execute("""
    select a.id, a.nodo_id, n.codigo, a.data, a.structure_snapshot, a.is_active
      from nodos.builder_artifact_instance a
      left join nodos.nodo n on n.id = a.nodo_id
     where a.template_id = %s
     order by n.codigo
""", [TEMPLATE_ID])
rows = cur.fetchall()

fills, problemas = [], []
for rid, nodo_id, nodo_cod, data, struct, activo in rows:
    d = data if isinstance(data, dict) else json.loads(data or "{}")
    s = struct if isinstance(struct, dict) else json.loads(struct or "{}")
    secs = s.get("sections") or []

    if not secs:
        nd = dict(d)
        nd.setdefault(NEW_ID, nd.get(NEW_ID) or "")
        fills.append((rid, nodo_cod, nd))
        continue

    ids = [f.get("id") for sec in secs for col in sec.get("columns", [])
           for f in col.get("fields", [])]
    if ids.count(NEW_ID) > 1:
        problemas.append((rid, nodo_cod, "DESTINO duplicado"))
    elif OLD_ID not in ids:
        problemas.append((rid, nodo_cod, "sin campo Origen en el snapshot"))
    elif NEW_ID not in ids:
        problemas.append((rid, nodo_cod, "sin campo Destino en el snapshot"))

print(f"con snapshot vacío a rellenar: {len(fills)}")
for rid, nodo, _ in fills:
    print("  ", rid, nodo)
print(f"problemas detectados: {len(problemas)}")
for p in problemas:
    print("  ", p)

if not APPLY:
    print("\nDRY-RUN (usá --apply)")
    raise SystemExit(0)

for rid, _, nd in fills:
    cur.execute("""
        update nodos.builder_artifact_instance
           set structure_snapshot = %s::jsonb,
               data = %s::jsonb,
               updated_at = now()
         where id = %s
    """, [json.dumps(TPL, ensure_ascii=False),
          json.dumps(nd, ensure_ascii=False), rid])
print(f"rellenados: {len(fills)}")
