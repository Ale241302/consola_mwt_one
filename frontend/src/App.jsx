// MWT.ONE · App — routes
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Login from "./pages/Login.jsx";
import ScreenDashboard from "./pages/Dashboard.jsx";
import ScreenExpedientes from "./pages/Expedientes.jsx";
import ScreenOCDetail from "./pages/OCDetail.jsx";
import ScreenExpedienteDetail from "./pages/ExpedienteDetail.jsx";
import ScreenPipeline from "./pages/Pipeline.jsx";
import ScreenPortal from "./pages/Portal.jsx";
import ScreenPagos from "./pages/Pagos.jsx";
import ScreenInventario from "./pages/Inventario.jsx";
import ScreenWizard from "./pages/Wizard.jsx";
import ScreenTransfers from "./pages/Transfers.jsx";
import ScreenNodos from "./pages/Nodos.jsx";
import ScreenClientes from "./pages/Clientes.jsx";
import ScreenBrands from "./pages/Brands.jsx";
import ScreenProductos from "./pages/Productos.jsx";
import ScreenProveedores from "./pages/Proveedores.jsx";
import ScreenEmailTemplates from "./pages/EmailTemplates.jsx";
import ScreenNotificaciones from "./pages/Notificaciones.jsx";
import ScreenCobros from "./pages/Cobros.jsx";

export default function App() {
  return (
    <Routes>
      {/* Pública */}
      <Route path="/login" element={<Login />} />

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
        <Route path="/transferencias" element={<ScreenTransfers />} />
        <Route path="/nodos" element={<ScreenNodos />} />
        <Route path="/clientes" element={<ScreenClientes />} />
        <Route path="/marcas" element={<ScreenBrands />} />
        <Route path="/productos" element={<ScreenProductos />} />
        <Route path="/proveedores" element={<ScreenProveedores />} />
        <Route path="/templates" element={<ScreenEmailTemplates />} />
        <Route path="/notificaciones" element={<ScreenNotificaciones />} />
        <Route path="/cobros" element={<ScreenCobros />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
