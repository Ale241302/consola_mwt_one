"""Códigos de OC y de expediente — POL_CODIGO_OC v1.4.

Un solo lugar para armar el número de la OC y el código interno cuando el
wizard del portal (`POST /api/expedientes/create-from-oc/`) crea el
expediente sin que el cliente haya subido una OC numerada.

Reglas (decisión del CEO, 07/11/2026; ver `harness_alejandro/03_REGLAS_DE_CODIGO.md`):

  · Si el cliente emitió OC con número, manda ese número.
  · Si el cliente tiene serie configurada (`clientes.cliente.oc_correlativo`),
    se consume el siguiente de esa serie (la que administra Álvaro).
  · Si no, se arma `{PRV}-{CLIENTE}-{LUGAR}-{NN}-{AA}` con NN de uno a seis
    dígitos por cliente, país y año, sin reutilizar los ya usados. LUGAR es el
    país ISO-2 del cliente en marítimo y el aeropuerto IATA de destino en
    aéreo (G26, 13/11/2026): `MAR-SONDEL-CR-505516-26` vs
    `MAR-SONDEL-SJO-505516-26`. El consecutivo es el mismo para ambos modos.
  · El código interno del expediente es `EXP-` + lo anterior; si hay proforma
    conocida, `EXP-{PRV}-{CLIENTE}-{DES}-{proforma}`.
  · Límite duro: `expedientes.expediente.codigo` y `expedientes.oc.codigo`
    son VARCHAR(32). El código del expediente se recorta por tramos para no
    dejar que la base devuelva un 500.

Las funciones puras (`formatear_oc`, `cliente_corto`, `armar_codigo_expediente`)
no tocan la base y se pueden probar sin Postgres.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from datetime import date
from typing import Any, Optional

from django.db import connection

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────
# Constantes de la política
# ─────────────────────────────────────────────────────────────────────
PRV_POR_MARCA = {"marluvas": "MAR", "tecmater": "TEC", "bangni": "BAN"}
PRV_POR_DEFECTO = "MAR"

# Nombre corto por cliente (POL_CODIGO_OC). Se busca por prefijo de la
# razón social o del nombre comercial, normalizados.
CLIENTE_CORTO = (
    ("COMERCIALIZADORA UMMIE", "UMMIE"),
    ("DISTRIBUIDORA COMTEK", "COMTEK"),
    ("EQUIPOS Y GUANTES INDUSTRIALES", "EGUISA"),
    ("GRUPO SOLUCIONES DE INGENIERIA", "SIASA"),
    ("IMPORCOMP", "IMPORCOMP"),
    ("IMPORTACIONES Y COMPRAS", "IMPORTACIONES"),
    ("MUITO WORK", "MUITO"),
    ("PRO CUSTOMER", "PROCUSTOMER"),
    ("MELEXA", "SONEPAR"),          # MELEXA es SONEPAR Colombia
    ("SONDEL", "SONDEL"),
    ("SONEPAR", "SONEPAR"),
    ("MAGNESITA", "MAGNESITA"),
    ("FORAGRO", "FORAGRO"),
)

# Palabras que no sirven como nombre corto en el fallback.
_NO_SIRVEN = {
    "COMERCIALIZADORA", "DISTRIBUIDORA", "IMPORTADORA", "EQUIPOS", "GRUPO",
    "SOCIEDAD", "COMPANIA", "COMPANIA.", "INDUSTRIAS", "INDUSTRIAL",
    "CORP", "CORP.", "LTDA", "LTDA.", "S.A.", "S.A", "SA", "S.A.S.",
    "S.A.S", "SAS", "S DE RL", "DE", "DEL", "LA", "LAS", "LOS", "Y", "E",
    "THE", "INC", "INC.", "LLC",
}

PATRON_OC = re.compile(
    r"^(?P<prv>[A-Z]{3})-(?P<cliente>[A-Z0-9]+)-(?P<pais>[A-Z]{2,3})-"
    r"(?P<nn>\d{1,6})-(?P<aa>\d{2})$"
)

# Un `po_number` que ya viene armado como código interno
# (`MAR-IMPORCOMP-GUA-2296-2025`, el que usa el MCP) o como proforma
# (`2514-2026`) no se vuelve a prefijar: sería `EXP-MAR-CLIENTE-PAIS-MAR-…`.
PATRON_CODIGO_ARMADO = re.compile(r"^(MAR|TEC|BAN)-[A-Z0-9]+-[A-Z0-9]{2,4}-[A-Z0-9\-]+$")
PATRON_PROFORMA = re.compile(r"^\d{3,4}-\d{4}$")

# Consecutivo de OC por marca: `MAR-UMMIE-GT-04-25` (marítimo) o
# `MAR-SONDEL-SJO-505516-26` (aéreo: IATA en lugar del país). El NN admite de
# 1 a 6 dígitos (Sondel usa 505515; Ummie, 04).
PATRON_CODIGO_MARCA = re.compile(
    r"^(?P<prv>[A-Z]{3})-(?P<cliente>[A-Z0-9]+)-(?P<pais>[A-Z]{2,3})-"
    r"(?P<nn>\d{1,6})-(?P<aa>\d{2})$"
)

# Modos que cuentan como aéreo (vienen como `freight_mode` SEA/AIR o como
# `transport_mode` MARITIMO/AEREO/TERRESTRE, según el módulo).
_MODOS_AEREOS = frozenset({"AIR", "AEREO", "AVION", "PLANE"})


def ya_es_codigo(po: Any) -> bool:
    """True si el número ya es el código interno o la proforma."""
    s = str(po or "").strip().upper()
    return bool(PATRON_CODIGO_ARMADO.match(s) or PATRON_PROFORMA.match(s))

LARGO_MAX_CODIGO = 32
PREFIJO_EXP = "EXP-"

# Último recurso cuando el cliente no tiene país: queda visible en el código
# y se corrige al completar la ficha (no se inventa un ISO real).
PAIS_POR_DEFECTO = "XX"


# ─────────────────────────────────────────────────────────────────────
# Funciones puras
# ─────────────────────────────────────────────────────────────────────
def _sin_acentos(texto: Any) -> str:
    s = str(texto or "")
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def _normalizar(texto: Any) -> str:
    """Mayúsculas, sin acentos, sin puntuación. `COMERCIALIZADORA UMMIE, S.A.`
    → `COMERCIALIZADORA UMMIE SA`."""
    s = _sin_acentos(texto).upper()
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def prv_de_marca(slug: Any = None, nombre: Any = None, brand_code: Any = None) -> str:
    """`marluvas` → `MAR`; `tecmater` → `TEC`; `bangni` → `BAN`."""
    for valor in (slug, nombre):
        key = _normalizar(valor).lower().replace(" ", "")
        if key in PRV_POR_MARCA:
            return PRV_POR_MARCA[key]
    code = _normalizar(brand_code)
    if code:
        return code[:3]
    return PRV_POR_DEFECTO


def cliente_corto(cliente: Any = None, razon_social: Any = None,
                  nombre_comercial: Any = None) -> str:
    """Nombre corto del cliente en mayúsculas.

    Acepta un dict o un objeto con `razon_social` / `nombre_comercial`.
    Primero busca la tabla de la política; si no está, toma la primera
    palabra significativa de la razón social.
    """
    if cliente is not None:
        razon_social = razon_social or _attr(cliente, "razon_social")
        nombre_comercial = nombre_comercial or _attr(cliente, "nombre_comercial")
    for fuente in (nombre_comercial, razon_social):
        norm = _normalizar(fuente)
        if not norm:
            continue
        for prefijo, corto in CLIENTE_CORTO:
            if norm.startswith(prefijo):
                return corto
    norm = _normalizar(razon_social) or _normalizar(nombre_comercial)
    for palabra in norm.split(" "):
        if palabra and palabra not in _NO_SIRVEN and len(palabra) >= 3:
            return palabra[:12]
    return "CLIENTE"


def pais_de(cliente: Any = None, pais_iso2: Any = None) -> str:
    if cliente is not None and not pais_iso2:
        pais_iso2 = _attr(cliente, "pais_iso2")
    return (_normalizar(pais_iso2) or PAIS_POR_DEFECTO)[:2]


def _lugar_norm(valor: Any) -> str:
    """Segmento de lugar del código: país ISO-2 o aeropuerto IATA (2-3 letras)."""
    s = (_normalizar(valor) or "").replace(" ", "")
    return (s or PAIS_POR_DEFECTO)[:3]


def es_aereo(freight_mode: Any = None, transport_mode: Any = None) -> bool:
    """True si el envío es aéreo, venga como `freight_mode` (AIR) o como
    `transport_mode` (AEREO / "aéreo"). Cualquier otro valor cae a marítimo."""
    for valor in (freight_mode, transport_mode):
        s = (_normalizar(valor) or "").replace(" ", "")
        if not s:
            continue
        if s in _MODOS_AEREOS or s.startswith("AER") or s.startswith("AIR"):
            return True
        if s in {"SEA", "MARITIMO", "MAR", "OCEAN", "TERRESTRE", "LAND"}:
            return False
    return False


def lugar_de(cliente: Any = None, freight_mode: Any = None,
             transport_mode: Any = None, iata: Any = None) -> str:
    """Segmento de LUGAR del código de OC según el tipo de transporte.

      · marítimo (o desconocido) → país ISO-2 del cliente (`CR`)
      · aéreo                    → aeropuerto IATA de destino (`SJO`)

    El aeropuerto sale de `iata` (payload) o de `clientes.cliente.airport_iata`
    (ficha del cliente). Si no hay aeropuerto configurado NO se inventa uno:
    cae al país.
    """
    pais = pais_de(cliente)
    if not es_aereo(freight_mode, transport_mode):
        return pais
    for valor in (iata, _attr(cliente, "airport_iata")):
        code = (_normalizar(valor) or "").replace(" ", "")
        if 3 == len(code) and code.isalnum():
            return code
    return pais


def _dos_digitos_anio(anio: Any) -> str:
    """2026 · `2026` · date(2026-11-09) → `26`."""
    if anio is None:
        anio = date.today()
    if isinstance(anio, date):
        anio = anio.year
    try:
        return f"{int(anio):04d}"[-2:]
    except (TypeError, ValueError):
        return f"{date.today().year:04d}"[-2:]


def formatear_oc(prv: str, cliente: str, pais: str, nn: int, anio: Any) -> str:
    """`MAR`, `UMMIE`, `GT`, 4, 2026 → `MAR-UMMIE-GT-04-26`.

    `pais` es el lugar: país ISO-2 (marítimo) o IATA de 3 letras (aéreo).
    """
    return (
        f"{_normalizar(prv).replace(' ', '')[:3]}-"
        f"{_normalizar(cliente).replace(' ', '')[:14]}-"
        f"{_lugar_norm(pais)}-"
        f"{int(nn):02d}-{_dos_digitos_anio(anio)}"
    )


def parsear_oc(codigo: Any) -> Optional[dict]:
    """Separa un código de OC del formato de la política; None si no aplica."""
    s = str(codigo or "").strip().upper()
    s = re.sub(r"^PO[\s\-_]*", "", s)
    s = s.strip(" -_").replace(" ", "")
    match = PATRON_OC.match(s)
    if not match:
        return None
    partes = match.groupdict()
    return {
        "prv": partes["prv"],
        "cliente": partes["cliente"],
        "pais": partes["pais"],
        "nn": int(partes["nn"]),
        "anio": 2000 + int(partes["aa"]),
        "codigo": s,
    }


def parsear_codigo_marca(codigo: Any) -> Optional[dict]:
    """Separa `MAR-UMMIE-GT-04-25` en sus partes.

    El consecutivo admite de 1 a 6 dígitos: Sondel usa 505515 y Ummie 04.
    Acepta el prefijo `PO ` de presentación.
    """
    s = str(codigo or "").strip().upper()
    s = re.sub(r"^PO[\s\-_]*", "", s)
    s = re.sub(r"\s+", "", s)
    match = PATRON_CODIGO_MARCA.match(s)
    if not match:
        return None
    partes = match.groupdict()
    return {
        "prv": partes["prv"],
        "cliente": partes["cliente"],
        "pais": partes["pais"],
        "nn": int(partes["nn"]),
        "anio": 2000 + int(partes["aa"]),
        "codigo": s,
    }


def siguiente_nn(codigos: list, prv: str, pais: str, anio: Any) -> int:
    """Siguiente consecutivo NN mirando los códigos ya usados.

    Incluye cancelados (no se reutiliza el número) y no depende del orden.
    """
    aa = _dos_digitos_anio(anio)
    pais = pais_de(pais_iso2=pais)
    maximo = 0
    for codigo in codigos:
        partes = parsear_oc(codigo)
        if not partes:
            continue
        if partes["prv"] != _normalizar(prv)[:3]:
            continue
        if partes["pais"] != pais or str(partes["anio"])[-2:] != aa:
            continue
        maximo = max(maximo, partes["nn"])
    return maximo + 1


def _recortar(base: str, po_number: str) -> str:
    """Arma `EXP-…` sin pasar de 32 caracteres.

    Por tramos: código completo → sin PRV → solo el número de OC.
    Nunca deja que la base reciba un valor más largo y devuelva HTTP 500.
    """
    candidatos = [f"{PREFIJO_EXP}{base}"]

    # Sin el PRV: EXP-CLIENTE-…
    tramos = str(base).split("-", 1)
    if len(tramos) == 2 and len(tramos[0]) == 3:
        candidatos.append(f"{PREFIJO_EXP}{tramos[1]}")

    candidatos.append(f"{PREFIJO_EXP}{po_number}")

    for codigo in candidatos:
        if len(codigo) <= LARGO_MAX_CODIGO:
            return codigo

    recortado = f"{PREFIJO_EXP}{po_number}"[:LARGO_MAX_CODIGO]
    log.warning(
        "[codigo_expediente] código recortado a %s caracteres: %s",
        LARGO_MAX_CODIGO, recortado,
    )
    return recortado


def armar_codigo_expediente(
    *,
    prv: str,
    cliente: str,
    pais: str,
    po_number: str,
    origen: str = "cliente",
    proforma: Optional[str] = None,
    destino: Optional[str] = None,
) -> str:
    """Código interno `EXP-…` para el expediente recién creado.

    `origen` es cómo salió el número de OC:
      · `cliente`      → lo emitió el cliente
      · `correlativo`  → serie configurada del cliente (oc_correlativo)
      · `consecutivo`  → código `{PRV}-{CLIENTE}-{PAÍS}-{NN}-{AA}` de la política
      · `auto`         → último recurso OC-AUTO (no debería ocurrir)
    """
    po = str(po_number or "").strip()
    # El número de la OC puede venir del OCR con su prefijo ("PO 505515").
    # En el código del expediente va limpio; el prefijo "PO" lo pone la
    # presentación de la OC.
    po = re.sub(r"^(PO|POC)[\s\-_]*", "", po, flags=re.IGNORECASE).strip()
    po = re.sub(r"\s+", "", po)
    if proforma and _normalizar(proforma):
        des = _normalizar(destino) if destino else pais_de(pais_iso2=pais)
        base = f"{prv}-{cliente}-{des[:3]}-{_normalizar(proforma).replace(' ', '-')}"
    elif origen == "consecutivo" and parsear_oc(po):
        base = po
    elif origen == "auto":
        base = po
    elif ya_es_codigo(po):
        # El MCP ya manda el código armado o la proforma: no se prefija.
        base = po
    else:
        # Cliente o serie: el OC ya es la referencia; se le antepone el
        # contexto del cliente para que el código siga siendo legible.
        base = f"{prv}-{cliente}-{pais_de(pais_iso2=pais)}-{po}"
    return _recortar(base, po)


# ─────────────────────────────────────────────────────────────────────
# Lectura de la base
# ─────────────────────────────────────────────────────────────────────
def _attr(obj: Any, nombre: str):
    if isinstance(obj, dict):
        return obj.get(nombre)
    return getattr(obj, nombre, None)


def _cliente_row(client_id) -> dict:
    if not client_id:
        return {}
    iata = None
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT razon_social, nombre_comercial, pais_iso2, oc_correlativo,
                       airport_iata
                  FROM clientes.cliente
                 WHERE id = %s::uuid
                """,
                [str(client_id)],
            )
            row = c.fetchone()
    except Exception:  # noqa: BLE001
        # Antes del SQL G26 la columna no existe: se sigue con el resto.
        try:
            with connection.cursor() as c:
                c.execute(
                    """
                    SELECT razon_social, nombre_comercial, pais_iso2, oc_correlativo
                      FROM clientes.cliente
                     WHERE id = %s::uuid
                    """,
                    [str(client_id)],
                )
                row = c.fetchone()
        except Exception as exc:  # noqa: BLE001
            log.warning("[codigo_expediente] cliente %s ilegible: %s", client_id, exc)
            return {}
    else:
        iata = row[4] if len(row) > 4 else None
    if not row:
        return {}
    return {
        "razon_social": row[0],
        "nombre_comercial": row[1],
        "pais_iso2": row[2],
        "oc_correlativo": row[3],
        "airport_iata": iata,
    }


