// ─────────────────────────────────────────────────────────────
// pages/Cobros.jsx — Cobros
//
// Contexto (2026-11-09): `cobros.cobro` está vacía en producción y
// mwt.one no guarda fecha de vencimiento por pedido. La pantalla anterior
// mostraba cuatro ceros y una cartera "en mora" que se inventaba con un hash
// del id del expediente. Eso se eliminó.
//
// Ahora la pantalla muestra lo que sí existe y es verificable: el saldo de
// cada pedido (facturado - pagado, calculado por el backend) separado por
// modo de operación.
//   · Reventa: la deuda es de MWT (el cliente le paga a MWT).
//   · Comisión: la factura la cobra Marluvas; MWT cobra su comisión.
// La antigüedad de cartera no se muestra porque no hay fecha de vencimiento
// real en la base. Cuando exista, se agrega.
// ─────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { clientesApi, expedientesApi } from "../lib/api.js";

const money = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return "-";
  return `USD ${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
};

const rowsOf = (r) => (Array.isArray(r) ? r : (r?.results || []));

export default function ScreenCobros() {
  const { lang } = useOutletContext();
  const es = lang !== "en";
  const navigate = useNavigate();

  const [exps, setExps] = useState([]);
  const [clientes, setClientes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [negocio, setNegocio] = useState("todos");
  const [estado, setEstado] = useState("todos");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const safe = (p) => p.catch(() => null);
    const [e, cli] = await Promise.all([safe(expedientesApi.list()), safe(clientesApi.list())]);
    if (!e) {
      setError(es ? "No se pudieron cargar los pedidos." : "Could not load orders.");
      setLoading(false);
      return;
    }
    setExps(rowsOf(e));
    const map = {};
    rowsOf(cli).forEach((x) => { map[x.id] = x.razon_social || x.nombre_comercial || ""; });
    setClientes(map);
    setLoading(false);
  }, [es]);
  useEffect(() => { load(); }, [load]);

  const conSaldo = useMemo(() => {
    return (exps || [])
      .filter((e) => Number(e.balance) > 0)
      .map((e) => ({
        ...e,
        _saldo: Number(e.balance),
        _facturado: Number(e.total_invoiced || 0),
        _pagado: Number(e.total_paid || 0),
        _reventa: (e.modo_operacion || "").toUpperCase() === "FULL",
      }))
      .sort((a, b) => b._saldo - a._saldo);
  }, [exps]);

  const kpis = useMemo(() => {
    const reventa = conSaldo.filter((e) => e._reventa);
    const comision = conSaldo.filter((e) => !e._reventa);
    return {
      reventa: reventa.reduce((s, e) => s + e._saldo, 0),
      nReventa: reventa.length,
      comision: comision.reduce((s, e) => s + e._saldo, 0),
      nComision: comision.length,
      facturado: conSaldo.reduce((s, e) => s + e._facturado, 0),
    };
  }, [conSaldo]);

  const visibles = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conSaldo.filter((e) => {
      if (negocio === "reventa" && !e._reventa) return false;
      if (negocio === "comision" && e._reventa) return false;
      if (estado !== "todos" && (e.estado || "") !== estado) return false;
      if (!needle) return true;
      const pf = ((e.proforma_codigos || [])[0] || e.codigo || "").toLowerCase();
      const cli = (e.client_name || clientes[e.client_id] || "").toLowerCase();
      return pf.includes(needle) || cli.includes(needle);
    });
  }, [conSaldo, negocio, estado, q, clientes]);

  const estados = useMemo(
    () => Array.from(new Set(conSaldo.map((e) => e.estado).filter(Boolean))).sort(),
    [conSaldo]
  );

  const abrir = (e) => {
    if (e.oc_id) navigate(`/expedientes/${e.oc_id}`);
    else navigate("/expedientes");
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{ marginBottom: 6 }}>{es ? "MÓDULO" : "MODULE"}</div>
          <h1 className="page-title">{es ? "Cobros" : "Collections"}</h1>
          <div className="page-subtitle">
            {es
              ? "Saldo real por pedido (facturado menos pagado). La antigüedad no se muestra porque mwt.one todavía no guarda fecha de vencimiento."
              : "Real balance per order (invoiced minus paid). Aging is not shown because mwt.one does not store a due date yet."}
          </div>
        </div>
      </div>

      {loading && (
        <div className="card card-pad-lg" style={{ color: "var(--text-tertiary)" }}>
          {es ? "Cargando…" : "Loading…"}
        </div>
      )}

      {!loading && error && (
        <div className="card card-pad-lg" role="alert" style={{ color: "var(--critical)" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{es ? "No se pudo cargar" : "Load failed"}</div>
          <div className="micro" style={{ color: "var(--text-secondary)" }}>{error}</div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={load}>
            {es ? "Reintentar" : "Retry"}
          </button>
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div className="card card-pad-lg">
              <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "POR COBRAR (REVENTA)" : "RECEIVABLE (RESALE)"}</div>
              <div className="tabular-nums" style={{ font: "800 24px/1.1 var(--font-display)", marginTop: 4 }}>{money(kpis.reventa)}</div>
              <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
                {kpis.nReventa} {es ? "pedidos · los cobra MWT" : "orders · collected by MWT"}
              </div>
            </div>
            <div className="card card-pad-lg">
              <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "COMISIÓN (MARLUVAS)" : "COMMISSION (MARLUVAS)"}</div>
              <div className="tabular-nums" style={{ font: "800 24px/1.1 var(--font-display)", marginTop: 4, color: "var(--text-secondary)" }}>
                {money(kpis.comision)}
              </div>
              <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
                {kpis.nComision} {es ? "pedidos · la factura la cobra Marluvas" : "orders · invoiced by Marluvas"}
              </div>
            </div>
            <div className="card card-pad-lg">
              <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "PEDIDOS CON SALDO" : "ORDERS WITH BALANCE"}</div>
              <div className="tabular-nums" style={{ font: "800 24px/1.1 var(--font-display)", marginTop: 4 }}>{conSaldo.length}</div>
              <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
                {es ? "de" : "of"} {exps.length} {es ? "expedientes" : "files"}
              </div>
            </div>
            <div className="card card-pad-lg">
              <div className="micro" style={{ color: "var(--text-tertiary)" }}>{es ? "FACTURADO SIN COBRAR" : "INVOICED, NOT COLLECTED"}</div>
              <div className="tabular-nums" style={{ font: "800 24px/1.1 var(--font-display)", marginTop: 4 }}>{money(kpis.facturado)}</div>
              <div className="micro" style={{ color: "var(--text-tertiary)", marginTop: 4 }}>
                {es ? "suma de las dos columnas" : "sum of both columns"}
              </div>
            </div>
          </div>

          <div className="card card-pad-lg">
            <div className="flex ai-center jc-between" style={{ gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div className="caption" style={{ color: "var(--text-tertiary)", fontWeight: 800, letterSpacing: ".04em" }}>
                {es ? "SALDO POR PEDIDO" : "BALANCE BY ORDER"}
              </div>
              <div className="flex ai-center" style={{ gap: 8, flexWrap: "wrap" }}>
                <input
                  className="input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={es ? "Proforma o cliente" : "Proforma or client"}
                  style={{ minWidth: 200 }}
                />
                <select className="select" value={negocio} onChange={(e) => setNegocio(e.target.value)}>
                  <option value="todos">{es ? "Todo negocio" : "All business"}</option>
                  <option value="reventa">{es ? "Reventa" : "Resale"}</option>
                  <option value="comision">{es ? "Comisión" : "Commission"}</option>
                </select>
                <select className="select" value={estado} onChange={(e) => setEstado(e.target.value)}>
                  <option value="todos">{es ? "Todo estado" : "All states"}</option>
                  {estados.map((x) => <option key={x} value={x}>{x}</option>)}
                </select>
              </div>
            </div>

            {visibles.length === 0 ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: 13, padding: "16px 4px" }}>
                {conSaldo.length === 0
                  ? (es ? "Ningún pedido tiene saldo pendiente." : "No order has an open balance.")
                  : (es ? "Ningún pedido coincide con el filtro." : "No order matches the filter.")}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      {[es ? "Proforma" : "Proforma", es ? "Cliente" : "Client", es ? "Negocio" : "Business",
                        es ? "Estado" : "State", es ? "Facturado" : "Invoiced", es ? "Pagado" : "Paid",
                        es ? "Saldo" : "Balance"].map((h) => (
                        <th key={h} style={{ textAlign: h === "Saldo" || h === "Facturado" || h === "Pagado" ? "right" : "left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((e) => (
                      <tr key={e.id} onClick={() => abrir(e)} style={{ cursor: "pointer" }}>
                        <td style={{ fontWeight: 700 }}>{(e.proforma_codigos || [])[0] || e.codigo || "-"}</td>
                        <td>{e.client_name || clientes[e.client_id] || "-"}</td>
                        <td>{e._reventa ? (es ? "Reventa" : "Resale") : (es ? "Comisión" : "Commission")}</td>
                        <td>{e.estado || "-"}</td>
                        <td className="tabular-nums" style={{ textAlign: "right" }}>{money(e._facturado)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right", color: "var(--text-tertiary)" }}>{money(e._pagado)}</td>
                        <td className="tabular-nums" style={{ textAlign: "right", fontWeight: 700 }}>{money(e._saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
