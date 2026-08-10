---
name: mwt-operations
description: Opera la Consola MWT.ONE a traves de su servidor MCP (mwt-one). Enseña que tool usar en cada flujo (alta de cliente/producto, creacion de expediente desde OC, documentos y SAP, proformas, recepcion/inventario, transferencias, liquidacion landed cost y pagos), el orden correcto, y los anti-patrones que rompen la operacion.
trigger: El usuario quiere crear/consultar/editar un expediente, cliente, producto, transferencia, pago, o liquidar costos usando MWT.ONE.
---

# mwt-operations — Operar la Consola MWT.ONE vía MCP

Esta skill guía el uso del servidor MCP `mwt-one` para operar la plataforma de
Muito Work Trading (expedientes de importación, inventario, transferencias,
pagos y liquidación de landed cost). Es el "manual del operador": **qué tool
usar, en qué orden, y qué NO hacer**.

## Antes de empezar

1. `mwt_whoami` → confirma que el token/identidad está activo y qué rol tienes.
2. `mwt_health` → si sospechas lentitud, token expirado o backend caído.
3. Si un rol no "ve" una tool: `mwt_diag_scope(email)` (CEO-only) explica qué
   le está permitido y por qué.

## Reglas transversales

- **Anti-duplicados:** SIEMPRE usa `expediente_buscar(oc_number|proforma|sap)`
  antes de `expediente_crear`. Si `existe=true`, NO crees: edita el existente.
- **NUNCA inventes SKUs ni tallas.** Los SKU vienen de `producto_listar`/
  `producto_obtener`; las tallas de `tallas_listar`. Líneas con `size='UNICA'`,
  `PENDING` o `SIN-SKU` son rechazadas.
- **Carga líneas ANTES de la proforma:** `proforma_generar` usa las líneas
  actuales del expediente; sin líneas sale en 0 pares / $0.
- **`campos` ahorra contexto:** usa proyección `campos="id,codigo,estado,…"` en
  las tools de detalle/listado cuando no necesites todo el payload.
- **Método correcto:** lee con `_obtener`/`_listar`, escribe con `_crear`/
  `_editar`/`_avanzar`. No reescribas estados a mano si existe una transición.

## Flujos

### Flujo 1 — Alta de cliente y producto (catálogo)
```
cliente_listar(q=…)  → ¿existe? → cliente_obtener(id)
cliente_crear({razon_social, pais_iso2, …})      [CEO: credito_limit_usd, comision_pct]
producto_listar(q=…) → producto_obtener(id)      [tallas, client_prices, ncm]
producto_crear({sku, nombre, marca_id, tallas:[uuids], especificaciones:{sizes:[uuids], ncm}})
producto_alias_crear(producto_id, cliente_id, alias="70B22-CPAP")
```
> Anti-patrón: crear un producto sin `tallas`/`especificaciones.sizes` (o con
> labels en vez de UUIDs) → el matching de líneas falla después.

### Flujo 2 — Crear expediente desde una OC (con anti-duplicado)
```
expediente_buscar(oc_number="504960", client_id=…)   ← SIEMPRE primero
  └─ existe=true → expediente_obtener(match) → editar (NO crear)
  └─ existe=false → expediente_resolve_oc_preview(client_id, lines)  [validación previa]
expediente_crear(client_id, ocr_payload={lines}, file_path="ruta/OC.pdf",
                 operating_company_id, brand_id, forma_pago, credit_days_mwt,
                 credit_days_cliente, po_number)
expediente_apply_pronto_pago(expediente_id, plazo_days=30)  [si aplica]
expediente_lineas(expediente_id)   [verificar precios]
lineas_actualizar_precios({linea_id, unit_price_mwt, unit_price_client})
```
> Anti-patrón: `expediente_crear` sin `file_path` deja el documento OC sin
> binario almacenado. Anti-patrón: mandar `po_number="SIN-PO"` (se ignora; mejor
> omitirlo).

### Flujo 3 — Documentos, SAP y proformas
```
documento_subir(expediente_id, file_path, data={kind:"PROFORMA"|"OC"|"SAP", codigo})
documento_listar(expediente_id) → documento_descargar(id) [URL firmada TTL corto]
sap_analizar(expediente_id, file_path) → sap_obtener → sap_confirmar
   (o match_subir → match_resolver para balanceo IA)
proforma_generar(expediente_id, audience="CLIENT")   [después de cargar líneas]
proforma_html(expediente_id, codigo)   [previsualizar sin persistir]
```
> Anti-patrón: `sap_confirmar` sin pasar la `fecha_fabricacion` correcta (el
> backend exige la fecha real, no la genérica). Anti-patrón: proforma antes de
> cargar líneas y precios.