def _marca_row(brand_id) -> dict:
    if not brand_id:
        return {}
    try:
        with connection.cursor() as c:
            c.execute(
                "SELECT slug, nombre, brand_code FROM brands.marca WHERE id = %s::uuid",
                [str(brand_id)],
            )
            row = c.fetchone()
    except Exception as exc:  # noqa: BLE001
        log.warning("[codigo_expediente] marca %s ilegible: %s", brand_id, exc)
        return {}
    if not row:
        return {}
    return {"slug": row[0], "nombre": row[1], "brand_code": row[2]}


def _codigos_oc(client_id) -> list:
    if not client_id:
        return []
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT codigo
                  FROM expedientes.oc
                 WHERE client_id = %s::uuid
                   AND is_active = TRUE
                """,
                [str(client_id)],
            )
            return [r[0] for r in c.fetchall() if r[0]]
    except Exception as exc:  # noqa: BLE001
        log.warning("[codigo_expediente] OCs del cliente %s ilegibles: %s", client_id, exc)
        return []


def siguiente_oc_sin_numero(client_id, brand_id=None, anio: Any = None) -> Optional[str]:
    """Código `{PRV}-{CLIENTE}-{PAÍS}-{NN}-{AA}` para una OC sin número.

    Devuelve None si no hay cliente o si el consecutivo se agotó (NN > 99).
    """
    cliente = _cliente_row(client_id)
    if not cliente:
        return None
    marca = _marca_row(brand_id)
    prv = prv_de_marca(marca.get("slug"), marca.get("nombre"), marca.get("brand_code"))
    cli = cliente_corto(cliente)
    pais = pais_de(cliente)
    nn = siguiente_nn(_codigos_oc(client_id), prv, pais, anio or date.today().year)
    if nn > 999999:
        log.warning(
            "[codigo_expediente] consecutivo agotado para %s-%s-%s",
            cli, pais, _dos_digitos_anio(anio or date.today().year),
        )
        return None
    return formatear_oc(prv, cli, pais, nn, anio or date.today().year)


def codigo_expediente_para(
    client_id,
    brand_id=None,
    *,
    po_number: Optional[str] = None,
    origen: str = "cliente",
    proforma: Optional[str] = None,
    destino: Optional[str] = None,
) -> str:
    """Atajo con la base resuelta: arma el `EXP-…` del expediente nuevo."""
    cliente = _cliente_row(client_id)
    marca = _marca_row(brand_id)
    prv = prv_de_marca(marca.get("slug"), marca.get("nombre"), marca.get("brand_code"))
    return armar_codigo_expediente(
        prv=prv,
        cliente=cliente_corto(cliente),
        pais=pais_de(cliente),
        po_number=str(po_number or ""),
        origen=origen,
        proforma=proforma,
        destino=destino,
    )


# ─────────────────────────────────────────────────────────────────────
# Correlativo de OC por cliente y marca
# (`clientes.cliente_marca_correlativo`, G25)
# ─────────────────────────────────────────────────────────────────────
def _marca_default_id() -> Optional[str]:
    """Marca por defecto cuando el alta no trae brand_id (Marluvas)."""
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT id
                  FROM brands.marca
                 WHERE is_active
                 ORDER BY (slug = 'marluvas') DESC, nombre
                 LIMIT 1
                """
            )
            row = c.fetchone()
        return str(row[0]) if row else None
    except Exception as exc:  # noqa: BLE001
        log.warning("[codigo_expediente] marca por defecto ilegible: %s", exc)
        return None


