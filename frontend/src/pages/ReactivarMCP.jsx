// =====================================================================
// MWT.ONE · pages/ReactivarMCP.jsx
// Reactivación de un usuario INACTIVO para acceder al MCP (Fase 2/7).
//
// El usuario inactivo llega desde el email (link a /reactivar-mcp) o directo.
// Pide: email, nombre, teléfono, empresa (con MCP) y motivo. NO activa la
// cuenta: queda PENDIENTE y un admin la aprueba desde /registro-solicitudes.
//
// Endpoints:
//   GET  /api/onboarding/clientes?q=…
//   POST /api/onboarding/reactivacion
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api.js";

const LOGO_URL = "https://mwt.one/images/2024/12/04/recurso-1logo_foot.png";

const PAISES = [["CR", "Costa Rica"], ["GT", "Guatemala"]];
const PAGE = {
  minHeight: "100vh", color: "#E8EEF5", fontFamily: "var(--font-display)",
  background: "radial-gradient(ellipse at center, #0E253C 0%, #081623 55%, #050E18 100%)",
  display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center", padding: "32px 16px",
};
const CARD = {
  width: "min(860px, calc(100vw - 32px))", padding: "34px 38px 30px",
  background: "rgba(13,30,48,0.92)", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 18, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
  backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
  maxHeight: "92vh", overflowY: "auto",
};
const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "18px 18px" };
const FULL = { gridColumn: "1 / -1" };
const INPUT = { width: "100%", height: 46, padding: "0 14px", background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#F5F8FC",
  fontSize: 14, fontFamily: "var(--font-display)", boxSizing: "border-box" };
const SELECT = { ...INPUT };
const TEXTAREA = { ...INPUT, height: 92, paddingTop: 10, resize: "vertical" };

function Field({ label, children, full }) {
  return (
    <div className="login-field" style={full ? FULL : undefined}>
      <label className="login-label">{label}</label>
      {children}
    </div>
  );
}

