from apps.productos.models import Producto
import json

prod_urls = [(p.sku, p.imagen_url, p.ficha_url) for p in Producto.objects.filter(is_active=True)[:5]]
print("URLS:" + json.dumps(prod_urls))
