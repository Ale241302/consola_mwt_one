// =====================================================================
// MWT.ONE · pages/RegistroMCP.jsx
// Registro público para acceder al MCP de una empresa (Fase 2).
//
// Pública (sin login). Usa la ESTÉTICA del login (navy + verde MWT) pero con
// un layout ancho (varias columnas) y scroll para el formulario largo.
// El alta queda PENDIENTE hasta aprobación del admin.
//
// Endpoints:
//   GET  /api/onboarding/clientes?q=…
//   POST /api/onboarding/registro
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api.js";

const LOGO_URL = "https://mwt.one/images/2024/12/04/recurso-1logo_foot.png";

const PAISES = [
  ["CR", "Costa Rica"], ["GT", "Guatemala"], ["HN", "Honduras"], ["SV", "El Salvador"],
  ["NI", "Nicaragua"], ["PA", "Panamá"], ["CO", "Colombia"], ["PE", "Perú"],
  ["MX", "México"], ["DO", "Rep. Dominicana"], ["US", "Estados Unidos"],
];

const nid = () => `addr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const newAddress = (defaultAll = false) => ({
  key: nid(), label: "Nueva dirección", kind: "BOTH",
  address_line_1: "", city: "", country: "PE", zip_code: "", is_default: defaultAll,
});

// Reutiliza la estética del login (clases) pero amplía el ancho de la tarjeta.
const PAGE = {
  minHeight: "100vh", color: "#E8EEF5", fontFamily: "var(--font-display)",
  background: "radial-gradient(ellipse at center, #0E253C 0%, #081623 55%, #050E18 100%)",
  display: "flex", flexDirection: "column", alignItems: "center",
  justifyContent: "center", padding: "32px 16px",
};
const CARD = {
  width: "min(940px, calc(100vw - 32px))", padding: "34px 38px 30px",
  background: "rgba(13,30,48,0.92)", border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 18, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)",
  backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
  maxHeight: "92vh", overflowY: "auto",
};
const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: "18px 18px" };
const FULL = { gridColumn: "1 / -1" };
const INPUT = { width: "100%", height: 46, padding: "0 14px", background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, color: "#F5F8FC",
  fontSize: 14, fontFamily: "var(--font-display)", boxSizing: "border-box",
  transition: "border-color 140ms, background 140ms, box-shadow 140ms" };
const INPUT_FOCUS = ":focus";
const SELECT = { ...INPUT };
const DARK_CARD = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12, padding: "12px 14px" };
const GREEN = { background: "linear-gradient(180deg, #1DE394 0%, #00B286 100%)" };

function Field({ label, children, full }) {
  return (
    <div className="login-field" style={full ? FULL : undefined}>
      <label className="login-label">{label}</label>
      {children}
    </div>
  );
}

export default function RegistroMCP() {
  const [form, setForm] = useState({ email: "", full_name: "", phone: "", password: "", confirm: "" });
  const [addresses, setAddresses] = useState([newAddress(true)]);
  const [empresa, setEmpresa] = useState(null);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => { document.title = "MWT ONE · Registro MCP"; }, []);

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

  const addAddress = () => setAddresses((aa) => [...aa, newAddress(aa.length === 0)]);
  const updAddr = (key, patch) => setAddresses((aa) => aa.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const markDefault = (key) => setAddresses((aa) => aa.map((a) => ({ ...a, is_default: a.key === key })));
  const rmAddr = (key) => setAddresses((aa) => {
    const next = aa.filter((a) => a.key !== key);
    if (next.length && !next.some((a) => a.is_default)) next[0].is_default = true;
    return next.length ? next : [newAddress(true)];
  });

  const addressPayload = useMemo(() => addresses.map(({ key, ...a }) => ({
    label: a.label || "Nueva dirección", kind: a.kind || "BOTH",
    address_line_1: a.address_line_1, city: a.city, country: a.country,
    zip_code: a.zip_code, is_default: !!a.is_default,
  })), [addresses]);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validEmail) return setError("Ingresa un correo válido.");
    if (form.password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (form.password !== form.confirm) return setError("Las contraseñas no coinciden.");
    if (!empresa) return setError("Selecciona tu empresa de la lista.");
    if (!form.full_name.trim()) return setError("Escribe tu nombre completo.");
    setSubmitting(true);
    try {
      await apiFetch("/onboarding/registro", {
        method: "POST",
        body: {
          email: form.email.trim(), full_name: form.full_name.trim(),
          phone: form.phone.trim(), password: form.password,
          cliente_id: empresa.id, addresses: addressPayload,
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
            Gracias, <b style={{ color: "#1DE394" }}>{form.full_name.trim()}</b>. Tu solicitud de acceso MCP
            para {empresa ? <b style={{ color: "#1DE394" }}>{empresa.razon_social}</b> : null} quedó
            <b> pendiente de aprobación</b>.
          </p>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
            Un administrador revisará la solicitud. Cuando la active, recibirás un correo con tus
            credenciales para conectar tu IA.
          </p>
          <div style={{ textAlign: "center", marginTop: 18 }}>
            <Link to="/login" className="login-submit" style={{ textDecoration: "none", display: "inline-flex",
              alignItems: "center", justifyContent: "center", padding: "0 34px" }}>
              Ir a la consola
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <div style={CARD}>
        <div className="login-brand">{logo}</div>
        <div className="login-tagline">Regístrate para conectar tu IA al MCP</div>

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

            <Field label="Contraseña *">
              <input className="login-input" style={{ ...INPUT, letterSpacing: "0.18em" }} type="password"
                     required minLength={8} value={form.password} onChange={set("password")}
                     placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
            </Field>
            <Field label="Confirmar contraseña *">
              <input className="login-input" style={{ ...INPUT, letterSpacing: "0.18em" }} type="password"
                     required minLength={8} value={form.confirm} onChange={set("confirm")}
                     placeholder="Repite la contraseña" autoComplete="new-password" />
            </Field>

            {/* Empresa */}
            <Field label="Empresa *" full>
              {!empresa ? (
                <>
                  <input className="login-input" style={INPUT} type="text" required value={q}
                         onChange={(e) => { setQ(e.target.value); setOpenList(true); }}
                         placeholder="Escribe el nombre (ej. Sondel)…" autoComplete="off" />
                  {openList && q.trim().length >= 2 && (
                    <div style={{
                      background: "rgba(8,22,35,0.96)", border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 10, marginTop: 6, maxHeight: 190, overflowY: "auto",
                    }}>
                      {searching && <div style={{ padding: "11px 14px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Buscando…</div>}
                      {!searching && options.length === 0 && (
                        <div style={{ padding: "11px 14px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                          Sin coincidencias con acceso MCP.
                        </div>
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
            </Field>

            {/* Direcciones */}
            <Field label="Direcciones" full>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button type="button" className="btn btn-secondary btn-sm"
                        style={{ color: "#E8EEF5" }} onClick={addAddress}>+ Nueva dirección</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
                {addresses.map((a, i) => (
                  <div key={a.key} style={DARK_CARD}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#F5F8FC" }}>
                        Dirección {i + 1}{a.is_default ? " · DEFAULT" : ""}
                      </span>
                      <span style={{ flex: 1 }} />
                      {!a.is_default && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#E8EEF5" }}
                                onClick={() => markDefault(a.key)}>Marcar default</button>
                      )}
                      {addresses.length > 1 && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#E8EEF5" }}
                                onClick={() => rmAddr(a.key)}>Quitar</button>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <input className="login-input" style={INPUT} placeholder="Etiqueta (Oficina, Bodega…)" value={a.label}
                             onChange={(e) => updAddr(a.key, { label: e.target.value })} />
                      <input className="login-input" style={INPUT} placeholder="Calle y número" value={a.address_line_1}
                             onChange={(e) => updAddr(a.key, { address_line_1: e.target.value })} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8 }}>
                      <input className="login-input" style={INPUT} placeholder="Ciudad" value={a.city}
                             onChange={(e) => updAddr(a.key, { city: e.target.value })} />
                      <select className="login-input" style={{ ...SELECT, cursor: "pointer" }} value={a.country}
                              onChange={(e) => updAddr(a.key, { country: e.target.value })}>
                        {PAISES.map(([iso, nom]) => <option key={iso} value={iso}>{nom}</option>)}
                      </select>
                      <input className="login-input" style={{ ...INPUT, minWidth: 120 }} placeholder="Código postal"
                             value={a.zip_code} onChange={(e) => updAddr(a.key, { zip_code: e.target.value })} />
                    </div>
                  </div>
                ))}
              </div>
            </Field>
          </div>

          {error && <div className="login-error" style={{ marginTop: 16 }}><span>{error}</span></div>}

          <button className="login-submit" type="submit" disabled={submitting} style={{ width: "100%", marginTop: 20 }}>
            {submitting ? "ENVIANDO…" : "ENVIAR SOLICITUD"}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: "center", fontSize: 12.5 }}>
          <Link to="/login" style={{ color: "#1DE394", textDecoration: "none" }}>¿Ya tienes cuenta? Inicia sesión</Link>
        </div>
      </div>
    </div>
  );
}
