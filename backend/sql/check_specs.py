from apps.productos.models import Producto
import json

prods = Producto.objects.filter(is_active=True)
specs_list = []
for p in prods[:3]:
    specs_list.append({
        "sku": p.sku,
        "nombre": p.nombre,
        "especificaciones": p.especificaciones
    })
print("SPECS:" + json.dumps(specs_list, indent=2))
