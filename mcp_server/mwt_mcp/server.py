"""Servidor MCP de la Consola MWT.ONE.

Expone la operación completa de MWT (clientes, productos, expedientes/OC, SAP,
fusión, proformas, nodos, inventario/recepción, transferencias, costos,
artefactos, impuestos/gastos, pagos entrante/saliente y factura/remisión) como
herramientas MCP, para que un agente externo (Antigravity, Kimi CLI, Claude
Desktop, etc.) las invoque sobre la API REST real.

Autenticación: Bearer token de servicio (MWT_MCP_TOKEN). Sin estado local.
"""
from __future__ import annotations

import re
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import client as api
from .client import MwtApiError
from .config import settings

mcp = FastMCP("mwt-one")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _safe(call):
    try:
        return call()
    except MwtApiError as e:
        return {"error": True, "status": e.status, "detail": e.payload, "url": e.url}
    except Exception as e:  # noqa: BLE001 - frontera del MCP: nunca propagar crudo
        return {"error": True, "detail": str(e)}


def _wguard():
    if settings.readonly:
        return {
            "error": True,
            "detail": "MCP en modo solo-lectura (MWT_MCP_READONLY=1); operación de escritura bloqueada.",
        }
    return None


def _params(**kwargs) -> dict:
    return {k: v for k, v in kwargs.items() if v is not None}


def _norm_num(s: str | None) -> str:
    """Normaliza un número de OC/proforma/SAP para comparar: minúsculas, quita
    prefijos 'po'/'oc' y todo lo no alfanumérico. '504960' == 'PO 504960' == 'PO-504960'."""
    s = re.sub(r"[^0-9a-z]", "", (s or "").strip().lower())
    return re.sub(r"^(po|oc)(?=\d)", "", s)


def _as_rows(data: Any) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("results") or []
    return []


# --------------------------------------------------------------------------- #
# Salud / introspección
# --------------------------------------------------------------------------- #
@mcp.tool()
def mwt_whoami() -> Any:
    """Devuelve la identidad y permisos del token actual (GET /auth/me/).
    Útil para verificar que el token MCP es válido y tiene rol CEO/ADMIN."""
    return _safe(lambda: api.get("auth/me/"))


# =========================================================================== #
# A) CLIENTES
# =========================================================================== #
@mcp.tool()
def cliente_listar(
    q: str | None = None,
    is_parent: str | None = None,
    tipo: str | None = None,
    estado: str | None = None,
    segmento: str | None = None,
    pais: str | None = None,
    canal: str | None = None,
) -> Any:
    """Lista clientes. Filtros opcionales: q (texto en razón social), is_parent
    (true/false/all), tipo, estado, segmento, pais (ISO-2), canal."""
    return _safe(
        lambda: api.get(
            "clientes/",
            _params(q=q, is_parent=is_parent, tipo=tipo, estado=estado,
                    segmento=segmento, pais=pais, canal=canal),
        )
    )


@mcp.tool()
def cliente_obtener(cliente_id: str) -> Any:
    """Obtiene el detalle completo de un cliente por su id (UUID)."""
    return _safe(lambda: api.get(f"clientes/{cliente_id}/"))


@mcp.tool()
def cliente_crear(datos: dict) -> Any:
    """Crea un cliente. `datos` admite: razon_social, nombre_comercial, tax_id,
    codigo_marluvas (10 dígitos), cedula_juridica, tipo (B2B/CONSUMIDOR/DISTRIBUIDOR),
    segmento, parent_id, pais_iso2, ciudad, direccion_entrega, contacto_nombre,
    contacto_email, canal, incoterm, medio_pago, dias_credito (0-180), moneda,
    credito_limit_usd*, comision_pct* (*CEO-only), estado (ACTIVO/PAUSADO/BLOQUEADO/INACTIVO),
    nodo_asignado_id, responsable_id."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post("clientes/", datos))


@mcp.tool()
def cliente_editar(cliente_id: str, cambios: dict) -> Any:
    """Edita un cliente (PATCH parcial). `cambios` = subconjunto de los campos de cliente_crear."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"clientes/{cliente_id}/", cambios))


@mcp.tool()
def cliente_subsidiarias(cliente_id: str) -> Any:
    """Lista las subsidiarias de un cliente padre."""
    return _safe(lambda: api.get(f"clientes/{cliente_id}/subsidiarias/"))


@mcp.tool()
def cliente_kpis_pool(cliente_id: str) -> Any:
    """KPIs consolidados del pool de crédito (padre + subsidiarias)."""
    return _safe(lambda: api.get(f"clientes/{cliente_id}/kpis_pool/"))


