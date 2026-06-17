-- =====================================================================
-- MWT.ONE · F0_seed_new_clients.sql · SEED NUEVOS CLIENTES
-- =====================================================================

INSERT INTO clientes.cliente (
    id, razon_social, nombre_comercial, tax_id, tipo, segmento,
    pais_iso2, ciudad, direccion, moneda,
    credito_aprobado, credito_usado, dias_credito,
    contacto_nombre, contacto_email, contacto_tel,
    estado, nodo_asignado_id, responsable_id,
    visibility_tier, is_active,
    codigo_marluvas, canal, incoterm, medio_pago, direccion_entrega, comision_pct
)
VALUES
(
    '88888888-0000-4000-8000-000000000010',
    '01 COMTEK', 'Comtek', '900895760-1', 'B2B', 'C',
    'CO', 'Medellín', 'Carrera 42 # 3 Sur 81, Edificio Milla de Oro, Torre 1, Piso 15, Medellín', 'USD',
    60000.00, 0.00, 90,
    'Administración', 'comunicaciones@comtek.la', '+57 317 3246351',
    'ACTIVO', NULL, NULL,
    'INTERNAL', TRUE,
    NULL, 'DISTRIBUIDOR', 'FOB', 'TRANSFER_BANCARIA', 'Carrera 42 # 3 Sur 81, Edificio Milla de Oro, Torre 1, Piso 15, Medellín', 0.1300
),
(
    '88888888-0000-4000-8000-000000000011',
    '02 SONEPAR', 'Sonepar Colombia', '860531287-5', 'B2B', 'C',
    'CO', 'Bogotá', 'Autopista Norte # 114 - 44, Edificio Invention Center, Oficina 702, Bogotá D.C.', 'USD',
    60000.00, 0.00, 90,
    'Administración', 'importacion.facturas@sonepar.co', '+57 601 587 4400',
    'ACTIVO', NULL, NULL,
    'INTERNAL', TRUE,
    NULL, 'DISTRIBUIDOR', 'FOB', 'TRANSFER_BANCARIA', 'Autopista Norte # 114 - 44, Edificio Invention Center, Oficina 702, Bogotá D.C.', 0.1300
),
(
    '88888888-0000-4000-8000-000000000012',
    '01 Importaciones y Compras', 'Importaciones y Compras', '08011990123456', 'B2B', 'C',
    'HN', 'Tegucigalpa', 'Colonia Florencia Norte, Edificio EDUCREDITO, Tegucigalpa', 'USD',
    60000.00, 0.00, 90,
    'Administración', 'compras@importacionesycompras.hn', '+504 2209-5355',
    'ACTIVO', NULL, NULL,
    'INTERNAL', TRUE,
    NULL, 'DISTRIBUIDOR', 'FOB', 'TRANSFER_BANCARIA', 'Colonia Florencia Norte, Edificio EDUCREDITO, Tegucigalpa, Honduras', 0.1300
),
(
    '88888888-0000-4000-8000-000000000013',
    '01 Procostumer', 'Pro Customer Corp', '1556575-1-2026', 'B2B', 'C',
    'PA', 'Ciudad de Panamá', 'Vía España, Ciudad de Panamá', 'USD',
    60000.00, 0.00, 90,
    'Administración', 'ventas@procustomer.com', '+507 800-1234',
    'ACTIVO', NULL, NULL,
    'INTERNAL', TRUE,
    NULL, 'DISTRIBUIDOR', 'FOB', 'TRANSFER_BANCARIA', 'Vía España, Ciudad de Panamá, Panamá', 0.1300
),
(
    '88888888-0000-4000-8000-000000000014',
    'Imporcomp', 'Imporcomp', '38796171', 'B2B', 'C',
    'GT', 'Mixco', 'Bulevar El Naranjo 28-98, Zona 4, Mixco, Guatemala', 'USD',
    60000.00, 0.00, 90,
    'Administración', 'ventas@imporcomp.com', '+502 2380-9000',
    'ACTIVO', NULL, NULL,
    'INTERNAL', TRUE,
    NULL, 'DISTRIBUIDOR', 'FOB', 'TRANSFER_BANCARIA', 'Bulevar El Naranjo 28-98, Zona 4, Mixco, Guatemala', 0.1300
)
ON CONFLICT (tax_id, pais_iso2) DO NOTHING;
