-- =====================================================================
-- MWT.ONE · 91d_evento_is_active.sql · CANCELADO (NO-OP)
-- Agente: [AG-DATABASE]
--
-- ⚠️ Este script fue creado y luego cancelado. NO ejecutar.
--
-- El plan original era añadir `is_active` a transfers.evento porque el
-- modelo Django lo declaraba. Pero al revisar 91_transfers_audit.sql
-- (línea 157) se confirmó la decisión de diseño explícita:
--
--   "transfers.evento es append-only — sin columna is_active"
--
-- El audit trail debe ser inmutable. La solución correcta es quitar
-- `is_active` del modelo apps.transfers.models.Evento (lo cual ya se
-- hizo en el commit que acompaña este archivo), no añadir la columna
-- a la tabla.
--
-- Este archivo se mantiene únicamente para documentar la decisión y
-- el flujo de razonamiento. Ejecutarlo es seguro (no hace nada).
-- =====================================================================

DO $$ BEGIN
    RAISE NOTICE '[91d] NO-OP — ver comentario al inicio del archivo';
END $$;