### Flujo 4 — Fusionar y avanzar estados
```
expediente_fusionar(expediente_ids=[...], label="SAP 1234 + 5678")   [agrupar SAPs]
expediente_avanzar_estado(expediente_id, action)     [transición válida del pipeline]
expediente_phase_durations_set(expediente_id, phase_durations={...})
expediente_eventos(expediente_id)                    [historial]
```

### Flujo 5 — Recepción e inventario
```
nodo_listar → nodo_obtener(id)                       [destino de la recepción]
recepcion_crear(expediente_id, nodo_id, lines=[{producto_id, size, qty, unit_cost_usd}],
                cost_lines=[{kind:"DAI"|"IVA"|"FLETE"|…, amount, currency, fx_to_usd}])
stock_listar(nodo, producto)                          [verificar saldos]
inventario_saldos_por_expediente(expediente_ids=[...])
inventario_transferir_asignaciones(...)               [reasignar si hace falta]
```
> Anti-patrón: recepción con `unit_cost_usd=0` en líneas CERRADAS (la validación
> del backend lo rechaza). `kind` de costo DEBE estar en el catálogo válido.

### Flujo 6 — Transferencias (movimientos entre nodos)
```
transferencia_listar(origen, destino, estado) → transferencia_obtener(id)
transferencia_crear({origen, destino, lineas:[{producto_id, size, qty}], ...})
transferencia_aprobar(id) → transferencia_despachar(id) → transferencia_recibir(id, lineas)
transferencia_conciliar(id) → transferencia_cerrar(id)
transfer_notas_listar(id) / transfer_nota_crear(id, text)
```
> Anti-patrón: saltarse `aprobar`→`despachar`→`recibir`; el backend niega
> transiciones ilegales (409).

### Flujo 7 — Costos y liquidación landed
```
transfer_costos_listar(transferencia_id)
transfer_costo_agregar(transferencia_id, kind, amount, currency, fx_to_usd,
                       scope_json={expediente_ids:[...]} o {lines:[{expediente_id, producto_id, talla}]})
transfer_artefacto_crear(transferencia_id, ...)      [AWB/BL]
transfer_liquidacion_preview(transferencia_id)        [preview del landed]
transfer_liquidar(transferencia_id, method="BY_VALUE") [persiste; excluye IVA del landed]
transfer_factura_payload(transferencia_id)            [factura/remisión]
```
> El motor de liquidación **excluye el IVA** del landed (va aparte en
> `summary.extra_costs_iva_usd`) y **respeta `scope_json`** (un costo DAI solo
> se prorratea entre sus líneas/expedientes). Anti-patrón: agregar costos con
> `scope_json` mal formado (usa `expediente_ids` o `lines`, no ambos a la vez).

### Flujo 8 — Pagos (entrante/saliente)
```
pago_applicables(expediente_id|client_id)             [qué se puede pagar]
pago_dry_run(...)                                     [simular sin persistir]
pago_registrar({direction:"IN"|"OUT", monto, aplicaciones:[{applicable_type, applicable_id, monto_aplicado}]})
pago_obtener(pago_id) → pago_conciliar(pago_id, bank_reference)   [impacta saldo/crédito]
pago_liberar_credito(pago_id) / pago_rechazar(pago_id, body)
```
> Anti-patrón: registrar un pago y no conciliarlo (no impacta saldos). Anti-
> patrón: `aplicaciones` sin `applicable_type` válido (COSTO|PRODUCTO|PROFORMA|FACTURA).

### Utilidades
```
tipo_cambio(par="usd-crc")   → rate para convertir a USD (fx_to_usd = 1/rate)
storage_subir_archivo(...) / artefacto_archivo_descargar(...)
ncm_listar() / marca_listar() / tallas_listar()   [catálogos para crear]
```

## Errores comunes y cómo leerlos

Todo error devuelve `{error, status, detail, url, hint}`:
- **400** → payload inválido (revisa tipos/campos, listados en `detail`).
- **403** → rol sin permiso para la tool/acción (revisa matriz /roles).
- **404** → id/UUID mal, o recurso fuera del scope del usuario.
- **409** → transición ilegal o duplicado.
- **429** → rate limit; espera y reintenta.
- **500** → error interno; revisa logs de django.

## Entrega

Cuando completes un flujo, resume: qué expediente/cliente/transferencia quedó
creado (con su id/código), qué documentos se subieron, y el estado final.
