// MWT.ONE · hooks/queries/useClientesMap.js
// Resuelve N clientes con UN solo fetch de listado y arma el mapa en cliente.
// Reemplaza el patrón N+1 `Promise.all(ids.map(id => clientesApi.get(id)))`.
// Ola 3 · 3.26 · React Query.
import { useQuery } from "@tanstack/react-query";
import { clientesApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

export function useClientesMap(ids) {
  const enabled = Array.isArray(ids) && ids.length > 0;
  return useQuery({
    queryKey: queryKeys.clientes.byIds(ids || []),
    enabled,
    queryFn: async ({ signal }) => {
      const raw = await clientesApi.list(undefined, { signal });
      const arr = Array.isArray(raw) ? raw : (raw?.results || []);
      const wanted = new Set(ids);
      const map = {};
      for (const c of arr) if (c?.id && wanted.has(c.id)) map[c.id] = c;
      return map;
    },
    staleTime: 60_000,
  });
}
