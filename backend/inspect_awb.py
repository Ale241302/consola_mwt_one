import os
import sys
import django

sys.path.append('/opt/consola-mwt-one/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import connection

with connection.cursor() as c:
    c.execute("""
        SELECT template_title, data, jsonb_pretty(structure_snapshot)
        FROM nodos.builder_artifact_instance
        WHERE template_id = 9
        LIMIT 1
    """)
    row = c.fetchone()
    if row:
        print("TITLE:", row[0])
        import json
        data_raw = row[1]
        data = json.loads(data_raw) if isinstance(data_raw, str) else (data_raw or {})
        struct = json.loads(row[2]) if row[2] else {}
        for sec in struct.get("sections", []) or []:
            for col in sec.get("columns", []) or []:
                for f in col.get("fields", []) or []:
                    fid = f.get("id")
                    lbl = f.get("label")
                    print(f"  {lbl} ({fid}) -> {data.get(fid)}")