def marcas_activas() -> list:
    """Marcas vigentes, con lo necesario para armar su código."""
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT id, nombre, slug, brand_code
                  FROM brands.marca
                 WHERE is_active
                 ORDER BY (slug = 'marluvas') DESC, nombre
                """
            )
            rows = c.fetchall()
    except Exception as exc:  # noqa: BLE001
        log.warning("[codigo_expediente] marcas ilegibles: %s", exc)
        return []
    return [
        {"id": str(r[0]), "nombre": r[1], "slug": r[2], "brand_code": r[3]}
        for r in rows
    ]


def filas_correlativo_marca(client_id) -> dict:
    """{brand_id: {"nn": int|None, "anio": int|None}} del cliente."""
    if not client_id:
        return {}
    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT brand_id::text, ultimo_nn, ultimo_anio
                  FROM clientes.cliente_marca_correlativo
                 WHERE client_id = %s::uuid
                """,
                [str(client_id)],
            )
            rows = c.fetchall()
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "[codigo_expediente] correlativos por marca ilegibles (cliente %s): %s",
            client_id, exc,
        )
        return {}
    return {
        str(r[0]): {
            "nn": int(r[1]) if r[1] is not None else None,
            "anio": int(r[2]) if r[2] is not None else None,
        }
        for r in rows
    }


