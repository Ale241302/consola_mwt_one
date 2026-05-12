-- =====================================================================
-- MWT.ONE · 65b_expediente_nodo_assignment.sql · Asignaciones de líneas
--   de expediente a nodos logísticos (append-only).
-- Sprint 2026-05-11 · Fase 3 del paquete Nodos + Recepción.
-- Agente responsable: [AG-DATABASE]
--
-- Caso de uso (palabras del CEO):
--   En el wizard "Recibir Lote" el usuario elige un nodo destino y luego
--   uno o más expedientes. Para cada (expediente, producto, talla) decide
--   cuánta cantidad asignar a ese nodo. Si quedan unidades sin asignar,
--   debe verlas en la próxima recepción. Si ya asignó toda la cantidad
--   de una (producto, talla) a algún nodo, esa fila no debe aparecer más.
--
-- Modelo: append-only — cada confirmación del wizard inserta una o más
-- filas. El saldo de "lo que queda por asignar" se calcula como:
--   line_qty - SUM(qty_asignada) sobre todas las filas activas con el
--   mismo (expediente_id, producto_id, talla).
-- El stock visible del nodo se calcula como SUM(qty_asignada) filtrado
-- por nodo_id.
--
-- No usamos UNIQUE — preservamos historia de cada asignación (útil para
-- auditoría: quién asignó qué, cuándo, en qué recepción).
--
-- Idempotencia: CREATE TABLE IF NOT EXISTS + DROP/CREATE TRIGGER.
--
-- Ejecutar:
--   psql -U mwt -d mwt_one -f backend/sql/65b_expediente_nodo_assignment.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS inventario.expediente_nodo_assignment (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    expediente_id   UUID         NOT NULL,                  -- ⛔ sin FK física · join lógico a expedientes.expediente
    producto_id     UUID         NOT NULL,                  -- ⛔ sin FK física · join lógico a productos.producto
    talla           VARCHAR(16),                            -- NULL permitido (productos sin talla)
    nodo_id         UUID         NOT NULL,                  -- ⛔ sin FK física · join lógico a nodos.nodo
    qty_asignada    INTEGER      NOT NULL CHECK (qty_asignada > 0),
                                                            -- enteros: cantidades de inventario en MWT son discretas
                                                            -- (par de zapatos, prenda, par de guantes). Numerico no
                                                            -- aporta y rompe la suma SUM() para validar saldos.
    recepcion_id    UUID,                                   -- opcional · join lógico a inventario.recepcion si la
                                                            -- asignación se confirmó via wizard de recepción
    notas           TEXT,
    created_by_id   UUID,                                   -- ⛔ sin FK física · join lógico a core.users.id
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Índices ────────────────────────────────────────────
-- (a) Query principal del backend: saldo por (expediente, producto, talla).
CREATE INDEX IF NOT EXISTS idx_ena_expediente_producto_talla
    ON inventario.expediente_nodo_assignment (expediente_id, producto_id, talla)
    WHERE is_active;
-- (b) Inventario del nodo: SUM(qty) por nodo y producto+talla.
CREATE INDEX IF NOT EXISTS idx_ena_nodo_producto_talla
    ON inventario.expediente_nodo_assignment (nodo_id, producto_id, talla)
    WHERE is_active;
-- (c) "Qué expedientes están en este nodo" (tab Expedientes del nodo).
CREATE INDEX IF NOT EXISTS idx_ena_nodo_expediente
    ON inventario.expediente_nodo_assignment (nodo_id, expediente_id)
    WHERE is_active;
-- (d) Trazabilidad: encontrar asignaciones por recepción.
CREATE INDEX IF NOT EXISTS idx_ena_recepcion
    ON inventario.expediente_nodo_assignment (recepcion_id)
    WHERE recepcion_id IS NOT NULL;
-- (e) Soft-delete auditing.
CREATE INDEX IF NOT EXISTS idx_ena_active
    ON inventario.expediente_nodo_assignment (is_active);

-- ── Trigger updated_at ─────────────────────────────────
-- public.tg_set_updated_at() ya existe (creada en database/01_init.sql,
-- usada por todos los módulos — ver 60_inventario.sql línea 93).
DROP TRIGGER IF EXISTS tg_ena_updated_at ON inventario.expediente_nodo_assignment;
CREATE TRIGGER tg_ena_updated_at
    BEFORE UPDATE ON inventario.expediente_nodo_assignment
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE inventario.expediente_nodo_assignment IS
    'Append-only · una fila por cada cantidad asignada de un (expediente, '
    'producto, talla) a un nodo logístico. Sprint 2026-05-11 fase 3.';