# =========================================================================== #
# B) PRODUCTOS
# =========================================================================== #
@mcp.tool()
def producto_listar(
    q: str | None = None,
    marca: str | None = None,
    categoria: str | None = None,
    estado: str | None = None,
    proveedor: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> Any:
    """Lista productos (SKU, nombre, precios). Filtros: q (busca en nombre+sku+desc),
    marca (UUID), categoria, estado, proveedor (UUID), limit, offset."""
    return _safe(
        lambda: api.get(
            "productos/",
            _params(q=q, marca=marca, categoria=categoria, estado=estado,
                    proveedor=proveedor, limit=limit, offset=offset),
        )
    )


@mcp.tool()
def producto_obtener(producto_id: str) -> Any:
    """Detalle completo de un producto, incluyendo `especificaciones`
    (tallas, client_prices, ncm) y precios (precio_lista, precio_distribuidor, costo_estandar)."""
    return _safe(lambda: api.get(f"productos/{producto_id}/"))


@mcp.tool()
def producto_crear(datos: dict) -> Any:
    """Crea un producto. `datos`: sku, nombre, marca_id, categoria, subcategoria,
    unidad, moneda, costo_estandar, precio_lista, precio_distribuidor, hs_code,
    pais_origen_iso2, estado, especificaciones (dict; aquí van tallas/client_prices/ncm)."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post("productos/", datos))


@mcp.tool()
def producto_editar(producto_id: str, cambios: dict) -> Any:
    """Edita un producto (PATCH). `cambios` = subconjunto de campos de producto_crear.
    Para cambiar precios por cliente, edita `especificaciones.client_prices`."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"productos/{producto_id}/", cambios))


@mcp.tool()
def ncm_listar() -> Any:
    """Lista los códigos NCM/arancelarios disponibles."""
    return _safe(lambda: api.get("ncm/"))


# =========================================================================== #
# C) EXPEDIENTES / OC
# =========================================================================== #
@mcp.tool()
def oc_listar(
    q: str | None = None,
    client: str | None = None,
    estado: str | None = None,
    credit_band: str | None = None,
) -> Any:
    """Lista órdenes de compra (OC). Filtros: q, client (UUID), estado, credit_band (GREEN/AMBER/RED)."""
    return _safe(
        lambda: api.get("ocs/", _params(q=q, client=client, estado=estado, credit_band=credit_band))
    )


@mcp.tool()
def oc_obtener(oc_id: str) -> Any:
    """Detalle de una OC (acepta UUID o código, p.ej. PO-2026-04100)."""
    return _safe(lambda: api.get(f"ocs/{oc_id}/"))


@mcp.tool()
def expediente_listar(
    oc: str | None = None,
    client: str | None = None,
    estado: str | None = None,
    phase_signal: str | None = None,
    q: str | None = None,
) -> Any:
    """Lista expedientes. Filtros: oc (UUID de la OC), client, estado
    (REGISTRO/PRODUCCION/PREPARACION/DESPACHO/TRANSITO/EN_DESTINO/CERRADO), phase_signal, q."""
    return _safe(
        lambda: api.get(
            "expedientes/",
            _params(oc=oc, client=client, estado=estado, phase_signal=phase_signal, q=q),
        )
    )


@mcp.tool()
def expediente_obtener(expediente_id: str) -> Any:
    """Detalle de un expediente (acepta UUID o código, p.ej. EXP-1027)."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/"))


@mcp.tool()
def expediente_buscar(
    oc_number: str | None = None,
    proforma: str | None = None,
    sap: str | None = None,
    client_id: str | None = None,
) -> Any:
    """⚠️ ANTI-DUPLICADOS — ÚSALA SIEMPRE ANTES DE `expediente_crear`.

    Busca expedientes que YA existen por **número de OC del cliente** (ej. "504960"
    o "PO 504960"), **número de proforma** (ej. "2468-2026") y/o **número de SAP**.
    El `q` normal NO sirve: solo matchea el código autogenerado (EXP-…). Esta tool
    compara contra `oc_codigos` / `proforma_codigos` / `sap_codigos` de cada expediente,
    normalizando prefijos 'PO'/'OC' y separadores.

    Recomendado pasar `client_id` para acotar la búsqueda. Devuelve
    `{existe, total, matches:[{expediente_id, codigo, oc_id, oc_codigos, proforma_codigos,
    sap_codigos, estado, client_id}]}`. Si `existe=true` → **NO crees**, edita el existente."""
    params = _params(client=client_id, oc_number=oc_number, proforma=proforma)  # oc_number/proforma los usa el backend si está parcheado
    data = _safe(lambda: api.get("expedientes/", params))
    if isinstance(data, dict) and data.get("error"):
        return data
    rows = _as_rows(data)
    tn_oc = _norm_num(oc_number) if oc_number else None
    tn_pf = (proforma or "").strip().lower() if proforma else None
    tn_sap = _norm_num(sap) if sap else None
    matches = []
    for e in rows:
        oc_cs = [_norm_num(x) for x in (e.get("oc_codigos") or [])]
        pf_cs = [(x or "").strip().lower() for x in (e.get("proforma_codigos") or [])]
        sap_cs = [_norm_num(x) for x in (e.get("sap_codigos") or [])]
        if (tn_oc and tn_oc in oc_cs) or (tn_pf and tn_pf in pf_cs) or (tn_sap and tn_sap in sap_cs):
            matches.append({
                "expediente_id": e.get("id"), "codigo": e.get("codigo"), "oc_id": e.get("oc_id"),
                "oc_codigos": e.get("oc_codigos"), "proforma_codigos": e.get("proforma_codigos"),
                "sap_codigos": e.get("sap_codigos"), "estado": e.get("estado"), "client_id": e.get("client_id"),
            })
    return {"existe": len(matches) > 0, "total": len(matches), "matches": matches}


@mcp.tool()
def expediente_lineas(expediente_id: str) -> Any:
    """Líneas (SKU/talla/cantidad/precios) de un expediente."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/lineas/"))


@mcp.tool()
def expediente_resolve_oc_preview(client_id: str, lines: list) -> Any:
    """Paso 2 del wizard: resuelve precios/matching de líneas SIN crear nada.
    `lines`: lista de {client_part_number?, sku?, size, qty}. Devuelve líneas con
    producto_id, unit_price y needs_review."""
    return _safe(
        lambda: api.post("expedientes/resolve-oc-preview/", {"client_id": client_id, "lines": lines})
    )


