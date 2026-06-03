import os
import sys
import django

# Set up Django environment
sys.path.append('c:\\Users\\ale13\\OneDrive\\Documents\\consola_mwt_one\\backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Pre-setup override to point to the docker-exposed host port
from django.conf import settings
import django
django.setup()

settings.DATABASES["default"]["PORT"] = "5434"
settings.DATABASES["default"]["HOST"] = "127.0.0.1"

from django.db import connection
connection.close()

with connection.cursor() as c:
    c.execute("""
        SELECT id, template_id, template_title, data, jsonb_pretty(structure_snapshot)
        FROM nodos.builder_artifact_instance
        WHERE template_id = 9
        LIMIT 1
    """)
    rows = c.fetchall()
    if not rows:
        print("No builder artifact instances found for template_id = 9.")
    for row in rows:
        print(f"ID: {row[0]}, Title: {row[2]}")
        data = row[3] or {}
        import json
        structure = json.loads(row[4]) if row[4] else {}
        for sec in structure.get("sections", []) or []:
            for col in sec.get("columns", []) or []:
                for f in col.get("fields", []) or []:
                    fid = f.get("id")
                    label = f.get("label")
                    val = data.get(fid)
                    print(f"  {label} ({fid}) -> {val}")
        print("-" * 40)
