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

# Campo -> patrón (con límites de palabra). Se evalúan en minúsculas.
# Decisión E4 (tras evaluación real): evitar substrings ambiguos que generaban
# falsos positivos — "bl" en "Bloqueado", "pago" en "Forma de Pago", "llegada"
# en "90 días desde la llegada a puerto", "due" por el documento DUE (Brasil).
_KEYWORD_RE = {
    "PRODUCCION": re.compile(
        r"\b(producci[oó]n|producc|fabricaci[oó]n|f[aá]brica|terminaci[oó]n|"
        r"estar[aá]\s+listo|listo\s+para|sale\s+de\s+f[aá]brica)\b", re.I),
    "BL_AWB": re.compile(
        r"\b(bl|b/l|awb|mawb|hawb|gu[ií]a\s+a[eé]rea|conocimiento\s+de\s+embarque|"
        r"bill\s+of\s+lading)\b", re.I),
    "ETD": re.compile(
        r"\b(etd|fecha\s+de\s+embarque|data\s+de\s+embarque|fecha\s+de\s+salida|"
        r"salida|zarpe|despacho|shipped|shipment)\b", re.I),
    "ETA": re.compile(
        r"\b(eta|fecha\s+de\s+llegada|fecha\s+de\s+arribo|arribo|arriba\s+a|"
        r"arrival|delivery)\b", re.I),
    "DUE": re.compile(
        r"\b(vencimiento|vence|vto|fecha\s+l[ií]mite|fecha\s+de\s+pago|due\s+date)\b", re.I),
    "DOCUMENTO": re.compile(
        r"\b(factura|packing\s+list|packing|certificado|documento)\b", re.I),
}
# BL_AWB antes de ETD: "conocimiento de embarque" no debe clasificar como ETD.
_ORDEN = ["PRODUCCION", "BL_AWB", "ETD", "ETA", "DUE", "DOCUMENTO"]

_RE_ISO = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")
_RE_DMY = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")
_RE_DMES = re.compile(r"\b(\d{1,2})\s+de\s+(" + _MES_RE + r")(?:\s+de\s+(\d{4}))?", re.I)
_RE_MES = re.compile(r"\b(" + _MES_RE + r")\b(?:\s+(?:de\s+)?(\d{4}))?", re.I)
_RE_SIN_FECHA = re.compile(r"sin\s+fecha|no\s+hay\s+fecha|no\s+tenemos\s+fecha|sin\s+confirmar", re.I)
_RE_ULTIMA = re.compile(r"última\s+semana|ultima\s+semana|fin\s+de|a\s+fin\s+de", re.I)

# ── Clasificación de la mención (Etapa 4 · decisión) ──────────────────
# CONSULTA  = pregunta; no es un hecho -> se descarta (no publicable).
# PROPUESTA = tentativa/estimación; informativa -> no dispara conflicto.
# CONFIRMACION = hecho asertado -> propuesta normal (sujeta a conflicto).
_RE_CONSULTA = re.compile(
    r"\?|¿|\b(cu[aá]ndo|qu[eé]\s+d[ií]a|es\s+posible|ser[ií]a\s+posible|podr[ií]as?|"
    r"me\s+confirmas?|necesito\s+saber|tienen\s+alguna|hay\s+alguna|consulto|pregunto|"
    r"podr[ií]an?\s+confirmar|agradezco\s+confirmar)\b", re.I)
_RE_PROPUESTA = re.compile(
    r"\b(propongo|proponemos|sugier[oa]|sugerimos|estim[oa]|estimamos|estimar[ií]a|"
    r"tentativ|preliminar|aproximad|si\s+todo\s+va\s+bien|esperamos|deber[ií]a|"
    r"en\s+principio|calculamos|prevemos|planeamos|la\s+idea\s+es|queremos|"
    r"probablemente|posiblemente)\b", re.I)


def _tipo_mencion(sentence: str) -> str:
    """Clasifica una oración como CONSULTA, PROPUESTA o CONFIRMACION."""
    s = sentence or ""
    if _RE_CONSULTA.search(s):
        return "CONSULTA"
    if _RE_PROPUESTA.search(s):
        return "PROPUESTA"
    return "CONFIRMACION"



