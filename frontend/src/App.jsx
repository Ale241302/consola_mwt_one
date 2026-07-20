// MWT.ONE · App — routes
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import ScreenPasswordReset from "./pages/PasswordReset.jsx";
import ScreenDashboard from "./pages/Dashboard.jsx";
import ScreenExpedientes from "./pages/Expedientes.jsx";
// Sprint 2026-06-10 · Cronograma interactivo (reemplaza al Resumen .html).
import ScreenCronograma from "./pages/Cronograma.jsx";
import ScreenOCDetail from "./pages/OCDetail.jsx";
// Sprint 2026-06-11 · detalle combinado de expedientes fusionados (E3).
import ScreenFusionDetail from "./pages/FusionDetail.jsx";
import ScreenExpedienteDetail from "./pages/ExpedienteDetail.jsx";
import ScreenPipeline from "./pages/Pipeline.jsx";
import ScreenPortal from "./pages/Portal.jsx";
import PortalDiag from "./pages/PortalDiag.jsx";
import ScreenPagos from "./pages/Pagos.jsx";
// Sprint 2026-05-24 · Modulo Finanzas CEO-ONLY (comisiones, margen, devengo).
import ScreenFinanzas from "./pages/Finanzas.jsx";
import ScreenInventario from "./pages/Inventario.jsx";
import InboundReceptionWizard from "./pages/InboundReceptionWizard.jsx";
// import ScreenWizard from "./pages/Wizard.jsx";  // legacy — ahora /wizard redirige al wizard simplificado
import CreateExpedienteWizard from "./pages/CreateExpedienteWizard.jsx";
import CreateExpedienteWizardLite from "./pages/CreateExpedienteWizardLite.jsx";
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
import ScreenNcmEngine from "./pages/NcmEngine.jsx";
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
// F6 · Sprint 2026-05-20 · Bitácora histórica de precios (CEO-ONLY).
import ScreenPriceHistory from "./pages/PriceHistory.jsx";
// Sprint 2026-07-20 · Mesa de trabajo (CEO/Admin) — expedientes que
// requieren atención (estancados vs promedio de fase / sin proforma).
import ScreenMesaTrabajo from "./pages/MesaTrabajo.jsx";
import ScreenProfilePage from "./pages/ProfilePage.jsx";
import ScreenTickets from "./pages/Tickets.jsx";
import ScreenTicketDetail from "./pages/TicketDetail.jsx";
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

// Rutas internas MWT: excluyen roles CLIENT_* aunque conozcan la URL.
function InternalOnlyRoute({ children }) {
  const { isClient } = useRole();
  if (isClient) return <Navigate to="/dashboard" replace />;
  return children;
}

