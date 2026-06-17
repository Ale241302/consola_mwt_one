import os
import sys
import uuid
from decimal import Decimal

# Add backend to python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django
django.setup()

from apps.productos.models import Producto
from apps.clientes.models import Cliente
from django.db import connection

print("Starting seed_products script...")

# 1. Get size UUIDs
with connection.cursor() as cursor:
    cursor.execute("SELECT id, talla_base FROM ops.tallas WHERE is_active=True")
    rows = cursor.fetchall()
all_size_ids = [str(r[0]) for r in rows]
print(f"Retrieved {len(all_size_ids)} size UUIDs.")

# 2. Setup Marluvas Brand UUID
MARLUVAS_BRAND_ID = "51db751c-2e74-4dd3-a592-d4bd2cc38b25"
MUITO_WORK_CLIENT_ID = "5525986c-3b09-4d13-bf8f-43ccaa2deae3"

# Client mapping
CLIENT_UUIDS = {
    "Muito Work": MUITO_WORK_CLIENT_ID,
    "SONDEL": "c588c410-468a-4d54-b676-3bec174eb39d",
    "01 COMTEK": "88888888-0000-4000-8000-000000000010",
    "02 SONEPAR": "88888888-0000-4000-8000-000000000011",
    "01 Importaciones y Compras": "88888888-0000-4000-8000-000000000012",
    "01 Procostumer": "88888888-0000-4000-8000-000000000013",
    "Imporcomp": "88888888-0000-4000-8000-000000000014"
}

