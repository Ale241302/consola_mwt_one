// frontend/src/components/ui/ErrorBoundary.jsx
// ─────────────────────────────────────────────────────────────────────
// Sprint 2026-06-11 · Auditoría Fable5 (checklist #6 · "pantalla en
// blanco"). Límite de error de React: si una página crashea durante el
// render (TypeError por datos incompletos, etc.), ANTES toda la app
// quedaba en blanco y obligaba a Ctrl+F5. Ahora el shell (sidebar +
// topbar) sobrevive y se muestra una card con el detalle técnico y
// botones de Reintentar / Recargar.
//
// Se monta en AppLayout alrededor del <Outlet/> con key=pathname, así
// el boundary se RESETEA solo al navegar a otra ruta.
// ─────────────────────────────────────────────────────────────────────
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error(
      "[ErrorBoundary] crash de render atrapado:",
      error,
      info && info.componentStack
    );
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(
      (this.state.error && this.state.error.message) || this.state.error || "Error"
    );
    return (
      <div className="page" style={{ padding: 32 }}>
        <div
          className="card card-pad-lg"
          style={{ maxWidth: 640, margin: "40px auto", textAlign: "center" }}
        >
          <div className="micro" style={{ color: "var(--critical, #DC2626)", letterSpacing: 1 }}>
            ERROR DE PANTALLA
          </div>
          <h2 style={{ margin: "10px 0 6px" }}>Algo salió mal al dibujar esta vista</h2>
          <p className="caption" style={{ color: "var(--text-tertiary)" }}>
            El resto de la consola sigue funcionando. Detalle técnico:
          </p>
          <pre style={{
            textAlign: "left", fontSize: 11, padding: 12, borderRadius: 8,
            background: "var(--bg-alt, #F1F5F9)", overflowX: "auto",
            fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap",
          }}>{msg}</pre>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => this.setState({ error: null })}
            >
              Reintentar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Recargar página
            </button>
          </div>
        </div>
      </div>
    );
  }
}
