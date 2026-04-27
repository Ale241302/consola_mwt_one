// =====================================================================
// MWT.ONE · pages/BrandClientPricingForm.jsx
// Agente responsable: [AG-FRONTEND]
//
// Ruta: /marcas/:brandId/clientes/:clienteId/precios
//
// Asignación de precios para un cliente dentro de una marca:
//   · Drag-and-drop de Excel / CSV (archivo de precios base).
//   · Vigencia: fecha_inicio (default hoy) + fecha_fin (o "indefinida").
//   · Sobre-precio: slider de %.
//   · Descuento Pronto Pago: días + %.
//   · Descuento por Volumen: unidades mínimas + %.
//
// Al guardar → POST /api/commercial/brand-client-pricing/ con snapshot
// inmutable de comisión + días de crédito del cliente (el backend los
// congela al crear la asignación).
//
// POL_VISIBILIDAD: la sección de "Snapshot financiero" sólo se ve para
// isAdmin (comisión del cliente + límite de crédito).
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useOutletContext } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  IconChevLeft, IconUpload, IconCheck, IconAlert, IconLock,
  IconDollar, IconPercent, IconClock, IconX, IconBoxes,
} from "../lib/icons.jsx";
import { useRole } from "../context/RoleContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { apiFetch, clientesApi, marcasApi } from "../lib/api.js";
import { CLIENTS, BRANDS } from "../data/mockData.js";

// ─── Helpers backend → shape interno ──────────────────────────
const _FLAG_ISO2 = {
  PE:'🇵🇪', CO:'🇨🇴', US:'🇺🇸', MX:'🇲🇽', AR:'🇦🇷',
  CL:'🇨🇱', BR:'🇧🇷', UY:'🇺🇾', EC:'🇪🇨', CR:'🇨🇷',
  PA:'🇵🇦', DO:'🇩🇴', GT:'🇬🇹', SV:'🇸🇻', HN:'🇭🇳',
  ES:'🇪🇸', CN:'🇨🇳',
};
function _adaptCliente(c) {
  if (!c) return null;
  const iso = (c.pais_iso2 || c.country_code || '').toUpperCase();
  const limite = c.credito_aprobado ?? c.credito_limit_usd ?? c.credito_limit;
  const dias   = c.dias_credito ?? c.credito_dias;
  return {
    id:                c.id || c.uuid,
    name:              c.razon_social || c.nombre_comercial || c.name || '—',
    razon_social:      c.razon_social,
    country:           c.pais || c.country,
    pais_iso2:         iso,
    flag:              c.flag || _FLAG_ISO2[iso] || '🌐',
    comision_pct:      c.comision_pct,
    dias_credito:      dias,
    credito_dias:      dias,
    credito_aprobado:  limite,
    credito_limit:     limite,
    credito_limit_usd: limite,
  };
}

// ─── Design tokens ───────────────────────────────────────────
const NAVY  = "#0B1E3A";
const MINT  = "#00B286";
const LIGHT = "#1DE394";
const AMBER = "#F59E0B";
const RED   = "#DC2626";
const INK   = "#334155";
const MUTED = "#64748B";
const SOFT  = "#F8FAFC";

// IconInfo helper
const IconInfo = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 8h.01M12 11v5"/>
  </svg>
);


