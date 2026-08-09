import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    // Ola 3 · 3.24 · sourcemap "hidden": se genera pero NO se publica en el
    // map público (evita exponer el fuente completo en producción).
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        // Separa dependencias grandes (xlsx, framer-motion, react) en chunks
        // propios para que el cambio de una librería no invalide el bundle
        // de la app y el navegador las cachee.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          xlsx: ["xlsx"],
          motion: ["framer-motion"],
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
