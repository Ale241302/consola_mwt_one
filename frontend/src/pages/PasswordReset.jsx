// =====================================================================
// MWT.ONE · pages/PasswordReset.jsx
// Agente responsable: [AG-FRONTEND]
//
// Ruta pública /reset?token=<raw>  — pantalla a la que llega el usuario
// desde el enlace del email "Restablece tu contraseña".
//
// Flujo:
//   1. Lee ?token del query string.
//   2. Muestra form: nueva contraseña + confirmación.
//   3. Valida match + longitud mínima (8) en cliente.
//   4. POST a /api/auth/password-reset-confirm/
//      body: { token, new_password }
//   5. En éxito → mensaje + auto-redirect a /login en 2.5s.
//   6. En error → muestra mensaje del backend (token expirado, etc.).
//
// La ruta está fuera de <ProtectedRoute/> en App.jsx — accesible sin JWT.
// =====================================================================
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

const NAVY  = "#0F1B3D";
const MINT  = "#10B981";
const LIGHT = "#1FD39A";
const RED   = "#DC2626";
const MUTED = "#6B7894";
const INK   = "#3D4A6B";

export default function ScreenPasswordReset() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [pwd, setPwd]     = useState("");
  const [pwd2, setPwd2]   = useState("");
  const [show, setShow]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  const tokenInvalid = !token || token.length < 20;

  // Validación en vivo
  const issues = useMemo(() => {
    const out = [];
    if (pwd.length < 8) out.push("Mínimo 8 caracteres");
    if (pwd && pwd2 && pwd !== pwd2) out.push("Las contraseñas no coinciden");
    return out;
  }, [pwd, pwd2]);

  const canSubmit = !busy && !tokenInvalid && pwd.length >= 8 && pwd === pwd2;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const base = window.location.origin;
      const resp = await fetch(`${base}/api/auth/password-reset-confirm/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: pwd }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setErr(json.detail || `Error ${resp.status}`);
        return;
      }
      setOkMsg(json.message || "Contraseña actualizada.");
      // Redirect después de 2.5s
      setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (ex) {
      setErr(String(ex?.message || ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0F1B3D 0%, #1A2A5C 60%, #10B981 140%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          width: "100%", maxWidth: 440,
          background: "#FFFFFF",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 20px 60px -20px rgba(15, 27, 61, 0.45)",
        }}
      >
        {/* Header band */}
        <div style={{
          background: "linear-gradient(135deg, #0F1B3D 0%, #1A2A5C 60%, #10B981 140%)",
          padding: "28px 32px",
          color: "#FFFFFF",
        }}>
          <div style={{
            font: "600 11px/1 inherit",
            color: "rgba(255,255,255,0.75)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}>
            Seguridad de la cuenta
          </div>
          <div style={{
            font: "700 22px/1.3 inherit",
            color: "#FFFFFF",
          }}>
            Restablecer contraseña
          </div>
        </div>

        {/* Body */}
        <form onSubmit={submit} style={{ padding: "30px 32px 28px" }}>
          {tokenInvalid ? (
            <div style={errorBox}>
              El enlace no es válido o está incompleto. Solicita un nuevo
              correo de restablecimiento desde el panel de tu administrador.
            </div>
          ) : okMsg ? (
            <div>
              <div style={{
                background: `${MINT}15`,
                border: `1px solid ${MINT}55`,
                color: "#065F46",
                padding: "16px 18px",
                borderRadius: 10,
                font: "500 14px/1.5 inherit",
                marginBottom: 16,
              }}>
                ✓ {okMsg}
              </div>
              <div style={{ font: "500 13px/1.5 inherit", color: MUTED, textAlign: "center" }}>
                Redirigiendo al inicio de sesión…
              </div>
            </div>
          ) : (
            <>
              <div style={{
                font: "500 14px/1.5 inherit", color: INK, marginBottom: 18,
              }}>
                Define una nueva contraseña para tu cuenta. Mínimo 8 caracteres.
              </div>

              {/* Password */}
              <label style={labelStyle}>Nueva contraseña</label>
              <div style={inputWrap}>
                <input
                  type={show ? "text" : "password"}
                  value={pwd}
                  onChange={e => setPwd(e.target.value)}
                  autoFocus
                  placeholder="••••••••"
                  style={inputStyle}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShow(s => !s)}
                        style={eyeBtn} aria-label="Mostrar/ocultar">
                  {show ? "🙈" : "👁"}
                </button>
              </div>

              {/* Confirmation */}
              <label style={{ ...labelStyle, marginTop: 14 }}>Confirma la contraseña</label>
              <input
                type={show ? "text" : "password"}
                value={pwd2}
                onChange={e => setPwd2(e.target.value)}
                placeholder="••••••••"
                style={inputStyle}
                autoComplete="new-password"
              />

              {/* Issues live */}
              {(pwd || pwd2) && issues.length > 0 && (
                <div style={{
                  marginTop: 10, font: "500 12px/1.5 inherit",
                  color: "#92400E", background: "#FFFBEB",
                  border: "1px solid #FDE68A", padding: "8px 12px",
                  borderRadius: 8,
                }}>
                  {issues.map((i, k) => <div key={k}>· {i}</div>)}
                </div>
              )}

              {/* Server error */}
              <AnimatePresence>
                {err && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={errorBox}
                  >
                    {err}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button type="submit" disabled={!canSubmit}
                style={{
                  width: "100%",
                  marginTop: 22,
                  padding: "14px 18px",
                  background: canSubmit
                    ? "linear-gradient(135deg, #0FB97A 0%, #10B981 50%, #1FD39A 100%)"
                    : "#94A3B8",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 10,
                  font: "700 14.5px/1 inherit",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  boxShadow: canSubmit ? "0 4px 12px rgba(16,185,129,0.28)" : "none",
                  transition: "background 130ms ease",
                }}
              >
                {busy ? "Actualizando…" : "Actualizar contraseña"}
              </button>

              <div style={{
                marginTop: 16, textAlign: "center",
                font: "500 12px/1.5 inherit", color: MUTED,
              }}>
                <a href="/login" style={{ color: MINT, textDecoration: "none", fontWeight: 600 }}>
                  Volver al inicio de sesión
                </a>
              </div>
            </>
          )}
        </form>

        {/* Footer */}
        <div style={{
          padding: "16px 32px",
          background: "#F7F9FC",
          borderTop: "1px solid #EAEEF5",
          font: "500 11px/1.5 inherit",
          color: "#8893AC",
          textAlign: "center",
        }}>
          ¿Necesitas ayuda? <a href="mailto:info@mwt.one"
            style={{ color: MINT, fontWeight: 600 }}>info@mwt.one</a>
        </div>
      </motion.div>
    </div>
  );
}

const labelStyle = {
  display: "block",
  font: "600 11px/1 inherit",
  color: NAVY,
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  border: "1.5px solid #E5EAF2",
  borderRadius: 8,
  font: "500 14px/1.2 inherit",
  color: NAVY,
  background: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};

const inputWrap = {
  position: "relative",
};

const eyeBtn = {
  position: "absolute",
  right: 8, top: "50%",
  transform: "translateY(-50%)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 18,
  padding: 4,
};

const errorBox = {
  background: `${RED}15`,
  border: `1px solid ${RED}55`,
  color: "#991B1B",
  padding: "12px 14px",
  borderRadius: 10,
  font: "500 13px/1.5 -apple-system, sans-serif",
  marginTop: 14,
};
