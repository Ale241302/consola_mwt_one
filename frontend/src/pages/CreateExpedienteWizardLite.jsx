// ─────────────────────────────────────────────────────────────
// CreateExpedienteWizardLite — Wizard Simplificado de 3 pasos
// Sprint Wizard Lite · 2026-04-29
// Agente responsable: [AG-FRONTEND]
//
// Reemplazo del CreateExpedienteWizard pesado (2000 líneas con OCR,
// marca, moneda, flete, totales). Esta versión es estrictamente:
//
//   Paso 1 · Cliente            cliente/subsidiaria + responsable
//   Paso 2 · Productos          plantilla CSV + matriz tallas + CPA
//   Paso 3 · Revisar y Crear    resumen limpio sin financiero
//
// El expediente nace en estado REGISTRO con marca/mode/currency NULL.
// El OPERATOR completa los datos comerciales en /expedientes/{id}
// antes de poder transitar T2 (REGISTRO → PRODUCCION). Esto se enforza
// con el componente CommercialDataHardStop dentro de ExpedienteDetail.
//
// Tokens: Navy #0B1E3A · Mint #00B286 · tabular-nums.
// POL_VISIBILIDAD: cero precios, cero subtotales, cero totales financieros.
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconChevRight, IconCheck, IconX, IconUpload, IconAlert,
  IconRefresh, IconUser, IconPackage, IconPlus, IconSearch, IconLock,
  IconMail, IconTrash,
} from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { bandaForTC } from "../constants/marluvas.js";
import { useExchangeRateUSDBRL } from "../hooks/useExchangeRateUSDBRL.js";
import {
  clientesApi, expedientesApi, lineasApi, productosApi, tallasApi, getToken,
} from "../lib/api.js";
import {
  ManualLinePanel, RequestAssignmentDialog,
} from "../components/expedientes/ManualLineModal.jsx";
import {
  MWT_OPERATING_CLIENT_ID, MWT_OPERATOR_NAME,
} from "../lib/operatingCompany.js";

// Sprint 2026-05-06 · Step 0 visible solo para ADMIN/CEO/staff. CLIENT_*
// salta este paso; el operador se asume "el propio cliente" implicitamente.
const STEPS_ADMIN = [
  { id: 0, label: "Operador" },
  { id: 1, label: "Cliente" },
  { id: 2, label: "Productos" },
  { id: 3, label: "Revisar y crear" },
];
const STEPS_CLIENT = [
  { id: 1, label: "Cliente" },
  { id: 2, label: "Productos" },
  { id: 3, label: "Revisar y crear" },
];

// Plantilla compatible con Excel en locales LATAM/ES.
//
// Por qué `sep=;` en la primera línea:
//   Excel en MX/CO/PE/ES usa `;` como separador por default (porque la
//   coma `,` es separador decimal). Si el CSV usa `,`, Excel lo abre
//   todo en una sola columna. La directiva `sep=` (Microsoft) instruye
//   a Excel sobre qué separador usar, ignorando el locale.
//   Excel también respeta CSVs con `;` directamente.
//
// Por qué BOM UTF-8 (﻿):
//   Sin BOM, Excel asume Windows-1252 y rompe tildes / "ñ".
//
// El parser del backend ya hace csv.Sniffer() sobre los delimitadores
// `,;|\t` y acepta ambos transparentemente.
//
// Sprint 2026-05-02 (AG-03): la primera columna acepta SKU **o** Nombre
// del producto **o** Ref Proveedor — el backend resuelve al SKU canónico
// vía productos.producto. La columna Talla acepta cualquier sistema con
// prefijo explícito (BRA/EU/US/UK/CM); sin prefijo asume EU. Sin esto
// los CSV de clientes que codifican distinto al SKU MWT fallaban en
// el matchmaker.
const TEMPLATE_CSV =
  "﻿" +
  "sep=;\n" +
  "SKU o Nombre;Talla (BR/US/UK/EU);Cantidad\n" +
  "ABC-123;42;10\n" +
  "ABC-123;BRA 40;5\n" +
  "Bota Plena Flor Negra;US 9.5;20\n" +
  "XYZ-999;UNICA;15\n";

