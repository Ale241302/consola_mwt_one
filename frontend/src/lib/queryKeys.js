// MWT.ONE · lib/queryKeys.js
// Factory central de query keys. Convención:
//   <dominio>.all → clave raíz (para invalidaciones)
//   <dominio>.list(params) → listado
//   <dominio>.detail(id) → detalle
//   <dominio>.byIds(ids) → colección resuelta por ids (mata el N+1)
// Ola 3 · 3.26 · React Query.
export const queryKeys = {
  expedientes: {
    all: ["expedientes"],
    list: (params) => ["expedientes", "list", params ?? {}],
    detail: (id) => ["expedientes", "detail", id],
  },
  clientes: {
    all: ["clientes"],
    list: (params) => ["clientes", "list", params ?? {}],
    byIds: (ids) => ["clientes", "byIds", [...(ids || [])].sort()],
  },
  ocs:        { all: ["ocs"],        list: (p) => ["ocs", "list", p ?? {}] },
  lineas:     { all: ["lineas"],     list: (p) => ["lineas", "list", p ?? {}] },
  productos:  { all: ["productos"],  list: (p) => ["productos", "list", p ?? {}] },
  transferencias: { all: ["transferencias"], list: (p) => ["transferencias", "list", p ?? {}] },
  pagos:      { all: ["pagos"],      list: (p) => ["pagos", "list", p ?? {}] },
};