def _campo_de_sentence(s: str) -> str | None:
    low = s.lower()
    for campo in _ORDEN:
        if _KEYWORD_RE[campo].search(low):
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
    """Extrae propuestas {campo, valor_raw, valor_fecha, precision, tipo_mencion}."""
    if not texto:
        return []
    out = []
    for sentence in re.split(r"[\n\.;?!]+", texto):
        campo = _campo_de_sentence(sentence)
        if not campo:
            continue
        tipo = _tipo_mencion(sentence)
        if _RE_SIN_FECHA.search(sentence):
            out.append({"campo": campo, "valor_raw": sentence.strip()[:300],
                        "valor_fecha": None, "precision": "DESCONOCIDA",
                        "tipo_mencion": tipo})
            continue
        for raw, f, prec in _fechas_de_sentence(sentence):
            out.append({"campo": campo, "valor_raw": sentence.strip()[:300],
                        "valor_fecha": f.isoformat() if f else None, "precision": prec,
                        "tipo_mencion": tipo})
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


# ── Tareas de seguimiento (insistencia / reconfirmación) ──────────────
def _crear_tarea_seguimiento(expediente_id, titulo, descripcion, *, campo, due_date,
                             prioridad="ALTA", user_id=None):
    """Crea una tarea de seguimiento evitando duplicar una abierta del mismo tipo."""
    try:
        from apps.tareas.models import Tarea
        # dedup simple por título + expediente en estados abiertos
        existe = Tarea.objects.filter(
            is_active=True, expediente_id=expediente_id, titulo=titulo,
        ).exclude(estado__in=["COMPLETADA", "CANCELADA"]).exists()
        if existe:
            return None
        return Tarea.objects.create(
            id=uuid.uuid4(), expediente_id=expediente_id, catalogo_codigo=None,
            titulo=titulo, descripcion=(descripcion or "")[:500],
            tipo="SEGUIMIENTO", estado="PENDIENTE", prioridad=prioridad,
            origen="MANUAL", due_date=due_date, is_active=True, created_by_id=user_id,
            evidence={"origen": "extraccion", "clase": campo.get("clase") if isinstance(campo, dict) else None},
        )
    except Exception as exc:
        log.warning("[extraccion.tarea_seg] %s", exc)
        return None


def _sumar_dias_habiles(d, n: int):
    from datetime import timedelta
    cur = d
    while n > 0:
        cur = cur + timedelta(days=1)
        if cur.weekday() < 5:
            n -= 1
    return cur


def _crear_tarea_insistencia(ex, user_id=None):
    """'No hay fecha' -> tarea para insistir una fecha concreta (cliente final)."""
    hoy = date.today()
    return _crear_tarea_seguimiento(
        ex.expediente_id,
        f"Solicitar fecha concreta de {ex.campo}",
        f"COMEX indicó que no hay fecha para {ex.campo}. Insistir: el cliente final "
        f"necesita una fecha concreta. Evidencia: {(ex.valor_raw or '')[:200]}",
        campo={"clase": "INSISTENCIA_FECHA", "campo": ex.campo},
        due_date=_sumar_dias_habiles(hoy, 5), prioridad="ALTA", user_id=user_id,
    )


def _mes_de_raw(raw):
    """Infiere el día 25 del mes/año mencionado (para reconfirmar un MES)."""
    if not raw:
        return None
    m = re.search(r"\b(" + _MES_RE + r")\b(?:\s+(?:de\s+)?(\d{4}))?", raw, re.I)
    if not m:
        return None
    mes = _MESES.get(m.group(1).lower())
    if not mes:
        return None
    anio = int(m.group(2)) if m.group(2) else date.today().year
    try:
        return date(anio, mes, 25)
    except ValueError:
        return None


