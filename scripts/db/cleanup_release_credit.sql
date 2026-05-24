-- =====================================================================
-- Consola MWT.ONE · cleanup_release_credit.sql
-- Sprint operativo: 2026-05-24 · Decision CEO (Alejandro)
--
-- PROPOSITO:
--   Vaciar la data operativa (expedientes, OCs, cobros, finance,
--   inventario, transfers, notifications, dashboard, portal logs,
--   tickets, AI threads, e historiales/logs de imports y precios)
--   PRESERVANDO los catalogos maestros y los registros de clientes.
--   Liberar el credito de todos los clientes a 0 (sin borrarlos).
--
-- DIFERENCIAS vs backend/sql/D0_purge_demo_data.sql:
--   · D0 hace TRUNCATE de clientes.cliente. Este script NO.
--   · D0 NO toca commercial.brand_client_pricing_assignment ni
--     pricing.client_assignment ni pricing.marluvas_client_sku_pricing.
--     Este script SI los borra (decision CEO 2026-05-24).
--   · D0 NO toca productos.precio_history ni imports_log ni
--     marluvas_price_history_*. Este script SI los borra.
--   · D0 borra portal.mwt_user. Este script NO (decision CEO: conservar
--     usuarios B2B para que sigan teniendo acceso al portal).
--   · Este script ademas hace UPDATE en clientes.cliente para poner
--     credito_usado = 0 (no se logra borrando cobros porque es un
--     campo persistido en el modelo).
--
-- LO QUE SE PRESERVA (NO se toca):
--   · core.users, core.roles, core.user_roles
--   · clientes.cliente (con UPDATE: credito_usado = 0)
--   · clientes.credit_config (config umbrales)
--   · brands.marca, brands.brand_discount_code
--   · productos.producto, .variante, .talla_matriz, .product_client_alias
--   · proveedores.proveedor + extensiones (audit, certificacion, promo,
--     iso_evaluations, suppliers_product_assignments)
--   · nodos.nodo, .artefacto, .nodo_jerarquia, .builder_artifact_instance,
--     .builder_artifact_line
--   · commercial.early_payment_policy, .early_payment_tier, .commission_rule
--   · pricing.grade_item, .pricelist_version, .payment_index, .pricing_constants
--   · finance.mwt_account (cuentas bancarias propias)
--   · portal.mwt_user (cuentas B2B externas activas)
--   · ai.agent, .instruction, .skill (catalogo AI Hub)
--   · email_templates.template, .version
--   · dashboard.widget_cat
--   · TODOS los *_cat (catalogos enumerados) en todos los schemas
--
-- LO QUE SE BORRA (TRUNCATE RESTART IDENTITY):
--   · Toda operacion (expedientes, OCs, cobros, finance v2, inventario,
--     transfers, notifications logs, dashboard snapshots, portal logs,
--     tickets, AI threads, render preview logs)
--   · clientes.cliente_credit_snapshot, clientes.credit_clock
--   · commercial.brand_client_pricing_assignment
--   · pricing.client_assignment, .marluvas_client_sku_pricing,
--     .marluvas_price_history_event, .marluvas_price_history_sku
--   · productos.precio_history, .imports_log
--   · brands.brand_import_log
--   · proveedores.supplier_import_log
--   · inventario.inventory_import_log, .expediente_nodo_assignment
--
-- USO MANUAL (one-off, desde el VPS):
--   ssh -p 2222 root@187.77.218.102
--   cd /opt/consola-mwt-one
--   git pull origin main
--   # PASO 1: Backup pre-cleanup (red de seguridad)
--   sudo systemctl start consola-backup.service
--   journalctl -u consola-backup.service -f
--   # (Ctrl+C cuando veas "Backup completado")
--   # PASO 2: Aplicar el cleanup
--   docker exec -i consola-mwt-one-postgres psql -U mwt -d mwt_one \
--     < scripts/db/cleanup_release_credit.sql
--   # PASO 3: Verificacion (counts antes/despues, ver final del archivo)
--
-- IDEMPOTENCIA:
--   Re-ejecutable sin riesgo. TRUNCATE en tabla vacia es no-op.
--   El UPDATE de credito_usado=0 sobre un cliente que ya esta en 0
--   tampoco genera cambios reales.
-- =====================================================================

BEGIN;

-- ── Lock global breve para que no se incremente credito_usado entre
-- el truncate de cobros y el UPDATE final ──
LOCK TABLE clientes.cliente IN SHARE ROW EXCLUSIVE MODE;

