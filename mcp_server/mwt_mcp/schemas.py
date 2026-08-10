"""Ola 2 · 2.16 — Schemas Pydantic para los dicts opacos del MCP.

Históricamente el MCP aceptaba `datos: dict`, `lines: list`, etc., sin validar la
estructura. Esto hacía visibles errores 400/422 del backend con mensajes genéricos.

Este módulo define modelos Pydantic LIGEROS para los inputs estructurados más
recurrentes. NO sustituyen la validación del backend (Django), pero:
  - detectan pronto errores obvios del agente (falta campo, tipo mal, listas vacías),
  - normalizan el error en un mensaje legible,
  - documentan el contrato esperado.

Uso en server.py:
    from .schemas import validate_lines, CostoSchema, validate_cost_lines
    err = validate_lines(lines); if err: return {"error": True, "detail": err}
    err = validate_cost_lines(cost_lines); if err: return {...}

Pydantic viene como dependencia transitiva de `mcp`. El import es perezoso y
opcional: si pydantic faltara, se degrada a "no validación" (None) para no romper.
"""
from __future__ import annotations

from typing import Any, Optional


# -- Import defensivo: pydantic puede no estar en entornos minimalistas. ------- #
try:  # pragma: no cover
    from pydantic import BaseModel, ValidationError, field_validator
    _HAVE_PYDANTIC = True
except Exception:  # noqa: BLE001 - degrade gracefully
    _HAVE_PYDANTIC = False
    BaseModel = object  # type: ignore
    ValidationError = Exception  # type: ignore

    def field_validator(*args, **kwargs):  # type: ignore
        return lambda f: f


KINDS_VALIDOS = {
    "DAI", "IVA", "ALMACENAJE", "AGENCIAMIENTO", "MANIPULEO", "FLETE", "SEGURO",
    "CONSOLIDACION", "PROCOMER", "LEY_6946", "TIMBRE_ARCHIVO", "TIMBRE_AGENTES",
    "TIMBRE_CONTADORES", "OTRO",
}
PRICE_VIEWS = {"MWT", "CLIENT"}
METHODS_LIQUIDACION = {"BY_VALUE", "BY_QUANTITY", "BY_VOLUME"}


# --------------------------------------------------------------------------- #
# Líneas de OC/expediente que manda el agente (ocr_payload.lines / lines)
# --------------------------------------------------------------------------- #
class LineaExpediente(BaseModel):
    """Una línea SKU×talla. Al menos uno de `sku`|`client_part_number`|`producto_id`
    debe estar presente; `qty` > 0; `size` no debe ser 'UNICA' ni vacío."""

    sku: Optional[str] = None
    client_part_number: Optional[str] = None
    producto_id: Optional[str] = None
    size: Optional[str] = None
    qty: Optional[int] = None
    unit_price: Optional[float] = None
    sku_text: Optional[str] = None

    @field_validator("qty")
    @classmethod
    def _qty_pos(cls, v):
        if v is not None and v <= 0:
            raise ValueError("qty debe ser > 0")
        return v


def validate_lines(lines: Any) -> Optional[str]:
    """Valida una lista de líneas de expediente. Devuelve None si OK,
    o un mensaje de error legible si la estructura es inválida."""
    if not _HAVE_PYDANTIC:
        return None
    if not isinstance(lines, list) or len(lines) == 0:
        return "lines debe ser un array no vacío. Parsea la matriz de tallas de la proforma/OC y envía una línea por SKU×talla REAL (size='39', NUNCA 'UNICA' ni 'PENDING')."
    dummy = {"", "PENDING", "PENDIENTE", "TBD", "NONE", "SIN-SKU"}
    for i, ln in enumerate(lines):
        if not isinstance(ln, dict):
            return f"lines[{i}] no es un objeto: {ln!r}"
        try:
            parsed = LineaExpediente(**ln)
        except ValidationError as e:
            return f"lines[{i}] es inválida: {_first_err(e)}"
        sku = str(parsed.sku or parsed.sku_text or parsed.client_part_number or "").strip().upper()
        if sku in dummy or not sku:
            return f"lines[{i}] no tiene un SKU real (viene {sku!r}). NUNCA uses 'PENDING' ni 'SIN-SKU'."
        if not parsed.size or str(parsed.size).strip().upper() in ("", "UNICA", "UNIT"):
            return f"lines[{i}] (sku={sku}) sin talla real: size no debe ser 'UNICA' ni vacío; pon el número de talla (ej. '39')."
        if parsed.qty is None or parsed.qty <= 0:
            return f"lines[{i}] (sku={sku}) qty debe ser > 0."
    return None


# --------------------------------------------------------------------------- #
# Líneas de costo (cost_lines de recepción/transferencia y scope_json)
# --------------------------------------------------------------------------- #
class ScopeLine(BaseModel):
    expediente_id: str
    producto_id: Optional[str] = None
    talla: Optional[str] = None


