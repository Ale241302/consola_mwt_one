"""
=====================================================================
MWT.ONE · apps.expedientes.envio_backfill
Backfill del artefacto de ENVÍO (AWB/BL) de un expediente.

El artefacto del nodo es la FUENTE DE VERDAD del envío: tracking, carrier,
fecha de despacho (ETD), fecha de arrivo (ETA), origen/destino, AWB/BL.
Estos viven como campos `field-XXXX` en `data` del artefacto (definidos en
`structure_snapshot` del template), NO en la cabecera del expediente.

Éste módulo, dado (expediente_id, tracking, carrier, etd, eta, origen,
destino), localiza el artefacto de envío del nodo del expediente y actualiza
el/los field-XXXX correspondientes mapeando por ETIQUETA (no por id fijo,
porque los ids de campo varían por template).
=====================================================================
"""
from __future__ import annotations

import json
import re
from typing import Any

from django.db import connection


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _find_envio_artifact(expediente_id: str) -> tuple[dict | None, str | None]:
    """Devuelve el artefacto de envío (AWB/BL) del nodo del expediente."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT nodo_id::text
              FROM inventario.expediente_nodo_assignment
             WHERE expediente_id = %s AND is_active = TRUE
            """,
            [expediente_id],
        )
        nodos = [r[0] for r in cur.fetchall()]
    if not nodos:
        return None, "El expediente no tiene un nodo logístico asignado."

    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, nodo_id::text, template_title, is_active,
                   COALESCE(structure_snapshot::text, '{}'),
                   COALESCE(data::text, '{}')
              FROM nodos.builder_artifact_instance
             WHERE nodo_id::text = ANY(%s) AND is_active = TRUE
            """,
            [nodos],
        )
        rows = cur.fetchall()

    best = None
    best_score = -1
    for aid, nid, title, _act, snap, data in rows:
        low = (f"{title or ''} {snap or ''}").lower()
        score = 0
        if any(k in low for k in ("tracking", "carrier")):
            score += 3
        if any(k in low for k in ("awb", "bl", "env", "fecha de despacho", "fecha de arrivo")):
            score += 2
        if score > best_score:
            best_score = score
            best = (aid, nid, title, snap, data)

    if not best or best_score <= 0:
        return None, ("No hay un artefacto de ENVÍO (AWB/BL) en el nodo del expediente. "
                      "Créalo primero con `nodo_artefacto_crear` (plantilla AWB/BL) y reintenta.")
    aid, nid, title, snap, data = best
    try:
        snapj = json.loads(snap) if snap else {}
    except Exception:  # noqa: BLE001
        snapj = {}
    return {
        "artifact_id": aid,
        "nodo_id": nid,
        "titulo": title or "",
        "structure": snapj,
        "data": json.loads(data) if data else {},
    }, None


def _field_map(structure: dict) -> dict[str, str]:
    """Etiqueta normalizada -> field_id (de los campos del template)."""
    m: dict[str, str] = {}

    def walk(o: Any) -> None:
        if isinstance(o, dict):
            fid = o.get("id") or o.get("key") or o.get("field_id")
            lab = o.get("label") or o.get("title") or o.get("name")
            if isinstance(fid, str) and fid.startswith("field") and isinstance(lab, str):
                m[_norm(lab)] = fid
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(structure)
    return m


def backfill_envio(expediente_id: str, *,
                   tracking: str | None = None,
                   carrier: str | None = None,
                   etd: str | None = None,
                   eta: str | None = None,
                   origen: str | None = None,
                   destino: str | None = None) -> dict:
    """Actualiza el artefacto de envío del expediente (única fuente de verdad)."""
    art, err = _find_envio_artifact(expediente_id)
    if err:
        return {"ok": False, "detail": err, "code": "NO_ARTEFACTO_ENVIO"}
    fm = _field_map(art["structure"])

    def setby(cands: list[str], value: str | None) -> tuple[str, str] | None:
        if not value:
            return None
        for c in cands:
            f = fm.get(_norm(c))
            if f:
                return f, value
        return None

    upd: dict[str, str] = {}
    for cands, value in [
        (["Tracking"], tracking),
        (["CARRIER", "Carrier", "Transportista"], carrier),
        (["Fecha de Despacho", "Fecha Despacho", "ETD", "Despacho"], etd),
        (["Fecha de Arrivo", "Fecha Arribo", "ETA", "Arribo"], eta),
    ]:
        r = setby(cands, value)
        if r:
            upd[r[0]] = r[1]

    # Origen · Destino (puede ser campo único o dos)
    if origen or destino:
        pais = f"{origen or ''} - {destino or ''}".strip(" -")
        r = setby(["Origen y Destino", "Origen", "Ruta", "Origen / Destino"], pais or None)
        if r:
            upd[r[0]] = r[1]

    if not upd:
        return {"ok": False, "detail": "Ningún campo proporcionado mapeó a un campo del "
                                       "artefacto de envío.", "code": "SIN_MATCH",
                "campos_disponibles": sorted(set(fm.values()))}

    newdata = json.dumps(upd)
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE nodos.builder_artifact_instance
               SET data = data || %s::jsonb, updated_at = NOW()
             WHERE id = %s
            RETURNING data::text
            """,
            [newdata, art["artifact_id"]],
        )
        row = cur.fetchone()
    final = json.loads(row[0]) if row and row[0] else {}
    return {
        "ok": True,
        "expediente_id": str(expediente_id),
        "artifact_id": art["artifact_id"],
        "artifact": art["titulo"],
        "updated": upd,
        "data": final,
    }