@mcp.tool()
def expediente_crear(
    client_id: str,
    ocr_payload: dict,
    operating_company_id: str | None = None,
    brand_id: str | None = None,
    forma_pago: str | None = None,
    credit_days_mwt: int | None = None,
    credit_days_cliente: int | None = None,
    mode: str | None = None,
    freight_mode: str | None = None,
    transport_mode: str | None = None,
    dispatch_mode: str | None = None,
    price_basis: str | None = None,
    po_number: str | None = None,
    moneda: str | None = None,
    idempotence_token: str | None = None,
    file_path: str | None = None,
) -> Any:
    """Crea un expediente desde una OC (orquestador atómico, comando C1).

    - `client_id`: cliente final (UUID).
    - `operating_company_id`: operador. Si lo opera Muito Work Limitada, pasa el
      UUID del cliente operador MWT; si lo opera el cliente, su propio UUID (o se omite).
    - `ocr_payload`: dict con `lines`: [{sku, size, qty, unit_price?, producto_id?}].
      Los precios se re-derivan server-side del motor de pricing.
    - `forma_pago`: CREDITO o CONTADO. `credit_days_mwt`/`credit_days_cliente`: plazos duales.
    - `mode` (COMISION/FULL), `freight_mode` (SEA/AIR), `dispatch_mode` (FCL/LCL/CONSOLIDADO): solo admin.
    - `file_path`: opcional, PDF/XLSX de la OC para adjuntar.
    """
    g = _wguard()
    if g:
        return g
    data = _params(
        client_id=client_id,
        operating_company_id=operating_company_id,
        brand_id=brand_id,
        forma_pago=forma_pago,
        credit_days_mwt=credit_days_mwt,
        credit_days_cliente=credit_days_cliente,
        mode=mode,
        freight_mode=freight_mode,
        transport_mode=transport_mode,
        dispatch_mode=dispatch_mode,
        price_basis=price_basis,
        po_number=po_number,
        moneda=moneda,
        idempotence_token=idempotence_token,
        ocr_payload=ocr_payload,
    )
    return _safe(lambda: api.post_multipart("expedientes/create-from-oc/", data, file_path))


@mcp.tool()
def lineas_actualizar_precios(updates: list) -> Any:
    """Fija los precios EXACTOS de las líneas (los leídos de la OC/proforma, no los
    de la BD). `updates`: [{linea_id, unit_price_mwt, unit_price_client}].
    Usa expediente_lineas para obtener los linea_id."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post("lineas/bulk-update-prices/", {"updates": updates}))


@mcp.tool()
def expediente_apply_pronto_pago(expediente_id: str, plazo_days: int, covered_pairs: list | None = None) -> Any:
    """Aplica el descuento de pronto pago al precio CLIENTE de un expediente.
    `plazo_days` ∈ {8,30,60,90,120}. `covered_pairs`: opcional, [{sku, size}] para acotar.
    Solo modifica unit_price_client (no toca unit_price_mwt)."""
    g = _wguard()
    if g:
        return g
    body = _params(plazo_days=plazo_days, covered_pairs=covered_pairs)
    return _safe(lambda: api.post(f"expedientes/{expediente_id}/apply-pronto-pago/", body))


@mcp.tool()
def expediente_edit_full_get(expediente_id: str) -> Any:
    """Lee la edición GENERAL del expediente (todas las líneas y términos)."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/edit-full/"))


@mcp.tool()
def expediente_edit_full_patch(expediente_id: str, cambios: dict) -> Any:
    """Edita en bloque un expediente (CEO-only). `cambios` admite: operating_company_id,
    forma_pago, payment_days, client_id, lines_added [{producto_id,sku,talla,qty}],
    lines_removed [linea_id], lines_updated [{id,qty}], split_line_ids, split_quantities."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"expedientes/{expediente_id}/edit-full/", cambios))


# --- Documentos -------------------------------------------------------------
@mcp.tool()
def documento_subir(
    file_path: str,
    kind: str = "OTRO",
    codigo: str | None = None,
    expediente_id: str | None = None,
    oc_id: str | None = None,
    audience: str = "CLIENT",
) -> Any:
    """Sube un documento (PDF, etc.) a un expediente u OC; lo almacena en MinIO. `kind`:
    tipo (OC, PROFORMA, BL, FACTURA, DUA, OTRO...). `codigo`: nombre/código (default =
    nombre del archivo). `audience`: CLIENT, MWT_INTERNAL o ADMIN_ONLY.

    NOTA DE ALMACENAMIENTO: para la **OC** y la **Proforma** del cliente conviene usar
    `match_subir(document_type="ART-01_OC"|"ART-02_PROFORMA")` y para el **SAP**
    `sap_confirmar`/`sap_upsert` con `file_path`, porque esos flujos dejan el binario
    bien almacenado y, además, mapean/asignan líneas. Usa `documento_subir` para el resto
    (BL/AWB, DUA, factura, otros). Verifica luego con `documento_listar`."""
    g = _wguard()
    if g:
        return g
    data = _params(kind=kind, codigo=codigo, expediente_id=expediente_id, oc_id=oc_id, audience=audience)
    return _safe(lambda: api.post_multipart("documentos/", data, file_path))


@mcp.tool()
def documento_listar(
    expediente: str | None = None, oc: str | None = None, kind: str | None = None
) -> Any:
    """Lista documentos por expediente, oc o kind (respeta visibilidad por audience)."""
    return _safe(lambda: api.get("documentos/", _params(expediente=expediente, oc=oc, kind=kind)))


# --- SAP --------------------------------------------------------------------
@mcp.tool()
def sap_analizar(expediente_id: str, file_path: str) -> Any:
    """Pre-analiza un archivo de confirmación SAP (Excel/PDF) contra las líneas del
    expediente: autocompleta sap_id, detecta discrepancias. No persiste nada."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post_multipart(f"expedientes/{expediente_id}/analyze-sap-confirmation/", {}, file_path))