def _formatear_para(cliente: dict, marca: dict, nn: Optional[int],
                    anio: Any, lugar: Any = None) -> str:
    """Arma el código con el lugar indicado (país o IATA). Sin `lugar`, usa el
    país del cliente (marítimo)."""
    prv = prv_de_marca(marca.get("slug"), marca.get("nombre"), marca.get("brand_code"))
    return formatear_oc(
        prv, cliente_corto(cliente), lugar or pais_de(cliente),
        int(nn or 1), anio or date.today().year,
    )


def siguiente_codigo_marca(
    client_id,
    brand_id=None,
    anio: Any = None,
    freight_mode: Any = None,
    transport_mode: Any = None,
    destino_iata: Any = None,
) -> Optional[str]:
    """Consume el siguiente consecutivo del cliente para esa marca.

    Devuelve el código completo (`MAR-SONDEL-CR-505516-26` en marítimo,
    `MAR-SONDEL-SJO-505516-26` en aéreo) o None si no se pudo leer/escribir la
    tabla. El consecutivo es el mismo para ambos modos: lo único que cambia es
    el segmento de lugar (país ISO-2 vs aeropuerto IATA). La primera vez parte
    de `clientes.cliente.oc_correlativo` (siembra) o de 1.
    """
    brand_id = brand_id or _marca_default_id()
    if not client_id or not brand_id:
        return None
    anio = int(anio or date.today().year)
    try:
        with connection.cursor() as c:
            c.execute(
                """
                INSERT INTO clientes.cliente_marca_correlativo AS cmc
                       (client_id, brand_id, ultimo_nn, ultimo_anio, updated_at)
                VALUES (
                    %s::uuid, %s::uuid,
                    COALESCE((SELECT oc_correlativo
                                FROM clientes.cliente
                               WHERE id = %s::uuid), 0) + 1,
                    %s, now()
                )
                ON CONFLICT (client_id, brand_id) DO UPDATE
                   SET ultimo_nn = COALESCE(cmc.ultimo_nn, 0) + 1,
                       ultimo_anio = EXCLUDED.ultimo_anio,
                       updated_at = now()
                RETURNING ultimo_nn, ultimo_anio
                """,
                [str(client_id), str(brand_id), str(client_id), anio],
            )
            row = c.fetchone()
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "[codigo_expediente] no se pudo consumir el consecutivo "
            "(cliente %s, marca %s): %s",
            client_id, brand_id, exc,
        )
        return None
    if not row:
        return None
    nn, anio_db = int(row[0]), int(row[1] or anio)
    cliente = _cliente_row(client_id)
    marca = _marca_row(brand_id)
    if not cliente or not marca:
        return None
    lugar = lugar_de(cliente, freight_mode, transport_mode, destino_iata)
    return _formatear_para(cliente, marca, nn, anio_db, lugar)