def _crear_tarea_reconfirmacion(ex, user_id=None):
    """Mes/rango impreciso -> reconfirmar la última semana del mes (día hábil)."""
    from datetime import timedelta
    # Referencia: fecha (si hay) o el mes/año literal del texto; si no, mes actual.
    base = ex.valor_fecha or _mes_de_raw(ex.valor_raw) or date(date.today().year, date.today().month, 25)
    ref = base.replace(day=25)
    while ref.weekday() >= 5:
        ref = ref - timedelta(days=1)
    return _crear_tarea_seguimiento(
        ex.expediente_id,
        f"Reconfirmar fecha {ex.campo} (precisión {ex.precision})",
        f"La fecha de {ex.campo} solo tiene precisión {ex.precision} "
        f"('{ex.valor_raw or ''}'). Reconfirmar con fábrica una fecha concreta; "
        f"al cliente se muestra 'última semana'; no se inventa un día.",
        campo={"clase": "RECONFIRMAR_MES", "campo": ex.campo},
        due_date=ref, prioridad="MEDIA", user_id=user_id,
    )


# ── Artefactos Builder (AWB/BL · ART-05) ──────────────────────────────
# Decisión E4: solo se escriben campos con mapeo semántico claro; nada inventado.
_ARTIFACT_MAP = {
    "ETD":    {"template_id": 9, "field": "field-1780150662711", "kind": "date", "label": "Fecha de Despacho"},
    "ETA":    {"template_id": 9, "field": "field-1780150673285", "kind": "date", "label": "Fecha de Arrivo"},
    "BL_AWB": {"template_id": 9, "field": "field-0072",           "kind": "text", "label": "Tracking"},
}
_ARTIFACT_PENDING = {"template_id": 9, "field": "field-0076", "label": "Itinerario"}


def _aplicar_artefactos(ex) -> dict:
    """Escribe la fecha confirmada en el artefacto AWB/BL del expediente.
    Devuelve {aplicado, field?, valor?, motivo?} para dejar traza."""
    if not ex.expediente_id:
        return {"aplicado": 0, "motivo": "sin expediente"}
    try:
        # 'No hay fecha': dejar constancia en el AWB/BL solo si el campo está vacío.
        if (ex.precision or "").upper() == "DESCONOCIDA":
            nota = f"PENDIENTE FECHA {ex.campo} — solicitada {date.today().isoformat()}"
            with connection.cursor() as c:
                c.execute("""
                    UPDATE nodos.builder_artifact_instance i
                       SET data = jsonb_set(COALESCE(i.data, '{}'::jsonb), ARRAY[%s],
                                            to_jsonb(%s::text), TRUE),
                           updated_at = NOW()
                     WHERE i.template_id = %s AND i.is_active = TRUE
                       AND NOT (COALESCE(i.data, '{}'::jsonb) ? %s)
                       AND EXISTS (SELECT 1 FROM nodos.builder_artifact_line l
                                    WHERE l.builder_artifact_instance_id = i.id
                                      AND l.expediente_id = %s::uuid AND l.is_active = TRUE)
                """, [_ARTIFACT_PENDING["field"], nota, _ARTIFACT_PENDING["template_id"],
                      _ARTIFACT_PENDING["field"], str(ex.expediente_id)])
                n = c.rowcount or 0
            return {"aplicado": n, "field": _ARTIFACT_PENDING["field"], "nota": nota}

        m = _ARTIFACT_MAP.get(ex.campo)
        if not m:
            return {"aplicado": 0, "motivo": "sin mapeo de artefacto"}
        if m["kind"] == "date":
            if not ex.valor_fecha:
                return {"aplicado": 0, "motivo": "sin valor_fecha"}
            valor = ex.valor_fecha.isoformat()
        else:
            valor = (ex.valor_raw or "")
            if not valor and ex.valor_fecha:
                valor = ex.valor_fecha.isoformat()
            valor = valor[:200]
        if not valor:
            return {"aplicado": 0, "motivo": "sin valor"}
        with connection.cursor() as c:
            c.execute("""
                UPDATE nodos.builder_artifact_instance i
                   SET data = jsonb_set(COALESCE(i.data, '{}'::jsonb), ARRAY[%s],
                                        to_jsonb(%s::text), TRUE),
                       updated_at = NOW()
                 WHERE i.template_id = %s AND i.is_active = TRUE
                   AND EXISTS (SELECT 1 FROM nodos.builder_artifact_line l
                                WHERE l.builder_artifact_instance_id = i.id
                                  AND l.expediente_id = %s::uuid AND l.is_active = TRUE)
            """, [m["field"], valor, m["template_id"], str(ex.expediente_id)])
            n = c.rowcount or 0
        return {"aplicado": n, "field": m["field"], "label": m["label"], "valor": valor}
    except Exception as exc:
        log.warning("[extraccion.artefactos] %s", exc)
        return {"aplicado": 0, "error": str(exc)}