export default function ReactivarMCP() {
  const [form, setForm] = useState({ email: "", full_name: "", phone: "", motivo: "" });
  const [empresa, setEmpresa] = useState(null);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => { document.title = "MWT ONE · Reactivar acceso MCP"; }, []);

  useEffect(() => {
    if (empresa) return;
    const qq = q.trim();
    if (qq.length < 2) { setOptions([]); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch(`/onboarding/clientes?q=${encodeURIComponent(qq)}`);
        if (alive) setOptions(Array.isArray(data) ? data : (data?.results || []));
      } catch { if (alive) setOptions([]); }
      finally { if (alive) setSearching(false); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q, empresa]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pickEmpresa = (c) => { setEmpresa(c); setQ(""); setOptions([]); setOpenList(false); };

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validEmail) return setError("Ingresa un correo válido.");
    if (!empresa) return setError("Selecciona tu empresa de la lista.");
    if (!form.full_name.trim()) return setError("Escribe tu nombre completo.");
    if (!form.motivo.trim()) return setError("Indica el motivo de la reactivación.");
    setSubmitting(true);
    try {
      await apiFetch("/onboarding/reactivacion", {
        method: "POST",
        body: {
          email: form.email.trim(), full_name: form.full_name.trim(),
          phone: form.phone.trim(), cliente_id: empresa.id, motivo: form.motivo.trim(),
        },
      });
      setDone(true);
    } catch (err) {
      const detail = err?.payload?.detail || err?.message || "No se pudo enviar la solicitud.";
      setError(typeof detail === "string" ? detail : "No se pudo enviar la solicitud.");
    } finally { setSubmitting(false); }
  };

  const logo = (
    <img src={LOGO_URL} alt="MWT ONE" className="login-logo"
         onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
  );

  if (done) {
    return (
      <div style={PAGE}>
        <div style={CARD}>
          <div className="login-brand">{logo}</div>
          <div className="login-tagline">Solicitud enviada</div>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, textAlign: "center" }}>
            Gracias, <b style={{ color: "#1DE394" }}>{form.full_name.trim()}</b>. Tu solicitud de
            reactivación {empresa ? <>para <b style={{ color: "#1DE394" }}>{empresa.razon_social}</b></> : null}
            quedó <b>pendiente de aprobación</b>.
          </p>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
            Un administrador revisará la solicitud. Al activarla, recibirás un correo con tus
            credenciales MCP.
          </p>
          <div style={{ textAlign: "center", marginTop: 18 }}>
            <Link to="/login" className="login-submit" style={{ textDecoration: "none", display: "inline-flex",
              alignItems: "center", justifyContent: "center", padding: "0 34px" }}>Ir a la consola</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <div style={CARD}>
        <div className="login-brand">{logo}</div>
        <div className="login-tagline">Reactivar mi acceso al MCP</div>

        <form onSubmit={onSubmit} noValidate>
          <div style={GRID}>
            <Field label="Correo electrónico *">
              <input className="login-input" style={INPUT} type="email" required value={form.email}
                     onChange={set("email")} placeholder="tu.correo@empresa.com" autoComplete="email" />
            </Field>
            <Field label="Nombre completo *">
              <input className="login-input" style={INPUT} type="text" required value={form.full_name}
                     onChange={set("full_name")} placeholder="Nombre y apellido" autoComplete="name" />
            </Field>

            <Field label="Teléfono">
              <input className="login-input" style={INPUT} type="tel" value={form.phone}
                     onChange={set("phone")} placeholder="+506 …" autoComplete="tel" />
            </Field>
            <Field label="&nbsp;"><span style={{ display: "block", height: 46 }} /></Field>

            {/* Empresa — con listado flotante */}
            <Field label="Empresa *" full>
              <div style={{ position: "relative" }}>
                {!empresa ? (
                  <>
                    <input className="login-input" style={INPUT} type="text" required value={q}
                           onChange={(e) => { setQ(e.target.value); setOpenList(true); }}
                           placeholder="Escribe el nombre (ej. Sondel)…" autoComplete="off" />
                    {openList && q.trim().length >= 2 && (
                      <div style={{
                        position: "absolute", top: "100%", left: 0, right: 0, zIndex: 60, marginTop: 4,
                        background: "rgba(8,22,35,0.97)", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 10, maxHeight: 190, overflowY: "auto", boxShadow: "0 14px 34px rgba(0,0,0,0.5)",
                      }}>
                        {searching && <div style={{ padding: "11px 14px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Buscando…</div>}
                        {!searching && options.length === 0 && (
                          <div style={{ padding: "11px 14px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Sin coincidencias.</div>
                        )}
                        {options.map((c) => (
                          <button key={c.id} type="button" onClick={() => pickEmpresa(c)}
                                  style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 14px",
                                           border: "none", background: "transparent", cursor: "pointer",
                                           fontSize: 13.5, color: "#F5F8FC" }}>
                            {c.razon_social}{c.is_subsidiary ? "  (subsidiaria)" : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(0,178,134,0.18)",
                                  color: "#1DE394", fontWeight: 600, fontSize: 13.5 }}>{empresa.razon_social}</span>
                    <button type="button" className="btn btn-ghost btn-sm"
                            style={{ color: "#E8EEF5" }} onClick={() => setEmpresa(null)}>Cambiar</button>
                  </div>
                )}
              </div>
            </Field>

            {/* Motivo */}
            <Field label="Motivo de la reactivación *" full>
              <textarea className="login-input" style={TEXTAREA} required value={form.motivo}
                        onChange={set("motivo")}
                        placeholder="Ej. necesito acceder a las herramientas del portal MWT.ONE de mi empresa…" />
            </Field>
          </div>

          {error && <div className="login-error" style={{ marginTop: 16 }}><span>{error}</span></div>}

          <button className="login-submit" type="submit" disabled={submitting}
                  style={{ width: "100%", marginTop: 20 }}>
            {submitting ? "ENVIANDO…" : "SOLICITAR REACTIVACIÓN"}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: "center", fontSize: 12.5 }}>
          <Link to="/login" style={{ color: "#1DE394", textDecoration: "none" }}>¿Ya tienes cuenta? Inicia sesión</Link>
        </div>
      </div>
    </div>
  );
}
