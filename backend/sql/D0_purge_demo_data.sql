-- =====================================================================
-- MWT.ONE · D0_purge_demo_data.sql
-- Agente responsable: [AG-DATABASE]
-- Sprint: 2026-05-10 · Decisión del CEO (Alejandro)
--
-- Propósito:
--   Borrar TODA la data operativa y los seeds demo del sistema.
--   Tras correr esto la consola arranca como una instancia limpia,
--   sin clientes, sin expedientes, sin OCs, sin cobros, sin pagos,
--   sin inventario, sin transferencias y sin catálogos sembrados
--   (brands/productos/proveedores/nodos).
--
-- Lo que SÍ se preserva:
--   · Schemas y tablas (estructura intacta).
--   · core.users, core.roles, core.user_roles (autenticación).
--   · TODOS los catálogos *_cat (estado_cat, segmento_cat, tipo_cat,
--     incoterm_cat, modo_operacion_cat, motivo_cat, etc.).
--   · email_templates.template + email_templates.version
--     (los textos los cuida el negocio; no son demo).
--   · Tablas de configuración como expedientes.forma_pago_cat,
--     pipeline.transicion_cat, transfers.legal_context_cat, etc.
--
-- Lo que se BORRA (TRUNCATE — TODO):
--   · clientes.cliente
--   · expedientes.oc, .expediente, .linea, .documento
--   · expedientes.artifact_instances, .expediente_product_lines,
--     .wizard_submission_log, .ocr_parsing_log, .document_match_log,
--     .builder_artifact_instance
--   · cobros.cobro, .pago, .conciliacion, .vencimiento,
--     .withholding_log, .collection_event, .fx_rate_history
--   · finance.payment, .payment_application, .payment_evidence,
--     .payment_ai_verdict, .activity_log
--   · financiero.cost_line
--   · pipeline.event_log
--   · inventario.stock, .movimiento, .recepcion, .recepcion_linea,
--     .recepcion_excepcion, .stock_snapshot, .stock_ubicacion,
--     .inventory_import_log
--   · transfers.transferencia, .linea, .evento, .cost_line,
--     .transferencia_documento
--   · notifications.notification_log, .email_queue_log
--   · dashboard.snapshot
--   · portal.mwt_user, .portal_audit_log, .portal_session_log
--   · tickets.ticket, .ticket_message, .ticket_attachment
--   · ai.thread, .message, .attachment, .thread_context, .usage_log
--   · email_templates.render_preview_log
--
-- Lo que se BORRA (TRUNCATE — catálogos demo del seed 99_seed.sql):
--   · brands.marca
--   · productos.producto, .variante, .talla_matriz, .precio_history,
--     .imports_log
--   · proveedores.proveedor, .supplier_promo_code, .supplier_audit_event,
--     .supplier_certificacion, .supplier_import_log,
--     .suppliers_product_assignments, .suppliers_iso_evaluations
--   · nodos.nodo, .nodo_jerarquia
--
-- Idempotencia:
--   El runner del entrypoint (backend/docker-entrypoint.sh) marca este
--   archivo en public._applied_sql tras la primera ejecución exitosa,
--   por lo que NO vuelve a correr en deploys siguientes. Si quieres
--   forzar re-ejecución manual:
--     DELETE FROM public._applied_sql WHERE filename='D0_purge_demo_data.sql';
--   y reinicia el contenedor backend.
--
-- Uso manual (one-off, sin pasar por entrypoint):
--   docker compose exec -T postgres psql -U mwt -d mwt_one \
--     -f /sql-modules/D0_purge_demo_data.sql
-- =====================================================================

BEGIN;

-- =====================================================================
-- Helper: TRUNCATE seguro — solo si la tabla existe.
-- Imprime cantidad de filas borradas para auditoría en logs.
-- =====================================================================
DO $purge$
DECLARE
    target_name TEXT;
    rows_deleted BIGINT;
    parts TEXT[];
    sch TEXT;
    tbl TEXT;
    -- Tablas a vaciar TOTALMENTE (operativas + catálogos demo).
    -- Orden no importa porque NO hay FKs físicas en este modelo.
    targets TEXT[] := ARRAY[
        -- ── Clientes ──
        'clientes.cliente',
        'clientes.cliente_credit_snapshot',
        -- ── Expedientes (OC, expediente, líneas, documentos, artefactos) ──
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
        -- ── Portal B2B ──
        'portal.portal_session_log',
        'portal.portal_audit_log',
        'portal.mwt_user',
        -- ── Tickets ──
        'tickets.ticket_attachment',
        'tickets.ticket_message',
        'tickets.ticket',
        -- ── AI Hub ──
        'ai.usage_log',
        'ai.message',
        'ai.attachment',
        'ai.thread_context',
        'ai.thread',
        -- ── Email templates · solo logs de preview ──
        'email_templates.render_preview_log',
        -- ── Catálogos demo (sembrados por 99_seed.sql) ──
        'brands.brand_discount_code',
        'brands.brand_import_log',
        'brands.marca',
        'productos.precio_history',
        'productos.imports_log',
        'productos.variante',
        'productos.talla_matriz',
        'productos.producto',
        'proveedores.suppliers_iso_evaluations',
        'proveedores.suppliers_product_assignments',
        'proveedores.supplier_promo_code',
        'proveedores.supplier_certificacion',
        'proveedores.supplier_audit_event',
        'proveedores.supplier_import_log',
        'proveedores.proveedor',
        'nodos.nodo_jerarquia',
        'nodos.nodo'
    ];
BEGIN
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
            EXECUTE format('TRUNCATE TABLE %I.%I RESTART IDENTITY', sch, tbl);
            RAISE NOTICE '  · %.% : % filas borradas', sch, tbl, rows_deleted;
        ELSE
            RAISE NOTICE '  · %.% : (tabla no existe — skip)', sch, tbl;
        END IF;
    END LOOP;

    -- ── Sanity: el seed marca como applied a 99_seed.sql. Si lo
    -- desmarcáramos, el entrypoint lo re-aplicaría en el próximo
    -- arranque y volvería a meter mocks. Lo dejamos marcado.
    RAISE NOTICE 'Purga completada. core.users / core.roles / catálogos *_cat se preservaron.';
END
$purge$;

COMMIT;

-- FIN D0_purge_demo_data.sql
