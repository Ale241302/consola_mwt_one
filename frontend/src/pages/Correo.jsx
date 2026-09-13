// ─────────────────────────────────────────────────────────────────────
// Correo.jsx — Etapa 3 · Bandeja de correo + contactos + grupos +
// editor (ES) con traducción + envío explícito.
// ─────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { correoApi } from "../lib/api.js";
import { usePagination, TablePagination } from "../components/ui/TablePagination.jsx";

function fmtDT(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("es-CR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

const MATCH_STYLE = {
  AUTO:         { bg: "rgba(0,178,134,0.16)", color: "#00734F" },
  VINCULADO:    { bg: "rgba(48,131,254,0.14)", color: "#1D4ED8" },
  POR_VINCULAR: { bg: "rgba(180,83,9,0.16)", color: "#92400E" },
  IGNORADO:     { bg: "rgba(100,116,139,0.16)", color: "#475569" },
};
function Chip({ text, style }) {
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, ...style }}>{text}</span>;
}

export default function Correo() {
  const { lang = "es" } = useOutletContext() || {};
  const es = lang === "es";
  const [tab, setTab] = useState("bandeja");
  const [toast, setToast] = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const selStyle = { padding: "6px 10px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6,
                     fontSize: 12, fontWeight: 600, background: "var(--surface, #fff)" };
  const inp = { padding: "7px 10px", border: "1px solid var(--border, #CBD5E1)", borderRadius: 6,
                fontSize: 13, width: "100%", background: "var(--surface, #fff)" };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="micro" style={{ marginBottom: 6 }}>COMUNICACIONES · CORREO</div>
          <h1 className="page-title">{es ? "Correo" : "Mail"}</h1>
          <div className="page-subtitle">
            {es ? "Bandeja, contactos y editor con traducción. El envío siempre es explícito."
                : "Inbox, contacts and editor with translation. Sending is always explicit."}
          </div>
        </div>
        <div className="seg">
          {[["bandeja", es ? "Bandeja" : "Inbox"], ["contactos", es ? "Contactos" : "Contacts"],
            ["grupos", es ? "Grupos" : "Groups"], ["estilo", es ? "Estilo" : "Style"],
            ["redactar", es ? "Redactar" : "Compose"]].map(([k, l]) => (
            <button key={k} data-active={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>

      {tab === "bandeja" && <Bandeja es={es} selStyle={selStyle} flash={flash} />}
      {tab === "contactos" && <Contactos es={es} selStyle={selStyle} inp={inp} flash={flash} />}
      {tab === "grupos" && <Grupos es={es} inp={inp} flash={flash} />}
      {tab === "estilo" && <Estilo es={es} inp={inp} flash={flash} />}
      {tab === "redactar" && <Redactar es={es} inp={inp} selStyle={selStyle} flash={flash} />}

      {toast && <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1200, background: "#0F172A",
                              color: "#fff", padding: "10px 16px", borderRadius: 8, fontSize: 13 }}>{toast}</div>}
    </div>
  );
}

function Bandeja({ es, selStyle, flash }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [direction, setDirection] = useState("");
  const [porVincular, setPorVincular] = useState(false);
  const [noLeidos, setNoLeidos] = useState(false);
  const [detalle, setDetalle] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (q) params.q = q;
      if (direction) params.direction = direction;
      if (porVincular) params.por_vincular = 1;
      if (noLeidos) params.no_leidos = 1;
      const d = await correoApi.mensajes.list(params);
      setItems(Array.isArray(d) ? d : (d?.results || []));
    } catch { setItems([]); } finally { setLoading(false); }
  }, [q, direction, porVincular, noLeidos]);
  useEffect(() => { load(); }, [load]);

  const { pageItems, page, setPage, perPage, setPerPage, totalPages, total } =
    usePagination(items, { defaultPerPage: 20 });
  useEffect(() => { setPage(1); }, [q, direction, porVincular, noLeidos, setPage]);

  const sync = async () => {
    try { const r = await correoApi.mensajes.sync({}); flash(r?.ok ? `Sync: ${r.importados ?? 0}` : `Sync: ${r?.reason || "no-op"}`); load(); }
    catch (e) { flash(e?.body?.detail || "Error"); }
  };
  const open = async (m) => {
    try { const full = await correoApi.mensajes.get(m.id); setDetalle(full);
          if (!m.is_read) correoApi.mensajes.marcarLeido(m.id).then(load).catch(() => {}); }
    catch { setDetalle(m); }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={es ? "Buscar asunto, remitente, proforma, SAP…" : "Search…"}
               style={{ ...selStyle, fontWeight: 400, minWidth: 260 }} />
        <select value={direction} onChange={(e) => setDirection(e.target.value)} style={selStyle}>
          <option value="">{es ? "Dirección: todas" : "Direction: all"}</option>
          <option value="IN">{es ? "Recibidos" : "Received"}</option>
          <option value="OUT">{es ? "Enviados" : "Sent"}</option>
        </select>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={porVincular} onChange={(e) => setPorVincular(e.target.checked)} /> {es ? "Por vincular" : "Unlinked"}
        </label>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={noLeidos} onChange={(e) => setNoLeidos(e.target.checked)} /> {es ? "No leídos" : "Unread"}
        </label>
        <button className="btn btn-ghost btn-sm" onClick={sync}>{es ? "Sincronizar" : "Sync"}</button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary, #94A3B8)" }}>{items.length} {es ? "mensajes" : "messages"}</span>
      </div>

      <div className="table-scroll" style={{ background: "var(--surface, #fff)", border: "1px solid var(--border-subtle, #E2E8F0)", borderRadius: 12 }}>
        <table className="table-sticky" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
          <thead><tr style={{ background: "var(--surface-alt, #F1F5F9)" }}>
            <Th>{es ? "Fecha" : "Date"}</Th><Th>{es ? "De / Para" : "From / To"}</Th><Th>{es ? "Asunto" : "Subject"}</Th>
            <Th>{es ? "Expediente" : "File"}</Th><Th>{es ? "Vínculo" : "Link"}</Th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary)" }}>…</td></tr>}
            {!loading && pageItems.length === 0 && <tr><td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--text-tertiary)" }}>{es ? "Sin mensajes." : "No messages."}</td></tr>}
            {pageItems.map((m, i) => (
              <tr key={m.id} onClick={() => open(m)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border-subtle,#F1F5F9)",
                                                              background: i % 2 ? "rgba(241,245,249,0.4)" : "transparent",
                                                              fontWeight: m.is_read ? 400 : 600 }}>
                <Td><span className="tabular-nums">{fmtDT(m.sent_at || m.created_at)}</span></Td>
                <Td><span style={{ fontFamily: "monospace", fontSize: 11 }}>{m.direction === "OUT" ? "→ " + (m.to_emails || []).join(", ") : (m.from_email || "—")}</span></Td>
                <Td>{(m.subject || "(sin asunto)").slice(0, 90)}</Td>
                <Td><span style={{ fontFamily: "monospace" }}>{m.proforma || "—"}{m.sap ? ` · ${m.sap}` : ""}</span></Td>
                <Td><Chip text={m.match_status} style={MATCH_STYLE[m.match_status] || MATCH_STYLE.POR_VINCULAR} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination page={page} totalPages={totalPages} perPage={perPage} setPerPage={setPerPage} setPage={setPage} total={total} lang={es ? "es" : "en"} />

      {detalle && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.45)", display: "flex", justifyContent: "flex-end" }}
             onClick={() => setDetalle(null)}>
          <div style={{ background: "var(--surface,#fff)", width: 640, maxWidth: "92%", height: "100%", overflow: "auto", padding: 22 }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <h3 style={{ margin: 0 }}>{detalle.subject || "(sin asunto)"}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetalle(null)}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", margin: "8px 0 14px" }}>
              <div><b>{es ? "De" : "From"}:</b> {detalle.from_email || "—"}</div>
              <div><b>{es ? "Para" : "To"}:</b> {(detalle.to_emails || []).join(", ") || "—"}</div>
              <div><b>{es ? "Fecha" : "Date"}:</b> {fmtDT(detalle.sent_at || detalle.created_at)}</div>
              <div style={{ marginTop: 6 }}><Chip text={detalle.match_status} style={MATCH_STYLE[detalle.match_status]} /> {detalle.match_reason}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <button className="btn btn-sm" onClick={async () => {
                const id = window.prompt(es ? "UUID del expediente a vincular:" : "File UUID:");
                if (id) { await correoApi.mensajes.vincular(detalle.id, { expediente_id: id }); flash(es ? "Vinculado" : "Linked"); setDetalle(null); load(); }
              }}>{es ? "Vincular a expediente" : "Link to file"}</button>
              <button className="btn btn-sm btn-ghost" onClick={async () => { await correoApi.mensajes.ignorar(detalle.id); flash("OK"); setDetalle(null); load(); }}>
                {es ? "Ignorar" : "Ignore"}</button>
            </div>
            {detalle.adjuntos?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div className="micro">{es ? "ADJUNTOS" : "ATTACHMENTS"}</div>
                {detalle.adjuntos.map((a) => <div key={a.id} style={{ fontSize: 12 }}>• {a.filename} ({a.size_bytes} B)</div>)}
              </div>
            )}
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, color: "var(--text-primary)" }}>
              {detalle.body_text || detalle.body_html || "(sin cuerpo)"}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

