# MWT.ONE — Servidor MCP

Servidor **MCP (Model Context Protocol)** que expone la operación completa de la
Consola MWT.ONE como herramientas para que un agente de IA externo (Antigravity,
Kimi CLI, Claude Desktop, Cursor, etc.) opere sobre la plataforma vía su API REST.

Autentica con un **token de servicio de larga vida** (≈100 años) generado contra
el backend. No guarda estado local: cada herramienta es una llamada autenticada a
`https://consola.mwt.one/api`.

---

## 1. Qué puede hacer (86 herramientas)

| Dominio | Herramientas |
|---|---|
| **Clientes** | `cliente_listar`, `cliente_obtener`, `cliente_crear`, `cliente_editar`, `cliente_subsidiarias`, `cliente_kpis_pool` |
| **Productos** | `producto_listar`, `producto_obtener`, `producto_crear`, `producto_editar`, `ncm_listar` |
| **OC / Expedientes** | `oc_listar`, `oc_obtener`, `expediente_listar`, `expediente_obtener`, `expediente_lineas`, `expediente_resolve_oc_preview`, `expediente_crear`, `expediente_apply_pronto_pago`, `expediente_edit_full_get/patch` |
| **Documentos** | `documento_subir`, `documento_listar` |
| **SAP** | `sap_analizar`, `sap_confirmar`, `sap_upsert`, `sap_obtener`, `sap_editar`, `sap_sincronizar_discrepancias` |
| **Balanceo IA** | `match_subir`, `match_resolver` |
| **Fusión** | `expediente_fusionar`, `expediente_fusion_label`, `expediente_desfusionar` |
| **Proforma / Factura** | `proforma_generar`, `proforma_html`, `factura_payload` |
| **Estados** | `expediente_avanzar_estado`, `expediente_phase_durations_get/set`, `expediente_eventos` |
| **Nodos** | `nodo_listar`, `nodo_obtener`, `nodo_crear`, `nodo_editar`, `nodo_artefactos_listar`, `nodo_artefacto_crear` |
| **Inventario / Recepción** | `stock_listar`, `inventario_saldos_por_expediente`, `inventario_expedientes_con_pendiente`, `inventario_lineas_en_nodo`, `recepcion_crear`, `inventario_transferir_asignaciones`, `inventario_artefactos_expediente` |
| **Movimientos** | `transferencia_listar/obtener/crear`, `transferencia_avanzar/aprobar/despachar/editar/recibir/conciliar/cerrar/cancelar` |
| **Costos / impuestos / gastos** | `transfer_costos_listar`, `transfer_costo_agregar`, `transfer_costo_editar`, `transfer_costo_eliminar`, `transfer_artefacto_crear` |
| **Landed cost / factura** | `transfer_liquidacion_preview`, `transfer_liquidar`, `transfer_factura_payload`, `transfer_notas_listar`, `transfer_nota_crear` |
| **Pagos** | `pago_applicables`, `pago_listar`, `pago_obtener`, `pago_dry_run`, `pago_registrar`, `pago_conciliar`, `pago_liberar_credito`, `pago_rechazar` |
| **Builder** | `builder_templates_listar`, `builder_template_obtener` |
| **Salud** | `mwt_whoami` |

---

## 2. Generar el token (sin vencimiento)

El backend ya incluye el comando `mint_mcp_token`. Córrelo **en el VPS** contra el
contenedor `django` (firma con el `DJANGO_SECRET_KEY` de producción):

```bash
ssh -p 2222 root@187.77.218.102
cd /opt/consola-mwt-one
docker exec -i consola-mwt-one-django python manage.py mint_mcp_token \
  --email alejandro@muitowork.com
```

Salida (ejemplo):

```
== MWT.ONE — MCP service token ==
  usuario : alejandro@muitowork.com
  rol     : superadmin
  vida    : 36500 dias
  TOKEN (guardalo como MWT_MCP_TOKEN en el .env del MCP):

  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....<token largo>....
```

> Para capturar solo el token (sin banner): añade `--quiet`.
> Para revocarlo: rota `DJANGO_SECRET_KEY` o desactiva el usuario en `core.users`.

Copia ese token: es tu `MWT_MCP_TOKEN`.

---

## 3. Instalar y correr el MCP

### Opción A — local (stdio), para Antigravity / Kimi CLI / Claude Desktop

```bash
cd mcp_server
pip install -r requirements.txt
export MWT_MCP_TOKEN="<pega-el-token>"
export MWT_API_BASE="https://consola.mwt.one/api"
python -m mwt_mcp          # arranca en stdio
```

### Opción B — por red (streamable-http / Docker)

```bash
cd mcp_server
docker build -t mwt-mcp .
docker run -d --name mwt-mcp -p 8765:8765 \
  -e MWT_MCP_TOKEN="<pega-el-token>" \
  -e MWT_API_BASE="https://consola.mwt.one/api" \
  -e MWT_MCP_TRANSPORT=http \
  mwt-mcp
# Endpoint MCP: http://<host>:8765/mcp
```

Variables de entorno (ver `.env.example`): `MWT_API_BASE`, `MWT_MCP_TOKEN`,
`MWT_MCP_TRANSPORT` (`stdio`|`http`), `MWT_MCP_HOST`, `MWT_MCP_PORT`,
`MWT_HTTP_TIMEOUT`, `MWT_MCP_READONLY` (`1` = solo lectura).

---

## 4. Registrar en clientes de IA

### Antigravity / Claude Desktop / Cursor (config JSON `mcpServers`)

```json
{
  "mcpServers": {
    "mwt-one": {
      "command": "python",
      "args": ["-m", "mwt_mcp"],
      "cwd": "/ruta/a/consola_mwt_one/mcp_server",
      "env": {
        "MWT_MCP_TOKEN": "<pega-el-token>",
        "MWT_API_BASE": "https://consola.mwt.one/api"
      }
    }
  }
}
```

### Kimi CLI

```bash
kimi mcp add mwt-one \
  --command python --args "-m,mwt_mcp" \
  --cwd /ruta/a/consola_mwt_one/mcp_server \
  --env MWT_MCP_TOKEN=<pega-el-token> \
  --env MWT_API_BASE=https://consola.mwt.one/api
```

(Para clientes que solo soportan HTTP, usa la Opción B y apunta a `http://<host>:8765/mcp`.)

---

## 5. Flujo operativo de referencia

1. `cliente_crear` / `producto_crear` → catálogo.
2. `expediente_resolve_oc_preview` → `expediente_crear` (operador, líneas, forma de
   pago, plazos duales) → `expediente_apply_pronto_pago`.
3. `documento_subir` (OC/PO) · `proforma_generar` · `sap_analizar`→`sap_confirmar`
   (o `match_subir`→`match_resolver` para balanceo IA).
4. `expediente_fusionar` para agrupar varios SAP/operadores.
5. `expediente_avanzar_estado` / `expediente_phase_durations_set` en el detalle del SAP.
6. `nodo_crear` · `recepcion_crear` (expediente/SKU/talla/cantidad + costos + artefactos).
7. `transferencia_crear` → `transferencia_aprobar`/`despachar`/`recibir`/`conciliar`;
   `transfer_costo_agregar` (DUA/impuestos/gastos), `transfer_artefacto_crear` (AWB/BL),
   `transfer_liquidar`, `transfer_factura_payload` (factura/remisión).
8. `pago_applicables` → `pago_registrar` (entrante/saliente, productos/costos) →
   `pago_conciliar` (recién aquí impacta saldos y crédito).

Empieza siempre con `mwt_whoami` para confirmar que el token está activo.
