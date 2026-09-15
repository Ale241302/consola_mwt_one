-- L15 · Comisiones históricas (conciliación FE ↔ cobros reales)
-- ---------------------------------------------------------------------------
-- El módulo /finanzas deriva el devengo desde expedientes; las FE (facturas
-- de comisión de MWT a Marluvas) cubren mayormente PFs 2025 que NO existen
-- como expedientes. Esta tabla registra el histórico de comisiones tal como
-- aparece en cada FE (factura electrónica), para conciliarlas.
-- Idempotente: CREATE ... IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.comision_historica (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    marca_id          uuid,
    periodo           text        NOT NULL,          -- 'YYYY-MM' del cobro
    fe_codigo         text,                          -- 'FE-2607' | 'CLAVE-...3257'
    fecha_emision     date,
    cliente_id        uuid,
    cliente_nombre    text,
    pf_ref            text,                          -- '2393-2025 / 2404-2026'
    pais_iso2         char(2),
    monto_cobrado_usd numeric(14,2),                 -- VALOR PAGO (del cliente)
    comision_pct      numeric(8,4),
    comision_usd      numeric(14,2),                 -- monto de la comisión
    tipo              text        DEFAULT 'COMISION',-- COMISION | PREMIO
    estado            text        DEFAULT 'PAGADA',  -- PAGADA | PENDIENTE
    expediente_id     uuid,                          -- vínculo (opción A)
    ref               text,
    detalle           jsonb       DEFAULT '{}'::jsonb,
    is_active         boolean     DEFAULT true,
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now(),
    UNIQUE (fe_codigo, periodo, cliente_nombre, pf_ref, tipo)
);

CREATE INDEX IF NOT EXISTS ix_comision_hist_periodo   ON finance.comision_historica (periodo);
CREATE INDEX IF NOT EXISTS ix_comision_hist_cliente   ON finance.comision_historica (cliente_id);
CREATE INDEX IF NOT EXISTS ix_comision_hist_expediente ON finance.comision_historica (expediente_id);

-- ── Seed · FE-2607 · cobros JULIO 2026 (emitida 2026-08-04) ─────────────────
INSERT INTO finance.comision_historica
  (marca_id, periodo, fe_codigo, fecha_emision, cliente_id, cliente_nombre, pf_ref, pais_iso2,
   monto_cobrado_usd, comision_pct, comision_usd, tipo, estado, ref)
VALUES
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-07','FE-2607','2026-08-04','a79dfc89-cfea-4ce5-9bca-b77186a77d83','Eguisa','2383-2025 A','GT',32934.10,0.0606,1995.81,'COMISION','PAGADA','FE-2607'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-07','FE-2607','2026-08-04','c588c410-468a-4d54-b676-3bec174eb39d','Sondel','2393-2025 / 2404-2026','CR',86553.51,0.1000,8655.35,'COMISION','PAGADA','FE-2607'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-07','FE-2607','2026-08-04','c588c410-468a-4d54-b676-3bec174eb39d','Sondel','2427-2026 / 2428-2026','CR',53687.30,0.1000,5368.73,'COMISION','PAGADA','FE-2607'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-07','FE-2607','2026-08-04','5f696777-d0e6-4cb7-a16f-64c830f0e310','Sonepar Colombia','2463-2026','CO',11761.20,0.1000,1176.12,'COMISION','PAGADA','FE-2607'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-07','FE-2607','2026-08-04','2358fd1c-eeec-46ff-8dd0-69ff40800367','Com Ummie','2429-2026','GT',10349.31,0.1000,1034.93,'COMISION','PAGADA','FE-2607'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-07','FE-2607','2026-08-04',NULL,'—','—',NULL,NULL,NULL,16.89,'PREMIO','PAGADA','FE-2607')
ON CONFLICT DO NOTHING;

-- ── Seed · FE-2606 · cobros JUNIO 2026 (emitida 2026-07-06) ─────────────────
INSERT INTO finance.comision_historica
  (marca_id, periodo, fe_codigo, fecha_emision, cliente_id, cliente_nombre, pf_ref, pais_iso2,
   monto_cobrado_usd, comision_pct, comision_usd, tipo, estado, ref)