@mcp.tool()
def sap_confirmar(
    expediente_id: str,
    sap_id: str,
    lineas_confirmadas: list,
    fecha_fabricacion: str | None = None,
    file_path: str | None = None,
) -> Any:
    """Confirma un SAP por primera vez (comando C5): asigna productos al SAP y
    transiciona REGISTRO→PRODUCCION. `lineas_confirmadas`: [{linea_id, qty_confirmada, unit_price?}].
    Requiere que el expediente esté en REGISTRO (si no, usa sap_upsert)."""
    g = _wguard()
    if g:
        return g
    data = _params(sap_id=sap_id, lineas_confirmadas=lineas_confirmadas, fecha_fabricacion=fecha_fabricacion)
    return _safe(lambda: api.post_multipart(
        f"expedientes/{expediente_id}/confirm-sap/", data, file_path, file_field="documento_sap"))


@mcp.tool()
def sap_upsert(
    expediente_id: str,
    sap_id: str,
    lineas_confirmadas: list,
    fecha_fabricacion: str | None = None,
    file_path: str | None = None,
) -> Any:
    """Crea o edita un SAP sin cambiar el estado del expediente (C5-upsert).
    Mismo body que sap_confirmar."""
    g = _wguard()
    if g:
        return g
    data = _params(sap_id=sap_id, lineas_confirmadas=lineas_confirmadas, fecha_fabricacion=fecha_fabricacion)
    return _safe(lambda: api.post_multipart(
        f"expedientes/{expediente_id}/upsert-sap/", data, file_path, file_field="documento_sap"))


@mcp.tool()
def sap_obtener(expediente_id: str, sap_id: str) -> Any:
    """Detalle del SAP (líneas, términos, valores MWT/cliente) — editor por-SAP."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/sap/{sap_id}/"))


@mcp.tool()
def sap_editar(expediente_id: str, sap_id: str, cambios: dict) -> Any:
    """Edita un SAP (CEO-only). `cambios`: operating_company_id, forma_pago, payment_days,
    client_id, lines_added, lines_removed, lines_updated."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"expedientes/{expediente_id}/sap/{sap_id}/", cambios))


@mcp.tool()
def sap_sincronizar_discrepancias(expediente_id: str, actions: list) -> Any:
    """Aplica acciones de discrepancia SAP. `actions`: [{kind: ADD_LINE|UPDATE_QTY|ATTACH_SAP|NOTIFY_CLIENT,
    sku, talla, qty, unit_price?, line_id?, sap_doc?}]."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post(f"expedientes/{expediente_id}/sync-sap-discrepancies/", {"actions": actions}))


# --- Matchmaker / balanceo IA ----------------------------------------------
@mcp.tool()
def match_subir(expediente_id: str, document_type: str, file_path: str) -> Any:
    """Sube un documento (OC/Proforma/SAP) y lo cruza con IA contra las líneas del
    expediente, devolviendo discrepancias. `document_type`: ART-01_OC, ART-02_PROFORMA o ART-04_SAP.
    Devuelve un log_id para luego resolver con match_resolver."""
    g = _wguard()
    if g:
        return g
    data = _params(document_type=document_type)
    return _safe(lambda: api.post_multipart(f"expedientes/{expediente_id}/upload-match/", data, file_path))


@mcp.tool()
def match_resolver(expediente_id: str, log_id: str, actions: list, note: str | None = None) -> Any:
    """Resuelve un balanceo IA aplicando acciones. `actions`: [{kind: ADD_LINE|UPDATE_QTY|ATTACH_SAP|DELETE_LINE|MANUAL,
    sku, talla, qty, qty_doc?, unit_price?, sap_doc?, line_id?}]."""
    g = _wguard()
    if g:
        return g
    body = _params(log_id=log_id, actions=actions, note=note)
    return _safe(lambda: api.post(f"expedientes/{expediente_id}/resolve-match/", body))


# --- Fusión -----------------------------------------------------------------
@mcp.tool()
def expediente_fusionar(expediente_ids: list, label: str | None = None) -> Any:
    """Fusiona (agrupa visualmente) 2+ expedientes bajo un fusion_id.
    `expediente_ids`: lista de UUIDs (mínimo 2)."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post("expedientes/fusionar/", _params(expediente_ids=expediente_ids, label=label)))


@mcp.tool()
def expediente_fusion_label(fusion_id: str, label: str | None = None) -> Any:
    """Cambia/borra la etiqueta de un grupo de fusión."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post("expedientes/fusion-label/", _params(fusion_id=fusion_id, label=label)))


@mcp.tool()
def expediente_desfusionar(fusion_id: str | None = None, expediente_ids: list | None = None) -> Any:
    """Deshace una fusión por fusion_id o por lista de expediente_ids."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post("expedientes/desfusionar/", _params(fusion_id=fusion_id, expediente_ids=expediente_ids)))


# --- Proforma / Factura -----------------------------------------------------
@mcp.tool()
def proforma_generar(expediente_id: str, audience: str = "CLIENT", codigo: str | None = None, payment_days: int | None = None) -> Any:
    """Genera y persiste una proforma. `audience`: CLIENT (vista cliente),
    MWT_INTERNAL o ADMIN_ONLY (vista interna). Devuelve el documento + signed_url."""
    g = _wguard()
    if g:
        return g
    body = _params(audience=audience, codigo=codigo, payment_days=payment_days)
    return _safe(lambda: api.post(f"expedientes/{expediente_id}/generate-proforma/", body))


@mcp.tool()
def proforma_html(expediente_id: str, codigo: str | None = None) -> Any:
    """Devuelve el HTML de la proforma renderizada al vuelo (no persiste)."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/proforma-html/", _params(codigo=codigo)))


@mcp.tool()
def factura_payload(expediente_id: str) -> Any:
    """Devuelve el payload estructurado de la factura comercial del expediente
    (líneas con FOB/landed/dai_rate/ncm, cost_breakdown, totales)."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/factura-payload/"))