def previsualizar_codigos_marca(client_id, anio: Any = None) -> list:
    """Código vigente y próximo por marca, sin consumir el consecutivo.

    Devuelve ambas variantes del lugar: `codigo`/`siguiente` (marítimo, país
    ISO-2) y `codigo_aereo`/`siguiente_aereo` (aéreo, aeropuerto IATA del
    cliente). El consecutivo es el mismo.
    """
    marcas = marcas_activas()
    if not marcas:
        return []
    cliente = _cliente_row(client_id)
    if not cliente:
        return []
    filas = filas_correlativo_marca(client_id)
    anio = int(anio or date.today().year)
    salida = []
    for marca in marcas:
        fila = filas.get(marca["id"]) or {}
        nn = fila.get("nn")
        if nn is None and cliente.get("oc_correlativo") is not None:
            # Aún sin fila: la siembra es el número que ya estaba en la ficha.
            nn = int(cliente["oc_correlativo"])
        anio_fila = fila.get("anio") or anio
        lugar_mar = pais_de(cliente)
        lugar_air = lugar_de(cliente, freight_mode="AIR")
        codigo = (_formatear_para(cliente, marca, nn, anio_fila, lugar_mar)
                  if nn else "")
        siguiente = _formatear_para(cliente, marca, (nn or 0) + 1, anio, lugar_mar)
        salida.append({
            "brand_id": marca["id"],
            "brand_nombre": marca["nombre"],
            "prv": prv_de_marca(marca.get("slug"), marca.get("nombre"), marca.get("brand_code")),
            "codigo": codigo,
            "nn": nn,
            "anio": fila.get("anio"),
            "siguiente": siguiente,
            # Variante aérea (mismo NN, lugar = aeropuerto IATA).
            "codigo_aereo": (_formatear_para(cliente, marca, nn, anio_fila, lugar_air)
                             if nn else ""),
            "siguiente_aereo": _formatear_para(cliente, marca, (nn or 0) + 1, anio, lugar_air),
            "lugar_aereo": lugar_air if lugar_air != lugar_mar else None,
            "airport_iata": cliente.get("airport_iata"),
        })
    return salida


