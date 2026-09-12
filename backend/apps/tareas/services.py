"""
apps.tareas · services (Etapa 2)
- Calendario de días hábiles (lunes a viernes; sin feriados en esta primera regla).
- Generación idempotente de tareas automáticas por expediente.
- Bitácora de eventos.
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from django.db import IntegrityError, connection

from .models import Tarea, TareaCatalogo, TareaEvento

# Estados de expediente considerados terminales (no generan tareas nuevas).
_EXP_TERMINAL = ("CERRADO", "CANCELADO")


# ── Calendario ──────────────────────────────────────────────────────
def add_business_days(d: date | None, n: int) -> date | None:
    """Suma n días hábiles (lun-vie). n puede ser negativo. No excluye feriados."""
    if d is None:
        return None
    step = 1 if n >= 0 else -1
    remaining = abs(int(n))
    cur = d
    while remaining > 0:
        cur = cur + timedelta(days=step)
        if cur.weekday() < 5:
            remaining -= 1
    return cur


# ── Catálogo ────────────────────────────────────────────────────────
def catalogo_by_codigo() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for c in TareaCatalogo.objects.filter(is_active=True):
        out[c.codigo] = {
            "id":                  c.id,
            "codigo":              c.codigo,
            "nombre":              c.nombre,
            "descripcion":         c.descripcion,
            "tipo":                c.tipo,
            "offset_dias_habiles": c.offset_dias_habiles,
            "offset_ref":          c.offset_ref,
            "depends_on_hito":     c.depends_on_hito,
            "is_active":           c.is_active,
        }
    return out


def catalogo_faltante() -> bool:
    """True si el catálogo base no está sembrado (SQL K7 no aplicado todavía)."""
    return not TareaCatalogo.objects.filter(is_active=True).exists()


# ── Bitácora ────────────────────────────────────────────────────────
def log_evento(tarea_id, accion: str, detalle: dict | None = None, user_id=None):
    try:
        TareaEvento.objects.create(
            id=uuid.uuid4(), tarea_id=tarea_id, accion=accion,
            detalle=detalle or {}, user_id=user_id,
        )
    except Exception:
        # La bitácora nunca debe tumbar la operación de negocio.
        pass


# ── Consultas de apoyo ──────────────────────────────────────────────
_EXP_FIELDS = """
    e.id::text AS id, e.codigo, e.estado, e.oc_id::text AS oc_id,
    e.client_id::text AS client_id, e.created_at::date AS reg_date,
    (SELECT MIN(l.production_date)
       FROM expedientes.linea l
      WHERE l.expediente_id = e.id AND l.is_active = TRUE
        AND l.production_date IS NOT NULL) AS prod_date
