// =====================================================================
// MWT.ONE · AuthContext.jsx
// Manejo de sesión (JWT access + refresh), perfil de usuario (rol,
// permisos) y helpers de autorización.
//
// Modo de operación:
//   · POST /api/auth/login  →  { access, refresh, user }
//   · Token + user persistidos en localStorage (key: 'mwt-auth')
//   · No hay fallback local: en producción el backend es la única fuente de
//     verdad. Para desarrollo local usar VITE_USE_MOCKS o levantar Django.
// =====================================================================
import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { authApi, refreshAccessToken } from "../lib/api.js";
import { clearCache } from "../lib/swrCache.js";
import { queryClient } from "../lib/queryClient.js";

const AUTH_KEY = "mwt-auth";

// Sprint 2026-07-19 · Cierre de sesión por inactividad (30 min).
// La última actividad REAL del usuario vive en localStorage para que
// cuente en cualquier pestaña abierta. Los timers automáticos (refresh
// proactivo, etc.) NO cuentan como actividad.
const ACTIVITY_KEY  = "mwt-activity";
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];

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
      // 1) Intento contra el backend real (único camino válido)
      const data = await authApi.login(usuario, password);

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
    // Ola 3 · 3.26 · React Query: purga la caché de estado servidor para no
    // filtrar datos entre usuarios en la misma máquina (paridad con swrCache).
    queryClient.clear();
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