def resegmentar_codigo_oc(expediente, freight_mode: Any = None,
                          transport_mode: Any = None) -> bool:
    """Ajusta el segmento de LUGAR del código de OC cuando cambia el transporte.

    Regla G26: marítimo → país ISO-2; aéreo → aeropuerto IATA del cliente.
    El consecutivo (NN) y el año (AA) no se tocan.

    Solo actúa sobre códigos que generó la política (`MAR-CLIENTE-LUGAR-NN-AA`).
    Un PO del cliente (`504960`, `PO 504960`, `IyC 004-2026`) NUNCA se toca.
    Devuelve True si reescribió el código. Fail-safe: ante cualquier error deja
    el código como estaba y devuelve False.
    """
    oc_id = getattr(expediente, "oc_id", None)
    client_id = getattr(expediente, "client_id", None)
    if not oc_id or not client_id:
        return False
    try:
        with connection.cursor() as c:
            c.execute(
                "SELECT codigo FROM expedientes.oc WHERE id = %s::uuid",
                [str(oc_id)],
            )
            row = c.fetchone()
        if not row or not row[0]:
            return False
        actual = str(row[0]).strip()
        partes = parsear_codigo_marca(actual)
        if not partes:
            return False
        cliente = _cliente_row(client_id)
        if not cliente:
            return False
        lugar = lugar_de(cliente, freight_mode, transport_mode)
        if lugar == partes["pais"]:
            return False
        nuevo = formatear_oc(
            partes["prv"], partes["cliente"], lugar,
            partes["nn"], partes["anio"],
        )
        if nuevo == actual:
            return False
        with connection.cursor() as c:
            c.execute(
                "UPDATE expedientes.oc SET codigo = %s, updated_at = now() "
                "WHERE id = %s::uuid",
                [nuevo, str(oc_id)],
            )
            # El código del expediente sigue al de la OC cuando es su espejo
            # exacto (`EXP-<OC>`); si tiene proforma/destino, no se toca.
            viejo_exp = f"{PREFIJO_EXP}{actual}"
            c.execute(
                """
                UPDATE expedientes.expediente
                   SET codigo = %s, updated_at = now()
                 WHERE oc_id = %s::uuid
                   AND codigo = %s
                """,
                [f"{PREFIJO_EXP}{nuevo}"[:LARGO_MAX_CODIGO], str(oc_id), viejo_exp],
            )
        log.info(
            "[codigo_expediente] OC %s re-segmentada: %s → %s",
            oc_id, actual, nuevo,
        )
        return True
    except Exception as exc:  # noqa: BLE001 - nunca romper el PATCH
        log.warning(
            "[codigo_expediente] no se pudo re-segmentar la OC %s: %s",
            oc_id, exc,
        )
        return False


