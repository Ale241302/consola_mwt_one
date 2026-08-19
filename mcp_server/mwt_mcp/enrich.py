"""Enriquecimiento de respuestas del MCP con nombres legibles (Ola 3.7 · Calidad).

Resuelve los UUIDs que el backend devuelve en campos como `client_id`,
`legal_entity_ids`, `operating_company_id`, `brand_id` a su nombre legible
(`nombre_comercial` / `razon_social` / `nombre`), para que el agente no le
muestre al CEO/Admin un UUID sino "Sondel S.A.".

También normaliza la presentación de los códigos de un expediente según el rol:
  · CEO/Admin  -> `proforma_codigos` + `oc_codigos` + `sap_codigos` (los presentes)
  · client_b2b -> `oc_codigos` + `sap_codigos` (sin proforma interna)

Diseño:
  · Resolución por BATCH con caché en memoria (TTL 30 min): se piden UNA vez los
    clientes del scope y se mapea id -> nombre_comercial. Evita N+1 por fila.
  · `enrich_ids(data)` recorre el payload y sustituye los campos *_id por un
    campo adjunto `*_nombre` cuando el ID está en el mapa (no muta el ID).
  · Fail-safe: si no se puede resolver (red, permiso), deja el UUID tal cual.
"""
from __future__ import annotations

import threading
import time
from typing import Any

from . import client as api

# ── Ola 2 · 2.7 — caché de nombres por (email | cliente) ───────────────
# Antes había UNA caché global: el primer usuario que disparaba _resolver
# cargaba los nombres de SU scope y un usuario posterior recibía `*_name`
# enriquecidos con clientes fuera de su tenant (fuga de nombres P1-4).
# Ahora la key incluye el email del usuario + el cliente resuelto de la app.
_CACHE_TTL = 30 * 60
_client_cache: dict[str, dict[str, str]] = {}
_client_cache_exp: dict[str, float] = {}
_cache_lock = threading.Lock()


def _cache_key() -> str:
    """Key de caché = (email de identidad | cliente resuelto de la app)."""
    from .identity import current_identity, current_tenant

    identity = current_identity()
    who = (identity.email or identity.user_id or "anon").lower()
    tenant = current_tenant()
    scope = tenant.client_id or "global"
    return f"{who}|{scope}"


def _resolver(identity_email: str | None = None) -> None:
    """Carga el mapa id -> nombre_comercial de las empresas del scope.

    Usa `portal/me/` como fuente PRIMARIA porque es accesible para TODOS los
    roles (incluido client_b2b, que recibe 403 en `/clientes/`). El `me`
    devuelve `empresas: [{id, nombre, razon_social}]`. Para staff, se añade un
    fallback a `clientes/` (más completo). Fail-safe: ante error, cachea
    vacío para no repetir la llamada por cada tool.
    """
    global _client_cache, _client_cache_exp
    key = _cache_key()
    try:
        names: dict[str, str] = {}
        try:
            data = api.get("portal/me/")
            empresas = (data or {}).get("empresas") or []
            for e in empresas:
                if e.get("id"):
                    names[str(e["id"])] = e.get("nombre") or e.get("razon_social") or ""
        except Exception:  # noqa: BLE001 - fallback a clientes/
            pass
        if not names:
            data = api.get("clientes/", {"limit": 500})
            rows = data if isinstance(data, list) else (data or {}).get("results") or []
            for r in rows:
                if r.get("id"):
                    names[str(r["id"])] = (r.get("nombre_comercial") or r.get("razon_social") or "")
        _client_cache[key] = names
        _client_cache_exp[key] = time.time() + _CACHE_TTL
    except Exception:  # noqa: BLE001 - fail-safe
        _client_cache_exp[key] = time.time() + 60  # reintenta pronto


def _ensure_loaded() -> None:
    key = _cache_key()
    with _cache_lock:
        if time.time() >= _client_cache_exp.get(key, 0.0):
            _resolver()


def client_name(client_id: str | None) -> str | None:
    """Nombre legible de un client_id (nombre_comercial o razon_social)."""
    if not client_id:
        return None
    _ensure_loaded()
    name = _client_cache.get(_cache_key(), {}).get(str(client_id))
    return name or None


def user_client_ids() -> list[str]:
    """Ids de las empresas (legal entities) del usuario conectado.

    Fuente: `portal/me/` (empresas[].id), que el resolver ya cachea. Útil para
    filtrar endpoints que NO aplican scope automático (ej. phase-stats).
    Fail-safe: lista vacía si no se puede resolver.
    """
    _ensure_loaded()
    return list(_client_cache.get(_cache_key(), {}).keys())