class CostoScope(BaseModel):
    applies_to_all: bool = True
    expediente_ids: Optional[list[str]] = None
    lines: Optional[list[ScopeLine]] = None


class CostoLinea(BaseModel):
    kind: str
    amount: float
    label: Optional[str] = None
    currency: str = "USD"
    fx_to_usd: float = 1.0
    price_view: str = "MWT"
    scope: Optional[Any] = None
    source: str = "MANUAL"

    @field_validator("kind")
    @classmethod
    def _kind(cls, v):
        if str(v).upper() not in KINDS_VALIDOS:
            raise ValueError(f"kind inválido '{v}'. Válidos: {sorted(KINDS_VALIDOS)}")
        return str(v).upper()

    @field_validator("amount")
    @classmethod
    def _amount(cls, v):
        if v is None or float(v) <= 0:
            raise ValueError("amount debe ser > 0")
        return v

    @field_validator("price_view")
    @classmethod
    def _pv(cls, v):
        if str(v).upper() not in PRICE_VIEWS:
            raise ValueError(f"price_view inválido '{v}'. Usa MWT|CLIENT.")
        return str(v).upper()

    @field_validator("scope")
    @classmethod
    def _scope(cls, v):
        if v is None:
            return v
        try:
            CostoScope(**v)
        except Exception as e:  # noqa: BLE001
            raise ValueError(f"scope inválido: {e}")
        return v


def validate_cost_lines(cost_lines: Any) -> Optional[str]:
    if not _HAVE_PYDANTIC:
        return None
    if cost_lines is None:
        return None
    if not isinstance(cost_lines, list):
        return "cost_lines debe ser un array."
    for i, c in enumerate(cost_lines):
        if not isinstance(c, dict):
            return f"cost_lines[{i}] no es un objeto."
        try:
            CostoLinea(**c)
        except ValidationError as e:
            return f"cost_lines[{i}] inválido: {_first_err(e)}"
        except Exception as e:  # noqa: BLE001
            return f"cost_lines[{i}] inválido: {e}"
    return None


# --------------------------------------------------------------------------- #
# Aplicaciones de pago (pago_registrar.aplicaciones)
# --------------------------------------------------------------------------- #
class AplicacionPago(BaseModel):
    applicable_type: str
    applicable_id: str
    applicable_code: Optional[str] = None
    cantidad_producto: Optional[int] = None
    monto_aplicado: float

    @field_validator("applicable_type")
    @classmethod
    def _at(cls, v):
        if str(v).upper() not in {"COSTO", "PRODUCTO", "PROFORMA", "FACTURA"}:
            raise ValueError("applicable_type debe ser COSTO|PRODUCTO|PROFORMA|FACTURA")
        return str(v).upper()

    @field_validator("monto_aplicado")
    @classmethod
    def _ma(cls, v):
        if v is None or float(v) < 0:
            raise ValueError("monto_aplicado no puede ser negativo")
        return v


def validate_aplicaciones(aplicaciones: Any) -> Optional[str]:
    if not _HAVE_PYDANTIC:
        return None
    if not isinstance(aplicaciones, list) or not aplicaciones:
        return "aplicaciones debe ser un array no vacío de {applicable_type, applicable_id, monto_aplicado}."
    for i, a in enumerate(aplicaciones):
        if not isinstance(a, dict):
            return f"aplicaciones[{i}] no es un objeto."
        try:
            AplicacionPago(**a)
        except ValidationError as e:
            return f"aplicaciones[{i}] inválido: {_first_err(e)}"
    return None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _first_err(e: Any) -> str:
    """Extrae el primer mensaje legible de un Pydantic ValidationError."""
    try:
        errs = e.errors()
        if errs:
            loc = ".".join(str(x) for x in errs[0].get("loc", []))
            msg = errs[0].get("msg", "")
            return f"{loc}: {msg}" if loc else msg
        return str(e)
    except Exception:  # noqa: BLE001
        return str(e)


# --------------------------------------------------------------------------- #
# Ola 3.7 · C2 — validación ligera de dicts opacos (datos/cambios)
#
# Los `datos` de creación y los `cambios` de PATCH son dicts que el agente
# arma al vuelo. Estos validadores NO sustituyen al backend (que es la
# autoridad), pero detectan pronto errores obvios (dict vacío, campo clave
# con tipo incorrecto) y documentan el contrato esperado en el error.
# --------------------------------------------------------------------------- #

