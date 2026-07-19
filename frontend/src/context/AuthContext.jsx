// =====================================================================
// MWT.ONE · AuthContext.jsx
// Manejo de sesión (JWT access + refresh), perfil de usuario (rol,
// permisos) y helpers de autorización.
//
// Modo de operación:
//   · POST /api/auth/login  →  { access, refresh, user }
//   · Token + user persistidos en localStorage (key: 'mwt-auth')
//   · Fallback DEV: si el backend no está activo, se permite login
//     directo validando el SHA-256 contra el hash del admin seed
//     (alejandro@muitowork.com / MuitoWork2026?). Esto permite probar
//     la UI antes de levantar Django.
// =====================================================================
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { authApi, ApiError, refreshAccessToken } from "../lib/api.js";
import { clearCache } from "../lib/swrCache.js";

const AUTH_KEY = "mwt-auth";

// Sprint 2026-07-19 · Cierre de sesión por inactividad (30 min).
// La última actividad REAL del usuario vive en localStorage para que
// cuente en cualquier pestaña abierta. Los timers automáticos (refresh
// proactivo, etc.) NO cuentan como actividad.
const ACTIVITY_KEY  = "mwt-activity";
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];

// Hash SHA-256 del password admin (para fallback DEV). Generado con:
//   printf '%s' 'MuitoWork2026?' | sha256sum
const ADMIN_FALLBACK = {
  email:     "alejandro@muitowork.com",
  usernames: ["alejandro@muitowork.com", "admin", "alejandro"],
  sha256:    "9fd0f3edaadea3046e561859e9f211878e8d124b1c196ddad82924ed570c05f9",
  user: {
    id:    "00000000-0000-0000-0000-000000000001",
    email: "alejandro@muitowork.com",
    full_name: "Alejandro Mendoza",
    role: "admin",
    role_name: "Admin",
    permissions: {
      modules: ["*"],
      actions: ["view","create","edit","delete","export","admin"],
    },
  },
};