def guardar_codigo_marca(client_id, brand_id, nn, anio) -> bool:
    """Fija el consecutivo de una marca (lo que edita la ficha del cliente)."""
    if not client_id or not brand_id:
        return False
    try:
        nn = int(nn) if nn is not None and str(nn).strip() != "" else None
    except (TypeError, ValueError):
        return False
    if nn is None:
        # Vaciar el campo en la ficha borra la fila: la próxima OC arranca en 01.
        try:
            with connection.cursor() as c:
                c.execute(
                    """
                    DELETE FROM clientes.cliente_marca_correlativo
                     WHERE client_id = %s::uuid AND brand_id = %s::uuid
                    """,
                    [str(client_id), str(brand_id)],
                )
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "[codigo_expediente] no se pudo borrar el consecutivo "
                "(cliente %s, marca %s): %s",
                client_id, brand_id, exc,
            )
            return False
        return True
    try:
        with connection.cursor() as c:
            c.execute(
                """
                INSERT INTO clientes.cliente_marca_correlativo
                       (client_id, brand_id, ultimo_nn, ultimo_anio, updated_at)
                VALUES (%s::uuid, %s::uuid, %s, %s, now())
                ON CONFLICT (client_id, brand_id) DO UPDATE
                   SET ultimo_nn = EXCLUDED.ultimo_nn,
                       ultimo_anio = EXCLUDED.ultimo_anio,
                       updated_at = now()
                """,
                [
                    str(client_id), str(brand_id), nn,
                    int(anio) if anio else date.today().year,
                ],
            )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "[codigo_expediente] no se pudo guardar el consecutivo "
            "(cliente %s, marca %s): %s",
            client_id, brand_id, exc,
        )
        return False
    return True