function Contactos({ es, selStyle, inp, flash }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ email: "", nombre: "", empresa: "", marca: "", idioma: "" });
  const load = useCallback(() => correoApi.contactos.list(q ? { q } : {}).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => setItems([])), [q]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    if (!form.email) return flash("Email requerido");
    try { await correoApi.contactos.create(form); setForm({ email: "", nombre: "", empresa: "", marca: "", idioma: "" }); flash("OK"); load(); }
    catch (e) { flash(e?.body?.detail || "Error"); }
  };
  return (
    <>
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input type="search" placeholder={es ? "Buscar contacto…" : "Search…"} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...selStyle, fontWeight: 400, minWidth: 240 }} />
      </div>
      <div className="card card-pad-lg" style={{ marginBottom: 14, display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 90px 90px", gap: 8 }}>
        <input style={inp} placeholder="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input style={inp} placeholder={es ? "Nombre" : "Name"} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input style={inp} placeholder={es ? "Empresa" : "Company"} value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} />
        <input style={inp} placeholder={es ? "Marca" : "Brand"} value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
        <input style={inp} placeholder="es" value={form.idioma} onChange={(e) => setForm({ ...form, idioma: e.target.value })} />
        <button className="btn btn-primary btn-sm" onClick={save}>{es ? "Agregar" : "Add"}</button>
      </div>
      <div className="card card-pad-lg">
        <table className="table" style={{ width: "100%" }}>
          <thead><tr><Th>Email</Th><Th>{es ? "Nombre" : "Name"}</Th><Th>{es ? "Empresa" : "Company"}</Th><Th>{es ? "Marca" : "Brand"}</Th><Th>Idioma</Th><Th right>·</Th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--border-subtle,#F1F5F9)" }}>
                <Td>{c.email}</Td><Td>{c.nombre || "—"}</Td><Td>{c.empresa || "—"}</Td><Td>{c.marca || "—"}</Td><Td>{c.idioma || "—"}</Td>
                <Td right><button className="btn btn-sm btn-ghost" onClick={async () => { await correoApi.contactos.remove(c.id); load(); }}>✕</button></Td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "var(--text-tertiary)" }}>{es ? "Sin contactos." : "No contacts."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Grupos({ es, inp, flash }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ codigo: "", nombre: "", emails: "" });
  const load = () => correoApi.grupos.list().then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!form.codigo || !form.nombre) return flash("Código y nombre requeridos");
    try { await correoApi.grupos.create({ codigo: form.codigo, nombre: form.nombre,
      emails: form.emails.split(",").map((s) => s.trim()).filter(Boolean) });
      setForm({ codigo: "", nombre: "", emails: "" }); flash("OK"); load(); }
    catch (e) { flash(e?.body?.detail || "Error"); }
  };
  return (
    <div className="card card-pad-lg">
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 2fr 90px", gap: 8, marginBottom: 14 }}>
        <input style={inp} placeholder={es ? "Código" : "Code"} value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
        <input style={inp} placeholder={es ? "Nombre" : "Name"} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
        <input style={inp} placeholder="a@x.com, b@y.com" value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} />
        <button className="btn btn-primary btn-sm" onClick={save}>{es ? "Agregar" : "Add"}</button>
      </div>
      <table className="table" style={{ width: "100%" }}>
        <thead><tr><Th>{es ? "Código" : "Code"}</Th><Th>{es ? "Nombre" : "Name"}</Th><Th>Emails</Th><Th right>·</Th></tr></thead>
        <tbody>
          {items.map((g) => (
            <tr key={g.id} style={{ borderBottom: "1px solid var(--border-subtle,#F1F5F9)" }}>
              <Td mono>{g.codigo}</Td><Td>{g.nombre}</Td><Td>{(g.emails || []).join(", ")}</Td>
              <Td right><button className="btn btn-sm btn-ghost" onClick={async () => { await correoApi.grupos.remove(g.id); load(); }}>✕</button></Td>
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: "var(--text-tertiary)" }}>{es ? "Sin grupos." : "No groups."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Estilo({ es, inp, flash }) {
  const [actual, setActual] = useState(null);
  const [texto, setTexto] = useState("");
  useEffect(() => { correoApi.estilos.actual().then((d) => { setActual(d); setTexto(d?.contenido || ""); }).catch(() => {}); }, []);
  const publicar = async () => {
    if (!texto.trim()) return flash(es ? "Texto vacío" : "Empty text");
    try { const r = await correoApi.estilos.publicar({ contenido: texto }); setActual(r); flash(`v${r.version}`); }
    catch (e) { flash(e?.body?.detail || "Error"); }
  };
  return (
    <div className="card card-pad-lg">
      <div className="micro" style={{ marginBottom: 8 }}>{es ? "PERFIL DE ESTILO" : "STYLE PROFILE"} {actual?.version ? `· v${actual.version}` : ""}</div>
      <textarea style={{ ...inp, minHeight: 200 }} value={texto} onChange={(e) => setTexto(e.target.value)} />
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={publicar}>{es ? "Publicar nueva versión" : "Publish new version"}</button>
      </div>
    </div>
  );
}

function Redactar({ es, inp, selStyle, flash }) {
  const [form, setForm] = useState({ expediente_id: "", destinatarios: "", cc: "", asunto: "", body_es: "", idioma: "" });
  const [envio, setEnvio] = useState(null);
  const crear = async () => {
    if (!form.asunto || !form.body_es) return flash(es ? "Asunto y cuerpo requeridos" : "Subject and body required");
    const body = {
      expediente_id: form.expediente_id || undefined,
      destinatarios: form.destinatarios.split(",").map((s) => s.trim()).filter(Boolean),
      cc: form.cc.split(",").map((s) => s.trim()).filter(Boolean),
      subject: form.asunto, body_es: form.body_es, idioma: form.idioma || undefined,
    };
    try { const e = await correoApi.envios.create(body); setEnvio(e); flash(es ? "Borrador creado" : "Draft created"); }
    catch (e) { flash(e?.body?.detail || "Error"); }
  };
  const traducir = async () => {
    if (!envio) return;
    try { const e = await correoApi.envios.traducir(envio.id, { idioma: form.idioma || "en" }); setEnvio(e); flash("OK"); }
    catch (e) { flash(e?.body?.detail || "Sin traducción"); }
  };
  const enviar = async () => {
    if (!envio) return;
    if (!window.confirm(es ? "¿Enviar ahora?" : "Send now?")) return;
    try { const r = await correoApi.envios.enviar(envio.id); flash(r?.ok ? "Enviado" : (r?.reason || "Error")); }
    catch (e) { flash(e?.body?.detail || "Error"); }
  };
  return (
    <div className="card card-pad-lg" style={{ display: "grid", gap: 10, maxWidth: 820 }}>
      <input style={inp} placeholder={es ? "Expediente (UUID, opcional)" : "File (UUID, optional)"} value={form.expediente_id} onChange={(e) => setForm({ ...form, expediente_id: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <input style={inp} placeholder={es ? "Para (coma-separado)" : "To (comma)"} value={form.destinatarios} onChange={(e) => setForm({ ...form, destinatarios: e.target.value })} />
        <input style={inp} placeholder="CC" value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
        <input style={inp} placeholder={es ? "Asunto" : "Subject"} value={form.asunto} onChange={(e) => setForm({ ...form, asunto: e.target.value })} />
        <select style={selStyle} value={form.idioma} onChange={(e) => setForm({ ...form, idioma: e.target.value })}>
          <option value="">{es ? "Idioma destino" : "Target language"}</option>
          {["en", "pt", "pt-BR", "fr", "it", "de", "es"].map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <textarea style={{ ...inp, minHeight: 200 }} placeholder={es ? "Cuerpo (español)…" : "Body (Spanish)…"} value={form.body_es} onChange={(e) => setForm({ ...form, body_es: e.target.value })} />
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" onClick={crear}>{es ? "Crear borrador" : "Create draft"}</button>
        <button className="btn" disabled={!envio} onClick={traducir}>{es ? "Traducir" : "Translate"}</button>
        <button className="btn" disabled={!envio} onClick={enviar}>{es ? "Enviar" : "Send"}</button>
      </div>
      {envio && (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-secondary)" }}>
          <div><b>Estado:</b> {envio.estado}</div>
          {envio.body_traducido && (
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", marginTop: 8, padding: 10, background: "var(--surface-alt,#F1F5F9)", borderRadius: 8 }}>
              {envio.body_traducido}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Th({ children, right }) {
  return <th style={{ padding: "10px 12px", textAlign: right ? "right" : "left", fontSize: 10, fontWeight: 700,
                      letterSpacing: 0.5, color: "var(--text-tertiary, #94A3B8)", textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, right, mono }) {
  return <td style={{ padding: "9px 12px", textAlign: right ? "right" : "left", verticalAlign: "top",
                      fontFamily: mono ? "'JetBrains Mono', monospace" : undefined }}>{children}</td>;
}
