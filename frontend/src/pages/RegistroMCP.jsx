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

// Estilos base del formulario (ancho, claro, responsive en 2 columnas).
const F = {
  wrap: {
    minHeight: "100vh", background: "var(--bg, #F2F4F8)",
    padding: "32px 16px", display: "flex", justifyContent: "center",
  },
  container: { width: "100%", maxWidth: 1000, display: "flex", flexDirection: "column", gap: 18 },
  header: {
    display: "flex", alignItems: "center", gap: 14, marginBottom: 6,
  },
  logo: { height: 44, objectFit: "contain" },
  title: { fontSize: 24, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-.01em" },
  subtitle: { fontSize: 13.5, color: "var(--text-tertiary)", marginTop: 2 },
  card: {
    background: "var(--surface-raised, #fff)", border: "1px solid var(--border)",
    borderRadius: 14, padding: "26px 30px", boxShadow: "0 8px 28px rgba(15,27,61,0.06)",
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 },
  full: { gridColumn: "1 / -1" },
  label: { display: "block", fontWeight: 600, fontSize: 13, color: "var(--text-secondary)", marginBottom: 5 },
  err: { background: "#FCE7E7", color: "#B83227", border: "1px solid #F5C6C6", borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 12 },
  btn: {
    background: "var(--mint, #00B286)", color: "#fff", border: "none",
    padding: "12px 22px", borderRadius: 9, fontSize: 14, fontWeight: 700,
    cursor: "pointer", width: "100%",
  },
  btnDisabled: { opacity: 0.6, cursor: "default" },
};

function Field({ label, children, full }) {
  return (
    <div style={full ? F.full : undefined}>
      <label style={F.label}>{label}</label>
      {children}
    </div>
  );
}

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

  const logo = (
    <img src={LOGO_URL} alt="MWT ONE" style={F.logo}
         onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
  );

  if (done) {
    return (
      <div style={F.wrap}>
        <div style={F.container}>
          <div style={F.header}>{logo}
            <div>
              <div style={F.title}>MWT ONE</div>
              <div style={F.subtitle}>Solicitud enviada</div>
            </div>
          </div>
          <div style={F.card}>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-secondary)", margin: "0 0 8px" }}>
              Gracias, <b>{form.full_name.trim()}</b>. Tu solicitud de acceso MCP para
              {empresa ? <> <b>{empresa.razon_social}</b></> : null} quedó
              <b> pendiente de aprobación</b>.
            </p>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-tertiary)" }}>
              Un administrador revisará la solicitud. Cuando la active, recibirás un correo con tus
              credenciales para conectar tu IA.
            </p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: 14, textDecoration: "none" }}>
              Ir a la consola
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={F.wrap}>
      <div style={F.container}>
        {/* Header */}
        <div style={F.header}>
          {logo}
          <div>
            <div style={F.title}>Registro MCP</div>
            <div style={F.subtitle}>
              Registrate para conectar tu IA al MCP de tu empresa. Queda pendiente hasta la aprobación.
            </div>
          </div>
        </div>

        {/* Formulario */}
        <form onSubmit={onSubmit} noValidate>
          <div style={F.card}>
            <div style={F.grid}>
              <Field label="Correo electrónico *">
                <input className="input" type="email" required value={form.email}
                       onChange={set("email")} placeholder="tu.correo@empresa.com" autoComplete="email" />
              </Field>
              <Field label="Nombre completo *">
                <input className="input" type="text" required value={form.full_name}
                       onChange={set("full_name")} placeholder="Nombre y apellido" autoComplete="name" />
              </Field>

              <Field label="Teléfono">
                <input className="input" type="tel" value={form.phone}
                       onChange={set("phone")} placeholder="+506 …" autoComplete="tel" />
              </Field>
              <Field label="&nbsp;">
                <span style={{ display: "block", height: 38 }} />
              </Field>

              <Field label="Contraseña *">
                <input className="input" type="password" required minLength={8} value={form.password}
                       onChange={set("password")} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
              </Field>
              <Field label="Confirmar contraseña *">
                <input className="input" type="password" required minLength={8} value={form.confirm}
                       onChange={set("confirm")} placeholder="Repite la contraseña" autoComplete="new-password" />
              </Field>

              {/* Empresa — full width */}
              <Field label="Empresa *" full>
                {!empresa ? (
                  <>
                    <input className="input" type="text" required value={q}
                           onChange={(e) => { setQ(e.target.value); setOpenList(true); }}
                           placeholder="Escribe el nombre (ej. Sondel)…" autoComplete="off" />
                    {openList && q.trim().length >= 2 && (
                      <div style={{
                        background: "var(--surface-raised)", border: "1px solid var(--border-strong)",
                        borderRadius: 10, marginTop: 6, maxHeight: 190, overflowY: "auto",
                        boxShadow: "0 8px 24px rgba(15,27,61,0.10)",
                      }}>
                        {searching && <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-tertiary)" }}>Buscando…</div>}
                        {!searching && options.length === 0 && (
                          <div style={{ padding: "10px 14px", fontSize: 13, color: "var(--text-tertiary)" }}>
                            Sin coincidencias con acceso MCP.
                          </div>
                        )}
                        {options.map((c) => (
                          <button key={c.id} type="button" onClick={() => pickEmpresa(c)}
                                  style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 14px",
                                           border: "none", background: "transparent", cursor: "pointer",
                                           fontSize: 13.5, color: "var(--text-primary)" }}>
                            {c.razon_social}{c.is_subsidiary ? "  (subsidiaria)" : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="badge badge-navy" style={{ fontSize: 13, padding: "7px 12px" }}>{empresa.razon_social}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEmpresa(null)}>Cambiar</button>
                  </div>
                )}
              </Field>

              {/* Direcciones — full width */}
              <Field label="Direcciones" full>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addAddress}>+ Nueva dirección</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                  {addresses.map((a, i) => (
                    <div key={a.key} style={{
                      border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px",
                      background: "var(--surface)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                          Dirección {i + 1}{a.is_default ? " · DEFAULT" : ""}
                        </span>
                        <span style={{ flex: 1 }} />
                        {!a.is_default && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => markDefault(a.key)}>Marcar default</button>
                        )}
                        {addresses.length > 1 && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => rmAddr(a.key)}>Quitar</button>
                        )}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input className="input" placeholder="Etiqueta (Oficina, Bodega…)" value={a.label}
                               onChange={(e) => updAddr(a.key, { label: e.target.value })} />
                        <input className="input" placeholder="Calle y número" value={a.address_line_1}
                               onChange={(e) => updAddr(a.key, { address_line_1: e.target.value })} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8 }}>
                        <input className="input" placeholder="Ciudad" value={a.city}
                               onChange={(e) => updAddr(a.key, { city: e.target.value })} />
                        <select className="select" value={a.country}
                                onChange={(e) => updAddr(a.key, { country: e.target.value })}>
                          {PAISES.map(([iso, nom]) => <option key={iso} value={iso}>{nom}</option>)}
                        </select>
                        <input className="input" placeholder="Código postal" value={a.zip_code}
                               style={{ minWidth: 120 }}
                               onChange={(e) => updAddr(a.key, { zip_code: e.target.value })} />
                      </div>
                    </div>
                  ))}
                </div>
              </Field>
            </div>

            {error && <div style={{ ...F.err, marginTop: 14 }}>{error}</div>}

            <button className="btn btn-primary" type="submit" disabled={submitting}
                    style={{ ...F.btn, marginTop: 18, opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "Enviando…" : "Enviar solicitud"}
            </button>
          </div>
        </form>

        <div style={{ textAlign: "center", marginTop: 10 }}>
          <Link to="/login" style={{ fontSize: 13.5, color: "var(--brand-accent)" }}>
            ¿Ya tienes cuenta? Inicia sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