# Campos *_id que queremos enriquecer con un *_nombre adjunto.
_ID_FIELDS = (
    "client_id", "legal_entity_id", "operating_company_id",
    "nodo_asignado_id", "responsable_id", "parent_id",
)


def _enrich_dict(obj: dict) -> dict:
    out = dict(obj)
    for field in _ID_FIELDS:
        cid = out.get(field)
        if cid:
            name = client_name(cid)
            if name:
                # Adjunta el nombre sin pisar el id: ej. client_id + client_name
                out.setdefault(field.replace("_id", "_name"), name)
    return out


def _walk(value: Any) -> Any:
    if isinstance(value, dict):
        return _enrich_dict({k: _walk(v) for k, v in value.items()})
    if isinstance(value, list):
        return [_walk(v) for v in value]
    return value


def enrich_ids(payload: Any) -> Any:
    """Recorre el payload y adjunta `*_name` para los campos *_id resueltos.

    NO muta el id original; solo añade el nombre cuando se pudo resolver.
    Fail-safe: ante cualquier error devuelve el payload intacto.
    """
    try:
        return _walk(payload)
    except Exception:  # noqa: BLE001
        return payload


# --------------------------------------------------------------------------- #
# Presentación de códigos de expediente según rol (Ola 3.7 · Calidad)
# --------------------------------------------------------------------------- #
def present_expediente_codigos(row: dict, role: str) -> dict:
    """Normaliza los códigos de un expediente según el rol.

    Añade un campo `codigos_presentacion` con el formato legible:
      CEO/Admin  -> "PF 2393-2025 · PO 504302 · 257021"   (proforma + oc + sap)
      client_b2b -> "PO 504302 · 257021"                   (oc + sap)

    Si el backend ya trae `proforma_codigos`/`oc_codigos`/`sap_codigos`
    (listas), se usan esas; si no, se deriva del `codigo` interno.
    """
    from .redact import is_ceo_or_admin, is_client

    role = (role or "").strip().lower()
    proformas = row.get("proforma_codigos") or (
        [row["proforma_codigo"]] if row.get("proforma_codigo") else []
    )
    ocs = row.get("oc_codigos") or []
    saps = row.get("sap_codigos") or []
    # Fix 2026-08-19 · el listado para client_b2b trae `sap_codigos` vacío pero
    # el SAP real vive en el campo legacy `sap` (ej. "282507"). Se expone para
    # que el cliente vea y encadene por su SAP. Si NO hay SAP, queda vacío.
    if not saps and row.get("sap"):
        saps = [str(row.get("sap"))]

    partes: list[str] = []
    if is_ceo_or_admin(role):
        partes.extend(proformas)  # proforma interna solo para CEO/Admin
    partes.extend(ocs)
    partes.extend(saps)

    out = dict(row)
    if partes:
        out["codigos_presentacion"] = " · ".join(partes)
    # Ola 3.8 · El código interno EXP- es un número que SOLO usa el sistema;
    # no se entrega a ningún rol (ni admin/CEO). El identificador presentable
    # es `codigos_presentacion` (PF · PO · SAP).
    out.pop("codigo", None)
    out.pop("codigo_interno", None)
    out.pop("expediente_codigo", None)
    # Fix 2026-08-19 · los UUIDs internos del expediente (id, expediente_id,
    # oc_id, fusion_id, operating_company_id, brand_id) NUNCA se exponen, a
    # NINGÚN rol. El identificador de encadenamiento es `referencia_cliente`
    # (para admin/CEO prioriza proforma; para client_b2b OC o SAP). Las tools
    # (expediente_obtener/editar/lineas) resuelven por esa referencia.
    for key in (
        "id",
        "expediente_id",
        "oc_id",
        "fusion_id",
        "operating_company_id",
        "brand_id",
        "client_id",
    ):
        out.pop(key, None)
    if is_ceo_or_admin(role):
        ref = (proformas[0] if proformas else (ocs[0] if ocs else (saps[0] if saps else None)))
    else:
        ref = (ocs[0] if ocs else (saps[0] if saps else None))
    if ref:
        out["referencia_cliente"] = ref
    return out


# --------------------------------------------------------------------------- #
# Enriquecimiento de PRODUCTOS (Ola 3.7 · Calidad)
# --------------------------------------------------------------------------- #
_talla_cache: dict[str, dict] = {}
_talla_cache_exp: float = 0.0