# --- Estados SAP / pipeline -------------------------------------------------
@mcp.tool()
def expediente_avanzar_estado(expediente_id: str, fase_to: str, note: str | None = None, idempotence_token: str | None = None, documento_id: str | None = None) -> Any:
    """Avanza el expediente/SAP a la siguiente fase. `fase_to`: REGISTRO, PRODUCCION,
    PREPARACION, DESPACHO, TRANSITO, EN_DESTINO o CERRADO. Registra un evento inmutable."""
    g = _wguard()
    if g:
        return g
    body = _params(fase_to=fase_to, note=note, idempotence_token=idempotence_token, documento_id=documento_id)
    return _safe(lambda: api.post(f"expedientes/{expediente_id}/transition/", body))


@mcp.tool()
def expediente_phase_durations_get(expediente_id: str) -> Any:
    """Lee las fechas/duraciones por fase del expediente."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/phase-durations/"))


@mcp.tool()
def expediente_phase_durations_set(expediente_id: str, phase_durations: dict) -> Any:
    """Edita las fechas/duraciones por fase (CEO-only). `phase_durations`:
    {FASE: dias | null | {start, end}}, p.ej. {"TRANSITO": {"start":"2026-01-01","end":"2026-01-12"}}."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post(f"expedientes/{expediente_id}/phase-durations/", phase_durations))


@mcp.tool()
def expediente_eventos(expediente_id: str, limit: int = 200) -> Any:
    """Historial de eventos (transiciones) del expediente."""
    return _safe(lambda: api.get(f"expedientes/{expediente_id}/events/", _params(limit=limit)))


# =========================================================================== #
# D) NODOS
# =========================================================================== #
@mcp.tool()
def nodo_listar(tipo: str | None = None, pais: str | None = None, status: str | None = None, q: str | None = None) -> Any:
    """Lista nodos (almacenes/oficinas/hubs). Filtros: tipo, pais (ISO-2), status, q."""
    return _safe(lambda: api.get("nodos/", _params(tipo=tipo, pais=pais, status=status, q=q)))


@mcp.tool()
def nodo_obtener(nodo_id: str) -> Any:
    """Detalle de un nodo."""
    return _safe(lambda: api.get(f"nodos/{nodo_id}/"))


@mcp.tool()
def nodo_crear(datos: dict) -> Any:
    """Crea un nodo. `datos`: codigo, nombre, tipo (HQ/OFICINA/ALMACEN/HUB), pais_iso2,
    ciudad, direccion, responsable_id, capacidad_m2, operating_company_id, capabilities, status."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post("nodos/", datos))


@mcp.tool()
def nodo_editar(nodo_id: str, cambios: dict) -> Any:
    """Edita un nodo (PATCH parcial)."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"nodos/{nodo_id}/", cambios))


@mcp.tool()
def nodo_artefactos_listar(nodo_id: str, template_id: int | None = None) -> Any:
    """Lista los artefactos (Builder) registrados en un nodo."""
    return _safe(lambda: api.get(f"nodos/{nodo_id}/builder-artifacts/", _params(template_id=template_id)))


@mcp.tool()
def nodo_artefacto_crear(nodo_id: str, template_id: int, template_title: str, data: dict, structure_snapshot: dict | None = None, lines: list | None = None) -> Any:
    """Agrega un artefacto del Builder a un nodo. `template_id`: id del template del
    Builder; `data`: valores de los campos; `structure_snapshot`: estructura del form;
    `lines`: alcance [{expediente_id, producto_id, talla, qty}]."""
    g = _wguard()
    if g:
        return g
    body = _params(template_id=template_id, template_title=template_title, data=data,
                   structure_snapshot=structure_snapshot, lines=lines)
    return _safe(lambda: api.post(f"nodos/{nodo_id}/builder-artifacts/", body))


# =========================================================================== #
# E) INVENTARIO / RECEPCIÓN
# =========================================================================== #
@mcp.tool()
def stock_listar(nodo: str | None = None, producto: str | None = None, solo_disponible: bool | None = None) -> Any:
    """Lista stock por nodo/producto. `solo_disponible`: solo filas con cantidad>0."""
    params = _params(nodo=nodo, producto=producto)
    if solo_disponible:
        params["solo_disponible"] = 1
    return _safe(lambda: api.get("stock/", params))


@mcp.tool()
def inventario_saldos_por_expediente(expediente_ids: list, nodo_id: str | None = None) -> Any:
    """Saldos pendientes de asignar por expediente. `expediente_ids`: lista de UUIDs (requerido)."""
    csv = ",".join(expediente_ids)
    return _safe(lambda: api.get("inventario/saldos-por-expediente/", _params(expediente_ids=csv, nodo_id=nodo_id)))


@mcp.tool()
def inventario_expedientes_con_pendiente() -> Any:
    """Devuelve los expediente_ids que tienen cantidades pendientes de recibir."""
    return _safe(lambda: api.get("inventario/expedientes-with-pending/"))


@mcp.tool()
def inventario_lineas_en_nodo(nodo_id: str, expediente_ids: list | None = None) -> Any:
    """Líneas (SKU/talla/cantidad disponible + precios duales) presentes en un nodo,
    base para crear una transferencia. `expediente_ids`: opcional, acota."""
    params = {}
    if expediente_ids:
        params["expediente_ids"] = ",".join(expediente_ids)
    return _safe(lambda: api.get(f"inventario/nodos/{nodo_id}/lineas-en-nodo/", params))