// SHA-256 en browser via WebCrypto
async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,        setUser]        = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [refresh,     setRefresh]     = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError,   setAuthError]   = useState("");
  const [bootstrapped, setBootstrapped] = useState(false);

  // --- bootstrap desde localStorage ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (raw) {
        const { user: u, access, refresh: r } = JSON.parse(raw);
        if (u) setUser(u);
        if (access) setAccessToken(access);
        if (r) setRefresh(r);
      }
    } catch { /* noop */ }
    setBootstrapped(true);
  }, []);

  // Sprint 2026-05-31 · Sincronización con el auto-refresh de lib/api.js.
  // Cuando apiFetch refresca el access token (o fuerza logout porque el
  // refresh expiró), emite eventos en window. Acá mantenemos el state de
  // React alineado con localStorage para que ninguna vista quede con un
  // token viejo ni con sesión fantasma.
  useEffect(() => {
    const onRefreshed = (e) => {
      const acc = e?.detail?.access;
      const ref = e?.detail?.refresh;
      if (acc) setAccessToken(acc);
      if (ref) setRefresh(ref);
    };
    const onForcedLogout = () => {
      setUser(null);
      setAccessToken(null);
      setRefresh(null);
      try { localStorage.removeItem(AUTH_KEY); } catch { /* noop */ }
      try { localStorage.removeItem(ACTIVITY_KEY); } catch { /* noop */ }
    };
    window.addEventListener("mwt-auth-refreshed", onRefreshed);
    window.addEventListener("mwt-auth-logout", onForcedLogout);
    return () => {
      window.removeEventListener("mwt-auth-refreshed", onRefreshed);
      window.removeEventListener("mwt-auth-logout", onForcedLogout);
    };
  }, []);

  // Sprint 2026-05-31 · Refresh PROACTIVO. El access token dura 30 min
  // (SIMPLE_JWT.ACCESS_TOKEN_LIFETIME). Refrescamos al bootstrap y cada
  // 25 min para que ninguna vista —ni siquiera las que usan fetch crudo
  // con getToken()— vea un token expirado. El refresh dura 7 días.
  useEffect(() => {
    if (!bootstrapped || !refresh) return;
    if (String(refresh).startsWith("dev-local")) return; // sesión DEV
    refreshAccessToken();
    const id = setInterval(() => { refreshAccessToken(); }, 25 * 60 * 1000);
    return () => clearInterval(id);
  }, [bootstrapped, refresh]);

  const persist = (payload) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
  };
  const clearPersist = () => localStorage.removeItem(AUTH_KEY);

  // --- login ---
  const login = useCallback(async (usuario, password) => {
    setAuthLoading(true);
    setAuthError("");
    try {
      // 1) Intento contra el backend real
      let data;
      try {
        data = await authApi.login(usuario, password);
      } catch (err) {
        // Si el backend no responde (HTTP 0 / 404), caemos al fallback DEV.
        const backendDown = err instanceof ApiError && (err.status === 0 || err.status === 404);
        if (!backendDown) throw err;

        // Fallback DEV: validamos contra el admin seed
        const hash = await sha256Hex(password);
        const userOk = ADMIN_FALLBACK.usernames.includes(usuario.toLowerCase());
        if (!userOk || hash !== ADMIN_FALLBACK.sha256) {
          throw new ApiError("Usuario o contraseña incorrectos", 401, null);
        }
        data = {
          access:  "dev-local-" + Date.now(),
          refresh: "dev-local-refresh-" + Date.now(),
          user:    ADMIN_FALLBACK.user,
        };
      }

      setUser(data.user);
      setAccessToken(data.access);
      setRefresh(data.refresh);
      persist({ user: data.user, access: data.access, refresh: data.refresh });
      return data.user;
    } catch (err) {
      const msg = err?.message || "Error al iniciar sesión";
      setAuthError(msg);
      throw err;
    } finally {
      setAuthLoading(false);
    }
  }, []);

  // --- logout ---
  const logout = useCallback(async () => {
    try { if (accessToken && refresh) await authApi.logout(accessToken, refresh); } catch { /* noop */ }
    setUser(null);
    setAccessToken(null);
    setRefresh(null);
    clearPersist();
    try { localStorage.removeItem(ACTIVITY_KEY); } catch { /* noop */ }
    clearCache(); // purga la caché SWR de datos del usuario saliente (R3)
  }, [accessToken, refresh]);

  // Sprint 2026-07-19 · Cierre automático por inactividad (30 min).
  //
  // La sesión PERSISTE en localStorage: cerrar el navegador o apagar la
  // computadora NO la pierde (bootstrap la restaura y el refresh dura
  // 7 días). El cierre por inactividad escucha SOLO actividad real del
  // usuario: mouse, teclado, touch, scroll y click (una recarga también
  // cuenta — el montaje renueva la actividad). El refresh proactivo de
  // 25 min NO cuenta (es un timer, no el usuario).
  //
  // Última actividad compartida en localStorage → una acción en
  // cualquier pestaña mantiene vivas todas las pestañas abiertas.
  const logoutRef = useRef(null);
  useEffect(() => { logoutRef.current = logout; }, [logout]);

  useEffect(() => {
    if (!bootstrapped || !user) return;
    // Montaje/login cuenta como actividad fresca.
    try { localStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch { /* noop */ }
    let lastWrite = 0;
    const onActivity = () => {
      const t = Date.now();
      if (t - lastWrite < 5000) return; // throttle: 1 escritura / 5 s
      lastWrite = t;
      try { localStorage.setItem(ACTIVITY_KEY, String(t)); } catch { /* noop */ }
    };
    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true }));
    const id = setInterval(() => {
      let last = 0;
      try { last = Number(localStorage.getItem(ACTIVITY_KEY) || 0); } catch { /* noop */ }
      if (last && Date.now() - last > IDLE_LIMIT_MS) {
        logoutRef.current?.();
      }
    }, 30 * 1000);
    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      clearInterval(id);
    };
  }, [bootstrapped, user]);

  // --- autorización ---
  const has = useCallback((module, action = "view") => {
    if (!user) return false;
    const p = user.permissions || {};
    const mods = p.modules || [];
    const acts = p.actions || [];
    if (mods.includes("*")) return true;
    if (!mods.includes(module)) return false;
    if (!acts.length) return true;
    return acts.includes("*") || acts.includes(action);
  }, [user]);

  const value = {
    user,
    role:          user?.role || null,
    roleName:      user?.role_name || null,
    permissions:   user?.permissions || {},
    accessToken,
    refresh,
    authLoading,
    authError,
    bootstrapped,
    login,
    logout,
    has,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider/>");
  return ctx;
}
