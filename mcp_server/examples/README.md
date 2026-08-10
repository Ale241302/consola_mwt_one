# MWT.ONE MCP — Ejemplos de flujos completos

> Flujos end-to-end reales usando las tools del servidor MCP `mwt-one`.
> Cada flujo muestra el orden correcto, los parámetros típicos, y cómo leer la
> respuesta. Reemplaza los IDs de ejemplo por los de tu entorno.

---

## Flujo 1 · Alta de un cliente nuevo + su part-number de producto

**Objetivo:** crear un cliente B2B y registrar el alias de producto que el
cliente usa (para que el matching no falle en la próxima OC).

```text
1) cliente_listar(q="Sondel")                          → ¿existe? (anti-duplicado)
2) cliente_crear({
       "razon_social": "Sondel SA",
       "pais_iso2": "CR",
       "tipo": "B2B",
       "dias_credito": 60,
       "moneda": "USD"
   })                                                  → {id: "cli-…", razon_social: "Sondel SA"}
3) producto_listar(q="70B22-CPAP")                     → {id: "prod-…", sku: "70B22-CPAP"}
4) producto_alias_crear(
       producto_id="prod-…",
       cliente_id="cli-…",
       alias="70B22-CPAP"
   )                                                   → alias registrado
```

**Resultado:** el cliente existe en catálogo y su part-number ya matchea.

---

## Flujo 2 · Crear expediente desde una OC (anti-duplicado)

**Objetivo:** crear un expediente de importación a partir de la OC del cliente,
verificando antes que no exista ya.

```text
1) expediente_buscar(oc_number="504960", client_id="cli-…")
     → {existe: false, matches: []}                     ← NO existe, se crea
2) expediente_resolve_oc_preview(
       client_id="cli-…",
       lines=[{"sku": "700728", "size": "39", "qty": 20}]
   )                                                   → valida precios/matching
3) expediente_crear(
       client_id="cli-…",
       ocr_payload={"lines": [{"sku":"700728","size":"39","qty":20}]},
       operating_company_id="op-mwt…",
       brand_id="brand-…",
       forma_pago="CREDITO",
       credit_days_mwt=30,
       credit_days_cliente=60,
       po_number="504960",
       file_path="ruta/OC-504960.pdf"
   )                                                   → {id: "exp-…", codigo: "EXP-…"}
4) expediente_lineas(expediente_id="exp-…")            → verificar precios/estado
```

**Regla de oro:** si `expediente_buscar` devuelve `existe: true`, edita el
existente — nunca crees un duplicado.

---

## Flujo 3 · Subir documentos, analizar y confirmar SAP

**Objetivo:** adjuntar la proforma/SAP del cliente y confirmar el SAP del
expediente.

```text
1) documento_subir(
       expediente_id="exp-…",
       data={"kind": "SAP", "codigo": "257021"},
       file_path="ruta/SAP-257021.pdf"
   )                                                   → {id: "doc-…"}
2) documento_listar(expediente_id="exp-…")             → verificar adjuntos
3) sap_analizar(expediente_id="exp-…", file_path="ruta/SAP-257021.pdf")
                                                       → extrae líneas/fechas
4) sap_confirmar(expediente_id="exp-…", sap_id="sap-…",
                 fecha_fabricacion="2025-12-18")
                                                       → SAP confirmado
5) proforma_generar(expediente_id="exp-…", audience="CLIENT")
                                                       → proforma del sistema
```

**Anti-patrón:** confirmar el SAP sin la fecha de fabricación real (el backend
la exige).

---

## Flujo 4 · Recepción de mercancía con costos

**Objetivo:** recibir el inventario del expediente en un nodo, con costos
logísticos (DUA/impuestos).

```text
1) nodo_listar() → nodo_obtener(nodo_id="nodo-…")      → destino de recepción
2) stock_listar(nodo="nodo-…", producto="prod-…")       → saldo previo
3) recepcion_crear(
       expediente_id="exp-…",
       nodo_id="nodo-…",
       lines=[{"producto_id":"prod-…","size":"39","qty":20,"unit_cost_usd":25.10}],
       cost_lines=[
           {"kind":"DAI","amount":1250.50,"currency":"USD","fx_to_usd":1},
           {"kind":"IVA","amount":1800.00,"currency":"CRC","fx_to_usd":0.00217}
       ]
   )                                                   → recepción + costos
4) stock_listar(nodo="nodo-…", producto="prod-…")       → saldo incrementado
```