@mcp.tool()
def recepcion_crear(items: list, cost_lines: list | None = None, recepcion_id: str | None = None) -> Any:
    """Crea una recepción en un nodo asignando productos de expedientes (bulk).

    `items`: [{expediente_id, producto_id, talla, qty_asignada, nodo_id, notas?}].
    `cost_lines`: opcional (paso 3 costos): [{kind, label?, amount, currency, fx_to_usd,
      source, scope}] donde scope = {"applies_to_all": true} o {"applies_to_all": false,
      "expediente_ids":[...], "lines":[{expediente_id,producto_id,talla}]}.
    Los costos se prorratean por unidad y 'viajan' al transferir."""
    g = _wguard()
    if g:
        return g
    body = _params(items=items, cost_lines=cost_lines, recepcion_id=recepcion_id)
    return _safe(lambda: api.post("inventario/nodo-assignments/bulk/", body))


@mcp.tool()
def inventario_transferir_asignaciones(origin_nodo_id: str, destination_nodo_id: str, items: list, transferencia_id: str | None = None) -> Any:
    """Mueve asignaciones de stock de un nodo a otro. `items`: [{expediente_id, producto_id, talla, qty}].
    `transferencia_id`: opcional, para enlazar el movimiento físico."""
    g = _wguard()
    if g:
        return g
    body = _params(origin_nodo_id=origin_nodo_id, destination_nodo_id=destination_nodo_id, items=items, transferencia_id=transferencia_id)
    return _safe(lambda: api.post("inventario/nodo-assignments/transfer/", body))


@mcp.tool()
def inventario_artefactos_expediente(expediente_id: str) -> Any:
    """Lista los artefactos (Builder) ligados a un expediente vía inventario."""
    return _safe(lambda: api.get(f"inventario/expedientes/{expediente_id}/artifacts/"))


# =========================================================================== #
# F) TRANSFERENCIAS (MOVIMIENTOS)
# =========================================================================== #
@mcp.tool()
def transferencia_listar(origen: str | None = None, destino: str | None = None, estado: str | None = None, legal_context: str | None = None, q: str | None = None) -> Any:
    """Lista movimientos/transferencias. Filtros: origen, destino (UUID nodo),
    estado (PLANNED/APPROVED/IN_TRANSIT/RECEIVED/RECONCILED/CLOSED/CANCELLED),
    legal_context (INTERNAL/NATIONALIZATION/EXPORT/DISTRIBUTION/CONSIGNMENT), q."""
    return _safe(lambda: api.get("transferencias/", _params(origen=origen, destino=destino, estado=estado, legal_context=legal_context, q=q)))


@mcp.tool()
def transferencia_obtener(transferencia_id: str) -> Any:
    """Detalle de un movimiento (acepta UUID o código TRF-...), con líneas, eventos,
    documentos y cost_lines."""
    return _safe(lambda: api.get(f"transferencias/{transferencia_id}/"))


@mcp.tool()
def transferencia_crear(
    origen_id: str,
    destino_id: str,
    legal_context: str = "INTERNAL",
    lineas: list | None = None,
    cost_lines: list | None = None,
    ref_tracking: str | None = None,
    context_data: dict | None = None,
    notes: str | None = None,
) -> Any:
    """Crea un movimiento entre nodos. `origen_id`/`destino_id`: UUID de nodos.
    `legal_context`: INTERNAL/NATIONALIZATION/EXPORT/DISTRIBUTION/CONSIGNMENT.
    `lineas`: [{producto_id, sku, size, qty_transfer, unit_cost, unit_value}].
    `cost_lines`: costos DUA iniciales (ver transfer_costo_agregar).
    `context_data`: metadata legal (p.ej. bl_awb_number, dua_number, transfer_pricing_amount)."""
    g = _wguard()
    if g:
        return g
    body = _params(origen_id=origen_id, destino_id=destino_id, legal_context=legal_context,
                   lineas=lineas, cost_lines=cost_lines, ref_tracking=ref_tracking,
                   context_data=context_data, notes=notes)
    return _safe(lambda: api.post("transferencias/", body))


def _transfer_action(transferencia_id: str, action: str, body: dict | None = None):
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post(f"transferencias/{transferencia_id}/{action}/", body or {}))


@mcp.tool()
def transferencia_avanzar(transferencia_id: str, notes: str | None = None) -> Any:
    """Avanza el movimiento al siguiente estado legal (advance)."""
    return _transfer_action(transferencia_id, "advance", _params(notes=notes))


@mcp.tool()
def transferencia_aprobar(transferencia_id: str, notes: str | None = None) -> Any:
    """Aprueba el movimiento (PLANNED→APPROVED)."""
    return _transfer_action(transferencia_id, "approve", _params(notes=notes))


@mcp.tool()
def transferencia_despachar(transferencia_id: str, notes: str | None = None) -> Any:
    """Marca el movimiento como despachado (APPROVED→IN_TRANSIT, descuenta stock origen).
    La ETA, fecha de despacho y tracking BL/AWB se setean con transferencia_editar."""
    return _transfer_action(transferencia_id, "dispatch", _params(notes=notes))