# Catálogo de campos permitidos por entidad (whitelist): evita typos que el
# backend rechazaría con 400 genérico. Un valor None = "cualquier tipo".
_CLIENTE_KEYS = {
    "razon_social", "nombre_comercial", "tax_id", "codigo_marluvas",
    "cedula_juridica", "tipo", "segmento", "parent_id", "pais_iso2",
    "ciudad", "direccion_entrega", "contacto_nombre", "contacto_email",
    "canal", "incoterm", "medio_pago", "dias_credito", "moneda",
    "credito_limit_usd", "comision_pct", "estado", "nodo_asignado_id",
    "responsable_id",
}
_PRODUCTO_KEYS = {
    "sku", "nombre", "marca_id", "categoria", "unidad", "costo_estandar",
    "precio_lista", "precio_mwt", "hs_code", "pais_origen_iso2", "estado",
    "colores", "tallas", "especificaciones", "descripcion",
}
_NODO_KEYS = {
    "tipo", "nombre", "codigo", "pais_iso2", "ciudad", "direccion",
    "status", "operador_id", "propietario_id", "capacidad", "metadata",
    "parent_id",
}
_OC_KEYS = {
    "brand_id", "proforma", "sap", "display_label", "proveedor_id",
    "estado", "moneda", "client_id", "codigo",
}
_EXPEDIENTE_KEYS = {
    "brand_id", "modo_operacion", "freight_mode", "dispatch_mode",
    "incoterm", "forma_pago", "operating_company_id", "credit_days",
    "credit_days_mwt", "credit_days_cliente", "moneda", "po_number",
    "estado", "origin", "destination",
}
_SAP_KEYS = {"sap", "fecha", "fecha_fabricacion", "fecha_embarque", "eta",
             "observaciones", "estado", "valores"}
_DOCUMENTO_KEYS = {"codigo", "kind", "titulo", "notas", "fecha", "storage_url"}
_TRANSFERENCIA_KEYS = {"origen", "destino", "tipo", "fecha_programada", "notas",
                       "responsable_id", "nodo_origen_id", "nodo_destino_id",
                       "estado", "legacy"}
_NODO_ARTEFACTO_KEYS = {"tipo", "nombre", "codigo", "titulo", "estado",
                        "data", "payload", "publicado", "metadata"}


def _validate_dict(
    value: Any,
    *,
    label: str,
    allowed_keys: set[str] | None = None,
    required: set[str] | None = None,
    allow_empty: bool = False,
) -> Optional[str]:
    """Valida un dict opaco de creación/edición. Devuelve None si OK."""
    if not _HAVE_PYDANTIC:
        return None
    if not isinstance(value, dict):
        return f"{label} debe ser un objeto (dict)."
    if not value and not allow_empty:
        return f"{label} no puede estar vacío. Envía al menos un campo."
    if allowed_keys:
        desconocidas = set(value) - allowed_keys
        if desconocidas:
            top = ", ".join(sorted(desconocidas)[:5])
            return (
                f"{label} tiene campo(s) no reconocido(s): {top}. "
                f"Permitidos: {', '.join(sorted(allowed_keys)[:12])}…"
            )
    if required:
        faltan = [k for k in required if k not in value or value.get(k) in (None, "")]
        if faltan:
            return f"{label} requiere: {', '.join(faltan)}."
    return None


def validate_cliente_datos(datos: Any) -> Optional[str]:
    """Validación ligera de `datos` de cliente_crear (C2)."""
    return _validate_dict(datos, label="datos de cliente", allowed_keys=_CLIENTE_KEYS,
                          required={"razon_social"})


def validate_cliente_cambios(cambios: Any) -> Optional[str]:
    """Validación ligera de `cambios` de cliente_editar (C2)."""
    return _validate_dict(cambios, label="cambios de cliente", allowed_keys=_CLIENTE_KEYS,
                          allow_empty=False)


def validate_producto_datos(datos: Any) -> Optional[str]:
    """Validación ligera de `datos` de producto_crear (C2)."""
    return _validate_dict(datos, label="datos de producto", allowed_keys=_PRODUCTO_KEYS,
                          required={"sku", "nombre"})


def validate_producto_cambios(cambios: Any) -> Optional[str]:
    """Validación ligera de `cambios` de producto_editar (C2)."""
    return _validate_dict(cambios, label="cambios de producto", allowed_keys=_PRODUCTO_KEYS)


def validate_nodo_datos(datos: Any) -> Optional[str]:
    """Validación ligera de `datos` de nodo_crear (C2)."""
    return _validate_dict(datos, label="datos de nodo", allowed_keys=_NODO_KEYS,
                          required={"tipo", "nombre"})


def validate_nodo_cambios(cambios: Any) -> Optional[str]:
    """Validación ligera de `cambios` de nodo_editar (C2)."""
    return _validate_dict(cambios, label="cambios de nodo", allowed_keys=_NODO_KEYS)


def validate_cambios(cambios: Any, label: str = "cambios", allowed_keys: set[str] | None = None) -> Optional[str]:
    """Validador genérico para PATCH (oc_editar/expediente_editar/sap_editar/
    documento_editar/transferencia_editar/nodo_editar/artefacto_editar)."""
    return _validate_dict(cambios, label=label, allowed_keys=allowed_keys,
                          allow_empty=False)


def pydantic_available() -> bool:
    return bool(_HAVE_PYDANTIC)
