// MWT.ONE · lib/queryClient.js
// Instancia QueryClient de React Query + defaults alineados con apiFetch.
// Ola 3 · 3.26 · React Query (estado servidor; api.js sigue siendo transporte).
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.js";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sprint 2026-09-11 · 60s (antes 30s): los listados no se re-piden al
      // navegar entre Dashboard/Expedientes/Otras. Las mutaciones invalidan
      // (`queryKeys.*.all`) y fuerzan refetch activo aunque el dato esté fresh.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false, // consistente con el comportamiento actual
      retry: (count, err) => {
        if (err instanceof ApiError && [400, 401, 403, 404].includes(err.status)) return false;
        return count < 1;          // 1 reintento, alineado con apiFetch
      },
    },
  },
});
