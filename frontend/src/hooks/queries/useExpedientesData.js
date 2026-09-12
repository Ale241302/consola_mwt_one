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
import { expedientesApi, ocsApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

export function useExpedientesData(params) {
  return useQuery({
    queryKey: queryKeys.expedientes.list(params),
    queryFn: async ({ signal }) => {
      // expedientes es mandatorio: si falla, la pantalla muestra el error
      // real.
      //
      // Sprint 2026-09-11 · el listado ya viene AUTOSUFICIENTE del backend
      // (order_value/total_client/total_mwt + client_name/operator_name
      // batched en ExpedienteListSerializer). Antes el front bajaba además
      // TODO /lineas/ (567KB, ~8s), /productos/ (~4s) y /clientes/ para
      // calcular lo mismo client-side → 3 requests pesados innecesarios.
      // Solo seguimos pidiendo /ocs/ (barato) para el fallback de navegación.
      const expRaw = await expedientesApi.list(params, { signal });
      const ocRaw = await ocsApi.list(undefined, { signal }).catch(() => []);
      return { expRaw, ocRaw };
    },
  });
}
