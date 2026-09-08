// =====================================================================
// MWT.ONE · pages/RegistroMCP.jsx
// Registro público para acceder al MCP de una empresa (Fase 2).
//
// Pública (sin login). Pide: email, nombre completo, teléfono, contraseña,
// empresa (autocompletado SOLO clientes con MCP provisionado + subsidiarias)
// y direcciones. El alta queda PENDIENTE: no habilita login; un admin la
// aprueba desde /registro-solicitudes y entonces llega el email con las
// credenciales MCP.
//
// Endpoints:
//   GET  /api/onboarding/clientes?q=…
//   POST /api/onboarding/registro
// =====================================================================
import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api.js";

const LOGO_URL = "https://mwt.one/images/2024/12/04/recurso-1logo_foot.png";

// País → ISO-2 (valores de la consola). Lista corta LATAM + US.
const PAISES = [
  ["CR", "Costa Rica"], ["GT", "Guatemala"], ["HN", "Honduras"],
  ["SV", "El Salvador"], ["NI", "Nicaragua"], ["PA", "Panamá"],
  ["CO", "Colombia"], ["PE", "Perú"], ["MX", "México"],
  ["DO", "Rep. Dominicana"], ["US", "Estados Unidos"],
];

const nid = () => `addr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const newAddress = (defaultAll = false) => ({
  key: nid(), label: "Nueva dirección", kind: "BOTH",
  address_line_1: "", city: "", country: "PE", zip_code: "",
  is_default: defaultAll,
});

export default function RegistroMCP() {
  const [form, setForm] = useState({
    email: "", full_name: "", phone: "", password: "", confirm: "",
  });
  const [addresses, setAddresses] = useState([newAddress(true)]);
  const [empresa, setEmpresa] = useState(null);          // {id, razon_social, …}
  const [q, setQ] = useState("");
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => { document.title = "MWT ONE · Registro MCP"; }, []);

  // ── Autocompletado de empresa (server-side contra clientes MCP) ──
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
      } catch (e) {
        if (alive) setOptions([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q, empresa]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickEmpresa = (c) => {
    setEmpresa(c);
    setQ("");
    setOptions([]);
    setOpenList(false);
  };

  // ── Direcciones ──
  const addAddress = () => {
    setAddresses((aa) => [...aa, newAddress(aa.length === 0)]);
  };
  const updAddr = (key, patch) =>
    setAddresses((aa) => aa.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  const markDefault = (key) =>
    setAddresses((aa) => aa.map((a) => ({ ...a, is_default: a.key === key })));
  const rmAddr = (key) => {
    setAddresses((aa) => {
      const next = aa.filter((a) => a.key !== key);
      if (next.length && !next.some((a) => a.is_default)) next[0].is_default = true;
      return next.length ? next : [newAddress(true)];
    });
  };

  const addressPayload = useMemo(
    () => addresses.map(({ key, ...a }) => {
      const out = { label: a.label || "Nueva dirección", kind: a.kind || "BOTH",
        address_line_1: a.address_line_1, city: a.city, country: a.country,
        zip_code: a.zip_code, is_default: !!a.is_default };
      return out;
    }),
    [addresses]
  );

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
          cliente_id: empresa.id,
          addresses: addressPayload,
        },
      });
      setDone(true);
    } catch (err) {
      const detail = err?.payload?.detail || err?.message || "No se pudo enviar la solicitud.";
      setError(typeof detail === "string" ? detail : "No se pudo enviar la solicitud.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ maxWidth: 560 }}>
          <div className="login-brand">
            <img src={LOGO_URL} alt="MWT ONE" className="login-logo"
                 onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
          </div>
          <div className="login-tagline">Solicitud enviada</div>
          <div className="login-form" style={{ textAlign: "center" }}>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              Gracias, <b>{form.full_name.trim()}</b>. Tu solicitud de acceso MCP para
              {empresa ? <> <b>{empresa.razon_social}</b></> : null} quedó <b>pendiente de aprobación</b>.
            </p>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-tertiary)", marginTop: 8 }}>
              Un administrador revisará la solicitud. Cuando la active, recibirás un correo con tus
              credenciales para conectar tu IA.
            </p>
            <Link className="login-submit" style={{ textDecoration: "none", display: "inline-block", marginTop: 12 }}
                  to="/login">Ir a la consola</Link>
          </div>
          <div className="login-foot"><b>MWT.ONE</b> · Control Center</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 620, maxHeight: "100vh", overflowY: "auto" }}>
        <div className="login-brand">
          <img src={LOGO_URL} alt="MWT ONE" className="login-logo"
               onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
        </div>
        <div className="login-tagline">Regístrate para conectar tu IA al MCP de tu empresa</div>

        <form className="login-form" onSubmit={onSubmit} noValidate style={{ gap: 12 }}>
          {/* Email */}
          <div className="login-field">
            <label className="login-label" htmlFor="rmc-email">Correo electrónico *</label>
            <input id="rmc-email" className="login-input" type="email" required
                   value={form.email} onChange={set("email")}
                   placeholder="tu.correo@empresa.com" autoComplete="email" />
          </div>

          {/* Nombre */}
          <div className="login-field">
            <label className="login-label" htmlFor="rmc-name">Nombre completo *</label>
            <input id="rmc-name" className="login-input" type="text" required
                   value={form.full_name} onChange={set("full_name")}
                   placeholder="Nombre y apellido" autoComplete="name" />
          </div>

          {/* Teléfono */}
          <div className="login-field">
            <label className="login-label" htmlFor="rmc-phone">Teléfono</label>
            <input id="rmc-phone" className="login-input" type="tel"
                   value={form.phone} onChange={set("phone")}
                   placeholder="+506 …" autoComplete="tel" />
          </div>

          {/* Contraseña + confirmación */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="login-field">
              <label className="login-label" htmlFor="rmc-pass">Contraseña *</label>
              <input id="rmc-pass" className="login-input" type="password" required minLength={8}
                     value={form.password} onChange={set("password")}
                     placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor="rmc-pass2">Confirmar contraseña *</label>
              <input id="rmc-pass2" className="login-input" type="password" required minLength={8}
                     value={form.confirm} onChange={set("confirm")}
                     placeholder="Repite la contraseña" autoComplete="new-password" />
            </div>
          </div>

          {/* Empresa */}
          <div className="login-field">
            <label className="login-label" htmlFor="rmc-empresa">Empresa *</label>
            {!empresa ? (
              <>
                <input id="rmc-empresa" className="login-input" type="text" required
                       value={q} onChange={(e) => { setQ(e.target.value); setOpenList(true); }}
                       placeholder="Escribe el nombre (ej. Sondel)…" autoComplete="off"
                       style={{ marginBottom: 0 }} />
                {openList && q.trim().length >= 2 && (
                  <div style={{
                    background: "var(--surface-raised)", border: "1px solid var(--border-strong)",
                    borderRadius: 10, marginTop: 6, maxHeight: 180, overflowY: "auto", boxShadow: "0 8px 24px rgba(15,27,61,.1)",
                  }}>
                    {searching && <div className="login-tagline" style={{ padding: "10px 14px", margin: 0 }}>Buscando…</div>}
                    {!searching && options.length === 0 && (
                      <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-tertiary)" }}>
                        Sin coincidencias con acceso MCP.
                      </div>
                    )}
                    {options.map((c) => (
                      <button key={c.id} type="button"
                              onClick={() => pickEmpresa(c)}
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                                       border: "none", background: "transparent", cursor: "pointer",
                                       fontSize: 13.5, color: "var(--text-primary)" }}>
                        {c.razon_social}{c.is_subsidiary ? "  (subsidiaria)" : ""}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge badge-navy" style={{ fontSize: 12.5 }}>{empresa.razon_social}</span>
                <button type="button" className="btn btn-ghost btn-sm"
                        onClick={() => setEmpresa(null)}>Cambiar</button>
              </div>
            )}
          </div>

          {/* Direcciones */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label className="login-label" style={{ margin: 0 }}>Direcciones</label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addAddress}>+ Nueva dirección</button>
            </div>
            {addresses.map((a, i) => (
              <div key={a.key} style={{
                border: "1px solid var(--border)", borderRadius: 12, padding: "10px 12px",
                marginBottom: 8, background: "var(--surface)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    Dirección {i + 1}{a.is_default ? " · DEFAULT" : ""}
                  </span>
                  <span style={{ flex: 1 }} />
                  {!a.is_default && (
                    <button type="button" className="btn btn-ghost btn-sm"
                            onClick={() => markDefault(a.key)}>Marcar default</button>
                  )}
                  {addresses.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm"
                            onClick={() => rmAddr(a.key)}>Quitar</button>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input className="input" placeholder="Etiqueta (Oficina, Bodega…)"
                         value={a.label} onChange={(e) => updAddr(a.key, { label: e.target.value })} />
                  <input className="input" placeholder="Calle y número"
                         value={a.address_line_1} onChange={(e) => updAddr(a.key, { address_line_1: e.target.value })} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8 }}>
                  <input className="input" placeholder="Ciudad"
                         value={a.city} onChange={(e) => updAddr(a.key, { city: e.target.value })} />
                  <select className="select" value={a.country}
                          onChange={(e) => updAddr(a.key, { country: e.target.value })}>
                    {PAISES.map(([iso, nom]) => <option key={iso} value={iso}>{nom}</option>)}
                  </select>
                  <input className="input" placeholder="Código postal" style={{ width: 130 }}
                         value={a.zip_code} onChange={(e) => updAddr(a.key, { zip_code: e.target.value })} />
                </div>
              </div>
            ))}
          </div>

          {error && (
            <div className="login-error" role="alert" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span>{error}</span>
            </div>
          )}

          <button className="login-submit" type="submit" disabled={submitting}>
            {submitting && <span className="login-spinner" />}
            Enviar solicitud
          </button>

          <div style={{ textAlign: "center", marginTop: 4 }}>
            <Link to="/login" style={{ fontSize: 13, color: "var(--brand-accent)" }}>
              ¿Ya tienes cuenta? Inicia sesión
            </Link>
          </div>
        </form>

        <div className="login-foot"><b>MWT.ONE</b> · Control Center</div>
      </div>
    </div>
  );
}