// ═════════════════════════════════════════════════════════════
// Componente principal
// ═════════════════════════════════════════════════════════════
export default function ScreenBrandClientPricingForm() {
  const { brandId, clienteId } = useParams();
  const navigate = useNavigate();
  const { lang } = useOutletContext() || { lang: "es" };
  const { isAdmin } = useRole();
  const { accessToken } = useAuth();
  const [resolvedPreview, setResolvedPreview] = useState(null);  // {count, items[]}

  // Lookup cliente + marca · backend real con fallback al mock
  const [client, setClient] = useState(null);
  const [brand,  setBrand]  = useState(null);
  const [lookupLoading, setLookupLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!clienteId) { setClient(null); setLookupLoading(false); return; }
    setLookupLoading(true);
    clientesApi.get(clienteId)
      .then(c => { if (!cancelled) setClient(_adaptCliente(c)); })
      .catch(() => {
        const mockHit = CLIENTS.find(c => (c.id || c.uuid) === clienteId);
        if (!cancelled) setClient(mockHit ? _adaptCliente(mockHit) : null);
      })
      .finally(() => { if (!cancelled) setLookupLoading(false); });
    return () => { cancelled = true; };
  }, [clienteId]);

  useEffect(() => {
    let cancelled = false;
    if (!brandId) { setBrand(null); return; }
    marcasApi.get(brandId)
      .then(b => { if (!cancelled) setBrand(b); })
      .catch(() => {
        const mockHit = BRANDS.find(b => b.id === brandId);
        if (!cancelled) setBrand(mockHit || null);
      });
    return () => { cancelled = true; };
  }, [brandId]);

  // ── Estado del formulario ──
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [fechaInicio, setFechaInicio] = useState(today());
  const [fechaFin, setFechaFin] = useState("");
  const [fechaFinIndef, setFechaFinIndef] = useState(true);
  const [sobrePrecioPct, setSobrePrecioPct] = useState(0);      // 0..30
  const [prontoPagoDias, setProntoPagoDias] = useState("");
  const [prontoPagoPct,  setProntoPagoPct]  = useState(0);       // 0..30
  const [volumenMin,     setVolumenMin]     = useState("");
  const [volumenPct,     setVolumenPct]     = useState(0);       // 0..30
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  // ── Drag-and-drop ──
  const fileInputRef = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    const ok = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",   // xlsx
      "application/vnd.ms-excel",                                             // xls
      "text/csv",
      "application/csv",
    ].includes(f.type) || /\.(xlsx|xls|csv)$/i.test(f.name || "");
    if (!ok) {
      setFileError(lang === "es"
        ? "Formato no soportado. Usa .xlsx, .xls o .csv."
        : "Unsupported format. Use .xlsx, .xls or .csv.");
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setFileError(lang === "es" ? "Máximo 15 MB." : "Max 15 MB.");
      return;
    }
    setFileError(null);
    setFile(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // ── Save ──
  const save = async () => {
    setSaving(true);
    setBanner(null);
    // Solo brand_id + cliente_id son obligatorios. El resto: si está vacío,
    // ni siquiera lo enviamos (DRF lo trata como "no provisto" → null en BD).
    const payload = {
      brand_id:   brandId,
      cliente_id: clienteId,
      fecha_inicio: fechaInicio || undefined,
      fecha_fin:  fechaFinIndef ? null : (fechaFin || null),
      sobre_precio_pct:  sobrePrecioPct > 0 ? (sobrePrecioPct / 100).toFixed(4) : null,
      pronto_pago_dias:  prontoPagoDias === "" ? null : Number(prontoPagoDias),
      pronto_pago_pct:   prontoPagoPct > 0 ? (prontoPagoPct / 100).toFixed(4) : null,
      volumen_min_units: volumenMin === "" ? null : Number(volumenMin),
      volumen_pct:       volumenPct > 0 ? (volumenPct / 100).toFixed(4) : null,
      notas: notas || null,
    };
    try {
      // 1) Crear asignación (snapshot de comisión + crédito se hace server-side)
      const created = await apiFetch("/commercial/brand-client-pricing/", {
        method: "POST",
        body: payload,
        token: accessToken,
      });

      // 2) Si hay archivo Excel, subirlo y disparar el parser openpyxl
      let uploadResult = null;
      if (file && created?.id) {
        const fd = new FormData();
        fd.append("file", file);
        const API_BASE = import.meta.env.VITE_API_BASE || "/api";
        const resp = await fetch(
          `${API_BASE}/commercial/brand-client-pricing/${created.id}/upload-file/`,
          { method: "POST",
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: fd },
        );
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.detail || `HTTP ${resp.status}`);
        uploadResult = data;
      }

      // 3) Pedir resolved-prices para previsualizar
      let resolved = null;
      if (created?.id) {
        try {
          resolved = await apiFetch(
            `/commercial/brand-client-pricing/${created.id}/resolved-prices/?limit=20`,
            { token: accessToken },
          );
        } catch { /* opcional */ }
      }

      setResolvedPreview(resolved);
      const importedMsg = uploadResult
        ? (lang === "es"
            ? `Asignación creada · ${uploadResult.skus_imported} SKUs importados.`
            : `Assignment created · ${uploadResult.skus_imported} SKUs imported.`)
        : (lang === "es"
            ? "Asignación de precios guardada."
            : "Pricing assignment saved.");
      setBanner({ type: "success", msg: importedMsg });

      // Si NO se subió Excel, navegar; si sí, dejamos que el operador
      // revise la tabla resolvedPreview antes de salir.
      if (!file) {
        setTimeout(() => navigate(`/marcas/${brandId}`), 800);
      }
    } catch (err) {
      setBanner({ type: "error",
        msg: String(err?.body?.detail || err?.message || err) });
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───
  if (lookupLoading) {
    return (
      <div className="page">
        <div style={emptyCard}>
          <div style={{ color: MUTED, fontSize: 13 }}>
            {lang === "es" ? "Cargando cliente…" : "Loading client…"}
          </div>
        </div>
      </div>
    );
  }
  if (!client) {
    return (
      <div className="page">
        <div style={emptyCard}>
          <IconAlert size={22} style={{ color: MUTED, marginBottom: 8 }}/>
          <div>{lang === "es" ? "Cliente no encontrado." : "Client not found."}</div>
          <div style={{ color: MUTED, fontSize: 11, marginTop: 6 }}>
            ID: {clienteId}
          </div>
          <button onClick={() => navigate("/marcas")}
                  style={{ ...btnGhost, marginTop: 14 }}>
            {lang === "es" ? "Volver" : "Back"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingBottom: 120 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button onClick={() => navigate(`/marcas/${brandId}`)}
                style={btnGhost}>
          <IconChevLeft size={13}/>
          {lang === "es" ? "Volver" : "Back"}
        </button>
        <span style={{ color: MUTED, fontSize: 12 }}>·</span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {lang === "es" ? "Marcas" : "Brands"}
        </span>
        <span style={{ color: MUTED }}>/</span>
        <span style={{ fontSize: 12, color: NAVY }}>{brand?.nombre || brandId}</span>
        <span style={{ color: MUTED }}>/</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: NAVY }}>
          {lang === "es" ? "Precios — " : "Pricing — "}{client.razon_social || client.name}
        </span>
      </div>

      {/* Header · cliente + snapshot financiero */}
      <div style={{
        background: `linear-gradient(135deg, ${NAVY} 0%, #1A2F52 100%)`,
        color: "#FFFFFF", padding: "20px 24px", borderRadius: 12,
        marginBottom: 20,
        display: "grid",
        gridTemplateColumns: isAdmin ? "1fr auto" : "1fr",
        gap: 18, alignItems: "center",
      }}>
        <div>
          <div style={{ font: "500 10.5px/1 var(--font-body)", opacity: 0.65,
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
            {lang === "es" ? "Asignación de precios" : "Pricing assignment"}
          </div>
          <div style={{ font: "700 20px/1.2 var(--font-body)" }}>
            {client.razon_social || client.name}
          </div>
          <div style={{ font: "500 11.5px/1.4 var(--font-body)", opacity: 0.75, marginTop: 4 }}>
            {brand?.nombre || "—"} · {client.country || client.pais_iso2}
          </div>
        </div>

        {/* Snapshot financiero · CEO-ONLY */}
        {isAdmin && (
          <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
            <SnapshotBadge
              label={lang === "es" ? "Comisión" : "Commission"}
              value={client.comision_pct != null ? `${(Number(client.comision_pct) * 100).toFixed(2)}%` : "—"}
              color={LIGHT}
            />
            <SnapshotBadge
              label={lang === "es" ? "Días crédito" : "Credit days"}
              value={`${client.credito_dias ?? client.dias_credito ?? 0}d`}
              color="#FFFFFF"
            />
            <SnapshotBadge
              label={lang === "es" ? "Límite" : "Limit"}
              value={fmtMoney(client.credito_limit_usd ?? client.credito_limit)}
              color="#FFFFFF"
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {banner && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{
              padding: "10px 14px", marginBottom: 16,
              background: banner.type === "success" ? `${MINT}15` : `${RED}15`,
              color: banner.type === "success" ? "#065F46" : "#991B1B",
              border: `1px solid ${banner.type === "success" ? `${MINT}55` : `${RED}55`}`,
              borderRadius: 8,
              font: "500 12.5px/1.4 var(--font-body)",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {banner.type === "success" ? <IconCheck size={14}/> : <IconAlert size={14}/>}
            {banner.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>

        {/* ── Sección 1 · Archivo de precios (drag & drop) ── */}
        <Section
          title={lang === "es" ? "Archivo de precios" : "Price file"}
          subtitle={lang === "es"
            ? "Sube el Excel con los precios base por SKU. Opcional — puedes guardar sólo con modificadores."
            : "Upload the Excel with base prices per SKU. Optional — can be saved with modifiers only."}
        >
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? MINT : file ? MINT : "#CBD5E1"}`,
              background: dragOver ? `${MINT}0D` : file ? `${MINT}06` : SOFT,
              borderRadius: 12,
              padding: 28, textAlign: "center",
              cursor: "pointer",
              transition: "all 160ms ease",
            }}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" hidden
                   onChange={e => handleFile(e.target.files?.[0])}/>
            {file ? (
              <div>
                <IconCheck size={28} style={{ color: MINT, marginBottom: 8 }}/>
                <div style={{ font: "700 14px/1.2 var(--font-body)", color: NAVY }}>
                  {file.name}
                </div>
                <div style={{ font: "500 11.5px/1.3 var(--font-body)", color: MUTED, marginTop: 4 }}>
                  {(file.size / 1024).toFixed(1)} KB
                </div>
                <button type="button"
                  onClick={e => { e.stopPropagation(); setFile(null); }}
                  style={{
                    marginTop: 10, padding: "4px 10px",
                    border: "1px solid #E5E7EB", background: "#FFFFFF",
                    color: MUTED, borderRadius: 6, cursor: "pointer",
                    font: "500 11px/1 var(--font-body)",
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}
                >
                  <IconX size={10}/>
                  {lang === "es" ? "Cambiar archivo" : "Change file"}
                </button>
              </div>
            ) : (
              <div>
                <IconUpload size={28} style={{ color: dragOver ? MINT : MUTED, marginBottom: 10 }}/>
                <div style={{ font: "700 14px/1.2 var(--font-body)", color: NAVY }}>
                  {lang === "es"
                    ? "Arrastra el Excel aquí o click para seleccionar"
                    : "Drag the Excel here or click to select"}
                </div>
                <div style={{ font: "500 11.5px/1.4 var(--font-body)", color: MUTED, marginTop: 4 }}>
                  .xlsx · .xls · .csv · max 15 MB
                </div>
              </div>
            )}
          </div>
          {fileError && (
            <div style={{
              marginTop: 8, font: "500 11px/1.3 var(--font-body)", color: RED,
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              <IconAlert size={11}/>
              {fileError}
            </div>
          )}
        </Section>

        {/* ── Sección 2 · Vigencia ── */}
        <Section
          title={lang === "es" ? "Vigencia" : "Validity"}
          subtitle={lang === "es"
            ? "Período en que estos precios estarán activos para el cliente."
            : "Period when these prices will be active for the client."}
        >
          <Grid cols={2}>
            <Field label={lang === "es" ? "Fecha de inicio" : "Start date"}>
              <Input type="date" value={fechaInicio}
                     onChange={v => setFechaInicio(v)}/>
            </Field>

            <div>
              <Label>{lang === "es" ? "Fecha de finalización" : "End date"}</Label>
              <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                <Input type="date" value={fechaFin}
                       onChange={v => setFechaFin(v)}
                       disabled={fechaFinIndef}
                       style={{ opacity: fechaFinIndef ? 0.5 : 1 }}/>
                <motion.button type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => {
                    const next = !fechaFinIndef;
                    setFechaFinIndef(next);
                    if (next) setFechaFin("");
                  }}
                  style={{
                    padding: "0 14px",
                    border: `1.5px solid ${fechaFinIndef ? MINT : "#E5E7EB"}`,
                    background: fechaFinIndef ? `${MINT}10` : "#FFFFFF",
                    color: fechaFinIndef ? MINT : INK,
                    font: "600 11.5px/1 var(--font-body)",
                    borderRadius: 6, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 4,
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}
                >
                  {fechaFinIndef && <IconCheck size={11}/>}
                  {lang === "es" ? "Indefinida" : "Indefinite"}
                </motion.button>
              </div>
            </div>
          </Grid>
        </Section>

        {/* ── Sección 3 · Sobre-precio ── */}
        <Section
          title={lang === "es" ? "Sobre-precio" : "Price markup"}
          subtitle={lang === "es"
            ? "Se aplica multiplicativamente sobre el precio base del Excel. Opcional."
            : "Multiplicative adjustment over the Excel base price. Optional."}
          badge={{ label: "OPCIONAL", color: MUTED, bg: "#F1F5F9" }}
        >
          <SliderField
            value={sobrePrecioPct}
            onChange={setSobrePrecioPct}
            min={0} max={30} step={0.5}
            unit="%"
            labels={["0%", "10%", "20%", "30%"]}
            colorFor={pct => pct >= 20 ? RED : pct >= 10 ? AMBER : MINT}
          />
        </Section>

        {/* ── Sección 4 · Descuento Pronto Pago ── */}
        <Section
          title={lang === "es" ? "Descuento Pronto Pago" : "Early Payment Discount"}
          subtitle={lang === "es"
            ? "Si el cliente paga antes de X días, se aplica Y% de descuento."
            : "If the client pays within X days, apply Y% discount."}
          badge={{ label: "OPCIONAL", color: MUTED, bg: "#F1F5F9" }}
        >
          <Grid cols={2}>
            <Field label={lang === "es" ? "Días para aplicar" : "Days to apply"}
                   hint="0 — 180">
              <InputAffixed affixRight={lang === "es" ? "días" : "days"}
                            type="number" min={0} max={180}
                            value={prontoPagoDias}
                            onChange={v => setProntoPagoDias(v)}
                            placeholder="ej: 10"
                            mono tabular/>
            </Field>
            <div>
              <Label>{lang === "es" ? "Descuento" : "Discount"}</Label>
              <SliderField
                value={prontoPagoPct}
                onChange={setProntoPagoPct}
                min={0} max={30} step={0.5}
                unit="%"
                labels={["0%", "10%", "20%", "30%"]}
                colorFor={pct => pct >= 20 ? RED : pct >= 10 ? AMBER : MINT}
              />
            </div>
          </Grid>
        </Section>

        {/* ── Sección 5 · Descuento por Volumen ── */}
        <Section
          title={lang === "es" ? "Descuento por Volumen" : "Volume Discount"}
          subtitle={lang === "es"
            ? "Si la OC supera X unidades, se aplica Y% de descuento."
            : "If the PO exceeds X units, apply Y% discount."}
          badge={{ label: "OPCIONAL", color: MUTED, bg: "#F1F5F9" }}
        >
          <Grid cols={2}>
            <Field label={lang === "es" ? "Unidades mínimas" : "Minimum units"}
                   hint={lang === "es"
                     ? "Se activa cuando la cantidad total de la OC supera este número."
                     : "Triggers when the total PO quantity exceeds this number."}>
              <InputAffixed affixRight={lang === "es" ? "un." : "un."}
                            type="number" min={0}
                            value={volumenMin}
                            onChange={v => setVolumenMin(v)}
                            placeholder="ej: 500"
                            mono tabular/>
            </Field>
            <div>
              <Label>{lang === "es" ? "Descuento" : "Discount"}</Label>
              <SliderField
                value={volumenPct}
                onChange={setVolumenPct}
                min={0} max={30} step={0.5}
                unit="%"
                labels={["0%", "10%", "20%", "30%"]}
                colorFor={pct => pct >= 20 ? RED : pct >= 10 ? AMBER : MINT}
              />
            </div>
          </Grid>
        </Section>

        {/* ── Sección 6 · Notas internas ── */}
        <Section
          title={lang === "es" ? "Notas internas" : "Internal notes"}
          subtitle={lang === "es"
            ? "Contexto comercial, condiciones especiales, referencia a correos, etc."
            : "Commercial context, special conditions, email refs, etc."}
        >
          <Textarea value={notas} onChange={setNotas} rows={3}
            placeholder={lang === "es"
              ? "Ej: Negociado con J. Pérez tras reunión 2026-04-01. Válido hasta resolución de incidente SAP-9182."
              : "Negotiated with J. Pérez on 2026-04-01. Valid until SAP-9182 incident closes."}/>
        </Section>
      </div>

      {/* Footer sticky */}
      <div style={{
        position: "sticky", bottom: 0, zIndex: 5,
        marginTop: 24, padding: "14px 20px",
        background: "#FFFFFFEE", backdropFilter: "blur(6px)",
        borderTop: "1px solid #E5E7EB", borderRadius: 10,
        display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
        boxShadow: "0 -4px 14px -8px rgba(11,30,58,0.10)",
      }}>
        <div style={{ font: "500 11.5px/1.4 var(--font-body)", color: MUTED }}>
          {lang === "es"
            ? "Los términos financieros del cliente se congelan al guardar (snapshot)."
            : "Client financial terms are frozen on save (snapshot)."}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => navigate(`/marcas/${brandId}`)}
                  disabled={saving}
                  style={{
                    padding: "9px 18px", background: "transparent",
                    border: "1px solid #E5E7EB", color: INK,
                    font: "600 12.5px/1 var(--font-body)",
                    borderRadius: 8, cursor: saving ? "not-allowed" : "pointer",
                  }}>
            {lang === "es" ? "Cancelar" : "Cancel"}
          </button>
          <button type="button" onClick={save}
                  disabled={saving}
                  style={{
                    padding: "9px 22px",
                    background: saving ? "#94A3B8" : MINT,
                    color: "#FFFFFF", border: "none",
                    font: "700 12.5px/1 var(--font-body)",
                    borderRadius: 8,
                    cursor: saving ? "not-allowed" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
            <IconCheck size={13}/>
            {saving
              ? (lang === "es" ? "Guardando…" : "Saving…")
              : (lang === "es" ? "Guardar asignación" : "Save assignment")}
          </button>
        </div>
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// Slider reutilizable con labels y color dinámico
// ═════════════════════════════════════════════════════════════
function SliderField({ value, onChange, min, max, step, unit = "%", labels = [], colorFor }) {
  const color = (colorFor ? colorFor(Number(value)) : MINT);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <span style={{
          color, font: "700 12.5px/1 var(--font-body)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {Number(value).toFixed(1)}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: color, cursor: "pointer" }}
      />
      <div style={{
        display: "flex", justifyContent: "space-between",
        font: "500 9.5px/1 var(--font-body)", color: MUTED,
        marginTop: 2,
      }}>
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// Snapshot pill (header)
// ═════════════════════════════════════════════════════════════
function SnapshotBadge({ label, value, color }) {
  return (
    <div style={{
      padding: "8px 14px",
      background: "rgba(255,255,255,0.08)",
      borderRadius: 10, minWidth: 88,
    }}>
      <div style={{
        font: "500 9.5px/1 var(--font-body)", opacity: 0.65,
        textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        <IconLock size={8}/> {label}
      </div>
      <div style={{
        font: "700 16px/1 var(--font-body)",
        color, fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
    </div>
  );
}


// ═════════════════════════════════════════════════════════════
// Primitivas UI
// ═════════════════════════════════════════════════════════════
function Section({ title, subtitle, badge, highlight, children }) {
  return (
    <section style={{
      padding: "18px 20px",
      background: "#FFFFFF",
      border: `1px solid ${highlight ? `${highlight}33` : "#E5E7EB"}`,
      borderLeft: highlight ? `3px solid ${highlight}` : `1px solid #E5E7EB`,
      borderRadius: 10,
    }}>
      <div style={{ marginBottom: 4 }}>
        <div style={{ font: "700 14px/1.2 var(--font-body)", color: NAVY,
          display: "flex", alignItems: "center", gap: 8 }}>
          {title}
          {badge && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "3px 8px", borderRadius: 12,
              background: badge.bg || badge.color,
              color: badge.bg ? badge.color : "#FFFFFF",
              font: "700 9.5px/1 var(--font-body)",
              letterSpacing: 0.4, textTransform: "uppercase",
            }}>
              {badge.icon}
              {badge.label}
            </span>
          )}
        </div>
        {subtitle && (
          <div style={{ font: "500 12px/1.4 var(--font-body)", color: MUTED, marginTop: 3 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  );
}

function Grid({ cols = 2, children }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: 14,
    }}>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <label style={{
      display: "block",
      font: "600 11px/1 var(--font-body)", color: NAVY,
      marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.4,
    }}>
      {children}
    </label>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {error ? (
        <div style={{ font: "500 10.5px/1.3 var(--font-body)", color: RED, marginTop: 4,
          display: "inline-flex", alignItems: "center", gap: 3 }}>
          <IconAlert size={10}/>{error}
        </div>
      ) : hint ? (
        <div style={{ font: "500 10.5px/1.3 var(--font-body)", color: MUTED, marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Input({ value, onChange, onBlur, type = "text", mono, tabular, style, ...rest }) {
  return (
    <input
      type={type}
      value={value ?? ""}
      onChange={e => onChange && onChange(e.target.value)}
      onBlur={onBlur}
      {...rest}
      style={{
        width: "100%", padding: "9px 11px",
        border: "1px solid #E5E7EB", borderRadius: 6,
        font: `500 13px/1.2 ${mono ? "var(--font-mono, ui-monospace)" : "var(--font-body)"}`,
        color: NAVY, background: "#FFFFFF", outline: "none",
        fontVariantNumeric: tabular ? "tabular-nums" : undefined,
        ...style,
      }}
    />
  );
}

function InputAffixed({ affixLeft, affixRight, value, onChange, type = "text", mono, tabular, ...rest }) {
  return (
    <div style={{
      display: "flex", alignItems: "stretch",
      border: "1px solid #E5E7EB", borderRadius: 6,
      overflow: "hidden", background: "#FFFFFF",
    }}>
      {affixLeft && (
        <span style={{ padding: "8px 11px", background: SOFT, color: MUTED,
          font: "600 12px/1 var(--font-body)", borderRight: "1px solid #E5E7EB",
          display: "grid", placeItems: "center" }}>
          {affixLeft}
        </span>
      )}
      <input type={type}
        value={value ?? ""}
        onChange={e => onChange && onChange(e.target.value)}
        {...rest}
        style={{
          flex: 1, minWidth: 0, padding: "9px 11px",
          border: "none", outline: "none",
          font: `600 13px/1.2 ${mono ? "var(--font-mono, ui-monospace)" : "var(--font-body)"}`,
          color: NAVY, fontVariantNumeric: tabular ? "tabular-nums" : undefined,
        }}
      />
      {affixRight && (
        <span style={{ padding: "8px 11px", background: SOFT, color: MUTED,
          font: "500 10.5px/1 var(--font-body)", borderLeft: "1px solid #E5E7EB",
          display: "grid", placeItems: "center",
          textTransform: "uppercase", letterSpacing: 0.4 }}>
          {affixRight}
        </span>
      )}
    </div>
  );
}

function Textarea({ value, onChange, rows = 3, ...rest }) {
  return (
    <textarea value={value ?? ""}
      onChange={e => onChange && onChange(e.target.value)}
      rows={rows}
      {...rest}
      style={{
        width: "100%", padding: "10px 11px",
        border: "1px solid #E5E7EB", borderRadius: 6,
        font: "500 13px/1.5 var(--font-body)", color: NAVY,
        background: "#FFFFFF", outline: "none", resize: "vertical",
      }}
    />
  );
}


// ─── Utilidades ───
function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function fmtMoney(n) {
  const v = Number(n || 0);
  if (!v) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const btnGhost = {
  padding: "6px 10px", background: "transparent",
  border: "1px solid #E5E7EB", color: INK,
  font: "600 12px/1 var(--font-body)",
  borderRadius: 6, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 4,
};

const emptyCard = {
  padding: 40, textAlign: "center",
  background: SOFT, borderRadius: 10, border: "1px dashed #E5E7EB",
  color: MUTED, font: "500 13px/1.4 var(--font-body)",
  maxWidth: 420, margin: "60px auto",
};