def _ensure_tallas_loaded() -> None:
    global _talla_cache, _talla_cache_exp
    if time.time() < _talla_cache_exp:
        return
    try:
        data = api.get("sizing/tallas/", {"limit": 500})
        rows = data if isinstance(data, list) else (data or {}).get("results") or []
        _talla_cache = {str(r.get("id")): r for r in rows if r.get("id")}
        _talla_cache_exp = time.time() + _CACHE_TTL
    except Exception:  # noqa: BLE001
        _talla_cache_exp = time.time() + 60


def resolve_tallas(sizes: list | None) -> list[dict]:
    """Resuelve una lista de UUIDs de talla a su nombre + equivalencias.

    Ej. `["71e3feb6-..."]` -> `[{"id": "...", "nombre": "33", "eu": "35",
    "us_men": "3-3.5", "cm": "22.34"}]`. Fail-safe: deja el UUID si no resuelve.
    """
    if not sizes:
        return []
    _ensure_tallas_loaded()
    out = []
    for s in sizes:
        sid = str(s)
        t = _talla_cache.get(sid)
        if not t:
            out.append({"id": sid, "nombre": sid})
            continue
        out.append({
            "id": sid,
            "nombre": t.get("nombre") or t.get("talla_base") or sid,
            "talla_base": t.get("talla_base"),
            "eu": t.get("eu"),
            "us_men": t.get("us_men"),
            "us_women": t.get("us_women"),
            "uk_men": t.get("uk_men"),
            "cm": t.get("cm"),
            "br": t.get("br"),
        })
    return out


def _client_ids_for_user(user: dict | None) -> set[str]:
    """Legal entity ids del usuario conectado (para filtrar client_prices)."""
    if not user:
        return set()
    ids = user.get("legal_entity_ids") or []
    return {str(x) for x in ids}


def enrich_producto(payload: Any, user: dict | None = None) -> Any:
    """Enriquece un producto (o lista):
      · `tallas`/`especificaciones.sizes` -> array con nombre + equivalencias.
      · `especificaciones.client_prices` -> filtrado por rol:
        CEO/Admin: todos; client_b2b: solo sus legal_entity_ids.
      · `ficha_pdf` se deja como referencia (el MCP la descarga en demanda).
    """
    from .redact import is_ceo_or_admin, is_client

    role = (user or {}).get("role") or (user or {}).get("role_slug") or ""

    def _one(row: dict) -> dict:
        if not isinstance(row, dict):
            return row
        out = dict(row)
        spec = out.get("especificaciones")
        if isinstance(spec, dict):
            spec = dict(spec)
            sizes = spec.get("sizes") or []
            if sizes:
                spec["sizes"] = resolve_tallas(sizes)
            cp = spec.get("client_prices") or {}
            if isinstance(cp, dict) and cp:
                if is_ceo_or_admin(role):
                    pass  # CEO/Admin: todos los precios
                elif is_client(role):
                    allowed = _client_ids_for_user(user)
                    spec["client_prices"] = {
                        k: v for k, v in cp.items()
                        if k in allowed or _is_uuid_in(user, k)
                    }
                else:
                    # staff no-CEO: sin precios por cliente (evita fuga)
                    spec["client_prices"] = {}
            out["especificaciones"] = spec
        tallas = out.get("tallas") or []
        if tallas:
            out["tallas"] = resolve_tallas(tallas)
        return out

    def _is_uuid_in(user, cid):
        # comparación tolerante: algunos client_prices usan el id de legal_entity
        le = user.get("legal_entity_ids") or []
        return str(cid) in {str(x) for x in le}

    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        payload = dict(payload)
        payload["results"] = [_one(r) for r in payload["results"]]
        return payload
    if isinstance(payload, list):
        return [_one(r) for r in payload]
    if isinstance(payload, dict):
        return _one(payload)
    return payload


# --------------------------------------------------------------------------- #
# Enriquecimiento de LÍNEAS de expediente (Ola 3.8 · Calidad)
# --------------------------------------------------------------------------- #
_product_cache: dict[str, dict] = {}
_product_cache_exp: float = 0.0


