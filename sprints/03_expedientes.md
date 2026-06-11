# Sprint 03 · Expedientes — Importación, Wizards y Documentos

## 1. Propósito
Módulo central del negocio: expedientes de importación (OC/proforma → SAP → fases del pipeline → entrega), wizard de creación, fusión visual de expedientes, documentos comerciales con matchmaker OCR, días por fase y Cronograma.

## 2. Mapeo Tecnológico
*   **Base de datos**: schema `expedientes` (`expediente`, `linea`, `documento`, `oc`), `pipeline.event_log` (fases), `sizing` (A3); SQL: `70`, `95*` (wizard), `96*` (audit), `C0` (operating_company), `D2`, `D6`, `E1` (phase_durations), `E3` (fusión), `E4` (display_label).
*   **Backend**: apps `expedientes` (views.py ~4.6k líneas: ViewSet + phase-stats + fusionar + confirm-sap), `sizing`, `ocr` (document matchmaker); `views_proforma.py` (factura-payload).
*   **Frontend**: `Expedientes.jsx` (~1.7k líneas), `OCDetail.jsx` (~2.8k), `ExpedienteDetail.jsx` (~3.2k), `FusionDetail.jsx`, `Cronograma.jsx` + `lib/cronogramaData.js`, `Wizard.jsx`, `CreateExpedienteWizard(Lite).jsx`, `SizingEngine.jsx`; componentes `components/expedientes/*` y `components/cronograma/*`.

## 3. Auditoría de Lentitud (BD & Backend)
- [ ] **N+1 CONFIRMADO**: `ExpedienteListSerializer.get_proforma_codigos/oc_codigos/sap_codigos` consultan `documento`/`linea` POR expediente → con N expedientes son 3N queries por listado. Reescribir con agregación en lote vía context.
- [ ] `OcSerializer.get_total_invoiced_real`: query por OC en listados — mismo tratamiento.
- [ ] Índices: `expedientes.linea(oc_id)`, `linea(expediente_id)`, `documento(oc_id)`, `documento(kind)`, `pipeline.event_log(aggregate_id, created_at)`, `expediente(fusion_id)` (E3 ya lo creó — verificar resto).
- [ ] `phase-stats`: escanea TODO el event_log; medir y, si crece, materializar o limitar ventana.
- [ ] `factura-payload`: LATERAL join a assignments — `EXPLAIN ANALYZE` con expedientes de 50+ líneas.
- [ ] Frontend `load()` de Expedientes: cascada de fetches por fila (clientes, productos, líneas) — coordinar payload enriquecido del backend.
- [ ] `loadCronograma`: 3 requests × expediente (lotes de 3 anti-429) — proponer endpoint consolidado `cronograma-feed/`.

## 4. Auditoría de Estabilidad (Frontend)
- [ ] `Expedientes.jsx`/`OCDetail.jsx`/`ExpedienteDetail.jsx`: páginas gigantes; envolver en ErrorBoundary de ruta. Cualquier `TypeError` en una celda tumba TODA la pantalla (pantalla blanca reportada).
- [ ] Cancelación: los `useEffect` usan `cancel`/`alive` pero el HTTP sigue vivo — cablear `signal` cuando `apiFetch` lo soporte (plan maestro #5).
- [ ] Navegación rápida Expedientes ↔ OCDetail ↔ ExpedienteDetail: verificar que `setApiOcLines`/`setMembers` no corran tras desmontar.
- [ ] `FusionDetail`: N×3 fetches por miembro; estados parciales tolerantes (miembro sin OC).
- [ ] Cronograma: rate-limit 429 ya mitigado por lotes — confirmar retry/backoff no deja promesas colgadas al salir de la página.

## 5. Flujo de Trabajo Colaborativo
1. **Frontend** mide `/api/expedientes/` (lista) con DevTools y reporta tiempo + tamaño de payload a **Backend**.
2. **Backend** cuenta queries reales del listado (django connection.queries) y confirma el N+1; pide a **SQL** los índices de soporte.
3. **SQL** entrega `E5_audit_indexes_expedientes.sql` idempotente; **Backend** reescribe los SerializerMethodField con mapas precomputados.
4. **Frontend** re-mide, valida que REF chips/cronograma siguen correctos por rol (R3) y firma el cierre.

## 6. Hallazgos y correcciones
**Auditoría 2026-06-11 (Fable 5):**
- ✅ **CORREGIDO (N+1 confirmado)** — `GET /api/expedientes/` ejecutaba 4-5 queries POR FILA (`get_proforma_codigo`, `get_proforma_codigos`, `get_oc_codigos` ×2, `get_sap_codigos`) ≈ 5N+1 queries. Nuevo `build_expediente_ref_batches()` en `serializers.py` precomputa los 3 mapas en **3-4 queries totales**; `ExpedienteViewSet.list` los inyecta por context y los getters mantienen fallback por-fila (compat con otros usos). Con 12 expedientes: ~61 → ~5 queries; escala O(1) en vez de O(N).
- ✅ **CORREGIDO (índices)** — `E5_audit_indexes.sql`: `linea(oc_id)`, `linea(expediente_id)`, `linea(producto_id)`, `linea(expediente_id,sap)`, `documento(oc_id)`, `documento(expediente_id,kind)`, `event_log(aggregate_id,created_at)`, `expediente(client_id|operating_company_id|oc_id)` — todos guardados por information_schema (a prueba de drift).
- ✅ **CORREGIDO (estabilidad)** — Las páginas gigantes (Expedientes/OCDetail/ExpedienteDetail/FusionDetail) quedan dentro del ErrorBoundary por ruta.
- ⏳ **PENDIENTE** — Cascada de hidratación del `load()` frontend (clientes/productos por lotes) → endpoint enriquecido; endpoint consolidado `cronograma-feed/` para sustituir 3×N requests del Cronograma; adopción de `signal` en `Expedientes.jsx:161-265` (efecto sin cleanup detectado).
