from django.db import connection
import json

with connection.cursor() as cursor:
    cursor.execute("SELECT id, tipo_producto, talla_base, br, eu, mx FROM ops.tallas WHERE is_active=True LIMIT 100")
    rows = cursor.fetchall()

sizes = [{"id": str(r[0]), "tipo_producto": r[1], "talla_base": r[2], "br": r[3], "eu": r[4], "mx": r[5]} for r in rows]
print("SIZES:" + json.dumps(sizes, indent=2))
