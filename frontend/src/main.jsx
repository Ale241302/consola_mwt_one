// MWT.ONE · entry point
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";
import { RoleProvider } from "./context/RoleContext.jsx";
import { queryClient } from "./lib/queryClient.js";
import "./styles/index.css";

// Devtools de React Query SOLO en desarrollo (no agranda el bundle de prod).
// Ola 3 · 3.26.
const DevTools = import.meta.env.DEV
  ? (await import("@tanstack/react-query-devtools")).ReactQueryDevtools
  : null;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <RoleProvider>
          <QueryClientProvider client={queryClient}>
            <App />
            {DevTools ? <DevTools initialIsOpen={false} /> : null}
          </QueryClientProvider>
        </RoleProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
