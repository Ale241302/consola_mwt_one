// MWT.ONE · hooks/mutations/useExpedienteMutations.js
// Mutaciones sobre expedientes con invalidación automática del listado.
// Ola 3 · 3.26 · React Query.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { expedientesApi } from "../../lib/api.js";
import { queryKeys } from "../../lib/queryKeys.js";

export function useExpedienteMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.expedientes.all });
  return {
    update: useMutation({ mutationFn: ({ id, body }) => expedientesApi.update(id, body), onSuccess: invalidate }),
    create: useMutation({ mutationFn: (body) => expedientesApi.create(body), onSuccess: invalidate }),
  };
}