# 3. Define the products
new_products_data = [
    {
        "sku": "700005",
        "nombre": "60B19M-CPAP-MIN-CP",
        "descripcion": "Bota de meter elástica sin cordones, capellada de cuero plena flor, puntera de composite, plantilla antiperforante textil, suela bidensidad PU.",
        "precio": 19.35,
        "color": "Negro",
        "ncm": "6403.99.90",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "De meter",
        "capellada": "Cuero Plena Flor",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional"],
        "segmentos": ["Producción", "Construcción", "Mineria"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "700010",
        "nombre": "50B19-MEX-CPAP-PAD",
        "descripcion": "Bota de meter sin cordones en cuero plena flor suela bidensidad PU/PU, puntera composite, antiperforante textil, protector metatarsal externo.",
        "precio": 17.53,
        "color": "Negro",
        "ncm": "6403.99.90",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "De meter",
        "capellada": "Cuero Plena Flor",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional"],
        "segmentos": ["Producción", "Construcción", "Mineria"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "Externo"
    },
    {
        "sku": "700190",
        "nombre": "70B22-E-CPAP-PAD",
        "descripcion": "Botín de seguridad con cordones, capellada en microfibra M-Micro y suela bidensidad PU/PU, puntera composite y plantilla antiperforante.",
        "precio": 16.85,
        "color": "Negro",
        "ncm": "6405.90.00",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "Con Cordones",
        "capellada": "Microfibra",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional"],
        "segmentos": ["Producción", "Construcción", "Electricista"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "700198",
        "nombre": "70B22-BP-HIDRO",
        "descripcion": "Botín de seguridad con cordones, capellada en microfibra repelente al agua, puntera plástica, suela bidensidad PU.",
        "precio": 12.52,
        "color": "Negro",
        "ncm": "6405.90.00",
        "clients": ["01 COMTEK"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Plástico",
        "antiperforante": "No",
        "suela": "Bidensidad PU",
        "cierre": "Con Cordones",
        "capellada": "Microfibra",
        "normativa": ["ISO 20345"],
        "riesgos": ["Ocupacional", "Seguridad"],
        "segmentos": ["Producción", "Construcción", "Limpieza"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "700518",
        "nombre": "60B19-MIN-A-PA-CP-EXP",
        "descripcion": "Bota de seguridad de meter elástica, capellada cuero plena flor, puntera composite, plantilla antiperforante, suela bidensidad PU/PU.",
        "precio": 17.61,
        "color": "Negro",
        "ncm": "6403.99.90",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "De meter",
        "capellada": "Cuero Plena Flor",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional"],
        "segmentos": ["Producción", "Construcción", "Mineria"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "70084",
        "nombre": "50B22M-CPAP-PAD",
        "descripcion": "Botín de seguridad con cordones, capellada cuero plena flor, puntera composite, plantilla antiperforante, suela bidensidad PU.",
        "precio": 15.00,
        "color": "Negro",
        "ncm": "6403.99.90",
        "clients": ["SONDEL"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "Con Cordones",
        "capellada": "Cuero Plena Flor",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional"],
        "segmentos": ["Producción", "Construcción", "Mineria"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "701393",
        "nombre": "60B29-MEX-CPAP-SRV",
        "descripcion": "Bota de seguridad con cordones para soldador, capellada cuero plena flor, puntera composite, plantilla antiperforante, suela bidensidad PU/PU.",
        "precio": 25.60,
        "color": "Negro",
        "ncm": "6403.99.90",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "Con Cordones",
        "capellada": "Cuero Plena Flor",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional", "Alta Temperatura"],
        "segmentos": ["Producción", "Metalurgia", "Siderurgia"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "701414",
        "nombre": "100AWORKF-CA-BR-A",
        "descripcion": "Bota de seguridad industrial de PVC impermeable (impermeable clase II) con forro interno y puntera de acero.",
        "precio": 6.41,
        "color": "Blanco",
        "ncm": "6401.10.00",
        "clients": ["01 COMTEK"],
        "tipo_calzado": "Bota Alta",
        "tipo_puntera": "Acero 200J",
        "antiperforante": "No",
        "suela": "Caucho",
        "cierre": "Sin Cordones",
        "capellada": "PVC",
        "normativa": ["ISO 20347"],
        "riesgos": ["Químicos", "Humedad", "Ocupacional", "Seguridad"],
        "segmentos": ["Alimentaria", "Limpieza", "Salud"],
        "imagen": "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "701654",
        "nombre": "50B22V-CPAP-HIDRO",
        "descripcion": "Botín de seguridad con cordones, capellada cuero plena flor hidrofugado repelente al agua, puntera composite, suela bidensidad PU/PU.",
        "precio": 14.18,
        "color": "Negro",
        "ncm": "6403.99.90",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "Con Cordones",
        "capellada": "Cuero Plena Flor HIDRO",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional", "Humedad"],
        "segmentos": ["Producción", "Construcción", "Petroquimicos"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "701927",
        "nombre": "50B26V-C-PAD-NT",
        "descripcion": "Botín de seguridad con cordones en nobuck color café, puntera de composite, plantilla de PU, suela bidensidad PU/PU.",
        "precio": 20.96,
        "color": "Café",
        "ncm": "6403.99.90",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU",
        "cierre": "Con Cordones",
        "capellada": "Cuero Nobuck",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional"],
        "segmentos": ["Producción", "Construcción", "Trekking"],
        "imagen": "https://images.unsplash.com/photo-1549298916-b41d501d3772?w=800",
        "protector_metatarsal": "No"
    },
    {
        "sku": "702064",
        "nombre": "60B19M-CPAP-MIN-CP",
        "descripcion": "Bota de meter sin cordones en cuero plena flor suela bidensidad PU/Caucho, puntera composite, antiperforante textil, protector metatarsal interno.",
        "precio": 19.35,
        "color": "Negro",
        "ncm": "6403.99.90",
        "clients": ["02 SONEPAR"],
        "tipo_calzado": "Bota al Tobillo",
        "tipo_puntera": "Composite 200J",
        "antiperforante": "Textil 1100 N",
        "suela": "Bidensidad PU Caucho",
        "cierre": "De meter",
        "capellada": "Cuero Plena Flor",
        "normativa": ["ISO 20345"],
        "riesgos": ["Shock", "Caída Objetos", "Seguridad", "Ocupacional", "Alta Temperatura"],
        "segmentos": ["Producción", "Construcción", "Mineria"],
        "imagen": "https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=800",
        "protector_metatarsal": "Interno"
    }
]

# 4. Insert each product if it doesn't exist
for pd in new_products_data:
    sku = pd["sku"]
    if Producto.objects.filter(sku=sku).exists():
        print(f"Product with SKU {sku} already exists. Skipping.")
        continue

    # Prepare client visibility overrides
    client_overrides = {MUITO_WORK_CLIENT_ID: True}
    for client_name in pd["clients"]:
        client_uuid = CLIENT_UUIDS.get(client_name)
        if client_uuid:
            client_overrides[client_uuid] = True

    # Setup especificaciones JSONB
    especificaciones = {
        "ncm": pd["ncm"],
        "color": pd["color"],
        "nodes": [],
        "sizes": all_size_ids,
        "suela": pd["suela"],
        "cierre": pd["cierre"],
        "fichas": [],
        "riesgo": pd["riesgos"],
        "gallery": [pd["imagen"]],
        "segmento": pd["segmentos"],
        "capellada": pd["capellada"],
        "normativa": pd["normativa"],
        "visibility": {
            "visible_to_all": False,
            "client_overrides": client_overrides
        },
        "cubrepuntera": "No",
        "tipo_calzado": pd["tipo_calzado"],
        "tipo_puntera": pd["tipo_puntera"],
        "client_prices": {cid: pd["precio"] for cid in client_overrides.keys()},
        "antiperforante": pd["antiperforante"],
        "plantilla_interna": "Poliuretano" if pd["sku"] != "701414" else "No",
        "disipativo_energia": ["ABNT NBR 16603-2017 500V"] if pd["sku"] not in ["700198", "701414"] else ["No"],
        "protector_metatarsal": pd["protector_metatarsal"],
        "materiales_circulares": "Sí" if pd["sku"] != "701414" else "No"
    }

    # Create the product
    price = Decimal(str(pd["precio"]))
    p = Producto(
        id=uuid.uuid4(),
        sku=sku,
        nombre=pd["nombre"],
        descripcion=pd["descripcion"],
        marca_id=uuid.UUID(MARLUVAS_BRAND_ID),
        categoria="CALZADO",
        subcategoria="CALZADO_SEGURIDAD",
        unidad="PAR",
        moneda="USD",
        costo_estandar=round(price * Decimal("0.85"), 2),
        precio_lista=round(price * Decimal("1.25"), 2),
        precio_distribuidor=price,
        precio_mwt=price,
        peso_kg=Decimal("1.200") if pd["sku"] != "701414" else Decimal("1.500"),
        volumen_m3=Decimal("0.0120") if pd["sku"] != "701414" else Decimal("0.0150"),
        imagen_url=pd["imagen"],
        ficha_url="https://marluvas.com.br/wp-content/uploads/2021/04/Catalogo_Marluvas_2021.pdf",
        tallas=all_size_ids,
        colores=[pd["color"]],
        estado="ACTIVO",
        proveedor_principal_id=None,
        pais_origen_iso2="BR",
        hs_code=pd["ncm"],
        stock_minimo=0,
        stock_maximo=0,
        visibility_tier="INTERNAL",
        is_active=True
    )
    p.especificaciones = especificaciones
    p.save()
    print(f"Successfully created product {pd['nombre']} with SKU {sku}.")

print("Finished seed_products script successfully!")