// ─────────────────────────────────────────────────────────────
export default function CreateExpedienteWizardLite() {
  const navigate = useNavigate();
  const { lang = "es" } = useOutletContext() || {};
  const { isAdmin, user } = useRole();
  // ── Sprint 2026-05-07 · Modo EDIT (?editExp=&editSap=).
  // R3: defensa en profundidad — si CLIENT_* llega al wizard con esos
  // params, los ignoramos (no debería pasar — ExpedienteDetail filtra el
  // botón — pero si por URL directa llegan, modo CREATE normal).
  const [searchParams] = useSearchParams();
  const editExp = isAdmin ? (searchParams.get('editExp') || null) : null;
  const editSap = isAdmin ? (searchParams.get('editSap') || null) : null;
  const isEditMode = !!(editExp && editSap);
  // ── Sprint 2026-05-06 · Step 0 (operador) solo para ADMIN/CEO/staff.
  // Para CLIENT_* arrancamos directo en el Step 1 con el cliente
  // pre-fijado a su empresa primaria (legal_entity_ids[0]).
  const STEPS = isAdmin ? STEPS_ADMIN : STEPS_CLIENT;
  const [step, setStep]   = useState(isAdmin ? 0 : 1);
  const [error, setError] = useState(null);

  // ── Empresa OPERADORA del expediente.
  // 'mwt'    → operating_company_id = MWT_OPERATING_CLIENT_ID
  // 'client' → operating_company_id = selClient.id
  // CLIENT_* fuerza 'client' (el operador es siempre el propio cliente).
  const [operatingMode, setOperatingMode] = useState(isAdmin ? 'mwt' : 'client');

  // ── Estado global ──
  const [clients, setClients]   = useState([]);
  const [selClient, setSelClient]       = useState(null);   // {id, label, parent_id, …}

  const [orderLines, setOrderLines]     = useState([]);     // [{tmpId, sku, talla, cantidad, producto_id, product_label, is_assigned, unassigned_request_sent}]
  const [parsing, setParsing]           = useState(false);
  const [manualOpen, setManualOpen]     = useState(false);
  const [reqDialog, setReqDialog]       = useState(null);   // {sku} cuando solicita asignación
  const [saving, setSaving]             = useState(false);
  const [toast, setToast]               = useState(null);
  // Sprint 2026-05-06 · términos de pago del expediente.
  const [paymentDays,   setPaymentDays]   = useState(0);
  // Sprint Registrar Pago (Fase 3 · Commit 9) · forma_pago obligatorio.
  // Antes default 'CREDITO' silencioso, lo que dejaba expedientes con
  // termos no decididos por el usuario. Ahora arranca '' (Selecciona...)
  // y el wizard bloquea el submit si no se eligio una opcion explicita.
  // Razon: cerrar el loop EXPEDIENTE_TERMS_UNDEFINED al liberar credito.
  const [paymentMethod, setPaymentMethod] = useState("");

  // ── Sprint 2026-05-01: precios y proyeccion de credito ─────────
  // Mapa { producto_id -> unit_price } resuelto desde el catalogo de
  // productos para la EMPRESA QUE OPERA (operatingMode === 'mwt'
  // → catalogo MWT, 'client' → override por client_id). El backend
  // congela el snapshot dual (mwt + cliente) al crear; aqui solo
  // mostramos en pantalla el precio del operador elegido.
  const [priceMap, setPriceMap] = useState({});
  // Sprint 2026-05-01: credito usado REAL del cliente, calculado a partir
  // de sus expedientes existentes (activos) + valor de cada linea
  // resuelto via catalogo de productos. Asi la barra de credito
  // refleja la situacion real, no solo el campo persistido (que suele
  // estar en 0 hasta que se emiten facturas).
  const [existingClientUsage, setExistingClientUsage] = useState(0);

  // ── Operador efectivo (UUID que se manda al backend) ──
  // IMPORTANTE: declarar ANTES de los useEffect que dependen de
  // operatingCompanyId / pricingClientId para evitar TDZ.
  const operatingCompanyId = useMemo(() => {
    if (operatingMode === 'mwt') return MWT_OPERATING_CLIENT_ID;
    return selClient?.id || null;
  }, [operatingMode, selClient]);

  // Cliente cuyo precio mostramos en pantalla (perspectiva del ADMIN).
  // Sprint 2026-05-10 v2 · modelo dual snapshot:
  //   · Operada por MWT  → ADMIN ve precio MWT ($36.46), CLIENT_* ve su
  //                        override ($47.74). Por eso el wizard usa
  //                        MWT_OPERATING_CLIENT_ID aqui.
  //   · Operada por cliente → ADMIN y CLIENT_* ven el mismo precio del
  //                        cliente. selClient.id.
  // Ahora MWT_OPERATING_CLIENT_ID apunta al UUID real de Muito Work
  // Limitada en clientes.cliente, asi el lookup en client_prices
  // resuelve correctamente al override $36.46 (antes caia a precio_lista
  // porque la constante era un placeholder).
  const pricingClientId = operatingMode === 'mwt'
    ? MWT_OPERATING_CLIENT_ID
    : (selClient?.id || null);

  // Sprint 2026-05-06 · cuando el usuario elige un cliente,
  // pre-llenamos paymentDays con su dias_credito por defecto.
  // Sprint 2026-05-07 · en EDIT mode no reseteamos a defaults cuando
  // selClient se limpia momentáneamente (clear+pick) — el usuario ya
  // eligió forma_pago/payment_days y no queremos pisarlos.
  useEffect(() => {
    if (selClient && Number(selClient.dias_credito) > 0) {
      setPaymentDays(Number(selClient.dias_credito));
    } else if (!selClient && !isEditMode) {
      setPaymentDays(0);
      // Sprint Commit 9 · sin cliente seleccionado volvemos a '' para
      // forzar elección explícita en el próximo expediente.
      setPaymentMethod("");
    }
  }, [selClient, isEditMode]);

  // Reset existingClientUsage cuando cambia el cliente (siempre).
  useEffect(() => {
    setExistingClientUsage(0);
  }, [selClient?.id]);

  // Sprint 2026-05-07 · BUG FIX: el priceMap solo debe limpiarse cuando
  // cambia `pricingClientId` (el cliente cuyas tarifas mostramos). Si
  // solo cambia selClient pero el operador sigue siendo el mismo (ej.
  // MWT operando), las tarifas son las mismas — limpiarlas dejaba
  // valor del pedido en $0 hasta que el fetcher re-disparase, lo que
  // no ocurría porque su dep `[pricingClientId]` no había cambiado.
  useEffect(() => {
    setPriceMap({});
  }, [pricingClientId]);

  // Sprint 2026-05-01: calcular credito usado proyectado desde
  // expedientes existentes del cliente.
  // Sprint 2026-05-10 · FIX: solo expedientes con forma_pago != CONTADO
  // consumen credito. Los CONTADO se cobran al confirmar la factura, no
  // entran en el pool de credito del cliente.
  useEffect(() => {
    if (!selClient?.id) return;
    let cancel = false;
    (async () => {
      try {
        // 1. Expedientes activos del cliente
        const expRaw = await expedientesApi.list({ client: selClient.id });
        const exps = Array.isArray(expRaw) ? expRaw : (expRaw?.results || []);
        if (cancel) return;
        // FIX 2026-05-10: filtrar CONTADO antes de proyectar credito.
        const creditoExps = exps.filter((e) => {
          const fp = String(e?.forma_pago || '').trim().toUpperCase();
          // Si forma_pago es null/vacio en data legacy, lo tratamos como
          // CREDITO (comportamiento previo). Solo CONTADO se excluye.
          return fp !== 'CONTADO';
        });
        if (creditoExps.length === 0) {
          setExistingClientUsage(0);
          return;
        }
        // 2. Todas las lineas activas del cliente (un solo call con filtro por
        //    is_active; despues filtramos en memoria por expediente_id).
        const lnRaw = await lineasApi.list({ is_active: true });
        const lns = Array.isArray(lnRaw) ? lnRaw : (lnRaw?.results || []);
        if (cancel) return;
        const expIds = new Set(creditoExps.map(e => e.id));
        const clientLines = lns.filter(l => expIds.has(l.expediente_id));

        // 3. Resolver precios via catalogo (igual que en otras vistas).
        //    Solo fetch productos que aparecen en estas lineas.
        const uniquePids = Array.from(new Set(
          clientLines.map(l => l.producto_id).filter(Boolean)
        ));
        const productMap = {};
        if (uniquePids.length > 0) {
          try {
            const prods = await productosApi.list();
            const arr = Array.isArray(prods) ? prods : (prods?.results || []);
            for (const p of arr) if (p?.id) productMap[p.id] = p;
          } catch { /* fallthrough */ }
        }
        if (cancel) return;

        // 4. Sumar qty * unit_price (con fallback al catalogo)
        let total = 0;
        for (const l of clientLines) {
          const qty = Number(l.qty || 0);
          let unit = Number(l.unit_price || 0);
          if (unit === 0 && l.producto_id) {
            const p = productMap[l.producto_id];
            if (p) {
              const cliMap = (p.especificaciones && p.especificaciones.client_prices) || {};
              const override = Number(cliMap[selClient.id] || 0);
              const lista    = Number(p.precio_lista || 0);
              unit = override > 0 ? override : lista;
            }
          }
          total += qty * unit;
        }
        if (!cancel) setExistingClientUsage(total);
      } catch {
        if (!cancel) setExistingClientUsage(0);
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selClient?.id]);

  useEffect(() => {
    if (!pricingClientId) return;
    const uniquePidIds = Array.from(new Set(
      orderLines.map(l => l.producto_id).filter(Boolean)
    ));
    // Solo fetch los que aun no tenemos
    const missing = uniquePidIds.filter(pid => !(pid in priceMap));
    if (missing.length === 0) return;
    let cancel = false;
    Promise.all(
      missing.map(pid => productosApi.get(pid).catch(() => null))
    ).then(prods => {
      if (cancel) return;
      const next = { ...priceMap };
      for (const p of prods) {
        if (!p?.id) continue;
        const cliMap = (p.especificaciones && p.especificaciones.client_prices) || {};
        const override = Number(cliMap[pricingClientId] || 0);
        const lista    = Number(p.precio_lista || 0);
        next[p.id] = override > 0 ? override : lista;
      }
      setPriceMap(next);
    });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingClientId, orderLines]);

  // Total del pedido segun precios resueltos
  const orderTotalValue = useMemo(() => {
    return orderLines.reduce((acc, l) => {
      const unit = Number(priceMap[l.producto_id] || 0);
      return acc + Number(l.cantidad || 0) * unit;
    }, 0);
  }, [orderLines, priceMap]);

  // Sprint 2026-05-06 · cuando el operador es MWT, traemos el credito
  // de Muito Work Limitada (sus campos credito_aprobado / credito_usado)
  // para mostrar el impacto sobre EL OPERADOR, no sobre el cliente final.
  const [mwtOperator, setMwtOperator] = useState(null);
  useEffect(() => {
    if (!isAdmin) { setMwtOperator(null); return; }
    let cancel = false;
    clientesApi.get(MWT_OPERATING_CLIENT_ID)
      .then((d) => { if (!cancel) setMwtOperator(d || null); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [isAdmin]);

  // Proyeccion de credito post-pedido sobre el OPERADOR del expediente.
  // Sprint 2026-05-06 · si operatingMode === 'mwt', el credito relevante
  // es el de Muito Work Limitada. Si 'client', el del cliente final.
  // Sprint 2026-05-10 · FIX: si el pedido en curso es CONTADO, NO debe
  // sumarse al `afterUsed` (no afecta credito).
  // Sprint 2026-05-10 v2 · FIX: el "usado" sale del campo persistido
  // del cliente (cliente.credito_used) — fuente de verdad alineada
  // con /clientes. Antes hacíamos Math.max(persistedUsed, existingClientUsage)
  // pero existingClientUsage sumaba qty*unit_price de TODOS los expedientes
  // activos del cliente (incluso los que están en REGISTRO sin facturar),
  // lo cual inflaba el bar (ej. Sondel con 0% usado en /clientes pero
  // 108% proyectado en el wizard).
  const creditProjection = useMemo(() => {
    const isMwt = operatingMode === 'mwt';
    const source = isMwt ? mwtOperator : selClient;
    if (!source) return null;
    const limit = isMwt
      ? Number(source.credito_aprobado || source.credito_limit_usd || 0)
      : Number(source.credito_limit || 0);
    const persistedUsed = isMwt
      ? Number(source.credito_usado || 0)
      : Number(source.credito_used || 0);
    // Usado = persistido. El campo lo mantiene el backend coherente con
    // facturas emitidas. No proyectamos desde expedientes — eso era una
    // sobre-estimación que confundía al admin.
    const used = persistedUsed;
    const available = Math.max(0, limit - used);
    // Si el pedido actual es CONTADO, no impacta credito → contributedOrder = 0.
    const isContadoNow = String(paymentMethod || '').trim().toUpperCase() === 'CONTADO';
    const contributedOrder = isContadoNow ? 0 : orderTotalValue;
    const afterUsed = used + contributedOrder;
    const afterAvailable = limit - afterUsed;
    const exceedsLimit = limit > 0 && afterUsed > limit;
    const utilPctAfter = limit > 0 ? Math.round((afterUsed / limit) * 100) : 0;
    return {
      limit, used, available,
      orderValue:       orderTotalValue,
      orderImpactCredit: contributedOrder,
      paymentMethod:    isContadoNow ? 'CONTADO' : 'CREDITO',
      afterUsed,
      afterAvailable,
      exceedsLimit,
      utilPctAfter,
      persistedUsed,
      projectedUsed: isMwt ? 0 : existingClientUsage,
      // Etiqueta de la entidad cuyo credito mostramos.
      subjectLabel: isMwt
        ? MWT_OPERATOR_NAME
        : (selClient?.label || ''),
    };
  }, [selClient, mwtOperator, operatingMode, orderTotalValue, existingClientUsage, paymentMethod]);

  // ── Cargar catálogos ──
  useEffect(() => {
    clientesApi.list({ is_parent: "all" }).then((d) => {
      const arr = Array.isArray(d) ? d : (d?.results || []);
      const adapted = arr.map(adaptClient);
      setClients(orderClientsHierarchy(adapted));
      // CLIENT_* → fija el cliente final a su empresa primaria.
      // Sprint 2026-05-06 · usamos legal_entity_ids[0] (compat: legacy
      // legal_entity_id singular) — el backend ya filtra el listado
      // por estos UUIDs.
      if (!isAdmin && user) {
        const primaryId = (Array.isArray(user.legal_entity_ids) && user.legal_entity_ids[0])
          || user.legal_entity_id || null;
        if (primaryId) {
          const c = adapted.find(x => x.id === primaryId);
          if (c) setSelClient(c);
        }
      }
    }).catch(() => setClients([]));
  }, [isAdmin, user]);

  // ── Sprint 2026-05-07 · EDIT MODE precarga ────────────────────
  // Cuando entramos con ?editExp=&editSap=, hidratamos el state desde
  // GET /expedientes/{exp}/sap/{sap}/. Si el endpoint todavía no está
  // deployado (404/500), caemos a modo CREATE silenciosamente.
  // initialLinesRef guarda el snapshot inicial para calcular diffs en
  // el submit (lines_added / lines_removed / lines_updated).
  const initialLinesRef = useRef([]);
  const initialClientIdRef = useRef(null);
  // Sprint 2026-05-07 · Modal de confirmación split.
  // pendingSplitBodyRef contiene el body listo para PATCH cuando el
  // usuario confirma; showSplitConfirm controla el modal.
  const pendingSplitBodyRef = useRef(null);
  const [showSplitConfirm, setShowSplitConfirm] = useState(false);
  useEffect(() => {
    if (!isEditMode) return;
    let cancel = false;
    (async () => {
      try {
        const token = getToken();
        const url = `/api/expedientes/${encodeURIComponent(editExp)}/sap/${encodeURIComponent(editSap)}/`;
        const resp = await fetch(url, {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (cancel) return;

        // 1. operatingMode
        const opIsMwt = String(data.operating_company_id || '').toLowerCase()
          === String(MWT_OPERATING_CLIENT_ID || '').toLowerCase();
        setOperatingMode(opIsMwt ? 'mwt' : 'client');

        // 2. selClient: resolver objeto completo (necesitamos dias_credito, etc.)
        if (data.client_id) {
          initialClientIdRef.current = data.client_id;
          try {
            const cli = await clientesApi.get(data.client_id);
            if (!cancel && cli) setSelClient(adaptClient(cli));
          } catch { /* fallthrough */ }
        }

        // 3. orderLines mapeadas desde data.lines
        const ls = Array.isArray(data.lines)
          ? data.lines.map((l) => ({
              tmpId:         l.id,
              sku:           l.sku,
              talla:         l.talla,
              cantidad:      Number(l.qty || 0),
              producto_id:   l.producto_id,
              product_label: l.product_label || l.sku,
              is_assigned:   true,
            }))
          : [];
        if (!cancel) {
          setOrderLines(ls);
          // Snapshot inicial inmutable para diffing.
          initialLinesRef.current = ls.map((l) => ({ ...l }));
        }

        // 4. payment terms
        if (data.payment_days != null) setPaymentDays(Number(data.payment_days));
        if (data.forma_pago) setPaymentMethod(data.forma_pago);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[wizard editMode] precarga fallida:', err);
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, editExp, editSap]);

  // ── Validación de step ──
  const canAdvance = useMemo(() => {
    if (step === 0) return operatingMode === 'mwt' || operatingMode === 'client';
    if (step === 1) return !!selClient;
    if (step === 2) return orderLines.length > 0
                       && orderLines.every((l) => l.is_assigned !== false && l.cantidad > 0);
    // Sprint Commit 9 · paso final (Resumen) — forma_pago obligatorio.
    // Sin este gate el wizard creaba expedientes con forma_pago='CREDITO'
    // silencioso, que luego rompía release-credit con EXPEDIENTE_TERMS_UNDEFINED.
    if (step === 3) return paymentMethod === 'CREDITO' || paymentMethod === 'CONTADO';
    return true;
  }, [step, selClient, orderLines, operatingMode, paymentMethod]);

  // ── Submit ──
  const submit = useCallback(async () => {
    if (saving) return;
    // Sprint Commit 9 · guard defensivo: si por algún path el submit se
    // disparara con paymentMethod vacío, bloqueamos y mostramos error.
    if (paymentMethod !== 'CREDITO' && paymentMethod !== 'CONTADO') {
      setError(lang === 'es'
        ? 'Selecciona la forma de pago (Crédito o Contado) antes de guardar.'
        : 'Choose the payment method (Credit or Cash) before saving.');
      return;
    }
    setSaving(true); setError(null);
    try {
      // ── Sprint 2026-05-07 · branch EDIT MODE ────────────────────
      // En lugar de POST /expedientes/, computamos diffs vs el snapshot
      // inicial y mandamos PATCH /expedientes/{exp}/sap/{sap}/.
      if (isEditMode) {
        const initial = initialLinesRef.current || [];
        const initialIds = new Set(initial.map((l) => l.tmpId).filter(Boolean));
        const currentIds = new Set(orderLines.map((l) => l.tmpId).filter(Boolean));

        const lines_added = orderLines
          .filter((l) => !l.tmpId || !initialIds.has(l.tmpId))
          .map((l) => ({
            producto_id: l.producto_id || null,
            sku:         l.sku,
            talla:       l.talla || null,
            qty:         Number(l.cantidad) || 0,
          }));

        const lines_removed = [...initialIds].filter((id) => !currentIds.has(id));

        const lines_updated = orderLines
          .filter((l) => l.tmpId && initialIds.has(l.tmpId))
          .filter((l) => {
            const orig = initial.find((o) => o.tmpId === l.tmpId);
            return orig && Number(orig.cantidad) !== Number(l.cantidad);
          })
          .map((l) => ({ id: l.tmpId, qty: Number(l.cantidad) || 0 }));

        const body = {
          operating_company_id: operatingCompanyId,
          // Sprint Commit 9 · forma_pago obligatorio. Si llegó aqui es
          // porque el wizard ya validó que paymentMethod ∈ {CREDITO, CONTADO}.
          forma_pago:           paymentMethod,
          payment_days:         Number(paymentDays) || 0,
          lines_added,
          lines_removed,
          lines_updated,
        };
        // Si el usuario cambió de cliente, abrir modal de confirmación
        // (split). Diferimos el PATCH hasta que el usuario apruebe.
        const clientChanged = !!(
          initialClientIdRef.current
          && selClient?.id
          && selClient.id !== initialClientIdRef.current
        );
        if (clientChanged && !pendingSplitBodyRef.current) {
          body.client_id = selClient.id;
          // Guardamos el body en el ref + abrimos el modal. El handler
          // de confirmación re-disparará submit() poniendo el ref pre-aprobado.
          pendingSplitBodyRef.current = body;
          setShowSplitConfirm(true);
          setSaving(false);
          return;
        }
        if (clientChanged) {
          // pendingSplitBodyRef ya contiene el body aprobado; usamos ese
          // y limpiamos el ref para futuros envíos.
          Object.assign(body, pendingSplitBodyRef.current || {});
          pendingSplitBodyRef.current = null;
        }

        const token = getToken();
        const url = `/api/expedientes/${encodeURIComponent(editExp)}/sap/${encodeURIComponent(editSap)}/`;
        const resp = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          let detail = `HTTP ${resp.status}`;
          try {
            const errBody = await resp.json();
            detail = errBody?.detail || JSON.stringify(errBody);
          } catch { /* fallthrough */ }
          throw new Error(detail);
        }

        // Parse response — puede traer new_expediente_id si hubo split.
        let respData = null;
        try { respData = await resp.json(); } catch { /* fallthrough */ }
        const targetExpId = respData?.new_expediente_id || editExp;
        const didSplit = !!respData?.split;

        // OK → resolver oc_id del expediente final (puede ser el nuevo).
        let ocId = 'none';
        try {
          const exp = await expedientesApi.get(targetExpId);
          ocId = exp?.oc_id || exp?.oc?.id || 'none';
        } catch { /* fallthrough */ }
        setToast({
          kind: 'ok',
          msg: didSplit
            ? (lang === 'es'
                ? `Expediente dividido. Nuevo: ${respData?.new_expediente_codigo || ''}`
                : `Expediente split. New: ${respData?.new_expediente_codigo || ''}`)
            : (lang === 'es' ? 'Cambios guardados.' : 'Changes saved.'),
        });
        // Sprint 2026-05-07 · al guardar cambios (editMode), aterrizar
        // en la vista de la OC padre (/expedientes/{ocId}) en lugar
        // del detalle del expediente (mismo criterio que CREATE).
        // Si por algún motivo no hay ocId resuelto, fallback al
        // detalle del expediente.
        if (ocId && ocId !== 'none') {
          navigate(`/expedientes/${encodeURIComponent(ocId)}`);
        } else {
          navigate(`/expedientes/none/exp/${encodeURIComponent(targetExpId)}`);
        }
        return;
      }

      // Agrupar líneas por (sku, talla) duplicadas — sumar cantidades.
      const grouped = {};
      orderLines.forEach((l) => {
        const k = `${l.sku}|${l.talla || ""}`;
        if (!grouped[k]) {
          grouped[k] = { ...l, cantidad: 0 };
        }
        grouped[k].cantidad += Number(l.cantidad || 0);
      });

      // Payload mínimo — el orchestrator legacy soporta crear con NULLs.
      // Sprint 2026-05-06 · operating_company_id define quien opera
      // el expediente (MWT vs cliente). Los precios duales se congelan
      // en el backend al crear las lineas (snapshot mwt + cliente).
      const payload = {
        client_id:           selClient.id,
        operating_company_id: operatingCompanyId,
        // Esto NO va: marca, mode, freight_mode, currency.
        // El backend ya las marca como required=False.
        estado:              "REGISTRO",
        notas:               null,
        // Sprint 2026-05-06 · términos de pago del expediente.
        credit_days:         Number(paymentDays) || 0,
        // Sprint Commit 9 · forma_pago obligatorio (CREDITO|CONTADO).
        // canAdvance ya bloqueó este submit si el usuario no eligió uno.
        forma_pago:          paymentMethod,
        lines: Object.values(grouped).map((l) => ({
          sku:           l.sku,
          talla:         l.talla || null,
          cantidad:      Number(l.cantidad) || 0,
          producto_id:   l.producto_id || null,
          product_label: l.product_label || null,
        })),
      };

      const resp = await expedientesApi.create(payload);
      // Sprint 2026-05-07 · al crear un expediente nuevo, el CEO prefiere
      // aterrizar en la vista de la OC padre (/expedientes/{oc_id}) que
      // ya muestra el grupo de SAPs + el nuevo expediente al fondo.
      // Si por algún motivo no hay oc_id en la response, caemos al
      // listado de expedientes.
      const expId = resp?.id;
      const ocId  = resp?.oc_id || resp?.oc?.id || null;
      if (ocId) {
        navigate(`/expedientes/${encodeURIComponent(ocId)}`);
      } else if (expId) {
        // Fallback raro: sin oc_id, vamos al detalle del expediente.
        navigate(`/expedientes/none/exp/${encodeURIComponent(expId)}`);
      } else {
        navigate("/expedientes");
      }
    } catch (e) {
      const fallback = isEditMode
        ? (lang === 'es' ? 'Error al guardar los cambios' : 'Error saving changes')
        : (lang === 'es' ? 'Error al crear el expediente' : 'Error creating file');
      const msg = e?.body?.detail || e?.message || fallback;
      setError(msg);
    } finally {
      setSaving(false);
    }
  }, [saving, orderLines, selClient, operatingCompanyId, paymentDays, paymentMethod, navigate,
      isEditMode, editExp, editSap, lang]);

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      {/* ── Header ─────────────────────── */}
      <div className="page-header" style={{ marginBottom: 18 }}>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate("/expedientes")}>
            <IconChevLeft size={12}/> {lang === "es" ? "Volver" : "Back"}
          </button>
          <div className="micro" style={{ marginTop: 8, marginBottom: 4 }}>
            {lang === "es" ? "EXPEDIENTES · INGRESO DE PEDIDO" : "FILES · ORDER INTAKE"}
          </div>
          <h1 className="page-title">
            {isEditMode
              ? (lang === "es" ? `Editar SAP ${editSap}` : `Edit SAP ${editSap}`)
              : (lang === "es" ? "Nuevo expediente" : "New file")}
          </h1>
          <div className="page-subtitle">
            {isEditMode
              ? (lang === "es"
                  ? "Editás los datos de este SAP. Los cambios afectan solo a este SAP, no al expediente entero."
                  : "Editing this SAP. Changes affect only this SAP, not the entire file.")
              : (lang === "es"
                  ? "Ingreso puro de pedido. Datos comerciales y logísticos se completan después en el detalle."
                  : "Pure order intake. Commercial/logistics data is filled later in the detail view.")}
          </div>
        </div>
      </div>

      {/* ── Stepper ─────────────────────── */}
      <Stepper step={step} steps={STEPS} onJump={(s) => s < step && setStep(s)} lang={lang}/>

      {/* ── Contenido ────────────────────── */}
      <AnimatePresence mode="wait">
        <motion.div key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0,  transition: { duration: 0.22 } }}
          exit   ={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}>
          {step === 0 && isAdmin && (
            <Step0Operador
              lang={lang}
              operatingMode={operatingMode}
              setOperatingMode={setOperatingMode}
            />
          )}
          {step === 1 && (
            <Step1Cliente
              lang={lang}
              clients={clients}
              isAdmin={isAdmin}
              isClientLocked={!isAdmin}
              operatingMode={operatingMode}
              selClient={selClient}     setSelClient={setSelClient}
              existingClientUsage={existingClientUsage}
            />
          )}
          {step === 2 && (
            <Step2Productos
              lang={lang}
              clientId={selClient?.id}
              clientLabel={selClient?.label}
              orderLines={orderLines} setOrderLines={setOrderLines}
              parsing={parsing} setParsing={setParsing}
              manualOpen={manualOpen} setManualOpen={setManualOpen}
              setReqDialog={setReqDialog}
              setToast={setToast}
              priceMap={priceMap}
              creditProjection={creditProjection}
              isAdmin={isAdmin}
            />
          )}
          {step === 3 && (
            <Step3Resumen
              lang={lang}
              client={selClient}
              operatingMode={operatingMode}
              operatingCompanyId={operatingCompanyId}
              orderLines={orderLines}
              priceMap={priceMap}
              creditProjection={creditProjection}
              isAdmin={isAdmin}
              paymentDays={paymentDays}
              setPaymentDays={setPaymentDays}
              paymentMethod={paymentMethod}
              setPaymentMethod={setPaymentMethod}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* ── Footer sticky ───────────────── */}
      <div className="card card-pad-md" style={{
        marginTop: 18, position: "sticky", bottom: 16, zIndex: 5,
        boxShadow: "0 8px 24px rgba(15,27,61,0.08)",
      }}>
        {error && (
          <div style={{
            padding: "10px 14px", marginBottom: 12, borderRadius: 8,
            background: "#FEE2E2", border: "1px solid #FCA5A5",
            color: "#991B1B", fontSize: 13,
          }}>
            <IconAlert size={12} style={{ verticalAlign: -1, marginRight: 6 }}/> {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button className="btn btn-ghost"
                  disabled={step === (isAdmin ? 0 : 1)}
                  onClick={() => setStep((s) => Math.max(isAdmin ? 0 : 1, s - 1))}>
            <IconChevLeft size={12}/> {lang === "es" ? "Anterior" : "Back"}
          </button>
          {step < 3 ? (
            <button className="btn btn-accent"
                    disabled={!canAdvance}
                    onClick={() => setStep((s) => Math.min(3, s + 1))}
                    style={{ minWidth: 180 }}>
              {lang === "es" ? "Siguiente" : "Next"} <IconChevRight size={12}/>
            </button>
          ) : (
            <button
              className="btn btn-accent"
              // Sprint Commit 9 · gate por canAdvance del step 3 — bloquea
              // submit si paymentMethod no esta elegido (CREDITO|CONTADO).
              disabled={saving || orderLines.length === 0 || !canAdvance}
              onClick={submit}
              style={{
                minWidth: 240, fontWeight: 700,
                background: "var(--btn-primary, #00B286)",
                borderColor: "var(--btn-primary, #00B286)",
              }}>
              {saving
                ? (isEditMode
                    ? (lang === "es" ? "Guardando…" : "Saving…")
                    : (lang === "es" ? "Creando…" : "Creating…"))
                : (
                  <>
                    {isEditMode
                      ? (lang === "es" ? "Guardar cambios" : "Save changes")
                      : (lang === "es" ? "Crear expediente" : "Create file")}
                    {' '}
                    <IconCheck size={12}/>
                  </>
                )
              }
            </button>
          )}
        </div>
      </div>

      {/* ── Modal de confirmación: split por cambio de cliente ── */}
      {showSplitConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSplitConfirm(false);
              pendingSplitBodyRef.current = null;
            }
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(11,30,58,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div style={{
            width: 'min(480px, 100%)',
            background: 'var(--surface-raised, #fff)',
            borderRadius: 14,
            boxShadow: '0 30px 80px rgba(11,30,58,0.40)',
            padding: '22px 24px 18px',
          }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '4px 10px', borderRadius: 999,
              background: 'color-mix(in oklab, var(--warning, #B45309) 12%, transparent)',
              color: 'var(--warning, #B45309)',
              fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
              marginBottom: 14,
            }}>
              {lang === 'es' ? 'CAMBIAR CLIENTE DEL SAP' : 'CHANGE SAP CLIENT'}
            </div>
            <div style={{
              fontSize: 17, fontWeight: 800, color: 'var(--text-primary, #0B1E3A)',
              marginBottom: 8,
            }}>
              {lang === 'es'
                ? '¿Crear un nuevo expediente con este SAP?'
                : 'Create a new expediente with this SAP?'}
            </div>
            <div style={{
              fontSize: 13, color: 'var(--text-secondary, #4A5773)',
              lineHeight: 1.5,
            }}>
              {lang === 'es'
                ? 'Las líneas con este SAP se moverán del expediente actual a un nuevo expediente con el cliente que elegiste. El crédito del cliente nuevo absorberá el valor del SAP.'
                : 'Lines with this SAP will move from the current expediente to a new one with the selected client. The new client\'s credit will absorb the SAP value.'}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: 10,
              marginTop: 22,
            }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setShowSplitConfirm(false);
                  pendingSplitBodyRef.current = null;
                }}
              >
                {lang === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn btn-accent"
                style={{ minWidth: 160, fontWeight: 700 }}
                onClick={() => {
                  setShowSplitConfirm(false);
                  // Re-disparamos submit; el ref ya tiene el body
                  // aprobado y la rama del clientChanged lo va a usar.
                  submit();
                }}
              >
                {lang === 'es' ? 'Sí, dividir expediente' : 'Yes, split expediente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Diálogo solicitud asignación ── */}
      {reqDialog && (
        <RequestAssignmentDialog
          lang={lang}
          sku={reqDialog.sku}
          clientId={selClient?.id}
          clientEmail={selClient?.contacto_email}
          onClose={() => setReqDialog(null)}
          onSent={(payload) => {
            setReqDialog(null);
            setToast({
              kind: "ok",
              msg: (lang === "es"
                ? `Solicitud enviada a ${payload.sent_to}.`
                : `Request sent to ${payload.sent_to}.`),
            });
            // Marcar línea como request_sent para deshabilitar reintento
            setOrderLines((prev) => prev.map((l) =>
              l.sku === reqDialog.sku ? { ...l, unassigned_request_sent: true } : l));
          }}
          onError={(msg) => setToast({ kind: "err", msg })}
        />
      )}

      {/* ── Toast ── */}
      {toast && <Toast {...toast} onClose={() => setToast(null)}/>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEPPER
// ═════════════════════════════════════════════════════════════
function Stepper({ step, steps, onJump, lang }) {
  const list = Array.isArray(steps) && steps.length ? steps : STEPS_CLIENT;
  return (
    <div className="card card-pad-md" style={{ marginBottom: 18 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap",
      }}>
        {list.map((s, idx) => {
          const done = step > s.id;
          const active = step === s.id;
          // Etiqueta del nodo: en steps con id=0 mostramos un punto.
          const dotLabel = s.id === 0 ? "0" : s.id;
          return (
            <React.Fragment key={s.id}>
              <button type="button"
                      onClick={() => onJump?.(s.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 14px", borderRadius: 999,
                        border: active ? "1.5px solid var(--brand-accent, #00B286)" : "1px solid var(--border, #E1E6ED)",
                        background: active ? "rgba(0,178,134,0.06)" : (done ? "rgba(0,178,134,0.10)" : "var(--surface-raised, #fff)"),
                        color: active ? "var(--text-primary, #0B1E3A)" : (done ? "var(--brand-accent, #00B286)" : "var(--text-secondary)"),
                        fontWeight: 600, fontSize: 13,
                        cursor: s.id < step ? "pointer" : "default",
                      }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 99,
                  background: active ? "var(--brand-accent, #00B286)" : (done ? "var(--brand-accent, #00B286)" : "var(--border, #E1E6ED)"),
                  color: (active || done) ? "#fff" : "var(--text-tertiary, #64748B)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}>
                  {done ? <IconCheck size={11}/> : dotLabel}
                </span>
                <span>{s.label}</span>
              </button>
              {idx < list.length - 1 && (
                <span style={{ flex: 1, height: 1, background: "var(--border, #E1E6ED)", maxWidth: 60 }}/>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 0 · OPERADOR (solo ADMIN)
// ─────────────────────────────────────────────────────────────
// Sprint 2026-05-06 · el ADMIN decide si el expediente lo opera
// Muito Work Limitada (default · pricing MWT, credito MWT) o el
// propio cliente (pricing del cliente, credito del cliente).
// ═════════════════════════════════════════════════════════════
/**
 * @typedef {Object} Step0Props
 * @property {string} lang
 * @property {'mwt'|'client'} operatingMode
 * @property {(m:'mwt'|'client') => void} setOperatingMode
 */
/** @param {Step0Props} props */
function Step0Operador({ lang, operatingMode, setOperatingMode }) {
  const cards = [
    {
      id: 'mwt',
      title_es: `Operada por ${MWT_OPERATOR_NAME}`,
      title_en: `Operated by ${MWT_OPERATOR_NAME}`,
      sub_es: 'Recomendada · MWT consolida pricing, crédito y exposición financiera.',
      sub_en: 'Recommended · MWT consolidates pricing, credit and financial exposure.',
      meta_es: 'Crédito y precios MWT · cliente final solo ve su precio congelado.',
      meta_en: 'MWT credit and pricing · the final client only sees the frozen client price.',
    },
    {
      id: 'client',
      title_es: 'Operada por el cliente',
      title_en: 'Operated by the client',
      sub_es: 'El cliente paga directo al proveedor; MWT actúa solo como facilitador.',
      sub_en: 'Client pays the supplier directly; MWT acts as facilitator only.',
      meta_es: 'Precios y crédito del cliente final. Sin snapshot dual.',
      meta_en: 'Final client pricing and credit. No dual snapshot.',
    },
  ];

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 6 }}>
        {lang === 'es'
          ? 'Paso 0 · ¿Quién opera el expediente?'
          : 'Step 0 · Who operates this file?'}
      </h2>
      <div className="caption" style={{
        color: 'var(--text-tertiary)', marginBottom: 18, lineHeight: 1.5,
      }}>
        {lang === 'es'
          ? 'Define quién es responsable comercial y financieramente del expediente. Puedes cambiarlo más adelante mientras el expediente esté en REGISTRO.'
          : 'Defines who is commercially and financially responsible. You can change this later while the file is in REGISTRO.'}
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14,
      }}>
        {cards.map((c) => {
          const active = operatingMode === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setOperatingMode(c.id)}
              style={{
                textAlign: 'left',
                padding: '18px 18px',
                borderRadius: 12,
                cursor: 'pointer',
                background: active
                  ? 'rgba(0,178,134,0.07)'
                  : 'var(--surface-raised, #fff)',
                border: active
                  ? '2px solid var(--brand-accent, #00B286)'
                  : '1px solid var(--border, #E1E6ED)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 99,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: active ? 'var(--brand-accent, #00B286)' : 'var(--border, #E1E6ED)',
                  color: active ? '#fff' : 'var(--text-tertiary, #64748B)',
                  fontSize: 11, fontWeight: 800,
                }}>
                  {active ? <IconCheck size={11}/> : ''}
                </span>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary, #0B1E3A)' }}>
                  {lang === 'es' ? c.title_es : c.title_en}
                </div>
              </div>
              <div className="caption" style={{
                color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6,
              }}>
                {lang === 'es' ? c.sub_es : c.sub_en}
              </div>
              <div className="caption" style={{
                color: 'var(--text-tertiary)', fontSize: 11, lineHeight: 1.4,
              }}>
                {lang === 'es' ? c.meta_es : c.meta_en}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 1 · CLIENTE
// ═════════════════════════════════════════════════════════════
/**
 * @typedef {Object} Step1Props
 * @property {string} lang
 * @property {Array<object>} clients
 * @property {object|null} selClient
 * @property {(c:object|null)=>void} setSelClient
 * @property {boolean} [isAdmin]
 * @property {boolean} [isClientLocked]
 * @property {'mwt'|'client'} [operatingMode]
 * @property {number} [existingClientUsage]
 */
/** @param {Step1Props} props */
function Step1Cliente({ lang, clients, selClient, setSelClient, existingClientUsage = 0, isAdmin = true, isClientLocked = false, operatingMode = 'client' }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.slice(0, 100);
    return clients.filter((c) =>
      [c.label, c.razon_social, c.tax_id, c.parent_label].join(" ").toLowerCase().includes(q)
    ).slice(0, 100);
  }, [clients, search]);

  // ── Sprint 2026-05-06 · si el operador es MWT, mostramos un card
  // resumen del crédito de Muito Work Limitada por arriba del picker.
  // El cliente final (Step 1) sigue siendo independiente.
  const showMwtOperatorCard = isAdmin && operatingMode === 'mwt';

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 14 }}>
        {lang === "es" ? "Paso 1 · Cliente" : "Step 1 · Client"}
      </h2>

      {showMwtOperatorCard && (
        <div style={{ marginBottom: 14 }}>
          <Field label={lang === 'es' ? 'Operador del expediente' : 'File operator'}>
            <MwtOperatorCard lang={lang}/>
          </Field>
        </div>
      )}

      {/* Selector de cliente final */}
      <Field label={
        showMwtOperatorCard
          ? (lang === 'es' ? 'Cliente final · ¿a quién factura MWT? *' : 'Final client · who does MWT invoice? *')
          : (lang === 'es' ? 'Cliente / Subsidiaria *' : 'Client / Subsidiary *')
      }>
        {selClient ? (
          <SelectedClientCard
            client={selClient}
            onClear={isClientLocked ? null : () => setSelClient(null)}
            lang={lang}
            existingUsage={existingClientUsage}
            locked={isClientLocked}
          />
        ) : (
          <div ref={ref} style={{ position: "relative" }}>
            <input
              className="input"
              placeholder={lang === "es" ? "Buscar por razón social, RUC o subsidiaria…" : "Search…"}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
            />
            {open && filtered.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
                background: "var(--surface-raised, #fff)", border: "1px solid var(--border)",
                borderRadius: 8, marginTop: 4, maxHeight: 320, overflowY: "auto",
                boxShadow: "0 8px 24px rgba(11,30,58,0.15)",
              }}>
                {filtered.map((c) => (
                  <button key={c.id} type="button"
                          onClick={() => { setSelClient(c); setOpen(false); setSearch(""); }}
                          style={{
                            width: "100%", textAlign: "left",
                            padding: "10px 14px",
                            paddingLeft: c.parent_id ? 28 : 14,
                            border: "none",
                            borderBottom: "1px solid var(--border-subtle, #F3F5F8)",
                            background: "var(--surface-raised, #fff)",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface-alt, #F7F9FC)"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "var(--surface-raised, #fff)"}>
                    {c.parent_id && (
                      <span style={{ color: "var(--brand-accent, #00B286)", fontWeight: 700 }} title="Subsidiaria">↳</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--text-primary, #0B1E3A)", fontSize: 13 }}>
                        {c.label}
                      </div>
                      <div className="caption" style={{ color: "var(--text-tertiary)" }}>
                        {c.tax_id && <code className="mono-sm">{c.tax_id}</code>}
                        {c.parent_label && (
                          <> · <span style={{ color: "var(--brand-accent, #00B286)" }}>hija de {c.parent_label}</span></>
                        )}
                      </div>
                    </div>
                    {c.credito_limit > 0 && (
                      <span className="tabular-nums" style={{
                        fontSize: 11, fontWeight: 700, color: "var(--brand-accent, #00B286)",
                        background: "rgba(0,178,134,0.10)", padding: "2px 8px",
                        borderRadius: 999,
                      }}>
                        ${(c.credito_limit / 1000).toFixed(0)}k
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Field>
    </div>
  );
}

// ── Sprint 2026-05-06 · Card readonly de Muito Work Limitada como
// operador. Muestra el credito disponible (pool) en barra verde.
// El backend exporta MWT como un cliente normal (cliente.cliente con
// id=MWT_OPERATING_CLIENT_ID); aqui la fetcheamos via clientesApi.get.
function MwtOperatorCard({ lang }) {
  const [op, setOp] = React.useState(null);
  React.useEffect(() => {
    let cancel = false;
    clientesApi.get(MWT_OPERATING_CLIENT_ID)
      .then((d) => { if (!cancel) setOp(d || null); })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);

  const limit = Number(op?.credito_aprobado || op?.credito_limit_usd || 0);
  const used  = Number(op?.credito_usado || 0);
  const utilPct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const disponible = Math.max(0, limit - used);
  const fmt = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  return (
    <div style={{
      padding: '14px 16px',
      border: '1.5px solid var(--brand-accent, #00B286)',
      background: 'rgba(0,178,134,0.05)',
      borderRadius: 12,
    }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary, #0B1E3A)' }}>
          {MWT_OPERATOR_NAME}
        </div>
        <div className="caption" style={{ color: 'var(--text-tertiary)' }}>
          {lang === 'es' ? 'Operador del expediente' : 'File operator'}
        </div>
      </div>
      {limit > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4,
          }}>
            <span>{lang === 'es' ? 'Crédito disponible (pool)' : 'Available credit (pool)'}</span>
            <span className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary, #0B1E3A)' }}>
              {fmt(disponible)} / {fmt(limit)}
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--border, #E1E6ED)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, utilPct)}%`,
              background: utilPct >= 85 ? 'var(--danger, #DC2626)' : utilPct >= 70 ? 'var(--warning, #F59E0B)' : 'var(--brand-accent, #00B286)',
              transition: 'width 0.18s ease',
            }}/>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @typedef {Object} SelectedClientCardProps
 * @property {object} client
 * @property {(()=>void)|null} [onClear] — null fuerza locked (CLIENT_* sin opcion de cambiar).
 * @property {string} lang
 * @property {number} [existingUsage]
 * @property {boolean} [locked]
 */
/** @param {SelectedClientCardProps} props */
function SelectedClientCard({ client, onClear, lang, existingUsage = 0, locked = false }) {
  // Sprint 2026-05-10 v2 · usamos `cliente.credito_used` directo (fuente
  // de verdad, alineada con /clientes). Antes Math.max(persistedUsed,
  // existingUsage) inflaba el bar contando expedientes en REGISTRO que
  // todavía no facturan. existingUsage queda como prop por compat pero
  // ya no se usa.
  const persistedUsed = Number(client.credito_used || 0);
  const used = persistedUsed;
  const limit = Number(client.credito_limit || 0);
  const utilPct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const disponible = Math.max(0, limit - used);
  return (
    <div style={{
      padding: "16px 18px",
      border: "2px solid #00B286",
      background: "rgba(0,178,134,0.05)",
      borderRadius: 12,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0B1E3A",
                        display: "flex", alignItems: "center", gap: 8 }}>
            {client.parent_id && (
              <span style={{ color: "#00B286", fontWeight: 800 }} title="Subsidiaria">↳</span>
            )}
            {client.label}
          </div>
          <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
            {client.tax_id && <code className="mono-sm">{client.tax_id}</code>}
            {client.parent_label && (
              <> · <span style={{ color: "#00B286" }}>hija de {client.parent_label}</span></>
            )}
          </div>
          {limit > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between",
                            fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
                <span>
                  {lang === "es" ? "Crédito disponible (pool)" : "Available credit (pool)"}
                  {/* Sprint 2026-05-10 v2 · badge "proyectado" removido.
                      El bar usa cliente.credito_used directo (alineado
                      con /clientes). Si en el futuro queremos mostrar
                      "pendiente de facturar" como hint separado, va con
                      otro estilo y no debe afectar el cálculo del bar. */}
                </span>
                <span className="tabular-nums" style={{ fontWeight: 700, color: "#0B1E3A" }}>
                  ${disponible.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                  {" / "}
                  ${limit.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div style={{ height: 6, background: "#E1E6ED", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(100, utilPct)}%`,
                  background: utilPct >= 85 ? "#DC2626" : utilPct >= 70 ? "#F59E0B" : "#00B286",
                  transition: "width 0.18s ease",
                }}/>
              </div>
            </div>
          )}
        </div>
        {(!locked && typeof onClear === 'function') && (
          <button onClick={onClear} className="btn btn-ghost btn-sm" style={{ color: "var(--danger, #D64545)" }}>
            <IconX size={12}/>
          </button>
        )}
        {locked && (
          <span className="caption" style={{
            color: 'var(--text-tertiary)',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <IconLock size={11}/>{lang === 'es' ? 'Fijo' : 'Locked'}
          </span>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// STEP 2 · PRODUCTOS
// ═════════════════════════════════════════════════════════════
function Step2Productos({
  lang, clientId, clientLabel,
  orderLines, setOrderLines,
  parsing, setParsing,
  manualOpen, setManualOpen,
  setReqDialog, setToast,
  priceMap = {}, creditProjection, isAdmin = false,
}) {
  const dropRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(async (file) => {
    if (!file || !clientId) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("client_id", clientId);
      const res = await fetch("/api/expedientes/parse-template/", {
        method: "POST", body: fd,
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const payload = await res.json();
      const newLines = (payload.lines || []).map((l, i) => ({
        tmpId:         `pl-${Date.now()}-${i}`,
        sku:           l.sku,
        talla:         l.talla,
        cantidad:      l.cantidad,
        producto_id:   l.producto_id,
        product_label: l.product_label,
        is_assigned:   l.is_assigned !== false,
      }));
      setOrderLines((prev) => [...prev, ...newLines]);
      const unass = payload.summary?.unassigned_rows || 0;
      setToast({
        kind: unass > 0 ? "warn" : "ok",
        msg: lang === "es"
          ? `${payload.summary?.valid_rows || 0} líneas cargadas` + (unass ? ` · ${unass} sin asignar` : "")
          : `${payload.summary?.valid_rows || 0} lines loaded` + (unass ? ` · ${unass} unassigned` : ""),
      });
    } catch (e) {
      setToast({ kind: "err", msg: e?.message || (lang === "es" ? "Error procesando archivo" : "Parse error") });
    } finally {
      setParsing(false);
    }
  }, [clientId, setOrderLines, setParsing, setToast, lang]);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "plantilla_expediente.csv";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const removeLine = (tmpId) =>
    setOrderLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  const updateLine = (tmpId, patch) =>
    setOrderLines((prev) => prev.map((l) => l.tmpId === tmpId ? { ...l, ...patch } : l));

  const totalUnits = orderLines.reduce((a, l) => a + Number(l.cantidad || 0), 0);
  const unassignedCount = orderLines.filter((l) => l.is_assigned === false).length;

  return (
    <div className="card card-pad-lg">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h2 className="heading-md">
          {lang === "es" ? "Paso 2 · Productos" : "Step 2 · Products"}
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}>
            ⬇ {lang === "es" ? "Descargar plantilla" : "Download template"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setManualOpen(true)}>
            <IconPlus size={11}/> {lang === "es" ? "Agregar línea manual" : "Add manual line"}
          </button>
        </div>
      </div>

      {/* Dropzone CSV/Excel */}
      <div ref={dropRef}
           onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
           onDragLeave={() => setDragOver(false)}
           onDrop={(e) => {
             e.preventDefault(); setDragOver(false);
             const f = e.dataTransfer.files?.[0];
             if (f) handleFile(f);
           }}
           style={{
             border: `2px dashed ${dragOver ? "#00B286" : "#CBD5E1"}`,
             borderRadius: 12,
             padding: 22, textAlign: "center",
             background: dragOver ? "rgba(0,178,134,0.04)" : "#FAFBFD",
             marginBottom: 18,
           }}>
        {parsing ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <IconRefresh size={18} style={{ color: "#00B286", animation: "spin 1.2s linear infinite" }}/>
            <strong style={{ color: "#0B1E3A" }}>
              {lang === "es" ? "Validando contra catálogo del cliente…" : "Validating against client catalog…"}
            </strong>
          </div>
        ) : (
          <div>
            <IconUpload size={26} style={{ color: "#3083FE", margin: "0 auto 8px", display: "block" }}/>
            <div style={{ fontWeight: 700, color: "#0B1E3A" }}>
              {lang === "es"
                ? "Arrastra el CSV / Excel con tu pedido o:"
                : "Drag the CSV / Excel here or:"}
            </div>
            <label className="btn btn-ghost" style={{ marginTop: 12, cursor: "pointer" }}>
              {lang === "es" ? "Seleccionar archivo" : "Pick a file"}
              <input type="file" accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,.xls"
                     style={{ display: "none" }}
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}/>
            </label>
            <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 8, lineHeight: 1.5 }}>
              {lang === "es" ? "Columnas: " : "Columns: "}
              <code>SKU/Nombre · Talla · Cantidad</code>
              <br/>
              <span style={{ fontSize: 11 }}>
                {lang === "es"
                  ? "La IA reconoce SKU, Nombre o Ref Proveedor. Talla acepta «42», «BRA 40», «US 9.5», «UK 9», «EU 43» o alfa («M», «UNICA»)."
                  : "AI accepts SKU, name or supplier ref. Size accepts «42», «BRA 40», «US 9.5», «UK 9», «EU 43» or alpha («M», «UNICA»)."}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Resumen */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8,
        padding: "10px 14px", borderRadius: 8,
        background: "rgba(0,178,134,0.06)",
      }}>
        <div className="caption" style={{ color: "#0B1E3A", fontWeight: 600 }}>
          {orderLines.length} {lang === "es" ? "líneas" : "lines"} · <strong className="tabular-nums">{totalUnits}</strong> {lang === "es" ? "unidades" : "units"}
          {unassignedCount > 0 && (
            <span style={{ color: "#B45309", marginLeft: 12, fontWeight: 700 }}>
              ⚠ {unassignedCount} {lang === "es" ? "sin asignar" : "unassigned"}
            </span>
          )}
        </div>
        {clientLabel && (
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Cliente:" : "Client:"} <strong style={{ color: "#0B1E3A" }}>{clientLabel}</strong>
          </div>
        )}
      </div>

      {/* Tabla */}
      {orderLines.length === 0 ? (
        <div className="empty" style={{ padding: 36 }}>
          <IconPackage size={22} style={{ color: "var(--text-tertiary)" }}/>
          <div className="caption" style={{ color: "var(--text-tertiary)" }}>
            {lang === "es" ? "Sin líneas todavía. Sube el CSV o agrega manual." : "No lines yet. Upload CSV or add manually."}
          </div>
        </div>
      ) : (
        <div className="card card-pad-0">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>{lang === "es" ? "Producto" : "Product"}</th>
                <th>{lang === "es" ? "Talla" : "Size"}</th>
                <th style={{ textAlign: "right", paddingRight: 24 }}>
                  {lang === "es" ? "Cantidad" : "Qty"}
                </th>
                {/* Sprint 2026-05-03 v3.8 · P. unit y Subtotal ocultas a pedido del CEO. */}
                <th>{lang === "es" ? "Estado" : "Status"}</th>
                <th style={{ width: 56, textAlign: "center" }}></th>
              </tr>
            </thead>
            <tbody>
              {orderLines.map((l) => {
                const unassigned = l.is_assigned === false;
                return (
                  <tr key={l.tmpId}
                      style={unassigned ? { background: "#FEF3C7" } : null}>
                    <td className="mono-sm">{l.sku}</td>
                    <td>{l.product_label || "—"}</td>
                    <td>{l.talla || "—"}</td>
                    <td style={{ textAlign: "right", paddingRight: 24 }}>
                      <input className="input tabular-nums" type="number" min="1"
                             value={l.cantidad}
                             onChange={(e) => updateLine(l.tmpId, { cantidad: Number(e.target.value) })}
                             style={{ width: 90, textAlign: "right",
                                      display: "inline-block" }}/>
                    </td>
                    {/* Sprint 2026-05-03 v3.8 · TDs P. unit y Subtotal eliminados. */}
                    <td>
                      {unassigned ? (
                        l.unassigned_request_sent ? (
                          <span className="caption" style={{ color: "#00B286", fontWeight: 600 }}>
                            ✓ {lang === "es" ? "Solicitud enviada" : "Request sent"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setReqDialog({ sku: l.sku, talla: l.talla, cantidad: l.cantidad })}
                            style={{
                              padding: "4px 10px", fontSize: 11,
                              color: "#B45309", border: "1px solid rgba(180,83,9,0.40)",
                              background: "rgba(180,83,9,0.06)",
                            }}>
                            <IconMail size={10}/> {lang === "es" ? "Solicitar asignación" : "Request assignment"}
                          </button>
                        )
                      ) : (
                        <span className="caption" style={{ color: "#00B286", fontWeight: 600 }}>
                          ✓ {lang === "es" ? "Asignado" : "Assigned"}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "center", width: 56 }}>
                      <button className="btn btn-ghost btn-sm"
                              onClick={() => removeLine(l.tmpId)}
                              title={lang === "es" ? "Eliminar línea" : "Remove line"}
                              style={{
                                color: "#D64545",
                                padding: "6px 8px",
                                borderRadius: 6,
                              }}>
                        <IconTrash size={13}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Rev 2026-05-21g · Card IMPACTO EN CRÉDITO removida del PASO 2
          (mandato CEO). La banda y los descuentos del motor de precios
          haran la validacion comercial real; ese bloque rojo "EXCEDE
          LIMITE" ya no aplica en este paso. Se conserva el equivalente
          del PASO 3 (Resumen) por si quieres mantener la senial alli. */}

      {manualOpen && (
        <ManualLinePanel
          lang={lang}
          clientId={clientId}
          onClose={() => setManualOpen(false)}
          onAdd={(rows) => {
            setOrderLines((prev) => [
              ...prev,
              ...rows.map((r, i) => ({
                tmpId: `pl-m-${Date.now()}-${i}`,
                ...r,
              })),
            ]);
          }}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// ManualLinePanel + RequestAssignmentDialog viven ahora en
//   components/expedientes/ManualLineModal.jsx
// (Sprint 2026-05-06 · extraídos para reuso en ExpedienteDetail.jsx)
// ═════════════════════════════════════════════════════════════


// ═════════════════════════════════════════════════════════════
// STEP 3 · RESUMEN (sin financiero)
// ═════════════════════════════════════════════════════════════
/**
 * @typedef {Object} Step3Props
 * @property {string} lang
 * @property {object|null} client
 * @property {'mwt'|'client'} [operatingMode]
 * @property {string|null} [operatingCompanyId]
 * @property {Array<object>} orderLines
 * @property {Object<string, number>} [priceMap]
 * @property {object|null} creditProjection
 * @property {boolean} [isAdmin]
 * @property {number} paymentDays
 * @property {(d:number)=>void} setPaymentDays
 * @property {string} paymentMethod
 * @property {(m:string)=>void} setPaymentMethod
 */
/** @param {Step3Props} props */
function Step3Resumen({ lang, client, operatingMode = 'client', operatingCompanyId, orderLines, priceMap = {}, creditProjection, isAdmin = false, paymentDays, setPaymentDays, paymentMethod, setPaymentMethod }) {
  // ── Matriz dinámica de plazos por SKU (Sprint 2026-05-22) ─────────────
  // El backend (`/api/portal/products/sku_pricing_matrix/`) devuelve la
  // fila de plazos del snapshot Marluvas del cliente en la banda vigente
  // según el TC USD/BRL del día. Si el cliente tiene snapshot, usamos
  // esos plazos reales (pueden ser solo 90/60/30/8 o un subconjunto).
  // Si no hay snapshot, caemos al EARLY_PAYMENT_TIERS hardcoded.
  const { tc: tcUsdBrl } = useExchangeRateUSDBRL(getToken());
  // eslint-disable-next-line no-unused-vars
  const _bandaActiva = useMemo(() => bandaForTC(tcUsdBrl), [tcUsdBrl]);
  const [pricingMatrix, setPricingMatrix] = useState(null); // {tc, banda_id, results: {sku → matrix}}

  // SKUs únicos presentes en la OC (key estable para el effect).
  const skusInOrderKey = useMemo(() => {
    const set = new Set();
    orderLines.forEach(l => { if (l && l.sku) set.add(String(l.sku).trim()); });
    return Array.from(set).sort().join("|");
  }, [orderLines]);

  useEffect(() => {
    if (!client?.id || !skusInOrderKey) { setPricingMatrix(null); return; }
    let cancelled = false;
    const skus = skusInOrderKey.split("|").filter(Boolean);
    const params = new URLSearchParams();
    params.set("skus", skus.join(","));
    if (Number.isFinite(tcUsdBrl) && tcUsdBrl > 0) {
      params.set("tc", String(tcUsdBrl));
    }
    fetch(`/api/portal/products/sku_pricing_matrix/?${params.toString()}`, {
      headers: {
        "Authorization": `Bearer ${getToken()}`,
        "X-Portal-Client": String(client.id),
        "Content-Type": "application/json",
      },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data?.results) setPricingMatrix(data); })
      .catch(() => { /* fallback silencioso al EARLY_PAYMENT_TIERS hardcoded */ });
    return () => { cancelled = true; };
  }, [client?.id, skusInOrderKey, tcUsdBrl]);

  // dynamicTiers: derivados del snapshot del primer SKU con ok=true.
  // (Asumimos que todos los SKUs del mismo cliente comparten plazos —
  // se cumple en el motor de precios actual donde `custom_plazos` es
  // global por (cliente, marca), no por SKU.)
  const dynamicTiers = useMemo(() => {
    const results = pricingMatrix?.results;
    if (!results || typeof results !== "object") return null;
    const firstOk = Object.values(results).find(m => m && m.ok && Array.isArray(m.plazos) && m.plazos.length > 0);
    if (!firstOk) return null;
    return firstOk.plazos.map(p => ({
      days:     Number(p.dias),
      // EARLY_PAYMENT_TIERS usa pct positivo para descuento (2.75 → -2.75%);
      // el backend devuelve fracción relativa al base (-0.0275). Convertimos:
      //   descuento → pct positivo, recargo → pct negativo.
      pct:      -Number(p.pct) * 100,
      label_es: `${p.dias} días`,
      label_en: `${p.dias} days`,
      isBase:   Boolean(p.is_base),
      adminOnly: false,
      realPrice: Number(p.price),  // precio USD real del snapshot (debug/futuro)
    }));
  }, [pricingMatrix]);

  // Tiers efectivos para el render: dinámicos si hay snapshot, sino el hardcoded.
  const effectiveTiers = dynamicTiers && dynamicTiers.length > 0
    ? dynamicTiers
    : getAvailableTiers(isAdmin);

  const operatedByMwt = operatingMode === 'mwt';
  const totalUnits = orderLines.reduce((a, l) => a + Number(l.cantidad || 0), 0);
  // Agrupar por SKU para el resumen + acumular subtotales por SKU
  const bySku = {};
  orderLines.forEach((l) => {
    if (!bySku[l.sku]) {
      bySku[l.sku] = {
        sku: l.sku, label: l.product_label, tallas: [],
        producto_id: l.producto_id, subtotalValue: 0,
      };
    }
    bySku[l.sku].tallas.push({ talla: l.talla, cantidad: l.cantidad });
    const u = Number(priceMap[l.producto_id] || 0);
    bySku[l.sku].subtotalValue += u * Number(l.cantidad || 0);
  });
  const groups = Object.values(bySku);
  const totalValue = groups.reduce((a, g) => a + g.subtotalValue, 0);

  // Sprint 2026-05-22 · Precios reales del snapshot por plazo.
  // tierTotals[dias] = suma sobre TODOS los SKUs de la OC:
  //   precio_del_snapshot_al_plazo[sku] * cantidad_del_sku.
  // Esto reemplaza el cálculo legacy `totalValue * (1 - pct)` que usaba
  // el precio del priceMap (que viene de parse-template, no del snapshot
  // Marluvas). Si dynamicTiers es null (sin snapshot), tierTotals queda
  // null y el render cae al cálculo legacy.
  const tierTotals = useMemo(() => {
    if (!dynamicTiers || !pricingMatrix?.results) return null;
    // Unidades totales por SKU en la orden
    const unitsBySku = {};
    orderLines.forEach(l => {
      if (!l || !l.sku) return;
      const sku = String(l.sku).trim();
      unitsBySku[sku] = (unitsBySku[sku] || 0) + Number(l.cantidad || 0);
    });
    const totals = {};
    dynamicTiers.forEach(tier => {
      let total = 0;
      Object.entries(unitsBySku).forEach(([sku, units]) => {
        const matrix = pricingMatrix.results[sku];
        if (!matrix || !matrix.ok || !Array.isArray(matrix.plazos)) return;
        const plazo = matrix.plazos.find(p => Number(p.dias) === Number(tier.days));
        if (!plazo) return;
        total += Number(plazo.price) * Number(units);
      });
      totals[tier.days] = total;
    });
    return totals;
  }, [dynamicTiers, pricingMatrix, orderLines]);

  // baseTier del effectiveTiers (plazo base, ej. 90d).
  const _baseTierGlobal = effectiveTiers.find(t => t.isBase) || effectiveTiers[0];
  // effectiveBaseTotal: total al plazo base usando snapshot si existe.
  // Es el reemplazo honesto del totalValue cuando hay snapshot.
  const effectiveBaseTotal = (tierTotals && _baseTierGlobal)
    ? (tierTotals[_baseTierGlobal.days] ?? totalValue)
    : totalValue;

  // Sprint 2026-05-06 · valor ajustado por el tier de pronto pago.
  // El "VALOR DEL PEDIDO" del bloque IMPACTO EN CRÉDITO refleja el
  // total con el descuento aplicado del plazo seleccionado.
  // Sprint 2026-05-22 · buscar en effectiveTiers (dinámicos del snapshot
  // del cliente cuando existen; fallback hardcoded sino).
  const selectedTier = effectiveTiers.find(
    t => t.days === Number(paymentDays)
  ) || _baseTierGlobal;
  const tierPct = selectedTier ? selectedTier.pct / 100 : 0;
  // Si hay tierTotals (snapshot), usamos el total real del plazo seleccionado.
  // Sino, fallback al cálculo legacy proporcional.
  const adjustedTotalValue = (tierTotals && selectedTier)
    ? (tierTotals[selectedTier.days] ?? effectiveBaseTotal)
    : (totalValue * (1 - tierPct));

  return (
    <div className="card card-pad-lg">
      <h2 className="heading-md" style={{ marginBottom: 14 }}>
        {lang === "es" ? "Paso 3 · Revisar y crear" : "Step 3 · Review & create"}
      </h2>

      {/* Cliente */}
      <div style={{ padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
          <div className="micro" style={{ color: "var(--brand-accent, #00B286)", letterSpacing: 1 }}>
            {lang === "es" ? "CLIENTE" : "CLIENT"}
          </div>
          {isAdmin && operatedByMwt && (
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
              padding: '3px 10px', borderRadius: 999,
              background: 'rgba(72,30,227,0.10)',
              color: 'var(--brand-accent-2, #481EE3)',
              border: '1px solid rgba(72,30,227,0.30)',
              textTransform: 'uppercase',
            }}>
              {lang === 'es' ? `Operado por ${MWT_OPERATOR_NAME}` : `Operated by ${MWT_OPERATOR_NAME}`}
            </span>
          )}
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary, #0B1E3A)",
                      display: "flex", alignItems: "center", gap: 8 }}>
          {client?.parent_id && (
            <span style={{ color: "var(--brand-accent, #00B286)", fontWeight: 800 }}>↳</span>
          )}
          {client?.label}
        </div>
        <div className="caption" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
          {client?.tax_id && <>RUC/CUIT <code className="mono-sm">{client.tax_id}</code></>}
          {client?.parent_label && (
            <> · <span style={{ color: "var(--brand-accent, #00B286)" }}>hija de {client.parent_label}</span></>
          )}
        </div>
      </div>

      {/* Productos */}
      <div className="micro" style={{ color: "#00B286", letterSpacing: 1, marginBottom: 8 }}>
        {lang === "es" ? "PRODUCTOS" : "PRODUCTS"} · {orderLines.length} {lang === "es" ? "líneas" : "lines"} · <strong>{totalUnits}</strong> {lang === "es" ? "unidades" : "units"}
      </div>
      <div className="card card-pad-0">
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>{lang === "es" ? "Producto" : "Product"}</th>
              <th>{lang === "es" ? "Tallas y cantidades" : "Sizes & quantities"}</th>
              <th style={{ textAlign: "right" }}>{lang === "es" ? "Total uds." : "Total qty"}</th>
              {isAdmin && <th style={{ textAlign: "right" }}>{lang === "es" ? "Valor" : "Value"}</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const totalSku = g.tallas.reduce((a, t) => a + Number(t.cantidad || 0), 0);
              return (
                <tr key={g.sku}>
                  <td className="mono-sm">{g.sku}</td>
                  <td>{g.label || "—"}</td>
                  <td>
                    {g.tallas.map((t, i) => (
                      <span key={i} style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 999,
                        background: "rgba(0,178,134,0.08)", color: "#0B1E3A",
                        fontSize: 11, fontWeight: 600, marginRight: 4, marginBottom: 4,
                      }}>
                        {t.talla || "—"}: <strong className="tabular-nums">{t.cantidad}</strong>
                      </span>
                    ))}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#0B1E3A" }}>
                    {totalSku}
                  </td>
                  {isAdmin && (
                    <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700, color: "#0B1E3A" }}>
                      {g.subtotalValue > 0
                        ? `$${g.subtotalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>—</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sprint 2026-05-03 v3.9 · Total separado en barra propia.
          Antes vivía como <tfoot>, pero al tener colSpan + columnas con
          chips de talla se veía descolgado del eje vertical de la columna
          'Valor'. Lo sacamos a un bloque hermano con grid 2-col que se
          alinea limpio al borde derecho del card. */}
      {isAdmin && totalValue > 0 && (
        <div style={{
          marginTop: 10,
          padding: "12px 16px",
          background: "rgba(0,178,134,0.06)",
          border: "1px solid rgba(0,178,134,0.18)",
          borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12,
        }}>
          <span style={{
            color: "var(--text-tertiary)", fontWeight: 600,
            textTransform: "uppercase", fontSize: 11, letterSpacing: 0.6,
          }}>
            {lang === "es" ? "Valor total del pedido" : "Order total value"}
          </span>
          <span className="tabular-nums" style={{
            fontWeight: 800, color: "#00B286", fontSize: 18,
          }}>
            ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      {/* Sprint 2026-05-06 · TÉRMINOS DE PAGO ────────────────────────────── */}
      {client && (
        <div style={{
          marginTop: 14,
          padding: "14px 16px",
          borderRadius: 10,
          background: "#F7F9FC",
          border: "1px solid #E1E6ED",
        }}>
          <div className="micro" style={{
            color: "#0B1E3A", letterSpacing: 1, fontWeight: 700, marginBottom: 12,
          }}>
            {lang === "es" ? "TÉRMINOS DE PAGO" : "PAYMENT TERMS"}
          </div>

          {/* ── Fila superior: Plazo de pago del expediente + Forma de pago ── */}
          {/* Sprint 2026-05-10 · FIX: este campo debe reflejar el plazo
              SELECCIONADO en las cards de pronto pago (paymentDays), NO
              el dias_credito default del cliente. El cliente trae un
              dias_credito por defecto que se usa solo como sugerencia
              inicial al elegir cliente — una vez que el ADMIN clickea
              otra card de pronto pago, este campo debe seguir esa
              selección. Etiqueta cambiada de 'Días crédito (cliente)'
              a 'Plazo de pago' para reflejar la semántica del campo
              (es el plazo de ESTE expediente, no el del cliente). */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14,
          }}>
            <div>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)",
                letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4,
              }}>
                {lang === "es" ? "Plazo de pago" : "Payment terms"}
              </div>
              <div className="tabular-nums" style={{
                fontSize: 16, fontWeight: 700, color: "#0B1E3A", padding: "8px 0",
              }}>
                {Number(paymentDays || 0)} {lang === "es" ? "días" : "days"}
                {Number(client?.dias_credito || 0) > 0
                 && Number(paymentDays || 0) !== Number(client.dias_credito || 0) && (
                  <span style={{
                    marginLeft: 8, fontSize: 11, fontWeight: 500,
                    color: "var(--text-tertiary)",
                  }}>
                    · {lang === "es"
                        ? `cliente: ${Number(client.dias_credito)}d default`
                        : `client: ${Number(client.dias_credito)}d default`}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)",
                letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4,
              }}>
                {lang === "es" ? "Forma de pago" : "Payment method"}
                <span style={{ color: "var(--critical)", marginLeft: 4 }}>*</span>
              </div>
              {/* Sprint Commit 9 · obligatorio. Mientras no se elija, el
                  wizard mantiene canAdvance=false en el paso 3 (Resumen)
                  y el botón "Crear" queda deshabilitado. Cerramos el loop
                  EXPEDIENTE_TERMS_UNDEFINED en liberación de crédito. */}
              <select
                className="input"
                value={paymentMethod}
                onChange={(e) => {
                  // Sprint 2026-05-06 · CONTADO y plazo son dimensiones
                  // ortogonales. Un pedido puede ser CONTADO a 30 días
                  // con descuento. Solo cambiamos paymentMethod; el plazo
                  // sigue siendo el que el usuario elija en las cards.
                  setPaymentMethod(e.target.value);
                }}
                style={{
                  fontWeight: 700,
                  borderColor: paymentMethod ? undefined : "var(--critical)",
                }}
                required
              >
                <option value="" disabled>
                  {lang === "es" ? "— Selecciona —" : "— Select —"}
                </option>
                <option value="CREDITO">{lang === "es" ? "Crédito" : "Credit"}</option>
                <option value="CONTADO">{lang === "es" ? "Contado" : "Cash"}</option>
              </select>
              {!paymentMethod && (
                <div style={{
                  marginTop: 4, fontSize: 11, fontWeight: 500,
                  color: "var(--critical)",
                }}>
                  {lang === "es"
                    ? "Requerido — sin forma de pago no se podrá liberar crédito."
                    : "Required — without payment method credit cannot be released."}
                </div>
              )}
            </div>
          </div>

          {paymentMethod === "CONTADO" && (
            <div style={{
              marginTop: 12,
              padding: "8px 12px", borderRadius: 6,
              background: "rgba(0,178,134,0.10)",
              color: "#00875A", fontSize: 12, fontWeight: 600,
            }}>
              {lang === "es"
                  ? "Pago al contado · sin impacto en crédito"
                  : "Cash payment · no credit impact"}
            </div>
          )}
        </div>
      )}

      {/* ── PROPUESTA — DESCUENTO POR PRONTO PAGO ─────────────────────────── */}
      {/* Sprint 2026-05-06 · cards horizontales con descuento por plazo.
          90 días = base (plazo actual de la PO). Plazos cortos = descuento %.
          120 días = recargo (solo admin). El usuario hace click en una card
          y se actualiza paymentDays. Visible solo cuando hay líneas con
          totalValue > 0 (necesario para calcular ahorro). */}
      {client && totalValue > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="micro" style={{
            color: "#0B1E3A", letterSpacing: 1, fontWeight: 700,
            marginBottom: 10, padding: "0 4px",
          }}>
            {lang === "es"
              ? "PROPUESTA — DESCUENTO POR PRONTO PAGO"
              : "PROPOSAL — EARLY-PAYMENT DISCOUNT"}
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${effectiveTiers.length}, minmax(0, 1fr))`,
            gap: 10,
          }}>
            {effectiveTiers.map((tier) => {
              const isSelected   = Number(paymentDays) === tier.days;
              const tierDiscount = tier.pct / 100;
              const baseTier     = effectiveTiers.find(t => t.isBase) || effectiveTiers[0];
              // Sprint 2026-05-22 · Si hay snapshot del cliente, tierTotal y
              // baseTotal salen de los precios reales por plazo. Sino,
              // fallback al cálculo proporcional legacy.
              const tierTotal    = tierTotals && tierTotals[tier.days] != null
                ? tierTotals[tier.days]
                : totalValue * (1 - tierDiscount);
              const baseTotal    = tierTotals && baseTier && tierTotals[baseTier.days] != null
                ? tierTotals[baseTier.days]
                : totalValue * (1 - (baseTier ? baseTier.pct/100 : 0));
              const tierUnit     = totalUnits > 0 ? tierTotal / totalUnits : 0;
              const ahorro       = baseTotal - tierTotal;

              const fmt = (v) => `$${Number(v || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}`;

              return (
                <button
                  key={tier.days}
                  type="button"
                  onClick={() => setPaymentDays(tier.days)}
                  style={{
                    textAlign: "left",
                    padding: "14px 14px",
                    borderRadius: 10,
                    cursor: "pointer",
                    background: isSelected ? "rgba(0,178,134,0.08)" : "#fff",
                    border: isSelected
                      ? "2px solid #00B286"
                      : "1px solid #E1E6ED",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{
                    fontSize: 11, fontWeight: 800,
                    color: "var(--text-tertiary)", letterSpacing: 0.6,
                    textTransform: "uppercase", marginBottom: 6,
                  }}>
                    {lang === "es" ? tier.label_es : tier.label_en}
                  </div>
                  <div className="tabular-nums" style={{
                    fontSize: 22, fontWeight: 800, marginBottom: 8,
                    color: tier.isBase
                      ? "var(--text-tertiary)"
                      : (tier.pct > 0 ? "#00875A" : "#B45309"),
                  }}>
                    {tier.isBase
                      ? (lang === "es" ? "base" : "base")
                      : (tier.pct > 0
                          ? `−${tier.pct.toFixed(2)}%`
                          : `+${Math.abs(tier.pct).toFixed(2)}%`)}
                  </div>
                  <div className="tabular-nums" style={{
                    fontSize: 16, fontWeight: 700, color: "#0B1E3A",
                  }}>
                    {fmt(tierUnit)}
                  </div>
                  <div style={{
                    fontSize: 10, color: "var(--text-tertiary)", marginBottom: 8,
                  }}>
                    {lang === "es" ? "por par" : "per pair"}
                  </div>
                  <div style={{
                    height: 1, background: "#E1E6ED", margin: "6px 0",
                  }}/>
                  <div className="tabular-nums" style={{
                    fontSize: 13, fontWeight: 700, color: "#0B1E3A",
                  }}>
                    {fmt(tierTotal)}
                  </div>
                  <div style={{
                    fontSize: 10,
                    color: tier.isBase
                      ? "var(--text-tertiary)"
                      : (tier.pct > 0 ? "#00875A" : "#B45309"),
                    fontWeight: 600, marginTop: 2,
                  }}>
                    {tier.isBase
                      ? (lang === "es" ? "Plazo actual PO" : "Current PO term")
                      : (tier.pct > 0
                          ? (lang === "es" ? `Ahorro ${fmt(ahorro)}`   : `Savings ${fmt(ahorro)}`)
                          : (lang === "es" ? `Recargo ${fmt(Math.abs(ahorro))}` : `Surcharge ${fmt(Math.abs(ahorro))}`))}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{
            marginTop: 10, padding: "8px 12px", borderRadius: 6,
            background: "rgba(0,178,134,0.06)",
            border: "1px solid rgba(0,178,134,0.18)",
            fontSize: 11, color: "#0B1E3A", lineHeight: 1.45,
          }}>
            <strong>{lang === "es" ? "Pronto pago:" : "Early payment:"}</strong>{" "}
            {lang === "es"
              ? "el descuento se aplica sobre el total facturado al confirmar el plazo de pago elegido. Plazo se cuenta desde la fecha de factura en destino. Sujeto a aprobación de crédito y disponibilidad de stock."
              : "discount applies to the total invoiced upon confirming the chosen payment term. Term counted from the destination invoice date. Subject to credit approval and stock availability."}
          </div>
        </div>
      )}

      {/* ── Sprint 2026-05-01: Impacto en credito (CEO-only) ── */}
      {/* Sprint 2026-05-06: ocultar si forma_pago = CONTADO */}
      {paymentMethod !== "CONTADO" && isAdmin && creditProjection && creditProjection.limit > 0 && orderLines.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <CreditProjectionCard cp={creditProjection} lang={lang} adjustedOrderValue={adjustedTotalValue}/>
        </div>
      )}

      {/* Aviso de qué falta */}
      <div style={{
        marginTop: 18, padding: "12px 14px", borderRadius: 8,
        background: "rgba(48,131,254,0.06)", border: "1px solid rgba(48,131,254,0.20)",
        fontSize: 13, color: "#0B1E3A",
      }}>
        <IconLock size={11} style={{ verticalAlign: -1, marginRight: 6, color: "#3083FE" }}/>
        {lang === "es"
          ? "Este expediente nacerá en estado REGISTRO. Marca, moneda y modo de operación se completarán después en el detalle (operativa/comercial)."
          : "This file will start in REGISTRO. Brand, currency and operation mode are filled later in the detail view."}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════

// Sprint 2026-05-06 · matriz de descuento por pronto pago (waterfall).
// Valores canónicos del catálogo COMEX 2025 v6 (commercial.early_payment_tier
// es la fuente de verdad oficial; aquí los hardcodeamos como fallback
// estable mientras el endpoint /api/commercial/early-payment-tiers/ no
// se enchufa al wizard. Cuando se haga el fetch real, este array se
// reemplaza por el response del backend).
//
// 90 días = base (0% descuento, plazo "estándar" de la PO).
// 120 días = recargo financiero — solo ADMIN puede ofrecerlo.
const EARLY_PAYMENT_TIERS = [
  { days: 8,   pct: 2.75, label_es: "8 días",   label_en: "8 days",   isBase: false, adminOnly: false },
  { days: 30,  pct: 1.75, label_es: "30 días",  label_en: "30 days",  isBase: false, adminOnly: false },
  { days: 60,  pct: 1.00, label_es: "60 días",  label_en: "60 days",  isBase: false, adminOnly: false },
  { days: 90,  pct: 0.00, label_es: "90 días",  label_en: "90 days",  isBase: true,  adminOnly: false },
  { days: 120, pct: -1.00, label_es: "120 días", label_en: "120 days", isBase: false, adminOnly: true  },
];

// Devuelve los tiers visibles según el rol y la moneda del pedido.
// El parámetro `commissionPct` es informativo (cliente VIP con comisión >0
// se considera "premium" y obtiene el tier 120; default sigue las flags).
function getAvailableTiers(isAdmin) {
  return EARLY_PAYMENT_TIERS.filter(t => isAdmin || !t.adminOnly);
}

function adaptClient(c) {
  return {
    id:              c.id,
    label:           c.razon_social || c.nombre_comercial || "—",
    razon_social:    c.razon_social,
    tax_id:          c.tax_id,
    parent_id:       c.parent_id || null,
    parent_label:    null,
    contacto_email:  c.contacto_email,
    credito_limit:   Number(c.credito_aprobado || c.credito_limit_usd || 0),
    credito_used:    Number(c.credito_usado || 0),
    // Sprint 2026-05-06 · días de crédito por defecto del cliente.
    // El wizard lo usa como default del input 'Días de pago' del Paso 3.
    dias_credito:    Number(c.dias_credito || 0),
  };
}

function orderClientsHierarchy(clients) {
  const out = []; const seen = new Set();
  clients.filter((c) => !c.parent_id).forEach((parent) => {
    out.push(parent); seen.add(parent.id);
    clients.filter((c) => c.parent_id === parent.id).forEach((sub) => {
      out.push({ ...sub, parent_label: parent.label });
      seen.add(sub.id);
    });
  });
  clients.forEach((c) => { if (!seen.has(c.id)) out.push(c); });
  return out;
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{
        display: "block", fontSize: 11, fontWeight: 700,
        color: "var(--text-tertiary)", letterSpacing: 0.4,
        textTransform: "uppercase", marginBottom: 6,
      }}>{label}</span>
      {children}
    </label>
  );
}

// ═════════════════════════════════════════════════════════════
// CREDIT PROJECTION CARD — visualizacion del impacto del pedido en
// el credito disponible del cliente. Sprint 2026-05-01.
// ═════════════════════════════════════════════════════════════
function CreditProjectionCard({ cp, lang, adjustedOrderValue }) {
  // Sprint 2026-05-06 · si llega adjustedOrderValue (tier de pronto pago),
  // recalculamos los derivados sobre la base ajustada para que el bloque
  // refleje el efecto del descuento elegido en el wizard.
  if (typeof adjustedOrderValue === "number" && !isNaN(adjustedOrderValue)) {
    const limit = Number(cp.limit) || 0;
    const used  = Number(cp.used) || 0;
    const newAfter = limit - used - adjustedOrderValue;
    const newUtil  = limit > 0
      ? Math.max(0, ((used + adjustedOrderValue) / limit) * 100)
      : 0;
    cp = {
      ...cp,
      afterAvailable: newAfter,
      utilPctAfter:   Math.round(newUtil * 10) / 10,
      exceedsLimit:   limit > 0 && newAfter < 0,
    };
  }
  const tone = cp.exceedsLimit ? "red"
             : cp.utilPctAfter >= 85 ? "red"
             : cp.utilPctAfter >= 70 ? "amber" : "green";
  const colorMap = {
    green: { bar: "#00B286", text: "#0B1E3A", bg: "rgba(0,178,134,0.06)", border: "rgba(0,178,134,0.30)" },
    amber: { bar: "#F59E0B", text: "#92400E", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.40)" },
    red:   { bar: "#DC2626", text: "#991B1B", bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.40)" },
  };
  const c = colorMap[tone];
  const fmt = (v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div style={{
      marginTop: 14,
      padding: "14px 16px",
      borderRadius: 10,
      background: c.bg,
      border: `1px solid ${c.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                     marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
        <div className="micro" style={{ color: c.text, letterSpacing: 1, fontWeight: 700 }}>
          {lang === "es" ? "IMPACTO EN CRÉDITO DEL CLIENTE" : "CLIENT CREDIT IMPACT"}
        </div>
        {cp.exceedsLimit && (
          <span style={{
            padding: "3px 10px", borderRadius: 999,
            background: "#DC2626", color: "#fff",
            fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
          }}>
            {lang === "es" ? "EXCEDE LÍMITE" : "EXCEEDS LIMIT"}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
        <Stat label={lang === "es" ? "Límite total" : "Total limit"} value={fmt(cp.limit)}/>
        <Stat label={lang === "es" ? "Uso actual" : "Current used"} value={fmt(cp.used)}/>
        <Stat label={lang === "es" ? "Valor del pedido" : "Order value"} value={fmt(cp.orderValue)} accent="#00B286"/>
        <Stat
          label={lang === "es" ? "Disponible después" : "After order"}
          value={fmt(cp.afterAvailable)}
          accent={cp.afterAvailable < 0 ? "#DC2626" : c.text}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between",
                       fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4 }}>
          <span>
            {lang === "es" ? "Utilización proyectada" : "Projected utilization"}
          </span>
          <span className="tabular-nums" style={{ fontWeight: 700, color: c.text }}>
            {cp.utilPctAfter}% {cp.exceedsLimit && "(>100%)"}
          </span>
        </div>
        <div style={{ height: 8, background: "#E1E6ED", borderRadius: 4, overflow: "hidden", position: "relative" }}>
          <div style={{
            height: "100%",
            width: `${Math.min(100, cp.utilPctAfter)}%`,
            background: c.bar,
            transition: "width 0.18s ease",
          }}/>
          {cp.exceedsLimit && (
            <div style={{
              position: "absolute", top: 0, right: 0, height: "100%",
              width: 4, background: "#7F1D1D",
            }}/>
          )}
        </div>
      </div>

      {cp.exceedsLimit && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#991B1B", fontWeight: 600 }}>
          ⚠ {lang === "es"
              ? "Este pedido excede el límite de crédito del cliente. Revisa con CEO antes de continuar."
              : "This order exceeds the client credit limit. Review with CEO before continuing."}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700,
        color: "var(--text-tertiary)", letterSpacing: 0.6,
        textTransform: "uppercase", marginBottom: 4,
      }}>{label}</div>
      <div className="tabular-nums" style={{
        fontSize: 15, fontWeight: 700,
        color: accent || "#0B1E3A",
      }}>{value}</div>
    </div>
  );
}

function Toast({ kind = "ok", msg, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [onClose]);
  const colors = {
    ok:   { bg: "rgba(0,178,134,0.10)",  border: "rgba(0,178,134,0.40)", color: "#00B286" },
    warn: { bg: "rgba(180,83,9,0.10)",   border: "rgba(180,83,9,0.40)",  color: "#92400E" },
    err:  { bg: "rgba(214,69,69,0.10)",  border: "rgba(214,69,69,0.40)", color: "#991B1B" },
  };
  const s = colors[kind] || colors.ok;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 200,
      padding: "12px 18px", borderRadius: 10,
      background: s.bg, border: `1px solid ${s.border}`,
      color: s.color, fontWeight: 600, fontSize: 13,
      boxShadow: "0 10px 30px rgba(11,30,58,0.20)",
      maxWidth: 380,
    }}>{msg}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// EOF · CreateExpedienteWizardLite
// ─────────────────────────────────────────────────────────────
