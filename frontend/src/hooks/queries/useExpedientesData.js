// MWT.ONE · hooks/queries/useExpedientesData.js
// Datos de la pantalla Expedientes vía React Query. El N+1 de clientes lo
// resuelve useClientesMap() con un solo fetch.
// Ola 3 · 3.26 · React Query.
import { useQuery } from "@tanstack/react-query";
import { expedientesApi, ocsApi, lineasApi, productosApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

export function useExpedientesData(params) {
  return useQuery({
    queryKey: queryKeys.expedientes.list(params),
    queryFn: async ({ signal }) => {
      const [expRaw, ocRaw, lnRaw, prodRaw] = await Promise.all([
        expedientesApi.list(params, { signal }),
        ocsApi.list(undefined, { signal }),
        lineasApi.list({ is_active: true }, { signal }),
        productosApi.list(undefined, { signal }),
      ]);
      return { expRaw, ocRaw, lnRaw, prodRaw };
    },
  });
}