DO $cleanup$
DECLARE
    target_name TEXT;
    rows_deleted BIGINT;
    parts TEXT[];
    sch TEXT;
    tbl TEXT;
    total_rows_deleted BIGINT := 0;
    -- Tablas a vaciar TOTALMENTE. Orden no critico porque el modelo
    -- usa FKs LOGICAS (sin constraint fisica), tal como D0 documenta.
    targets TEXT[] := ARRAY[
        -- ── Snapshots y estado de credito (NO el cliente) ──
        'clientes.cliente_credit_snapshot',
        'clientes.credit_clock',

        -- ── Expedientes (OC, expediente, lineas, documentos, artefactos) ──
        'expedientes.documento',
        'expedientes.linea',
        'expedientes.expediente',
        'expedientes.oc',
        'expedientes.artifact_instances',
        'expedientes.expediente_product_lines',
        'expedientes.wizard_submission_log',
        'expedientes.ocr_parsing_log',
        'expedientes.document_match_log',
        'expedientes.builder_artifact_instance',

        -- ── Cobros (legacy) ──
        'cobros.collection_event',
        'cobros.withholding_log',
        'cobros.fx_rate_history',
        'cobros.vencimiento',
        'cobros.conciliacion',
        'cobros.pago',
        'cobros.cobro',

        -- ── Finance v2 ──
        'finance.payment_ai_verdict',
        'finance.payment_evidence',
        'finance.payment_application',
        'finance.activity_log',
        'finance.payment',

        -- ── Financiero (legacy) ──
        'financiero.cost_line',

        -- ── Pipeline ──
        'pipeline.event_log',

        -- ── Inventario ──
        'inventario.recepcion_excepcion',
        'inventario.recepcion_linea',
        'inventario.recepcion',
        'inventario.stock_ubicacion',
        'inventario.stock_snapshot',
        'inventario.movimiento',
        'inventario.stock',
        'inventario.inventory_import_log',
        'inventario.expediente_nodo_assignment',

        -- ── Transfers ──
        'transfers.transferencia_documento',
        'transfers.cost_line',
        'transfers.evento',
        'transfers.linea',
        'transfers.transferencia',

        -- ── Notifications (logs operativos) ──
        'notifications.email_queue_log',
        'notifications.notification_log',

        -- ── Dashboard ──
        'dashboard.snapshot',

        -- ── Portal B2B · solo LOGS (mwt_user se conserva) ──
        'portal.portal_session_log',
        'portal.portal_audit_log',

        -- ── Tickets ──
        'tickets.ticket_attachment',
        'tickets.ticket_message',
        'tickets.ticket',

        -- ── AI Hub · solo conversaciones (catalogo agent/skill/instruction se conserva) ──
        'ai.usage_log',
        'ai.message',
        'ai.attachment',
        'ai.thread_context',
        'ai.thread',

        -- ── Email templates · solo logs de preview ──
        'email_templates.render_preview_log',

        -- ── Precios pactados por cliente (decision CEO 2026-05-24: borrar) ──
        'commercial.brand_client_pricing_assignment',
        'pricing.client_assignment',
        'pricing.marluvas_client_sku_pricing',
        'pricing.marluvas_price_history_event',
        'pricing.marluvas_price_history_sku',

        -- ── Historial de precios y logs de imports (decision CEO 2026-05-24) ──
        'productos.precio_history',
        'productos.imports_log',
        'brands.brand_import_log',
        'proveedores.supplier_import_log'
    ];
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE 'cleanup_release_credit.sql · iniciando · %', NOW();
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';

    FOREACH target_name IN ARRAY targets LOOP
        parts := string_to_array(target_name, '.');
        sch := parts[1];
        tbl := parts[2];

        IF EXISTS (
            SELECT 1
              FROM information_schema.tables
             WHERE table_schema = sch
               AND table_name   = tbl
        ) THEN
            EXECUTE format('SELECT COUNT(*) FROM %I.%I', sch, tbl) INTO rows_deleted;
            -- CASCADE: Postgres maneja el orden de FKs automaticamente. Necesario
            -- porque pricing.marluvas_price_history_sku tiene FK fisica hacia
            -- pricing.marluvas_price_history_event (la unica FK fisica en la lista
            -- de targets; el resto son FKs logicas sin constraint).
            EXECUTE format('TRUNCATE TABLE %I.%I RESTART IDENTITY CASCADE', sch, tbl);
            total_rows_deleted := total_rows_deleted + rows_deleted;
            RAISE NOTICE '  TRUNCATE %.% : % filas', sch, tbl, rows_deleted;
        ELSE
            RAISE NOTICE '  SKIP     %.%  (tabla no existe en este deploy)', sch, tbl;
        END IF;
    END LOOP;

    RAISE NOTICE '───────────────────────────────────────────────────────────────';
    RAISE NOTICE 'Total de filas borradas: %', total_rows_deleted;
