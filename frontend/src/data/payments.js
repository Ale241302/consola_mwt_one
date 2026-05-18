// =====================================================================
// MWT.ONE · data/payments.js
// Sprint Registrar Pago (Fase 2) — Hooks de datos para el wizard.
//
// Capa intermedia entre los componentes del wizard
// (RegisterPaymentWizard, CounterpartyPicker, OpenDebtsTable,
// CreditEffectPreview) y los endpoints `financePaymentsApi` /
// `counterpartiesApi` / `clientesApi` / `proveedoresApi`.
//
// Cada hook expone una shape uniforme:
//   { data, loading, error, refetch }
//
// El wizard NO toca los endpoints directamente — siempre va por aquí.
// Eso permite que un mock futuro de Cypress o un cambio de transport
// (REST → GraphQL, por ejemplo) no toque los componentes.
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  financePaymentsApi,
  counterpartiesApi,
  clientesApi,
  proveedoresApi,
} from "../lib/api.js";

// ─────────────────────────────────────────────────────────────────────
// useCounterpartiesUnified — combobox Paso 1
// ─────────────────────────────────────────────────────────────────────
/**
 * Lista TODAS las contrapartes que MWT puede pagar o cobrar.
 *
 *   direction = "IN"  (MWT cobra)  -> CLIENTES + DISTRIBUIDORES
 *   direction = "OUT" (MWT paga)   -> PROVEEDORES + ADUANEROS +
 *                                     TRANSPORTISTAS + AGENTES
 *   direction = null               -> ambos (sin filtro de direction)
 *
 * Como NO hay endpoint unificado `/api/counterparties/`, hace 2 queries
 * paralelas y fusiona en memoria, taggeando cada item con
 * `counterparty_type` derivado del API origen.
 *
 * @param {{ direction?: 'IN'|'OUT'|null }} [opts]
 * @returns {{
 *   data: Array<{
 *     id: string,
 *     counterparty_type: 'CLIENTE'|'PROVEEDOR'|'ADUANERO'|'TRANSPORTISTA'|'AGENTE'|'DISTRIBUIDOR',
 *     label: string,
 *     subtitle: string|null,
 *     country_iso2: string|null,
 *     tax_id: string|null,
 *     _raw: object
 *   }>,
 *   loading: boolean,
 *   error: string|null,
 *   refetch: () => void
 * }}
 */
