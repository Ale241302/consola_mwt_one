// MWT.ONE · App — routes
import React, { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import ScreenPasswordReset from "./pages/PasswordReset.jsx";
import { useRole } from "./context/RoleContext.jsx";

// ── Code splitting (Ola 3 · 3.24) ─────────────────────────────────────
// Carga diferida por ruta: cada página se descarga solo cuando se navega.
// Login/PasswordReset quedan eager (primera pantalla). Los monolitos
// (ExpedienteDetail, ProductFormView, etc.) se parten en chunks propios.
const ScreenDashboard = lazy(() => import("./pages/Dashboard.jsx"));
const ScreenExpedientes = lazy(() => import("./pages/Expedientes.jsx"));
const ScreenCronograma = lazy(() => import("./pages/Cronograma.jsx"));
const ScreenOCDetail = lazy(() => import("./pages/OCDetail.jsx"));
const ScreenFusionDetail = lazy(() => import("./pages/FusionDetail.jsx"));
const ScreenExpedienteDetail = lazy(() => import("./pages/ExpedienteDetail.jsx"));
const ScreenPipeline = lazy(() => import("./pages/Pipeline.jsx"));
const ScreenPortal = lazy(() => import("./pages/Portal.jsx"));
const ScreenPortalProductDetail = lazy(() => import("./pages/PortalProductDetail.jsx"));
const PortalDiag = lazy(() => import("./pages/PortalDiag.jsx"));
const ScreenPagos = lazy(() => import("./pages/Pagos.jsx"));
const ScreenFinanzas = lazy(() => import("./pages/Finanzas.jsx"));
const ScreenInventario = lazy(() => import("./pages/Inventario.jsx"));
const InboundReceptionWizard = lazy(() => import("./pages/InboundReceptionWizard.jsx"));
const CreateExpedienteWizard = lazy(() => import("./pages/CreateExpedienteWizard.jsx"));
const CreateExpedienteWizardLite = lazy(() => import("./pages/CreateExpedienteWizardLite.jsx"));
const ScreenTransfers = lazy(() => import("./pages/Transfers.jsx"));
const ScreenTransferDetail = lazy(() => import("./pages/TransferDetail.jsx"));
const ScreenCreateTransferWizard = lazy(() => import("./pages/CreateTransferWizard.jsx"));
const ScreenNodos = lazy(() => import("./pages/Nodos.jsx"));
const ScreenNodoDetail = lazy(() => import("./pages/NodoDetail.jsx"));
const ScreenClientes = lazy(() => import("./pages/Clientes.jsx"));
const ScreenClienteDetail = lazy(() => import("./pages/ClienteDetail.jsx"));
const ScreenClienteFormView = lazy(() => import("./pages/ClienteFormView.jsx"));
const ScreenBrands = lazy(() => import("./pages/Brands.jsx"));
const ScreenBrandDetail = lazy(() => import("./pages/BrandDetail.jsx"));
const ScreenBrandClientPricingForm = lazy(() => import("./pages/BrandClientPricingForm.jsx"));
const ScreenProductos = lazy(() => import("./pages/Productos.jsx"));
const ScreenProductFormView = lazy(() => import("./pages/ProductFormView.jsx"));
const ScreenSizingEngine = lazy(() => import("./pages/SizingEngine.jsx"));
const ScreenNcmEngine = lazy(() => import("./pages/NcmEngine.jsx"));
const ScreenProveedores = lazy(() => import("./pages/Proveedores.jsx"));
const ScreenSupplierFormView = lazy(() => import("./pages/SupplierFormView.jsx"));
const ScreenSupplierDetail = lazy(() => import("./pages/SupplierDetail.jsx"));
const ScreenEmailTemplates = lazy(() => import("./pages/EmailTemplates.jsx"));
const ScreenNotificaciones = lazy(() => import("./pages/Notificaciones.jsx"));
const ScreenCobros = lazy(() => import("./pages/Cobros.jsx"));
const ScreenAIHub = lazy(() => import("./pages/AIHub.jsx"));
const ScreenAIChat = lazy(() => import("./pages/AIChat.jsx"));
const ScreenAIGovernance = lazy(() => import("./pages/AIGovernance.jsx"));
const ScreenUsers = lazy(() => import("./pages/Users.jsx"));
const ScreenUserFormView = lazy(() => import("./pages/UserFormView.jsx"));
const ScreenRolesPermissions = lazy(() => import("./pages/RolesPermissions.jsx"));
const ScreenPriceHistory = lazy(() => import("./pages/PriceHistory.jsx"));
const ScreenMesaTrabajo = lazy(() => import("./pages/MesaTrabajo.jsx"));
const ScreenProfilePage = lazy(() => import("./pages/ProfilePage.jsx"));
const ScreenTickets = lazy(() => import("./pages/Tickets.jsx"));
const ScreenTicketDetail = lazy(() => import("./pages/TicketDetail.jsx"));

function PageFallback() {
  return (
    <div style={{ padding: 48, textAlign: "center", color: "var(--text-tertiary)" }}>
      Cargando…
    </div>
  );
}

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
    <Suspense fallback={<PageFallback />}>
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
        {/* Ruta del Portal B2B: ficha técnica comercial en lugar del formulario de edición. */}
        <Route path="/portal/productos/:productId" element={<ScreenPortalProductDetail />} />
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
    </Suspense>
  );
}
