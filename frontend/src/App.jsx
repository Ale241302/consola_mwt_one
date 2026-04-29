// MWT.ONE · App — routes
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import ScreenPasswordReset from "./pages/PasswordReset.jsx";
import ScreenDashboard from "./pages/Dashboard.jsx";
import ScreenExpedientes from "./pages/Expedientes.jsx";
import ScreenOCDetail from "./pages/OCDetail.jsx";
import ScreenExpedienteDetail from "./pages/ExpedienteDetail.jsx";
import ScreenPipeline from "./pages/Pipeline.jsx";
import ScreenPortal from "./pages/Portal.jsx";
import ScreenPagos from "./pages/Pagos.jsx";
import ScreenInventario from "./pages/Inventario.jsx";
import ScreenWizard from "./pages/Wizard.jsx";
import CreateExpedienteWizard from "./pages/CreateExpedienteWizard.jsx";
import ScreenTransfers from "./pages/Transfers.jsx";
import ScreenTransferDetail from "./pages/TransferDetail.jsx";
import ScreenCreateTransferWizard from "./pages/CreateTransferWizard.jsx";
import ScreenNodos from "./pages/Nodos.jsx";
import ScreenNodoDetail from "./pages/NodoDetail.jsx";
import ScreenClientes from "./pages/Clientes.jsx";
import ScreenClienteDetail from "./pages/ClienteDetail.jsx";
import ScreenClienteFormView from "./pages/ClienteFormView.jsx";
import ScreenBrands from "./pages/Brands.jsx";
import ScreenBrandDetail from "./pages/BrandDetail.jsx";
import ScreenBrandClientPricingForm from "./pages/BrandClientPricingForm.jsx";
import ScreenProductos from "./pages/Productos.jsx";
import ScreenProductFormView from "./pages/ProductFormView.jsx";
import ScreenSizingEngine from "./pages/SizingEngine.jsx";
import ScreenProveedores from "./pages/Proveedores.jsx";
import ScreenSupplierFormView from "./pages/SupplierFormView.jsx";
import ScreenSupplierDetail from "./pages/SupplierDetail.jsx";
import ScreenEmailTemplates from "./pages/EmailTemplates.jsx";
import ScreenNotificaciones from "./pages/Notificaciones.jsx";
import ScreenCobros from "./pages/Cobros.jsx";
import ScreenAIHub from "./pages/AIHub.jsx";
import ScreenAIChat from "./pages/AIChat.jsx";
import ScreenAIGovernance from "./pages/AIGovernance.jsx";
import ScreenUsers from "./pages/Users.jsx";
import ScreenUserFormView from "./pages/UserFormView.jsx";
import ScreenRolesPermissions from "./pages/RolesPermissions.jsx";
import ScreenProfilePage from "./pages/ProfilePage.jsx";
import { useRole } from "./context/RoleContext.jsx";