@mcp.tool()
def transferencia_editar(transferencia_id: str, cambios: dict) -> Any:
    """Edita campos del movimiento (PATCH): eta, dispatched_at, received_at, ref_tracking,
    value_usd, notes, context_data (AWB/BL van en context_data: bl_awb_number/awb_bl_number)."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"transferencias/{transferencia_id}/", cambios))


@mcp.tool()
def transferencia_recibir(transferencia_id: str, lineas: list, received_at: str | None = None, received_by_name: str | None = None) -> Any:
    """Recibe el movimiento en destino. `lineas`: [{id (linea_id), qty_received}].
    Decide RECEIVED o DISCREPANCY según cantidades."""
    g = _wguard()
    if g:
        return g
    body = _params(lineas=lineas, received_at=received_at, received_by_name=received_by_name)
    return _transfer_action(transferencia_id, "receive", body)


@mcp.tool()
def transferencia_conciliar(transferencia_id: str, reconciled_by_id: str | None = None, reconciled_note: str | None = None, exception_document_id: str | None = None, gap_justification: str | None = None) -> Any:
    """Concilia el movimiento (RECEIVED→RECONCILED). Si hay discrepancia exige
    reconciled_by_id y (exception_document_id o gap_justification)."""
    body = _params(reconciled_by_id=reconciled_by_id, reconciled_note=reconciled_note,
                   exception_document_id=exception_document_id, gap_justification=gap_justification)
    return _transfer_action(transferencia_id, "reconcile", body)


@mcp.tool()
def transferencia_cerrar(transferencia_id: str) -> Any:
    """Cierra el movimiento (→CLOSED)."""
    return _transfer_action(transferencia_id, "close")


@mcp.tool()
def transferencia_cancelar(transferencia_id: str, notes: str | None = None) -> Any:
    """Cancela el movimiento (→CANCELLED, revierte efectos de inventario)."""
    return _transfer_action(transferencia_id, "cancel", _params(notes=notes))


# --- Costos / impuestos / gastos del movimiento -----------------------------
@mcp.tool()
def transfer_costos_listar(transferencia_id: str) -> Any:
    """Lista las líneas de costo (DUA/impuestos/gastos) de un movimiento."""
    return _safe(lambda: api.get(f"transferencias/{transferencia_id}/cost-lines/"))


@mcp.tool()
def transfer_costo_agregar(
    transferencia_id: str,
    kind: str,
    amount: float,
    label: str | None = None,
    currency: str = "USD",
    fx_to_usd: float = 1.0,
    price_view: str = "MWT",
    scope_json: dict | None = None,
    source: str = "MANUAL",
    document_id: str | None = None,
    notes: str | None = None,
) -> Any:
    """Agrega un costo/impuesto/gasto al movimiento (tabla COSTOS INCREMENTALES).

    `kind`: DAI, IVA, ALMACENAJE, AGENCIAMIENTO, MANIPULEO, FLETE, SEGURO,
      CONSOLIDACION, PROCOMER, LEY_6946, TIMBRE_ARCHIVO, TIMBRE_AGENTES,
      TIMBRE_CONTADORES, OTRO. Para un impuesto custom usa kind=OTRO o el fiscal que aplique.
    `amount` + `fx_to_usd`: monto y conversión a USD.
    `price_view`: MWT (liquidación interna, CEO) o CLIENT (vista cliente).
    `scope_json`: a qué aplica — null/{"applies_to_all":true} = todo el batch, o
      {"applies_to_all":false, "expediente_ids":[...], "lines":[{expediente_id,producto_id,talla}]}.
    """
    g = _wguard()
    if g:
        return g
    body = _params(kind=kind, amount=amount, label=label, currency=currency, fx_to_usd=fx_to_usd,
                   price_view=price_view, scope_json=scope_json, source=source, document_id=document_id, notes=notes)
    return _safe(lambda: api.post(f"transferencias/{transferencia_id}/cost-lines/", body))


@mcp.tool()
def transfer_costo_editar(transferencia_id: str, cost_id: str, cambios: dict) -> Any:
    """Edita una línea de costo del movimiento (PATCH parcial)."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"transferencias/{transferencia_id}/cost-lines/{cost_id}/", cambios))


@mcp.tool()
def transfer_costo_eliminar(transferencia_id: str, cost_id: str) -> Any:
    """Elimina (soft) una línea de costo del movimiento."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.delete(f"transferencias/{transferencia_id}/cost-lines/{cost_id}/"))


@mcp.tool()
def transfer_artefacto_crear(transferencia_id: str, template_id: int, template_title: str, data: dict, structure_snapshot: dict | None = None, lines: list | None = None) -> Any:
    """Agrega un artefacto del Builder (AWB/BL, etc.) a un movimiento.
    `lines`: alcance [{expediente_id, producto_id, talla, qty}]."""
    g = _wguard()
    if g:
        return g
    body = _params(template_id=template_id, template_title=template_title, data=data,
                   structure_snapshot=structure_snapshot, lines=lines)
    return _safe(lambda: api.post(f"transferencias/{transferencia_id}/builder-artifacts/", body))


# --- Landed cost / factura / remisión ---------------------------------------
@mcp.tool()
def transfer_liquidacion_preview(transferencia_id: str) -> Any:
    """Preview del landed cost (no persiste): FOB, costos extra, costo aterrizado por línea."""
    return _safe(lambda: api.get(f"transferencias/{transferencia_id}/liquidation_report/"))


@mcp.tool()
def transfer_liquidar(transferencia_id: str, method: str = "BY_VALUE") -> Any:
    """Liquida y persiste el landed cost. `method`: BY_VALUE (default), BY_QUANTITY o BY_VOLUME."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post(f"transferencias/{transferencia_id}/liquidate/", {"method": method}))


@mcp.tool()
def transfer_factura_payload(transferencia_id: str) -> Any:
    """Payload estructurado para generar la factura/remisión interna del movimiento
    (líneas, cost_breakdown, totales, operating_company, transfer_pricing)."""
    return _safe(lambda: api.get(f"transferencias/{transferencia_id}/invoice_payload/"))


@mcp.tool()
def transfer_notas_listar(transferencia_id: str) -> Any:
    """Lista las notas del movimiento."""
    return _safe(lambda: api.get(f"transferencias/{transferencia_id}/notes/"))


