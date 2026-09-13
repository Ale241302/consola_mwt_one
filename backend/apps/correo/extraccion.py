"""
apps.correo · extraccion (Etapa 4)
Extrae fechas de correos (determinista + DeepSeek opcional), detecta conflictos
con la fecha vigente publicada y publica al confirmar.

Campos: PRODUCCION, ETD, ETA, BL_AWB, DUE, DOCUMENTO, OTRO.
Precisión: EXACTA, RANGO, MES, DESCONOCIDA.
Regla: una fecha que CAMBIA respecto de la publicada es CONFLICTO → revisión
(mesa de trabajo); no se publica sola.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import date

from django.db import IntegrityError, connection
from django.utils import timezone

from .models import ExpedienteFecha, Extraccion

log = logging.getLogger(__name__)

_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
}
_MES_RE = "|".join(_MESES.keys())

# Campo -> palabras clave (se evalúan en minúsculas).
_KEYWORDS = {
    "PRODUCCION": ["produc", "fabric", "termin", "listo", "entrega en fab"],
    "ETD":        ["etd", "salida", "embarque", "zarpe", "despacho", "sale"],
    "ETA":        ["eta", "llegada", "arrib", "llega", "recib", "destino"],
    "BL_AWB":     ["bl", "awb", "guia", "guía", "conocimiento", "mawb", "hawb"],
    "DUE":        ["due", "vencimiento", "vence", "pago"],
    "DOCUMENTO":  ["factura", "packing", "certificado", "documento"],
}
_ORDEN = ["PRODUCCION", "ETD", "ETA", "BL_AWB", "DUE", "DOCUMENTO"]

_RE_ISO = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")
_RE_DMY = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")
_RE_DMES = re.compile(r"\b(\d{1,2})\s+de\s+(" + _MES_RE + r")(?:\s+de\s+(\d{4}))?", re.I)
_RE_MES = re.compile(r"\b(" + _MES_RE + r")\b(?:\s+(?:de\s+)?(\d{4}))?", re.I)
_RE_SIN_FECHA = re.compile(r"sin\s+fecha|no\s+hay\s+fecha|no\s+tenemos\s+fecha|sin\s+confirmar", re.I)
_RE_ULTIMA = re.compile(r"última\s+semana|ultima\s+semana|fin\s+de|a\s+fin\s+de", re.I)


def _campo_de_sentence(s: str) -> str | None:
    low = s.lower()
    for campo in _ORDEN:
        for kw in _KEYWORDS[campo]:
            if kw in low:
                return campo
    return None


def _fechas_de_sentence(s: str):
    """Devuelve [(raw, date|None, precision)] detectados en la oración."""
    out = []
    for m in _RE_ISO.finditer(s):
        try:
            out.append((m.group(0), date(int(m.group(1)), int(m.group(2)), int(m.group(3))), "EXACTA"))
        except ValueError:
            pass
    if not out:
        for m in _RE_DMY.finditer(s):
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if y < 100:
                y += 2000
            try:
                out.append((m.group(0), date(y, mo, d), "EXACTA"))
            except ValueError:
                pass
    if not out:
        for m in _RE_DMES.finditer(s):
            dia = int(m.group(1)); mes = _MESES.get(m.group(2).lower()); anio = int(m.group(3)) if m.group(3) else date.today().year
            try:
                out.append((m.group(0), date(anio, mes, dia), "EXACTA"))
            except ValueError:
                pass
    if not out:
        for m in _RE_MES.finditer(s):
            mes = _MESES.get(m.group(1).lower()); anio = int(m.group(2)) if m.group(2) else date.today().year
            prec = "MES"
            out.append((m.group(0), None, prec))
    return out


def extraer_de_texto(texto: str) -> list[dict]:
    """Extrae propuestas {campo, valor_raw, valor_fecha, precision} de un texto."""
    if not texto:
        return []
    out = []
    for sentence in re.split(r"[\n\.;]+", texto):
        campo = _campo_de_sentence(sentence)
        if not campo:
            continue
        if _RE_SIN_FECHA.search(sentence):
            out.append({"campo": campo, "valor_raw": sentence.strip()[:300],
                        "valor_fecha": None, "precision": "DESCONOCIDA"})
            continue
        for raw, f, prec in _fechas_de_sentence(sentence):
            if _RE_ULTIMA.search(sentence) and prec == "MES":
                prec = "MES"
            out.append({"campo": campo, "valor_raw": sentence.strip()[:300],
                        "valor_fecha": f.isoformat() if f else None, "precision": prec})
    return out


def _llm_extraer(texto: str) -> list[dict]:
    """Enriquecimiento opcional con DeepSeek (JSON). Best-effort."""
    try:
        from apps.ai_hub.llm_text import llm_text
        sys = ('Extrae fechas del correo. Devuelve SOLO JSON: '
               '{"items":[{"campo":"PRODUCCION|ETD|ETA|BL_AWB|DUE|DOCUMENTO|OTRO",'
               '"valor_raw":"texto literal","valor_fecha":"YYYY-MM-DD o null",'
               '"precision":"EXACTA|RANGO|MES|DESCONOCIDA"}]}. Si no hay fechas, items vacío.')
        raw = llm_text(sys, texto[:4000], max_tokens=500) or ""
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            return []
        data = json.loads(m.group(0))
        items = data.get("items") or []
        return [i for i in items if isinstance(i, dict) and i.get("campo")]
    except Exception as exc:
        log.warning("[extraccion.llm] %s", exc)
        return []


def _conflicto(expediente_id, campo, valor_fecha, precision) -> bool:
    if not expediente_id:
        return False
    cur = ExpedienteFecha.objects.filter(expediente_id=expediente_id, campo=campo).first()
    if cur is None:
        return False
    same = (str(cur.valor_fecha) if cur.valor_fecha else None) == (valor_fecha or None) \
        and cur.precision == precision
    return not same


def _crear_tarea_revision(expediente_id, campo, valor_raw, user_id=None):
    try:
        from apps.tareas.models import Tarea
        Tarea.objects.create(
            id=uuid.uuid4(), expediente_id=expediente_id, catalogo_codigo=None,
            titulo=f"Revisar fecha {campo}", descripcion=(valor_raw or "")[:500],
            tipo="SEGUIMIENTO", estado="REQUIERE_REVISION", prioridad="ALTA",
            origen="MANUAL", is_active=True, created_by_id=user_id,
            evidence={"origen": "extraccion", "campo": campo},
        )
    except Exception as exc:
        log.warning("[extraccion.tarea] %s", exc)


def crear_propuestas(mensaje_id, expediente_id, texto, fuente="MENSAJE", user_id=None) -> list:
    items = extraer_de_texto(texto or "")
    if not items:
        items = _llm_extraer(texto or "")
    creadas = []
    for it in items:
        campo = (it.get("campo") or "OTRO").upper()
        if campo not in _KEYWORDS and campo != "OTRO":
            campo = "OTRO"
        try:
            ex = Extraccion.objects.create(
                id=uuid.uuid4(), mensaje_id=mensaje_id, expediente_id=expediente_id,
                campo=campo, valor_raw=it.get("valor_raw"), valor_fecha=it.get("valor_fecha"),
                precision=it.get("precision") or "EXACTA", fuente=fuente,
                confianza=0.6 if it.get("valor_fecha") else 0.3,
                estado="PROPUESTO",
                conflicto=_conflicto(expediente_id, campo, it.get("valor_fecha"), it.get("precision") or "EXACTA"),
                evidencias={"mensaje_id": str(mensaje_id) if mensaje_id else None},
                created_by_id=user_id,
            )
        except IntegrityError:
            continue
        creadas.append(ex)
        if ex.conflicto:
            _crear_tarea_revision(expediente_id, campo, it.get("valor_raw"), user_id)
    return creadas


def confirmar(extraccion_id, user_id=None):
    ex = Extraccion.objects.filter(pk=extraccion_id).first()
    if not ex:
        return None
    if ex.expediente_id and ex.campo:
        with connection.cursor() as c:
            c.execute("""
                INSERT INTO correo.expediente_fecha
                  (id, expediente_id, campo, valor_raw, valor_fecha, precision,
                   publicado, fuente_extraccion_id, created_at, updated_at)
                VALUES (%s, %s::uuid, %s, %s, %s, %s, TRUE, %s, NOW(), NOW())
                ON CONFLICT (expediente_id, campo) DO UPDATE
                   SET valor_raw = EXCLUDED.valor_raw,
                       valor_fecha = EXCLUDED.valor_fecha,
                       precision = EXCLUDED.precision,
                       publicado = TRUE,
                       fuente_extraccion_id = EXCLUDED.fuente_extraccion_id,
                       updated_at = NOW()
            """, [str(uuid.uuid4()), str(ex.expediente_id), ex.campo, ex.valor_raw,
                  ex.valor_fecha, ex.precision, str(ex.id)])
        # Las demás propuestas del mismo campo quedan supersedidas.
        Extraccion.objects.filter(
            expediente_id=ex.expediente_id, campo=ex.campo, estado="PROPUESTO",
        ).exclude(id=ex.id).update(estado="SUPERSEDIDO", updated_at=timezone.now())
    ex.estado = "CONFIRMADO"
    ex.conflicto = False
    ex.save(update_fields=["estado", "conflicto", "updated_at"])
    return ex


def rechazar(extraccion_id, user_id=None):
    ex = Extraccion.objects.filter(pk=extraccion_id).first()
    if not ex:
        return None
    ex.estado = "RECHAZADO"
    ex.save(update_fields=["estado", "updated_at"])
    return ex