// ── Route guard: CEO-ONLY páginas bloqueadas para CLIENT B2B.
// AI Hub Governance expone catálogos (agentes, skills, instrucciones)
// que son gobernanza interna MWT. El cliente no debe poder navegar ahí
// aunque conozca la URL — se redirige a /ai (su chat). El backend
// también devuelve 403 como defensa de segunda línea.
function AdminOnlyRoute({ children }) {
  const { isClient } = useRole();
  if (isClient) return <Navigate to="/ai" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Públicas */}
      <Route path="/login" element={<Login />} />
      <Route path="/reset" element={<ScreenPasswordReset />} />

      {/* Protegidas — todas pasan por <ProtectedRoute/> y comparten AppLayout */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<ScreenDashboard />} />
        <Route path="/expedientes" element={<ScreenExpedientes />} />
        <Route path="/expedientes/:ocId" element={<ScreenOCDetail />} />
        <Route path="/expedientes/:ocId/exp/:expedienteId" element={<ScreenExpedienteDetail />} />
        <Route path="/pipeline" element={<ScreenPipeline />} />
        <Route path="/portal" element={<ScreenPortal />} />
        <Route path="/financiero" element={<ScreenPagos />} />
        <Route path="/inventario" element={<ScreenInventario />} />
        <Route path="/wizard" element={<ScreenWizard />} />
        {/* Nuevo wizard multirol (ADMIN 4 pasos / CLIENT 3 pasos) — reemplazo de /wizard */}
        <Route path="/expedientes/nuevo" element={<CreateExpedienteWizard />} />
        <Route path="/portal/nueva-oc"  element={<CreateExpedienteWizard />} />
        <Route path="/transferencias" element={<ScreenTransfers />} />
        {/* Wizard full-page · debe ir ANTES de :transferId para no matchear "nueva" como id */}
        <Route path="/transferencias/nueva" element={<ScreenCreateTransferWizard />} />
        <Route path="/transferencias/:transferId" element={<ScreenTransferDetail />} />
        <Route path="/nodos" element={<ScreenNodos />} />
        <Route path="/nodos/:nodeId" element={<ScreenNodoDetail />} />
        <Route path="/clientes" element={<ScreenClientes />} />
        {/* Form full-page · debe ir ANTES del detail para no matchear /nuevo como :clienteId */}
        <Route path="/clientes/nuevo"                element={<ScreenClienteFormView />} />
        <Route path="/clientes/:clienteId/editar"    element={<ScreenClienteFormView />} />
        <Route path="/clientes/:clienteId"           element={<ScreenClienteDetail />} />
        <Route path="/marcas" element={<ScreenBrands />} />
        {/* Precios cliente-marca · vista full-page con drag&drop */}
        <Route path="/marcas/:brandId/clientes/:clienteId/precios"
               element={<ScreenBrandClientPricingForm />} />
        <Route path="/marcas/:brandId" element={<ScreenBrandDetail />} />
        <Route path="/productos" element={<ScreenProductos />} />
        <Route path="/productos/nuevo" element={<ScreenProductFormView />} />
        <Route path="/productos/:productId" element={<ScreenProductFormView />} />
        {/* Ruta del Portal B2B: mismo componente, pero useRole() detecta
            CLIENT y aplica el strip-down (fieldset disabled + tabs filtradas). */}
        <Route path="/portal/productos/:productId" element={<ScreenProductFormView />} />
        <Route path="/tallas" element={<ScreenSizingEngine />} />
        <Route path="/proveedores" element={<ScreenProveedores />} />
        <Route path="/proveedores/nuevo" element={<ScreenSupplierFormView />} />
        <Route path="/proveedores/:supplierId/editar" element={<ScreenSupplierFormView />} />
        <Route path="/proveedores/:supplierId" element={<ScreenSupplierDetail />} />
        <Route path="/templates" element={<ScreenEmailTemplates />} />
        <Route path="/notificaciones" element={<ScreenNotificaciones />} />
        <Route path="/cobros" element={<ScreenCobros />} />
        <Route path="/ai" element={<ScreenAIHub />} />
        <Route path="/ai/governance" element={<AdminOnlyRoute><ScreenAIGovernance /></AdminOnlyRoute>} />
        {/* M3 CORE — Usuarios y Roles (ADMIN-only, guard vía AdminOnlyRoute) */}
        <Route path="/usuarios"          element={<AdminOnlyRoute><ScreenUsers /></AdminOnlyRoute>} />
        <Route path="/usuarios/nuevo"    element={<AdminOnlyRoute><ScreenUserFormView /></AdminOnlyRoute>} />
        <Route path="/usuarios/:userId"  element={<AdminOnlyRoute><ScreenUserFormView /></AdminOnlyRoute>} />
        <Route path="/roles"             element={<AdminOnlyRoute><ScreenRolesPermissions /></AdminOnlyRoute>} />
        {/* Perfil propio — accesible para TODOS los usuarios autenticados
            (ADMIN + CLIENT). La vista aplica read-only por rol internamente. */}
        <Route path="/perfil"            element={<ScreenProfilePage />} />
        <Route path="/ai/chat/:threadId" element={<ScreenAIChat />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