VALUES
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-06','FE-2606','2026-07-06','5f696777-d0e6-4cb7-a16f-64c830f0e310','Sonepar Colombia','2400-2025 / 2405-2025','CO',40198.05,0.0700,2813.86,'COMISION','PAGADA','FE-2606'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-06','FE-2606','2026-07-06','c1b0b3d8-ea15-466e-b8a3-60d9d42c2816','Imporcomp','2410-2025','GT',11558.30,0.1000,1155.83,'COMISION','PAGADA','FE-2606'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-06','FE-2606','2026-07-06',NULL,'—','—',NULL,NULL,NULL,24.49,'PREMIO','PAGADA','FE-2606')
ON CONFLICT DO NOTHING;

-- ── Seed · FE-2604 · cobros ABRIL 2026 (emitida 2026-05-05) ─────────────────
INSERT INTO finance.comision_historica
  (marca_id, periodo, fe_codigo, fecha_emision, cliente_id, cliente_nombre, pf_ref, pais_iso2,
   monto_cobrado_usd, comision_pct, comision_usd, tipo, estado, ref)
VALUES
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-04','FE-2604','2026-05-05','2358fd1c-eeec-46ff-8dd0-69ff40800367','Com Ummie','2376-2025','GT',6014.91,0.1000,601.49,'COMISION','PAGADA','FE-2604'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-04','FE-2604','2026-05-05',NULL,'—','—',NULL,NULL,NULL,259.27,'PREMIO','PAGADA','FE-2604')
ON CONFLICT DO NOTHING;

-- ── Seed · FE-0094 · cobros FEBRERO 2026 (emitida 2026-03-04) ───────────────
INSERT INTO finance.comision_historica
  (marca_id, periodo, fe_codigo, fecha_emision, cliente_id, cliente_nombre, pf_ref, pais_iso2,
   monto_cobrado_usd, comision_pct, comision_usd, tipo, estado, ref)
VALUES
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-02','FE-0094','2026-03-04','340fabff-64c0-45fb-a67c-dab6dea26ae2','Importaciones Y Compras','2354-2025','HN',8425.90,0.0937,789.51,'COMISION','PAGADA','FE-0094'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-02','FE-0094','2026-03-04','340fabff-64c0-45fb-a67c-dab6dea26ae2','Importaciones Y Compras','2355-2025','HN',33762.50,0.1000,3376.25,'COMISION','PAGADA','FE-0094'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-02','FE-0094','2026-03-04','c1b0b3d8-ea15-466e-b8a3-60d9d42c2816','Imporcomp','2365-2025','GT',5829.70,0.1000,582.97,'COMISION','PAGADA','FE-0094'),
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2026-02','FE-0094','2026-03-04',NULL,'—','—',NULL,NULL,NULL,1201.80,'PREMIO','PAGADA','FE-0094')
ON CONFLICT DO NOTHING;

-- ── Seed · Clave …3257 · cobros NOVIEMBRE 2025 (emitida 2025-12-02) ─────────
INSERT INTO finance.comision_historica
  (marca_id, periodo, fe_codigo, fecha_emision, cliente_id, cliente_nombre, pf_ref, pais_iso2,
   monto_cobrado_usd, comision_pct, comision_usd, tipo, estado, ref)
VALUES
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2025-11','CLAVE-93111003257','2025-12-02','2358fd1c-eeec-46ff-8dd0-69ff40800367','Ummie','2331','CO',NULL,0.0410,328.44,'COMISION','PAGADA','CLAVE-93111003257')
ON CONFLICT DO NOTHING;

-- ── Seed · Clave …3235 · cobros JUNIO 2025 (emitida 2025-06-17) ─────────────
INSERT INTO finance.comision_historica
  (marca_id, periodo, fe_codigo, fecha_emision, cliente_id, cliente_nombre, pf_ref, pais_iso2,
   monto_cobrado_usd, comision_pct, comision_usd, tipo, estado, ref)
VALUES
  ('51db751c-2e74-4dd3-a592-d4bd2cc38b25','2025-06','CLAVE-93111003235','2025-06-17','bb5b7f8b-59ea-4a68-9abf-11abc06ed840','Comtek','2249','CO',NULL,0.0120,438.70,'COMISION','PAGADA','CLAVE-93111003235')
ON CONFLICT DO NOTHING;