def _ensure_products_loaded() -> None:
    global _product_cache, _product_cache_exp
    if time.time() < _product_cache_exp:
        return
    try:
        from .marluvas_pricing import _tc_usd_brl
        # Ola 3.8 · el catálogo B2B usa portal/products/ (scoped y read-only),
        # accesible para client_b2b. /api/productos/ devuelve 403 al cliente.
        # Fix 2026-08-18 · se envía `?tc=<usd_brl>` (mismo hook que el frontend)
        # para que el backend escoja la BANDA VIGENTE Marluvas al resolver el
        # precio 90d. Sin `tc`, resolve_client_price cae a banda 6 (5,00–5,20)
        # y el precio_venta del catálogo queda en la banda equivocada.
        _tc = _tc_usd_brl()
        params: dict = {"limit": 500}
        if _tc is not None:
            params["tc"] = _tc
        data = api.get("portal/products/", params)
        rows = data if isinstance(data, list) else (data or {}).get("results") or []
        _product_cache = {
            str(r.get("id")): r for r in rows if r.get("id")
        }
        if not _product_cache:
            # Fallback backoffice (staff/admin): solo si el primero no dio nada.
            data = api.get("productos/", {"limit": 500})
            rows = data if isinstance(data, list) else (data or {}).get("results") or []
            _product_cache = {
                str(r.get("id")): r for r in rows if r.get("id")
            }
        # Ola 3.8 · si el catálogo es manejable, recargamos el detalle (con
        # especificaciones) para que la búsqueda por características funcione.
        # El list del portal no incluye especificaciones; el detail sí.
        if _product_cache:
            pids = list(_product_cache.keys())
            if len(pids) <= 500:
                for pid in pids:
                    detail = _fetch_product_detail(pid)
                    if detail:
                        merged = dict(_product_cache[pid])
                        # Mantener el nombre/marca del list (el detail puede
                        # no traerlos igual) y añadir especificaciones/tallas.
                        for k, v in detail.items():
                            if v is not None:
                                merged.setdefault(k, v)
                        _product_cache[pid] = merged
        _product_cache_exp = time.time() + _CACHE_TTL
    except Exception:  # noqa: BLE001
        _product_cache_exp = time.time() + 60


def _fetch_product_detail(pid: str) -> dict | None:
    """Detalle de un producto del portal B2B (con especificaciones). Fail-safe."""
    try:
        detail = api.get(f"portal/products/{pid}/")
        if isinstance(detail, dict) and detail.get("id"):
            return detail
    except Exception:  # noqa: BLE001
        pass
    return None


def enrich_lineas(payload: Any) -> Any:
    """Añade a cada línea de expediente el `producto_nombre` y `marca_nombre`
    del producto (resuelto por producto_id vía el catálogo). Fail-safe: si no
    resuelve, deja la línea tal cual (el agente conserva el SKU)."""
    try:
        _ensure_products_loaded()
    except Exception:  # noqa: BLE001
        pass

    def _one(row: dict) -> dict:
        if not isinstance(row, dict):
            return row
        pid = row.get("producto_id")
        prod = _product_cache.get(str(pid)) if pid else None
        if not prod:
            return row
        out = dict(row)
        out.setdefault("producto_nombre", prod.get("nombre") or prod.get("sku"))
        marca = prod.get("marca_nombre") or prod.get("marca_label") or ""
        if marca:
            out.setdefault("marca_nombre", marca)
        return out

    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        payload = dict(payload)
        payload["results"] = [_one(r) for r in payload["results"]]
        return payload
    if isinstance(payload, list):
        return [_one(r) for r in payload]
    if isinstance(payload, dict):
        return _one(payload)
    return payload


# --------------------------------------------------------------------------- #
# Búsqueda de productos por texto amplio (Ola 3.8 · Calidad)
# --------------------------------------------------------------------------- #
# Índice invertido simple: término normalizado -> lista de producto_id.
# Se construye desde el cache de productos y cubre: sku, nombre, marca,
# categoría y TODAS las especificaciones (tipo_calzado, suela, color, riesgo,
# segmento, cierre, puntera, normativa...). Así "bota alta" o "suela caucho"
# resuelven sin tocar el backend.
_search_index: dict[str, list[str]] = {}
_search_index_built: float = 0.0


def _norm_tokens(text: str) -> list[str]:
    """Normaliza un texto a tokens simples (minúsculas, sin acentos, sin puntuación)."""
    import unicodedata

    nfkd = unicodedata.normalize("NFKD", (text or ""))
    ascii_txt = "".join(c for c in nfkd if not unicodedata.combining(c))
    out = []
    for tok in ascii_txt.lower().split():
        tok = "".join(ch for ch in tok if ch.isalnum())
        if tok:
            out.append(tok)
    return out


