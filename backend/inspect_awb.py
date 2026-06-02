import os
import sys
import django
import json

sys.path.append('/opt/consola-mwt-one/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import connection

with connection.cursor() as c:
    c.execute("""
        SELECT id, template_id, template_title, data
        FROM nodos.builder_artifact_instance
        WHERE data::text LIKE '%26BR%' OR data::text LIKE '%DU-E%'
    """)
    rows = c.fetchall()
    for row in rows:
        print("ID:", row[0], "TID:", row[1], "TITLE:", row[2])
        print("  DATA:", row[3])