END
$cleanup$;

-- =====================================================================
-- LIBERACION DE CREDITO
-- credito_usado es un campo PERSISTIDO (NUMERIC(14,2)) en clientes.cliente.
-- Borrar cobros no lo resetea automaticamente. UPDATE explicito requerido.
-- =====================================================================
DO $release$
DECLARE
    n_clientes INTEGER;
    n_with_credit_used INTEGER;
BEGIN
    SELECT COUNT(*) INTO n_clientes FROM clientes.cliente;
    SELECT COUNT(*) INTO n_with_credit_used
      FROM clientes.cliente WHERE credito_usado <> 0;

    RAISE NOTICE '───────────────────────────────────────────────────────────────';
    RAISE NOTICE 'Liberando credito_usado en % cliente(s) (% con saldo > 0)',
        n_clientes, n_with_credit_used;

    UPDATE clientes.cliente
       SET credito_usado = 0
     WHERE credito_usado <> 0;

    -- Limpiar estado "BLOQUEADO" si la razon de bloqueo era exceso de
    -- credito; los bloqueos manuales se preservan.
    -- (Comentado por defecto: descomentar SOLO si quieres re-activar
    -- automaticamente clientes que estaban bloqueados por tope.)
    -- UPDATE clientes.cliente
    --    SET estado = 'ACTIVO'
    --  WHERE estado = 'BLOQUEADO';

    RAISE NOTICE 'OK: credito_usado = 0 en todos los clientes.';
END
$release$;

COMMIT;

-- =====================================================================
-- VERIFICACION POST-CLEANUP
-- Estos SELECT se ejecutan FUERA de la transaccion para que sus
-- resultados sean visibles en el output de psql aunque el COMMIT haya
-- pasado. Sirven como auditoria inmediata.
-- =====================================================================
\echo '═══ Verificacion: registros CONSERVADOS (deben tener filas) ═══'
SELECT 'clientes.cliente'             AS tabla, COUNT(*) AS filas FROM clientes.cliente
UNION ALL SELECT 'clientes.credit_config',      COUNT(*) FROM clientes.credit_config
UNION ALL SELECT 'brands.marca',                COUNT(*) FROM brands.marca
UNION ALL SELECT 'productos.producto',          COUNT(*) FROM productos.producto
UNION ALL SELECT 'productos.talla_matriz',      COUNT(*) FROM productos.talla_matriz
UNION ALL SELECT 'proveedores.proveedor',       COUNT(*) FROM proveedores.proveedor
UNION ALL SELECT 'nodos.nodo',                  COUNT(*) FROM nodos.nodo
UNION ALL SELECT 'core.users',                  COUNT(*) FROM core.users
UNION ALL SELECT 'core.roles',                  COUNT(*) FROM core.roles
ORDER BY tabla;

\echo
\echo '═══ Verificacion: registros BORRADOS (deben ser 0) ═══'
SELECT 'expedientes.expediente'   AS tabla, COUNT(*) AS filas FROM expedientes.expediente
UNION ALL SELECT 'expedientes.oc',           COUNT(*) FROM expedientes.oc
UNION ALL SELECT 'expedientes.linea',        COUNT(*) FROM expedientes.linea
UNION ALL SELECT 'cobros.cobro',             COUNT(*) FROM cobros.cobro
UNION ALL SELECT 'finance.payment',          COUNT(*) FROM finance.payment
UNION ALL SELECT 'inventario.stock',         COUNT(*) FROM inventario.stock
UNION ALL SELECT 'inventario.movimiento',    COUNT(*) FROM inventario.movimiento
UNION ALL SELECT 'transfers.transferencia',  COUNT(*) FROM transfers.transferencia
UNION ALL SELECT 'tickets.ticket',           COUNT(*) FROM tickets.ticket
UNION ALL SELECT 'ai.thread',                COUNT(*) FROM ai.thread
ORDER BY tabla;

\echo
\echo '═══ Verificacion: credito_usado de cada cliente (deben ser 0) ═══'
SELECT razon_social,
       credito_aprobado,
       credito_usado,
       CASE WHEN credito_aprobado > 0
            THEN ROUND(100.0 * credito_usado / credito_aprobado, 2)
            ELSE 0
       END AS porcentaje_uso
  FROM clientes.cliente
 ORDER BY razon_social;

-- FIN cleanup_release_credit.sql