---

## Flujo 5 · Transferencia entre nodos

**Objetivo:** mover mercancía de la bodega al nodo del cliente, con su
aprobación/despacho/recepción.

```text
1) transferencia_listar(origen="nodo-bodega…")          → contexto
2) transferencia_crear({
       "origen": "nodo-bodega…",
       "destino": "nodo-cliente…",
       "lineas": [{"producto_id":"prod-…","size":"39","qty":20}]
   })                                                   → {id: "trf-…"}
3) transferencia_aprobar(transferencia_id="trf-…")
4) transferencia_despachar(transferencia_id="trf-…")
5) transferencia_recibir(transferencia_id="trf-…",
                         lineas=[{"id":"linea-…","qty_received":20}])
6) transferencia_conciliar(transferencia_id="trf-…")
7) transferencia_cerrar(transferencia_id="trf-…")
```

**Anti-patrón:** saltarse una transición → el backend responde 409 "transición
ilegal".

---

## Flujo 6 · Agregar costos y liquidar landed cost

**Objetivo:** registrar el DUA/impuestos/gastos de una transferencia y liquidar
el costo aterrizado por línea.

```text
1) transfer_costos_listar(transferencia_id="trf-…")     → costos actuales
2) transfer_costo_agregar(
       transferencia_id="trf-…",
       kind="FLETE",
       amount=950.00,
       currency="USD",
       fx_to_usd=1,
       scope_json={"applies_to_all": true}              → se prorratea global
   )
3) transfer_costo_agregar(
       transferencia_id="trf-…",
       kind="DAI",
       amount=4100.00,
       currency="CRC",
       fx_to_usd=0.00217,
       scope_json={"expediente_ids": ["exp-…"]}         → solo ese expediente
   )
4) transfer_liquidacion_preview(transferencia_id="trf-…")   → preview sin persistir
5) transfer_liquidar(transferencia_id="trf-…", method="BY_VALUE")
                                                       → persiste landed
6) transfer_factura_payload(transferencia_id="trf-…")   → factura/remisión
```

**Nota:** el motor **excluye el IVA** del landed (crédito fiscal) y lo reporta
aparte en `summary.extra_costs_iva_usd`. El `scope_json` respeta el alcance de
cada costo (DAI por NCM, etc.).

---

## Flujo 7 · Registrar y conciliar un pago

**Objetivo:** registrar un pago entrante del cliente y conciliarlo para que
impacte saldo/crédito.

```text
1) pago_applicables(expediente_id="exp-…")              → qué se puede pagar
2) pago_dry_run(
       expediente_id="exp-…",
       monto=15000.00,
       direction="IN",
       aplicaciones=[{"applicable_type":"PROFORMA",
                      "applicable_id":"exp-…",
                      "monto_aplicado":15000.00}]
   )                                                   → efecto sobre crédito
3) pago_registrar(
       expediente_id="exp-…",
       monto=15000.00,
       direction="IN",
       aplicaciones=[{"applicable_type":"PROFORMA",
                      "applicable_id":"exp-…",
                      "monto_aplicado":15000.00}],
       file_path="ruta/comprobante.pdf"                 → evidencia (campo evidencia)
   )                                                   → {id: "pago-…"}
4) pago_conciliar(pago_id="pago-…", bank_reference="REF-2026-0001")
                                                       → impacta saldos y crédito
```

**Anti-patrón:** registrar un pago sin conciliarlo (no impacta saldos ni
crédito hasta la conciliación).

---

## Flujo 8 · Diagnóstico de soporte (¿por qué no ve tal tool?)

**Objetivo:** responder "¿por qué este usuario no ve X?" sin tocar código.

```text
mwt_diag_scope(email="alvaro@muitowork.com")  (CEO-only)
  → {role_slug: "admin",
     legal_entity_ids: ["…"],
     mwt_rbac: {tools_permitidas: […], tools_ocultas: […],
                total_permitidas: N, total_ocultas: M}}
```

Si la tool que debería ver aparece en `tools_ocultas`, el rol no tiene el
`(módulo, acción)` en la matriz `/roles`.

---

## Consejos finales

- Empieza siempre con `mwt_whoami` para confirmar token/rol.
- Usa `campos="id,codigo,estado,…"` para ahorrar contexto.
- Usa `expediente_buscar` antes de `expediente_crear` (anti-duplicados).
- Lee `hint` de los errores: orienta el siguiente paso.