def _product_search_text(row: dict) -> str:
    """Concatena todos los textos buscables de un producto (sku, nombre, marca,
    categoría, especificaciones planas y aliases si ya se cargaron)."""
    parts = [
        str(row.get("sku") or ""),
        str(row.get("nombre") or ""),
        str(row.get("marca_label") or row.get("marca_nombre") or ""),
        str(row.get("categoria") or ""),
        str(row.get("descripcion") or ""),
    ]
    aliases = row.get("_aliases")
    if isinstance(aliases, (list, tuple)):
        parts.extend(str(a) for a in aliases if a)
    spec = row.get("especificaciones")
    if isinstance(spec, dict):
        for k, v in spec.items():
            if k in ("visibility", "client_prices", "nodes", "sizes", "fichas", "gallery"):
                continue
            if isinstance(v, (list, tuple)):
                parts.extend(str(x) for x in v if x is not None)
            elif v is not None:
                parts.append(str(v))
    return " ".join(p for p in parts if p)


# Aliases comerciales por cliente (staff-only; client_b2b recibe 403).
_alias_loaded: bool = False


def _load_aliases_for_staff() -> None:
    """Carga los aliases comerciales de cada producto en el cache (solo para
    roles staff; el endpoint devuelve 403 a client_b2b). Fail-safe: silencioso."""
    global _alias_loaded
    if _alias_loaded or not _product_cache:
        return
    _alias_loaded = True
    pids = list(_product_cache.keys())
    for pid in pids:
        try:
            data = api.get(f"productos/{pid}/aliases/")
            rows = data if isinstance(data, list) else (data or {}).get("results") or []
            aliases = sorted({str(r.get("alias")) for r in rows if r.get("alias")})
            if aliases and pid in _product_cache:
                _product_cache[pid] = dict(_product_cache[pid], _aliases=aliases)
        except Exception:  # noqa: BLE001 - 403 u otro: no bloquea
            continue


def _ensure_aliases(allow_staff: bool) -> None:
    if allow_staff and not _alias_loaded:
        try:
            _load_aliases_for_staff()
        except Exception:  # noqa: BLE001
            pass


def _build_search_index(rows: list) -> None:
    global _search_index, _search_index_built
    idx: dict[str, list[str]] = {}
    for r in rows:
        pid = str(r.get("id")) if r.get("id") else None
        if not pid:
            continue
        for tok in _norm_tokens(_product_search_text(r)):
            idx.setdefault(tok, []).append(pid)
    _search_index = idx
    _search_index_built = time.time()


def search_productos(query: str, limit: int = 10, with_specs: bool = False,
                     allow_aliases: bool = False) -> list[dict]:
    """Busca productos por SKU/nombre/alias/característica.

    Empareja por SUBSTRING (insensible): todos los tokens de la query deben
    aparecer en el texto buscable del producto (sku, nombre, marca, categoría,
    especificaciones y aliases). Así "60b29" matchea el sku/nombre "60B29-...",
    "bota alta" matchea tipo_calzado="Bota Alta", y "suela caucho" matchea
    suela="Caucho". `with_specs=True` recarga especificaciones de candidatos
    (portal/products/{id}/). `allow_aliases=True` indexa aliases (staff-only).
    Fail-safe: lista vacía.
    """
    try:
        _ensure_products_loaded()
        _ensure_aliases(allow_aliases)
        rows = list(_product_cache.values())
        tokens = _norm_tokens(query)
        if not tokens:
            return []
        # Scan lineal por substring sobre el texto normalizado de cada producto.
        def _matches(row: dict) -> bool:
            haystack = _norm_tokens(_product_search_text(row))
            # Unir tokens normalizados sin separadores para permitir substring.
            hay_text = " ".join(haystack)
            return all(tok in hay_text for tok in tokens)

        hits = [r for r in rows if _matches(r)]
        # Re-rank: los que matchean exactamente el sku/nombre van primero.
        qq = (query or "").strip().lower()
        hits.sort(key=lambda r: (
            0 if qq == str(r.get("sku") or "").lower() else
            1 if qq in str(r.get("sku") or "").lower() else
            2 if qq in str(r.get("nombre") or "").lower() else 3,
            str(r.get("sku") or ""),
        ))
        out = hits[:limit]
        if with_specs:
            out = [_with_specs(r) for r in out]
        return out
    except Exception:  # noqa: BLE001
        return []


def _with_specs(row: dict) -> dict:
    """Si la fila no trae especificaciones, las recarga del detalle (cacheado)."""
    if row.get("especificaciones"):
        return row
    pid = row.get("id")
    if not pid:
        return row
    key = str(pid)
    if key in _specs_cache:
        return _specs_cache[key]
    detail = _fetch_product_detail(key)
    if detail:
        merged = dict(row)
        for k, v in detail.items():
            if v is not None:
                merged.setdefault(k, v)
        _specs_cache[key] = merged
        return merged
    return row


_specs_cache: dict[str, dict] = {}
_specs_cache_exp: float = 0.0
