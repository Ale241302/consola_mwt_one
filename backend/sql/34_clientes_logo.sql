-- =====================================================================
-- MWT.ONE · 34_clientes_logo.sql · Extensión logo de cliente
-- Agente responsable: [AG-DATABASE]
--
-- Agrega soporte para guardar la imagen corporativa (logo) del cliente
-- en MinIO, persistiendo la key en clientes.cliente.logo_url.
-- =====================================================================

-- Columna de logo (key MinIO o URL relativa al bucket).
ALTER TABLE clientes.cliente
    ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN clientes.cliente.logo_url IS
    'Key del logo corporativo en MinIO (cliente/<id>/<uuid>-<nombre>). '
    'Renderizado vía /api/storage/download/?key=<logo_url>.';

-- =====================================================================
-- FIN 34_clientes_logo.sql
-- =====================================================================