# ── Extracción desde adjuntos (PDF/XLSX/DOCX/DUA) ─────────────────────
_MAX_ADJ_BYTES = 15 * 1024 * 1024

# Formatos con extractor text-native propio.
_ADJ_BASE_EXT = (".pdf", ".xlsx", ".xlsm", ".docx", ".txt", ".csv", ".tsv")
# Formatos adicionales que AnyDoc sí convierte (incluye legacy .xls/.doc).
_ADJ_ANYDOC_EXT = (".pdf", ".xlsx", ".xlsm", ".xls", ".docx", ".doc", ".docm",
                   ".pptx", ".rtf", ".odt", ".ods", ".odp", ".txt", ".csv", ".tsv")


def _to_markdown_anydoc(data: bytes, filename: str):
    """Convierte bytes a Markdown con AnyDoc (firecrawl-anydoc). None si no está
    instalado o la conversión falla (p. ej. escaneo → NeedsOcr)."""
    try:
        import anydoc  # type: ignore
    except Exception:
        return None
    try:
        return anydoc.to_markdown_bytes(data)
    except Exception as exc:  # noqa: BLE001
        log.info("[extraccion.anydoc] %s -> %s", filename, type(exc).__name__)
        return None


def _texto_de_adjunto(data: bytes, mime: str, filename: str, anydoc_enabled: bool):
    """Devuelve (texto, etiqueta_conversor). AnyDoc primero (mejor cobertura);
    fallback al texto propio. None si no hay texto útil."""
    from django.conf import settings
    from apps.ai_hub.document_extractor import _to_text_payload

    fname = (filename or "").lower()
    own_text, own_kind, is_image = ("", "unknown", False)
    if any(fname.endswith(e) for e in _ADJ_BASE_EXT) or mime.startswith("text/") \
            or mime in ("application/pdf",) or "spreadsheetml" in mime or "wordprocessingml" in mime:
        own_text, own_kind, is_image = _to_text_payload(data, mime, filename)

    md = None
    if anydoc_enabled and not is_image:
        md = _to_markdown_anydoc(data, filename)

    min_chars = int(getattr(settings, "CORREO_ANYDOC_MIN_CHARS", 20) or 20)
    # Preferimos AnyDoc si aporta contenido suficiente; si no, el texto propio.
    if md and len(md.strip()) >= min_chars and len(md) >= 0.5 * len(own_text or ""):
        return md, "anydoc-md"
    if own_text and len(own_text.strip()) >= 10 and not (fname.endswith((".xls", ".doc"))):
        return own_text, own_kind
    return None, None


