"""
=====================================================================
MWT.ONE · apps.expedientes.po_alias_matcher
Agente responsable: [AG-BACKEND]

Funciones PURAS (sin DB, sin red, sin Django) para el wizard
"Subir Orden de Compra" del cliente B2B (POST /api/expedientes/
create-from-oc/):

  1. MATCH POR ALIAS DEL CLIENTE (R1)
     La PO del cliente lista "Part Nº" tipo `50B22CPAP-37` que son
     el ALIAS del producto PARA ESE CLIENTE (tabla
     `productos.product_client_alias`, sembrada por
     backend/sql/B3_product_client_alias.sql) + sufijo de TALLA.
     NO son el SKU MWT (`700211`) ni el nombre canónico
     (`70B22-E-C-PAD`).

       normalize_code("70B22-CPAP")      → "70B22CPAP"
       extract_size("50B22CPAP-37")      → ("50B22CPAP", "37")
       match_part_number(part, index)    → alias más LARGO cuyo
                                           normalizado sea prefijo del
                                           Part Nº normalizado sin talla

  2. BANDAS MARLUVAS (R3)
     `pick_band(rate)` — espejo PURO de
     `apps.commercial.services.banda_for_tc` (12 bandas, piso 4.00,
     step 0.20, techo exclusivo). Las definiciones viven congeladas
     en `pricing.marluvas_client_sku_pricing.prices_matrix`
     (backend/sql/A2e_marluvas_prices_matrix_column.sql).
       rate 5.1604 → banda 6 ("5,00 – 5,20")

  3. PLAZOS
     `pick_plazo_price(matrix_result, days)` — extraída del inline
     `_pick_plazo_price` que vivía dentro de create_from_oc; ahora es
     testeable y reutilizable. `matrix_result` es el dict que devuelve
     `apps.commercial.services.get_client_price_matrix`.

  4. CÓDIGO DE DOCUMENTO (R4)
     `format_po_codigo("504983")` → "PO 504983" (idempotente si ya
     trae prefijo PO).

Este módulo NO importa Django a propósito: todos los tests corren
sin DB ni llamadas externas.
=====================================================================
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

# ─────────────────────────────────────────────────────────────────────
# Bandas Marluvas — espejo de apps.commercial.services.banda_for_tc
# (y de frontend/src/constants/marluvas.js). Cada banda cubre
# [piso, techo) — techo EXCLUSIVO. Fuera de [4.00, 6.40) → None.
# ─────────────────────────────────────────────────────────────────────
BAND_PISO = 4.00
BAND_STEP = 0.20
BAND_MIN = 1
BAND_MAX = 12

#: [(band_id, piso_inclusivo, techo_exclusivo), ...] — 1..12
DEFAULT_BANDS: list[tuple[int, float, float]] = [
    (i, round(BAND_PISO + BAND_STEP * (i - 1), 2),
        round(BAND_PISO + BAND_STEP * i, 2))
    for i in range(BAND_MIN, BAND_MAX + 1)
]

_NON_ALNUM_RE = re.compile(r"[^A-Z0-9]+")
_DIGIT_GROUP_RE = re.compile(r"\d+")
_PO_PREFIX_RE = re.compile(r"^(?:P\.?O\.?|PURCHASE\s+ORDER|ORDEN(?:\s+DE\s+COMPRA)?)[\s#:·\-]*", re.I)

# Rango plausible de tallas calzado (BR/EU). La PO trae 35-46
# típicamente (A2f contempla 33..48); margen 30-60 para tallas raras
# sin tragarnos sufijos de modelo (ej. `70B22` termina en '22' que NO
# es talla plausible → no se parte; y aunque un modelo terminara en un
# número plausible, el prefix-match contra el part COMPLETO y el
# fallback por nombre/SKU siguen vivos).
SIZE_MIN = 30
SIZE_MAX = 60


# ═════════════════════════════════════════════════════════════════════
# 1) Normalización + talla
# ═════════════════════════════════════════════════════════════════════
def normalize_code(value: Any) -> str:
    """Uppercase + elimina TODO separador no alfanumérico.

    La PO puede traer `50B22CPAP` y el alias `50B22-CPAP` — ambos
    normalizan a `50B22CPAP`.
    """
    if value is None:
        return ""
    return _NON_ALNUM_RE.sub("", str(value).upper().strip())


def extract_size(part_number: Any) -> tuple[str, Optional[str]]:
    """Separa el Part Nº del cliente en (base_normalizada, talla).

    Regla: la TALLA es el ÚLTIMO grupo numérico del Part Nº y debe ser
    TRAILING tras normalizar (`50B22CPAP-37` → 37; `70C32-PET-CPAP-PAD-40`
    → 40; tokens tipo `JA-36`/`WH-36` → 36). Si el grupo final no es
    plausible como talla (fuera de [SIZE_MIN, SIZE_MAX]) se devuelve
    (normalizado_completo, None).
    """
    raw = str(part_number or "").strip()
    norm = normalize_code(raw)
    if not norm:
        return "", None
    # IMPORTANTE: el grupo numérico se busca sobre el string CRUDO, antes
    # de quitar separadores — al normalizar, `50B22-37` colapsaría a
    # `50B2237` y el grupo final sería `2237`, no la talla `37`.
    matches = list(_DIGIT_GROUP_RE.finditer(raw))
    if not matches:
        return norm, None
    m = matches[-1]
    # El grupo debe ser SUFIJO: tras él solo separadores (sin alfanuméricos).
    if _NON_ALNUM_RE.sub("", raw[m.end():].upper()):
        return norm, None
    digits = m.group(0)
    # La talla típica es de 2 dígitos (35-46). Si el part number termina
    # en un grupo numérico largo (ej. un SKU puramente numérico como
    # `700211`), NO se parte.
    if len(digits) > 2:
        return norm, None
    if not (SIZE_MIN <= int(digits) <= SIZE_MAX):
        return norm, None
    base = normalize_code(raw[: m.start()])
    if not base:
        # Part Nº que es SOLO la talla ("37") no tiene base útil.
        return norm, None
    return base, digits


# ═════════════════════════════════════════════════════════════════════
# 2) Índice alias → producto + match
# ═════════════════════════════════════════════════════════════════════
def build_alias_index(alias_rows: Iterable[dict]) -> list[dict]:
    """Construye el índice de matching a partir de las filas de
    `productos.product_client_alias` de UN cliente.

    Cada row debe traer al menos `alias` y `producto_id`; opcionales:
    `sku` (SKU MWT del producto), `marca_id`, `cliente_sku`.

    Devuelve entradas {alias, alias_norm, producto_id, sku, marca_id,
    cliente_sku} ordenadas por len(alias_norm) DESC para que el alias
    más LARGO gane el prefix-match.
    """
    index: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for row in alias_rows or []:
        alias = (row.get("alias") or "").strip()
        producto_id = row.get("producto_id")
        alias_norm = normalize_code(alias)
        if not alias_norm or not producto_id:
            continue
        key = (alias_norm, str(producto_id))
        if key in seen:
            continue
        seen.add(key)
        index.append({
            "alias":       alias,
            "alias_norm":  alias_norm,
            "producto_id": str(producto_id),
            "sku":         (row.get("sku") or None),
            "marca_id":    str(row["marca_id"]) if row.get("marca_id") else None,
            "cliente_sku": (row.get("cliente_sku") or None),
        })
        # cliente_sku también identifica el producto en la PO (algunos
        # clientes ponen SU código ERP en vez del alias) — lo indexamos
        # como entrada adicional.
        cs_norm = normalize_code(row.get("cliente_sku"))
        if cs_norm and cs_norm != alias_norm:
            cs_key = (cs_norm, str(producto_id))
            if cs_key not in seen:
                seen.add(cs_key)
                index.append({
                    "alias":       row.get("cliente_sku"),
                    "alias_norm":  cs_norm,
                    "producto_id": str(producto_id),
                    "sku":         (row.get("sku") or None),
                    "marca_id":    str(row["marca_id"]) if row.get("marca_id") else None,
                    "cliente_sku": (row.get("cliente_sku") or None),
                })
    index.sort(key=lambda e: len(e["alias_norm"]), reverse=True)
    return index


def match_part_number(part_number: Any, alias_index: list[dict],
                      explicit_size: Any = None) -> Optional[dict]:
    """Matchea UN Part Nº de la PO contra el índice de aliases del
    cliente. Match = alias más LARGO cuyo normalizado sea PREFIJO del
    Part Nº normalizado SIN la talla (el índice ya viene ordenado por
    longitud DESC, así que el primer hit gana).

    `explicit_size`: si la PO ya trae la talla en columna aparte, se
    respeta y NO se re-extrae del Part Nº.

    Devuelve None si ningún alias matchea (el caller decide el
    fallback por nombre/SKU — NUNCA inventamos producto).
    """
    norm_full = normalize_code(part_number)
    if not norm_full or not alias_index:
        return None

    if explicit_size not in (None, ""):
        size = str(explicit_size).strip()
        base = norm_full
        size_norm = normalize_code(size)
        if size_norm and base.endswith(size_norm) and len(base) > len(size_norm):
            base = base[: -len(size_norm)]
    else:
        base, size = extract_size(part_number)

    for entry in alias_index:
        an = entry["alias_norm"]
        # prefijo de la base sin talla (caso típico) o del part completo
        # (alias == part exacto, sin talla en la PO).
        if base.startswith(an) or norm_full.startswith(an):
            return {
                "producto_id": entry["producto_id"],
                "sku":         entry.get("sku"),
                "marca_id":    entry.get("marca_id"),
                "alias":       entry["alias"],
                "cliente_sku": entry.get("cliente_sku"),
                "size":        size,
                "matched_via": "client_alias",
            }
    return None


# ═════════════════════════════════════════════════════════════════════
# 3) Bandas + plazos (R3)
# ═════════════════════════════════════════════════════════════════════
def pick_band(rate: Any,
              bands: Optional[list[tuple[int, float, float]]] = None) -> Optional[int]:
    """Devuelve el id de banda Marluvas cuyo rango BRL contiene `rate`.

    Piso INCLUSIVO, techo EXCLUSIVO (espejo exacto de
    `apps.commercial.services.banda_for_tc`):
        pick_band(5.1604) → 6   (banda "5,00 – 5,20")
        pick_band(5.00)   → 6
        pick_band(4.9999) → 5
        pick_band(6.40)   → None (fuera de rango)

    `bands`: lista opcional [(id, piso, techo), ...] para matrices con
    rangos custom; default = DEFAULT_BANDS (12 bandas 4.00→6.40).
    Acepta rate como float, Decimal o string ("5,1604" con coma BR).
    """
    if rate is None:
        return None
    try:
        n = float(str(rate).replace(",", ".")) if isinstance(rate, str) else float(rate)
    except (TypeError, ValueError):
        return None
    for band_id, lo, hi in (bands or DEFAULT_BANDS):
        if lo <= n < hi:
            return band_id
    return None


def pick_plazo_price(matrix_result: Optional[dict], days: Any) -> Optional[Decimal]:
    """Precio del plazo `days` dentro del resultado de
    `apps.commercial.services.get_client_price_matrix`.

    Extraída del inline `_pick_plazo_price` de create_from_oc (Sprint
    2026-05-24) para hacerla testeable. Mismo contrato: None si la
    matriz no está ok, el plazo exacto no existe o el precio no es > 0.
    """
    if not matrix_result or not matrix_result.get("ok"):
        return None
    try:
        days_int = int(days)
    except (TypeError, ValueError):
        return None
    for p in (matrix_result.get("plazos") or []):
        try:
            if int(p.get("dias") or 0) == days_int:
                v = Decimal(str(p.get("price") or 0))
                return v if v > 0 else None
        except (TypeError, ValueError, InvalidOperation):
            return None
    return None


# ═════════════════════════════════════════════════════════════════════
# 4) Código de documento "PO N" (R4)
# ═════════════════════════════════════════════════════════════════════
def format_po_codigo(po_number: Any) -> Optional[str]:
    """`504983` → "PO 504983" · `PO-504983` → "PO 504983" (idempotente).

    El número viene del parse de la OC (`ocr_payload.po.number`, que el
    extractor llena de "Purchase Order 504983" y similares).
    """
    if po_number is None:
        return None
    s = str(po_number).strip()
    if not s:
        return None
    s = _PO_PREFIX_RE.sub("", s).strip(" -#:·") or s
    return f"PO {s}"
