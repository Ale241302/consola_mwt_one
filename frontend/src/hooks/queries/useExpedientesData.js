// MWT.ONE · hooks/queries/useExpedientesData.js
// Datos de la pantalla Expedientes vía React Query. El N+1 de clientes lo
// resuelve useClientesMap() con un solo fetch.
// Ola 3 · 3.26 · React Query.
//
// 2026-08-11 · Resiliencia por rol: expedientes es el dato CORE de la
// pantalla; ocs/lineas/productos son ENRIQUECIMIENTO. Para roles CLIENT_B2B
// esos endpoints devuelven 403 (módulos no habilitados: productos, etc.) y
// un Promise.all total tiraba la pantalla entera con "Error al cargar
// expedientes" aunque /expedientes/ respondiera 200. Ahora cada fetch
// opcional degrada a [] y la tabla se renderiza igual (sin los fallbacks
// que solo enriquecían la vista).
import { useQuery } from "@tanstack/react-query";
import { expedientesApi, ocsApi, lineasApi, productosApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

export function useExpedientesData(params) {
  return useQuery({
    queryKey: queryKeys.expedientes.list(params),
    queryFn: async ({ signal }) => {
      // expedientes es mandatorio: si falla, la pantalla muestra el error
      // real. Los demás endpoints son opcionales y degradan a [] (403 de
      // rol, red, 5xx) sin tumbar el listado.
      const expRaw = await expedientesApi.list(params, { signal });
      const [ocRaw, lnRaw, prodRaw] = await Promise.all([
        ocsApi.list(undefined, { signal }).catch(() => []),
        lineasApi.list({ is_active: true }, { signal }).catch(() => []),
        productosApi.list(undefined, { signal }).catch(() => []),
      ]);
      return { expRaw, ocRaw, lnRaw, prodRaw };
    },
  });
}
