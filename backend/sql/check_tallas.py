from apps.productos.models import Producto
import json

p = Producto.objects.filter(is_active=True).first()
if p:
    print("SKU:", p.sku)
    print("tallas:", p.tallas)
    print("colores:", p.colores)
else:
    print("No products found")