def extraer_de_adjuntos(mensaje_id, expediente_id, user_id=None) -> list:
    """Extrae fechas del TEXTO de los adjuntos del mensaje. AnyDoc (si está
    habilitado e instalado) convierte el adjunto a Markdown; fallback al
    extractor text-native del ai_hub. Nunca inventa: sin texto → sin propuestas."""
    from django.conf import settings
    from .models import Adjunto
    anydoc_enabled = bool(getattr(settings, "CORREO_ANYDOC_ENABLED", True))
    permitidos = _ADJ_ANYDOC_EXT if anydoc_enabled else _ADJ_BASE_EXT
    creadas = []
    for a in Adjunto.objects.filter(mensaje_id=mensaje_id):
        if not a.storage_key:
            continue
        if a.size_bytes and int(a.size_bytes) > _MAX_ADJ_BYTES:
            continue
        fname = (a.filename or "").lower()
        if not fname.endswith(permitidos):
            continue
        try:
            from apps.storage.services import get_object_stream
            resp = get_object_stream(a.storage_key)
            if resp is None:
                continue
            try:
                data = resp.read()
            finally:
                try:
                    resp.close()
                except Exception:
                    pass
            text, kind = _texto_de_adjunto(data, a.mimetype or "", a.filename or "", anydoc_enabled)
            if not text or len(text.strip()) < 10:
                continue
            creadas += crear_propuestas(
                mensaje_id, expediente_id, text, fuente="ADJUNTO", user_id=user_id,
                evidencias_extra={"adjunto_id": str(a.id), "filename": a.filename, "kind": kind})
        except Exception as exc:
            log.warning("[extraccion.adjuntos] %s: %s", a.filename, exc)
    return creadas


def crear_propuestas(mensaje_id, expediente_id, texto, fuente="MENSAJE", user_id=None,
                     evidencias_extra=None) -> list:
    items = extraer_de_texto(texto or "")
    if not items:
        items = _llm_extraer(texto or "")
    creadas = []
    for it in items:
        campo = (it.get("campo") or "OTRO").upper()
        if campo not in _KEYWORD_RE and campo != "OTRO":
            campo = "OTRO"
        tipo = (it.get("tipo_mencion") or "CONFIRMACION").upper()
        if tipo not in ("CONSULTA", "PROPUESTA", "CONFIRMACION"):
            tipo = "CONFIRMACION"
        # CONSULTA = pregunta -> se registra pero se descarta (no publicable).
        estado = "RECHAZADO" if tipo == "CONSULTA" else "PROPUESTO"
        # Solo un HECHO (CONFIRMACION) puede marcar conflicto / abrir revisión.
        conflicto = (_conflicto(expediente_id, campo, it.get("valor_fecha"),
                                it.get("precision") or "EXACTA")
                     if tipo == "CONFIRMACION" else False)
        if tipo == "CONSULTA":
            confianza = 0.1
        elif tipo == "PROPUESTA":
            confianza = 0.4
        else:
            confianza = 0.6 if it.get("valor_fecha") else 0.3
        ev = {"mensaje_id": str(mensaje_id) if mensaje_id else None, "tipo_mencion": tipo}
        if evidencias_extra:
            ev.update(evidencias_extra)
        try:
            ex = Extraccion.objects.create(
                id=uuid.uuid4(), mensaje_id=mensaje_id, expediente_id=expediente_id,
                campo=campo, valor_raw=it.get("valor_raw"), valor_fecha=it.get("valor_fecha"),
                precision=it.get("precision") or "EXACTA", fuente=fuente,
                confianza=confianza, estado=estado, conflicto=conflicto,
                tipo_mencion=tipo, evidencias=ev, created_by_id=user_id,
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

        # 1) Reflejar en el artefacto Builder (AWB/BL · ART-05) si hay mapeo.
        traza = _aplicar_artefactos(ex)
        # 2) Tareas de seguimiento según la certeza de la fecha.
        prec = (ex.precision or "EXACTA").upper()
        if prec == "DESCONOCIDA":
            _crear_tarea_insistencia(ex, user_id)
        elif prec in ("MES", "RANGO"):
            _crear_tarea_reconfirmacion(ex, user_id)

        ev = dict(ex.evidencias or {})
        ev["artefacto"] = traza
        ex.evidencias = ev
    ex.estado = "CONFIRMADO"
    ex.conflicto = False
    ex.save(update_fields=["estado", "conflicto", "evidencias", "updated_at"])
    return ex


def rechazar(extraccion_id, user_id=None):
    ex = Extraccion.objects.filter(pk=extraccion_id).first()
    if not ex:
        return None
    ex.estado = "RECHAZADO"
    ex.save(update_fields=["estado", "updated_at"])
    return ex