@mcp.tool()
def transfer_nota_crear(transferencia_id: str, text: str, actor_name: str | None = None) -> Any:
    """Agrega una nota al movimiento."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.post(f"transferencias/{transferencia_id}/notes/", _params(text=text, actor_name=actor_name)))


# =========================================================================== #
# G) PAGOS (FINANCE)
# =========================================================================== #
@mcp.tool()
def pago_applicables(
    type: str,
    expediente: str | None = None,
    nodo_id: str | None = None,
    transferencia_id: str | None = None,
    oc_id: str | None = None,
    include_paid: bool | None = None,
) -> Any:
    """Lista los conceptos pagables. `type`: PROFORMA, FACTURA, COSTO o PRODUCTO.
    Para PROFORMA/FACTURA pasa `expediente`. Para COSTO/PRODUCTO acota con nodo_id,
    transferencia_id u oc_id. Devuelve los `applicable_id` para usar en pago_registrar."""
    params = _params(type=type, expediente=expediente, nodo_id=nodo_id,
                     transferencia_id=transferencia_id, oc_id=oc_id)
    if include_paid:
        params["include_paid"] = 1
    return _safe(lambda: api.get("finance/payments/applicables/", params))


@mcp.tool()
def pago_listar(expediente_id: str | None = None, estado: str | None = None, transferencia_id: str | None = None, q: str | None = None) -> Any:
    """Lista pagos. Filtros: expediente_id, estado (PENDIENTE_AI/CONFIRMADO_AI/NEEDS_REVIEW/
    CONFIRMADO_HUMANO/RECHAZADO/REVERTIDO), transferencia_id, q."""
    return _safe(lambda: api.get("finance/payments/", _params(expediente_id=expediente_id, estado=estado, transferencia_id=transferencia_id, q=q)))


@mcp.tool()
def pago_obtener(pago_id: str) -> Any:
    """Detalle de un pago, incluyendo aplicaciones, evidencia y veredicto IA."""
    return _safe(lambda: api.get(f"finance/payments/{pago_id}/"))


@mcp.tool()
def pago_dry_run(expediente_id: str, monto: float, direction: str, aplicaciones: list, counterparty_type: str | None = None, counterparty_id: str | None = None) -> Any:
    """Simula un pago sin persistir: valida y previsualiza el efecto sobre el crédito.
    `direction`: IN (entrante, cliente→MWT) u OUT (saliente, MWT→proveedor)."""
    body = _params(expediente_id=expediente_id, monto=monto, direction=direction,
                   aplicaciones=aplicaciones, counterparty_type=counterparty_type, counterparty_id=counterparty_id)
    return _safe(lambda: api.post("finance/payments/dry-run/", body))


@mcp.tool()
def pago_registrar(
    expediente_id: str,
    monto: float,
    moneda: str,
    fecha: str,
    metodo: str,
    tipo_pago: str,
    referencia: str,
    aplicaciones: list,
    notas: str | None = None,
    file_path: str | None = None,
    event_id: str | None = None,
) -> Any:
    """Registra un pago (entrante o saliente). Queda en estado borrador (PENDIENTE_AI/
    NEEDS_REVIEW) y NO afecta saldos ni crédito hasta conciliar (ver pago_conciliar).

    - `metodo`: TRANSFERENCIA_BANCARIA o NOTA_CREDITO.
    - `tipo_pago`: PARCIAL o COMPLETO. `referencia`: nº de referencia (3-64 chars).
    - `aplicaciones`: [{applicable_type: COSTO|PRODUCTO|PROFORMA|FACTURA, applicable_id,
        applicable_code?, cantidad_producto? (solo PRODUCTO), monto_aplicado}].
      Usa pago_applicables para obtener los applicable_id (sku/talla/cantidad para PRODUCTO).
    - `file_path`: comprobante opcional (pdf/png/jpg/webp ≤10MB).
    """
    g = _wguard()
    if g:
        return g
    data = _params(expediente_id=expediente_id, monto=monto, moneda=moneda, fecha=fecha,
                   metodo=metodo, tipo_pago=tipo_pago, referencia=referencia,
                   aplicaciones=aplicaciones, notas=notas, event_id=event_id)
    return _safe(lambda: api.post_multipart("finance/payments/", data, file_path, file_field="evidencia"))


@mcp.tool()
def pago_conciliar(pago_id: str, bank_reference: str | None = None) -> Any:
    """Concilia un pago (botón CONCILIAR): pasa a CONFIRMADO_HUMANO y recién aquí
    impacta saldos y libera crédito. Es la acción que 'aplica' el pago."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"finance/payments/{pago_id}/reconcile/", _params(bank_reference=bank_reference)))


@mcp.tool()
def pago_liberar_credito(pago_id: str) -> Any:
    """Libera el crédito de un pago (CEO-only)."""
    g = _wguard()
    if g:
        return g
    return _safe(lambda: api.patch(f"finance/payments/{pago_id}/release-credit/", {}))


@mcp.tool()
def pago_rechazar(pago_id: str, rejection_reason: str, rejection_comment: str | None = None) -> Any:
    """Rechaza un pago (CEO-only). `rejection_reason`: REF_ERRONEA, MONTO_NO_COINCIDE,
    DUPLICADO, COMPROBANTE_INVALIDO, FUERA_DE_PLAZO, CONTRAPARTE_INCORRECTA, OTRO
    (comentario obligatorio si OTRO)."""
    g = _wguard()
    if g:
        return g
    body = _params(rejection_reason=rejection_reason, rejection_comment=rejection_comment, confirm_reversal=True)
    return _safe(lambda: api.patch(f"finance/payments/{pago_id}/reject/", body))


# =========================================================================== #
# H) BUILDER TEMPLATES (catálogo de artefactos)
# =========================================================================== #
@mcp.tool()
def builder_templates_listar(only_published: bool = True) -> Any:
    """Lista los templates de artefactos disponibles en el Builder (campos, tipos, opciones)."""
    params = {"only_published": 1} if only_published else {}
    return _safe(lambda: api.get("builder/templates/", params))


@mcp.tool()
def builder_template_obtener(template_id: int) -> Any:
    """Obtiene la definición/estructura de un template del Builder por su id (entero)."""
    return _safe(lambda: api.get(f"builder/templates/{template_id}/"))
