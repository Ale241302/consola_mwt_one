// =====================================================================
// MWT.ONE · Login.jsx
// Pantalla de acceso — réplica 1:1 del mock (fondo navy + card centrada).
// Flujo:
//   1. Usuario ingresa credenciales.
//   2. POST /api/auth/login → backend verifica SHA-256 vs core.users.password_hash.
//   3. Backend responde { access, refresh, user: { id, email, role, permissions } }.
//   4. AuthContext persiste la sesión y se redirige a /dashboard.
// =====================================================================
import React, { useState, useEffect } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const LOGO_URL = "https://mwt.one/images/2024/12/04/recurso-1logo_foot.png";

// ───────────── iconos inline (mantenemos el estilo lucide del resto) ─────────────
const IconUser = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/>
    <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>
  </svg>
);
const IconLock = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2"/>
    <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
  </svg>
);
const IconEye = ({ size = 18, closed = false }) =>
  closed ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18"/>
      <path d="M10.6 6.1A10.2 10.2 0 0 1 12 6c5 0 9 4 10 6-0.5 1-1.7 2.6-3.5 4"/>
      <path d="M6.6 6.6C4.2 8.1 2.5 10.4 2 12c1 2 5 6 10 6 1.5 0 2.9-.3 4.1-.8"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
const IconAlert = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 8v4M12 16h.01"/>
  </svg>
);

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, authError, authLoading } = useAuth();

  const [usuario,  setUsuario]  = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [localErr, setLocalErr] = useState("");

  // Si ya hay sesión activa → redirigir directo
  if (user) {
    const to = location.state?.from?.pathname || "/dashboard";
    return <Navigate to={to} replace />;
  }

  useEffect(() => {
    document.title = "MWT ONE · Ingreso";
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLocalErr("");
    if (!usuario.trim() || !password) {
      setLocalErr("Completa usuario y contraseña");
      return;
    }
    try {
      await login(usuario.trim(), password);
      const to = location.state?.from?.pathname || "/dashboard";
      navigate(to, { replace: true });
    } catch (err) {
      // AuthContext ya dejó authError; setLocalErr queda como fallback
      if (!authError) setLocalErr(err?.message || "Error al iniciar sesión");
    }
  };

  const errorMsg = localErr || authError;

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit} autoComplete="on" noValidate>
        {/* ---- Brand (solo logo, sin texto — el logo ya dice MWT ONE) ---- */}
        <div className="login-brand">
          <img
            src={LOGO_URL}
            alt="MWT ONE"
            className="login-logo"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </div>
        <div className="login-tagline">Ingresa tus credenciales para continuar</div>

        <div className="login-form">
          {/* ---- Usuario ---- */}
          <div className="login-field">
            <label className="login-label" htmlFor="login-user">Usuario</label>
            <div className="login-input-wrap">
              <span className="login-input-icon"><IconUser/></span>
              <input
                id="login-user"
                className="login-input"
                type="text"
                placeholder="admin"
                value={usuario}
                autoComplete="username"
                autoFocus
                onChange={(e) => setUsuario(e.target.value)}
                disabled={authLoading}
              />
            </div>
          </div>

          {/* ---- Contraseña ---- */}
          <div className="login-field">
            <label className="login-label" htmlFor="login-pass">Contraseña</label>
            <div className="login-input-wrap">
              <span className="login-input-icon"><IconLock/></span>
              <input
                id="login-pass"
                className="login-input"
                type={showPass ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                disabled={authLoading}
              />
              <button
                type="button"
                className="login-eye"
                aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                onClick={() => setShowPass(s => !s)}
                tabIndex={-1}
              >
                <IconEye closed={showPass}/>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="login-error" role="alert">
              <IconAlert/><span>{errorMsg}</span>
            </div>
          )}

          <button className="login-submit" type="submit" disabled={authLoading}>
            {authLoading && <span className="login-spinner"/>}
            Ingresar a la plataforma
          </button>
        </div>

        <div className="login-foot">
          <b>MWT.ONE</b> · Control Center · v0.1.0
        </div>
      </form>
    </div>
  );
}