// Rutas altamente sensibles: gobernanza IA, RBAC, finanzas y diagnóstico.
function CeoAdminOnlyRoute({ children }) {
  const { isCeoAdmin } = useRole();
  if (!isCeoAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

// Fable5-QA 2026-06-12 · ver comentario en las rutas /portal/nueva-oc.
function NuevaOcRoleSwitch() {
  const { isClient } = useRole();
  return isClient ? <CreateExpedienteWizard /> : <CreateExpedienteWizardLite />;
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
        <Route path="/cronograma" element={<ScreenCronograma />} />
        {/* Sprint 2026-06-11 · detalle fusionado ANTES de :ocId (el
            segmento estático "fusion" gana ranking en React Router 6). */}
        <Route path="/expedientes/fusion/:fusionId" element={<ScreenFusionDetail />} />
        <Route path="/expedientes/:ocId" element={<ScreenOCDetail />} />
        <Route path="/expedientes/:ocId/exp/:expedienteId" element={<ScreenExpedienteDetail />} />
        <Route path="/pipeline" element={<ScreenPipeline />} />
        <Route path="/portal" element={<ScreenPortal />} />
        <Route path="/portal/diag" element={<CeoAdminOnlyRoute><PortalDiag /></CeoAdminOnlyRoute>} />
        <Route path="/financiero" element={<ScreenPagos />} />
        {/* Sprint 2026-05-24 · /finanzas es CEO-ONLY (admin/superadmin).
            AdminOnlyRoute bloquea CLIENT_* redirigiendolos a /ai.
            El backend ademas hace 403 si el rol no es admin (defense in depth). */}
        <Route path="/finanzas" element={<CeoAdminOnlyRoute><ScreenFinanzas /></CeoAdminOnlyRoute>} />
        {/* Sprint 2026-07-20 · Mesa de trabajo — CEO/Admin/superadmin. */}
        <Route path="/mesa-trabajo" element={<CeoAdminOnlyRoute><ScreenMesaTrabajo /></CeoAdminOnlyRoute>} />
        <Route path="/inventario" element={<InternalOnlyRoute><ScreenInventario /></InternalOnlyRoute>} />
        {/* Sprint Inbound Engine v1 (2026-04-29) — wizard full-page */}
        <Route path="/inventario/recepcion" element={<InternalOnlyRoute><InboundReceptionWizard /></InternalOnlyRoute>} />
        {/* /wizard es alias del wizard simplificado (mismo flujo
            para ADMIN y CLIENT). Antes apuntaba al ScreenWizard
            legacy con OCR pesado; el nuevo wizard de 3 pasos vive
            en /portal/nueva-oc y /expedientes/nuevo. */}
        <Route path="/wizard" element={<Navigate to="/portal/nueva-oc" replace />} />
        {/* Fable5-QA 2026-06-12 · Wizard role-aware:
            · CLIENT_*  -> CreateExpedienteWizard (multirol, 3 pasos CLIENT,
              POST /expedientes/create-from-oc/ con client_id forzado del JWT
              y mode/freight NULL pendientes de review CEO).
            · ADMIN/staff -> CreateExpedienteWizardLite (flujo interno).
            Bug previo: el cliente caia en el Lite, que postea al endpoint
            crudo /api/expedientes/ -> hard-shield R3 -> 403 al confirmar. */}
        {/* Nuevo wizard multirol (ADMIN 4 pasos / CLIENT 3 pasos) — reemplazo de /wizard */}
        {/* Sprint Wizard Lite (2026-04-29) — wizard simplificado de 3 pasos */}
        <Route path="/expedientes/nuevo" element={<NuevaOcRoleSwitch />} />
        <Route path="/portal/nueva-oc"  element={<NuevaOcRoleSwitch />} />
        {/* Wizard pesado legacy (con OCR/marca/moneda) — accesible solo para fallback */}
        <Route path="/expedientes/nuevo-completo" element={<CreateExpedienteWizard />} />
        <Route path="/transferencias" element={<InternalOnlyRoute><ScreenTransfers /></InternalOnlyRoute>} />
        {/* Wizard full-page · debe ir ANTES de :transferId para no matchear "nueva" como id */}
        <Route path="/transferencias/nueva" element={<InternalOnlyRoute><ScreenCreateTransferWizard /></InternalOnlyRoute>} />
        <Route path="/transferencias/:transferId" element={<InternalOnlyRoute><ScreenTransferDetail /></InternalOnlyRoute>} />
        <Route path="/nodos" element={<InternalOnlyRoute><ScreenNodos /></InternalOnlyRoute>} />
        <Route path="/nodos/:nodeId" element={<InternalOnlyRoute><ScreenNodoDetail /></InternalOnlyRoute>} />
        <Route path="/clientes" element={<InternalOnlyRoute><ScreenClientes /></InternalOnlyRoute>} />
        {/* Form full-page · debe ir ANTES del detail para no matchear /nuevo como :clienteId */}
        <Route path="/clientes/nuevo"                element={<InternalOnlyRoute><ScreenClienteFormView /></InternalOnlyRoute>} />
        <Route path="/clientes/:clienteId/editar"    element={<InternalOnlyRoute><ScreenClienteFormView /></InternalOnlyRoute>} />
        <Route path="/clientes/:clienteId"           element={<InternalOnlyRoute><ScreenClienteDetail /></InternalOnlyRoute>} />
        <Route path="/marcas" element={<InternalOnlyRoute><ScreenBrands /></InternalOnlyRoute>} />
        {/* Precios cliente-marca · vista full-page con drag&drop */}
        <Route path="/marcas/:brandId/clientes/:clienteId/precios"
               element={<CeoAdminOnlyRoute><ScreenBrandClientPricingForm /></CeoAdminOnlyRoute>} />
        <Route path="/marcas/:brandId" element={<InternalOnlyRoute><ScreenBrandDetail /></InternalOnlyRoute>} />
        <Route path="/productos" element={<InternalOnlyRoute><ScreenProductos /></InternalOnlyRoute>} />
        <Route path="/productos/nuevo" element={<InternalOnlyRoute><ScreenProductFormView /></InternalOnlyRoute>} />
        <Route path="/productos/:productId" element={<InternalOnlyRoute><ScreenProductFormView /></InternalOnlyRoute>} />
        {/* Ruta del Portal B2B: mismo componente, pero useRole() detecta
            CLIENT y aplica el strip-down (fieldset disabled + tabs filtradas). */}
        <Route path="/portal/productos/:productId" element={<ScreenProductFormView />} />
        <Route path="/tallas" element={<InternalOnlyRoute><ScreenSizingEngine /></InternalOnlyRoute>} />
        <Route path="/ncm" element={<InternalOnlyRoute><ScreenNcmEngine /></InternalOnlyRoute>} />
        <Route path="/proveedores" element={<InternalOnlyRoute><ScreenProveedores /></InternalOnlyRoute>} />
        <Route path="/proveedores/nuevo" element={<InternalOnlyRoute><ScreenSupplierFormView /></InternalOnlyRoute>} />
        <Route path="/proveedores/:supplierId/editar" element={<InternalOnlyRoute><ScreenSupplierFormView /></InternalOnlyRoute>} />
        <Route path="/proveedores/:supplierId" element={<InternalOnlyRoute><ScreenSupplierDetail /></InternalOnlyRoute>} />
        <Route path="/templates" element={<InternalOnlyRoute><ScreenEmailTemplates /></InternalOnlyRoute>} />
        <Route path="/notificaciones" element={<InternalOnlyRoute><ScreenNotificaciones /></InternalOnlyRoute>} />
        <Route path="/cobros" element={<InternalOnlyRoute><ScreenCobros /></InternalOnlyRoute>} />
        <Route path="/ai" element={<ScreenAIHub />} />
        <Route path="/ai/governance" element={<CeoAdminOnlyRoute><ScreenAIGovernance /></CeoAdminOnlyRoute>} />
        {/* M3 CORE — Usuarios y Roles (ADMIN-only, guard vía AdminOnlyRoute) */}
        <Route path="/tickets" element={<ScreenTickets />} />
        <Route path="/tickets/:ticketId" element={<ScreenTicketDetail />} />
        <Route path="/usuarios"          element={<CeoAdminOnlyRoute><ScreenUsers /></CeoAdminOnlyRoute>} />
        <Route path="/usuarios/nuevo"    element={<CeoAdminOnlyRoute><ScreenUserFormView /></CeoAdminOnlyRoute>} />
        <Route path="/usuarios/:userId"  element={<CeoAdminOnlyRoute><ScreenUserFormView /></CeoAdminOnlyRoute>} />
        <Route path="/roles"             element={<CeoAdminOnlyRoute><ScreenRolesPermissions /></CeoAdminOnlyRoute>} />
        {/* F6 · Historial de precios — bitácora CEO-ONLY de cambios del motor de precios. */}
        {/* F6 · Historial de precios — bitácora CEO-ONLY de cambios del motor de precios. */}
        <Route path="/historial-precios" element={<CeoAdminOnlyRoute><ScreenPriceHistory /></CeoAdminOnlyRoute>} />
        {/* Perfil propio — accesible para TODOS los usuarios autenticados
            (ADMIN + CLIENT). La vista aplica read-only por rol internamente. */}
        <Route path="/perfil"            element={<ScreenProfilePage />} />
        <Route path="/ai/chat/:threadId" element={<ScreenAIChat />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
