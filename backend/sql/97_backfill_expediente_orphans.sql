-- =====================================================================
-- MWT.ONE · 97_backfill_expediente_orphans.sql
-- Agente responsable: [AG-DATABASE]
--
-- Sprint Wizard Simplificado · 2026-04-29 · Backfill
--
-- Objetivo: vincular expedientes huérfanos (oc_id IS NULL) a una OC
-- mínima auto-generada. Resuelve los expedientes creados ANTES del fix
-- que añadió auto-OC en ExpedienteViewSet.create().
--
-- Idempotente:
--   · Solo procesa expedientes con oc_id IS NULL Y is_active = TRUE.
--   · Usa el codigo del expediente como sufijo de la OC (PO-from-EXP-NNNN)
--     para que sea trazable y no se duplique.
--   · UPSERT pattern: si ya existe una OC con ese mismo codigo, no la
--     vuelve a crear, solo linkea.
--
-- Cómo aplicar:
--   docker compose exec -T postgres psql -U mwt -d mwt_one \
--     < backend/sql/97_backfill_expediente_orphans.sql
-- =====================================================================

DO $$
DECLARE
    r RECORD;
    new_oc_id UUID;
    new_oc_codigo VARCHAR(32);
    line_count INTEGER;
BEGIN
    FOR r IN
        SELECT id, codigo, client_id, brand_id, moneda
          FROM expedientes.expediente
         WHERE oc_id IS NULL
           AND is_active = TRUE
         ORDER BY created_at ASC
    LOOP
        -- Codigo trazable: PO-from-<EXP-CODIGO>
        new_oc_codigo := 'PO-from-' || r.codigo;

        -- ¿Ya existe una OC con ese codigo? (re-run idempotente)
        SELECT id INTO new_oc_id
          FROM expedientes.oc
         WHERE codigo = new_oc_codigo
         LIMIT 1;

        IF new_oc_id IS NULL THEN
            -- Crear OC nueva
            new_oc_id := gen_random_uuid();
            INSERT INTO expedientes.oc (
                id, codigo, client_id, brand_id,
                estado, moneda, issued_at, notas,
                is_active, created_at, updated_at
            ) VALUES (
                new_oc_id, new_oc_codigo,
                r.client_id, r.brand_id,
                'EMITIDA', COALESCE(r.moneda, 'USD'), NOW(),
                'Backfill — vinculada al expediente ' || r.codigo
                  || ' que se había creado antes de auto-OC.',
                TRUE, NOW(), NOW()
            );
            RAISE NOTICE 'Creada OC % para expediente %', new_oc_codigo, r.codigo;
        ELSE
            RAISE NOTICE 'OC % ya existía, re-linkeando expediente %',
                new_oc_codigo, r.codigo;
        END IF;

        -- Linkear expediente.oc_id
        UPDATE expedientes.expediente
           SET oc_id = new_oc_id, updated_at = NOW()
         WHERE id = r.id;

        -- Linkear líneas existentes a la OC + actualizar lines_count
        UPDATE expedientes.linea
           SET oc_id = new_oc_id, updated_at = NOW()
         WHERE expediente_id = r.id
           AND oc_id IS NULL;

        SELECT COUNT(*) INTO line_count
          FROM expedientes.linea
         WHERE expediente_id = r.id AND is_active = TRUE;

        UPDATE expedientes.oc
           SET lines_count = line_count, updated_at = NOW()
         WHERE id = new_oc_id;

    END LOOP;
END $$;

-- =====================================================================
-- Verificación post-backfill
-- =====================================================================
SELECT
    e.codigo            AS expediente,
    e.oc_id IS NOT NULL AS tiene_oc,
    o.codigo            AS oc_codigo,
    o.lines_count       AS oc_lines
  FROM expedientes.expediente e
  LEFT JOIN expedientes.oc o ON o.id = e.oc_id
 WHERE e.is_active = TRUE
 ORDER BY e.created_at DESC
 LIMIT 20;

-- =====================================================================
-- FIN 97_backfill_expediente_orphans.sql
-- =====================================================================
