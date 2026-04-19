// =====================================================================
// MWT.ONE · ProtectedRoute.jsx
// Envoltura que exige sesión activa. Si no hay usuario autenticado
// redirige a /login conservando la ruta original en location.state.from.
// =====================================================================
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProtectedRoute({ children, module, action = "view" }) {
  const location = useLocation();
  const { user, bootstrapped, has } = useAuth();

  if (!bootstrapped) return null; // esperamos a leer localStorage

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Verificación de permisos por módulo (opcional)
  if (module && !has(module, action)) {
    return (
      <div className="page">
        <div className="card card-pad-lg empty">
          <div className="heading-md">Acceso restringido</div>
          <div className="body-sm text-sec" style={{ maxWidth: 420 }}>
            Tu rol ({user.role_name || user.role}) no tiene permiso para acceder a este módulo.
          </div>
        </div>
      </div>
    );
  }

  return children;
}