export function useCounterpartiesUnified({ direction = null } = {}) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const alive = useRef(true);

  const fetchOnce = useCallback(async () => {
    if (!alive.current) return;
    setLoading(true); setError(null);
    try {
      const [clientes, proveedores] = await Promise.all([
        clientesApi.list().catch(() => []),
        proveedoresApi.list().catch(() => []),
      ]);
      const clienteRows = Array.isArray(clientes)    ? clientes
                        : Array.isArray(clientes?.results) ? clientes.results : [];
      const provRows    = Array.isArray(proveedores) ? proveedores
                        : Array.isArray(proveedores?.results) ? proveedores.results : [];

      // Adapter cliente → counterparty. Algunos clientes tienen
      // `tipo = 'DISTRIBUIDOR'`; el resto cae a 'CLIENTE'.
      const fromClientes = clienteRows.map((c) => ({
        id:                c.id,
        counterparty_type: String(c.tipo || '').toUpperCase() === 'DISTRIBUIDOR'
                             ? 'DISTRIBUIDOR' : 'CLIENTE',
        label:             c.razon_social || c.nombre_comercial || c.tax_id || c.id,
        subtitle:          c.tax_id || null,
        country_iso2:      c.pais_iso2 || null,
        tax_id:            c.tax_id || null,
        _raw:              c,
      }));

      // Adapter proveedor → counterparty. El tipo del proveedor mapea
      // directamente al counterparty_type. Si no tiene tipo, default
      // 'PROVEEDOR'.
      const fromProveedores = provRows.map((p) => {
        const t = String(p.tipo || '').toUpperCase();
        const isKnown = ['PROVEEDOR','ADUANERO','TRANSPORTISTA','AGENTE'].includes(t);
        return {
          id:                p.id,
          counterparty_type: isKnown ? t : 'PROVEEDOR',
          label:             p.razon_social || p.nombre_comercial || p.tax_id || p.id,
          subtitle:          p.tax_id || null,
          country_iso2:      p.pais_iso2 || p.country_iso2 || null,
          tax_id:            p.tax_id || null,
          _raw:              p,
        };
      });

      // Filtrar segun direction:
      //   IN  -> tipos del lado cliente (CLIENTE | DISTRIBUIDOR)
      //   OUT -> tipos del lado proveedor (PROVEEDOR | ADUANERO | TRANSPORTISTA | AGENTE)
      //   null -> ambos
      let merged;
      if (direction === 'IN') {
        merged = fromClientes;
      } else if (direction === 'OUT') {
        merged = fromProveedores;
      } else {
        merged = [...fromClientes, ...fromProveedores];
      }

      // Sort por label.
      merged.sort((a, b) => String(a.label).localeCompare(String(b.label)));

      if (alive.current) setData(merged);
    } catch (err) {
      if (alive.current) {
        setError(err?.message || 'No se pudieron cargar las contrapartes');
        setData([]);
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [direction]);

  useEffect(() => {
    alive.current = true;
    fetchOnce();
    return () => { alive.current = false; };
  }, [fetchOnce]);

  return { data, loading, error, refetch: fetchOnce };
}

// ─────────────────────────────────────────────────────────────────────
// useOpenDebts — tabla Paso 2
// ─────────────────────────────────────────────────────────────────────
/**
 * Lista obligaciones abiertas de una contraparte. Wraps el endpoint
 *   GET /api/finance/counterparties/{type}/{id}/open-debts/?applicable_type=...
 *
 * @param {{
 *   counterparty_type: string|null,
 *   counterparty_id:   string|null,
 *   applicable_type?:  'PROFORMA'|'FACTURA'|'COSTO'|'PRODUCTO'|null,
 *   enabled?:          boolean
 * }} args
 * @returns {{
 *   data: import('../lib/types/payments.js').OpenDebt[],
 *   loading: boolean,
 *   error: string|null,
 *   refetch: () => void
 * }}
 */
export function useOpenDebts({
  counterparty_type,
  counterparty_id,
  applicable_type = null,
  enabled = true,
}) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const alive = useRef(true);

  const fetchOnce = useCallback(async () => {
    if (!enabled || !counterparty_type || !counterparty_id) {
      setData([]); setLoading(false); setError(null);
      return;
    }
    setLoading(true); setError(null);
    try {
      const rows = await counterpartiesApi.openDebts({
        counterparty_type,
        counterparty_id,
        applicable_type,
      });
      const arr = Array.isArray(rows) ? rows : (rows?.results || []);
      if (alive.current) setData(arr);
    } catch (err) {
      if (alive.current) {
        setError(err?.message || 'No se pudieron cargar las obligaciones abiertas');
        setData([]);
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [counterparty_type, counterparty_id, applicable_type, enabled]);

  useEffect(() => {
    alive.current = true;
    fetchOnce();
    return () => { alive.current = false; };
  }, [fetchOnce]);

  return { data, loading, error, refetch: fetchOnce };
}

// ─────────────────────────────────────────────────────────────────────
// usePaymentDryRun — preview Paso 4 (debounced)
// ─────────────────────────────────────────────────────────────────────
/**
 * Llama a `POST /api/finance/payments/dry-run/` con debounce
 * configurable. Devuelve `CreditEffectPreview` + validation_errors.
 *
 * Se re-dispara automaticamente cuando `payload` cambia (compara via
 * JSON.stringify para detectar diffs en objetos anidados).
 *
 * @param {object|null} payload  - payload del wizard (Paso 1+2+3)
 * @param {{ debounceMs?: number, enabled?: boolean }} [opts]
 * @returns {{
 *   data: import('../lib/types/payments.js').DryRunResponse|null,
 *   loading: boolean,
 *   error: string|null,
 *   refetch: () => void
 * }}
 */
export function usePaymentDryRun(payload, { debounceMs = 400, enabled = true } = {}) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const alive    = useRef(true);
  const timer    = useRef(null);
  const lastKey  = useRef('');

  // Key estable para detectar cambios. Se preferiria deep-equal pero
  // JSON.stringify es suficiente para el shape del payload.
  const payloadKey = useMemo(() => {
    if (!payload) return '';
    try { return JSON.stringify(payload); } catch { return ''; }
  }, [payload]);

  const fetchOnce = useCallback(async () => {
    if (!enabled || !payload) {
      setData(null); setLoading(false); setError(null);
      return;
    }
    setLoading(true); setError(null);
    try {
      const resp = await financePaymentsApi.dryRun(payload);
      if (alive.current) setData(resp || null);
    } catch (err) {
      if (alive.current) {
        // El backend devuelve 409 con { detail, code } cuando hay
        // EXPEDIENTE_TERMS_UNDEFINED. apiFetch lanza un Error con el
        // body parseado en .body — pasamos eso al consumer en data
        // para que el CreditEffectPreview lo renderee como banner rojo.
        setData(err?.body && typeof err.body === 'object'
          ? { validation_errors: [], credit_preview: {
              will_affect_credit: false,
              target_client_id: null, target_client_name: null,
              delta_usd: 0, reason: err.body.detail || String(err),
              blocking_error: err.body.code || 'UNKNOWN',
            } }
          : null);
        setError(err?.message || 'Dry-run fallo');
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [payloadKey, enabled]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce: si el payload cambia rápido, agrupamos las llamadas.
  useEffect(() => {
    alive.current = true;
    if (payloadKey === lastKey.current) return;
    lastKey.current = payloadKey;
    if (timer.current) clearTimeout(timer.current);
    if (!payloadKey || !enabled) return;
    timer.current = setTimeout(() => {
      if (alive.current) fetchOnce();
    }, debounceMs);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [payloadKey, enabled, debounceMs, fetchOnce]);

  return { data, loading, error, refetch: fetchOnce };
}

// ─────────────────────────────────────────────────────────────────────
// usePaymentSubmit — submit final del wizard
// ─────────────────────────────────────────────────────────────────────
/**
 * Wrapper de `financePaymentsApi.register()` con loading/error y
 * generacion automatica de `event_id` para idempotencia (UUID v4).
 *
 *   const { submit, submitting, error, lastResult } = usePaymentSubmit();
 *   await submit({ direction, counterparty_type, ..., evidencia: file });
 *
 * @returns {{
 *   submit: (payload: import('../lib/types/payments.js').CreatePaymentPayload) => Promise<object>,
 *   submitting: boolean,
 *   error: string|null,
 *   lastResult: object|null,
 *   reset: () => void
 * }}
 */
export function usePaymentSubmit() {
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const submit = useCallback(async (payload) => {
    setSubmitting(true); setError(null);
    try {
      // event_id para idempotencia: si el usuario hace doble-click en
      // "Registrar pago", el backend rechaza el segundo con error de
      // unicidad (ya hay UNIQUE en finance.payment(event_id)).
      const finalPayload = {
        ...payload,
        event_id: payload?.event_id || _genUuid(),
      };
      const resp = await financePaymentsApi.register(finalPayload);
      setLastResult(resp);
      return resp;
    } catch (err) {
      const msg = err?.body?.detail || err?.message || 'No se pudo registrar el pago';
      setError(msg);
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null); setLastResult(null);
  }, []);

  return { submit, submitting, error, lastResult, reset };
}

// ─────────────────────────────────────────────────────────────────────
// useRejectionReasons — catalogo enum del backend
// ─────────────────────────────────────────────────────────────────────
/**
 * Lista los 7 motivos de rechazo (mirror del enum Python).
 * Cache en memoria — solo se trae una vez por sesion.
 *
 * @returns {{ data: Array<{codigo:string, label:string}>, loading: boolean }}
 */
let _rejectionReasonsCache = null;
export function useRejectionReasons() {
  const [data,    setData]    = useState(_rejectionReasonsCache || []);
  const [loading, setLoading] = useState(!_rejectionReasonsCache);
  useEffect(() => {
    if (_rejectionReasonsCache) return;
    let alive = true;
    financePaymentsApi.selectRejectionReasons()
      .then((rows) => {
        if (!alive) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        _rejectionReasonsCache = arr;
        setData(arr);
      })
      .catch(() => { if (alive) setData([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { data, loading };
}

// ─────────────────────────────────────────────────────────────────────
// useCounterpartyTypes — catalogo enum del backend
// ─────────────────────────────────────────────────────────────────────
let _counterpartyTypesCache = null;
export function useCounterpartyTypes() {
  const [data,    setData]    = useState(_counterpartyTypesCache || []);
  const [loading, setLoading] = useState(!_counterpartyTypesCache);
  useEffect(() => {
    if (_counterpartyTypesCache) return;
    let alive = true;
    financePaymentsApi.selectCounterpartyTypes()
      .then((rows) => {
        if (!alive) return;
        const arr = Array.isArray(rows) ? rows : (rows?.results || []);
        _counterpartyTypesCache = arr;
        setData(arr);
      })
      .catch(() => { if (alive) setData([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { data, loading };
}


// ── Helpers ──────────────────────────────────────────────────────────
function _genUuid() {
  // crypto.randomUUID() esta disponible en todos los navegadores que
  // usamos (Chromium 92+, Firefox 95+, Safari 15.4+). Fallback rudo
  // para SSR / tests si hace falta.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