"""


def fetch_expediente(exp_id) -> dict | None:
    with connection.cursor() as c:
        c.execute(f"SELECT {_EXP_FIELDS} FROM expedientes.expediente e "
                  f"WHERE e.id = %s::uuid AND e.is_active = TRUE", [str(exp_id)])
        row = c.fetchone()
        cols = [d[0] for d in c.description]
        return dict(zip(cols, row)) if row else None


def fetch_active_expedientes() -> list[dict]:
    with connection.cursor() as c:
        c.execute(f"SELECT {_EXP_FIELDS} FROM expedientes.expediente e "
                  f"WHERE e.is_active = TRUE")
        cols = [d[0] for d in c.description]
        return [dict(zip(cols, row)) for row in c.fetchall()]


# ── Generación de tareas automáticas ────────────────────────────────
def _auto_viva(exp_id, codigo) -> bool:
    return Tarea.objects.filter(
        expediente_id=exp_id, catalogo_codigo=codigo, origen="AUTO", is_active=True,
    ).exclude(estado__in=["RESUELTA", "CANCELADA"]).exists()


def ensure_auto(exp: dict, codigo: str, *, due: date | None = None,
                tipo: str | None = None, user_id=None) -> bool:
    """Crea la tarea AUTO si no existe una viva para (expediente, plantilla). Devuelve True si creó."""
    cat = catalogo_by_codigo().get(codigo)
    if not cat or not cat["is_active"]:
        return False
    if _auto_viva(exp["id"], codigo):
        return False
    try:
        t = Tarea.objects.create(
            id=uuid.uuid4(),
            expediente_id=exp["id"], oc_id=exp.get("oc_id"),
            client_id=exp.get("client_id"),
            catalogo_id=cat["id"], catalogo_codigo=codigo,
            titulo=cat["nombre"], descripcion=cat["descripcion"],
            tipo=tipo or cat["tipo"], estado="PENDIENTE", prioridad="MEDIA",
            origen="AUTO", due_date=due,
            depends_on_hito=cat.get("depends_on_hito"),
            is_active=True, created_by_id=user_id,
        )
    except IntegrityError:
        # Carrera con otra corrida del generador → ya existe.
        return False
    log_evento(t.id, "AUTO_CREADA", {"catalogo": codigo}, user_id)
    return True


def cancelar_auto(exp_id, codigo: str, motivo: str, user_id=None) -> int:
    """Cancela tareas AUTO vivas de una plantilla (respeta overrides manuales)."""
    qs = Tarea.objects.filter(
        expediente_id=exp_id, catalogo_codigo=codigo, origen="AUTO", is_active=True,
    ).exclude(estado__in=["RESUELTA", "CANCELADA"])
    n = 0
    for t in qs:
        t.estado = "CANCELADA"
        t.save(update_fields=["estado", "updated_at"])
        log_evento(t.id, "AUTO_CANCELADA", {"motivo": motivo}, user_id)
        n += 1
    return n


def _generar_exp(exp: dict, user_id=None) -> list[str]:
    estado = (exp.get("estado") or "").upper()
    prod = exp.get("prod_date")
    creadas: list[str] = []

    if estado in _EXP_TERMINAL:
        # Cancelar toda tarea AUTO viva del expediente cerrado.
        for codigo in ("SOLICITAR_FECHA_PRODUCCION", "RECONFIRMAR_PRODUCCION",
                       "PREPARAR_DESPACHO", "REVISAR_ITINERARIO", "SEGUIMIENTO_SIN_RESPUESTA"):
            cancelar_auto(exp["id"], codigo, f"expediente {estado}", user_id)
        return creadas

    # 1) Solicitar fecha concreta de producción: 15 días hábiles tras el registro.
    if prod is None:
        due = add_business_days(exp.get("reg_date"), 15)
        if ensure_auto(exp, "SOLICITAR_FECHA_PRODUCCION", due=due, user_id=user_id):
            creadas.append("SOLICITAR_FECHA_PRODUCCION")
    else:
        # Ya hay fecha informada → la consulta inicial pierde sentido.
        cancelar_auto(exp["id"], "SOLICITAR_FECHA_PRODUCCION", "produccion informada", user_id)
        # 2) Reconfirmar producción: 10 días hábiles antes de la fecha informada.
        due = add_business_days(prod, -10)
        if ensure_auto(exp, "RECONFIRMAR_PRODUCCION", due=due, user_id=user_id):
            creadas.append("RECONFIRMAR_PRODUCCION")

    # 3) Preparar despacho cuando entra a preparación/despacho.
    if estado in ("PREPARACION", "DESPACHO"):
        if ensure_auto(exp, "PREPARAR_DESPACHO", user_id=user_id):
            creadas.append("PREPARAR_DESPACHO")

    # 4) Revisar itinerario durante el tránsito.
    if estado == "TRANSITO":
        if ensure_auto(exp, "REVISAR_ITINERARIO", user_id=user_id):
            creadas.append("REVISAR_ITINERARIO")

    return creadas


def generar_para_expediente(exp_id, user_id=None) -> dict:
    exp = fetch_expediente(exp_id)
    if not exp:
        return {"expediente_id": str(exp_id), "creadas": [], "error": "expediente_no_existe"}
    return {"expediente_id": str(exp_id), "creadas": _generar_exp(exp, user_id)}


def generar_global(user_id=None) -> dict:
    """Corrida completa (job diario). Idempotente."""
    creadas = 0
    for exp in fetch_active_expedientes():
        creadas += len(_generar_exp(exp, user_id))
    return {"creadas": creadas}
