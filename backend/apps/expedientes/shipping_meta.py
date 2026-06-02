"""
=====================================================================
MWT.ONE · apps.expedientes.shipping_meta
Agente responsable: [AG-BACKEND]

Resuelve metadata de ENVÍO (AWB/BL) y EMPAQUE (Packing List) desde los
builder-artifacts (nodos.builder_artifact_instance) de un expediente, para
enriquecer la Factura comercial (encabezado estilo DDP).

Estrategia de extracción robusta: NO dependemos de field-IDs frágiles. Para
cada artifact construimos un mapa {label → value} usando data (field_id →
value) + structure_snapshot (fields con id+label), y buscamos por etiqueta.
=====================================================================
"""
from __future__ import annotations

import logging
from django.db import connection

log = logging.getLogger(__name__)


def _label_value_map(data, structure):
    """Construye {label_lower: value} desde data + structure_snapshot."""
    out = {}
    try:
        data = data or {}
        for sec in (structure or {}).get("sections", []) or []:
            for col in sec.get("columns", []) or []:
                for f in col.get("fields", []) or []:
                    fid = f.get("id")
                    label = (f.get("label") or "").strip().lower()
                    if fid in data and label:
                        out[label] = data.get(fid)
    except Exception:  # noqa: BLE001 — defensivo
        log.exception("[shipping_meta] label map failed")
    return out


def _first_by_label(lvmap, *needles):
    """Primer valor cuyo label contenga alguno de los needles (orden importa)."""
    for n in needles:
        for label, val in lvmap.items():
            if n in label and val not in (None, "", []):
                return val
    return None


def resolve_shipping_packing(expediente_ids):
    """Devuelve {'shipping': {...}, 'packing': {...}} para los expedientes dados.

    shipping: doc_type, transport_mode, freight_mode, dispatch_mode, carrier,
              tracking (nº AWB/BL), consolidation, dispatch_date, arrival_date.
    packing:  cajas, peso_bruto, peso_neto, m3.
    Campos ausentes quedan en None.
    """
    shipping = {}
    packing = {}
    ids = [str(x) for x in (expediente_ids or []) if x]
    if not ids:
        return {"shipping": shipping, "packing": packing}

    try:
        with connection.cursor() as c:
            c.execute(
                """
                SELECT DISTINCT bai.id::text, bai.template_id, bai.template_title,
                       bai.data, bai.structure_snapshot, bai.created_at
                FROM nodos.builder_artifact_instance bai
                JOIN nodos.builder_artifact_line bal
                  ON bal.builder_artifact_instance_id = bai.id
                WHERE bal.expediente_id = ANY(%(ids)s::uuid[])
                  AND bal.is_active = TRUE AND bai.is_active = TRUE
                ORDER BY bai.created_at DESC
                """,
                {"ids": ids},
            )
            rows = c.fetchall()
    except Exception:  # noqa: BLE001
        log.exception("[shipping_meta] query failed ids=%s", ids)
        return {"shipping": shipping, "packing": packing}

    for (_iid, tid, title, data, structure, _created) in rows:
        title_l = (title or "").lower()
        lv = _label_value_map(data, structure)

        # ── AWB/BL (ART-05, template_id=9 o título con 'awb') ──
        if (tid == 9 or "awb" in title_l) and not shipping:
            itinerary = _first_by_label(lv, "itinerario")
            due = _first_by_label(lv, "du-e", "due", "declaración única", "declaracion unica", "declaración de exportación", "declaracion de exportacion")
            if not due and itinerary and ("BR" in str(itinerary) or "-" in str(itinerary)):
                due = itinerary
            shipping = {
                "doc_type":       _first_by_label(lv, "tipo de documento"),
                "transport_mode": _first_by_label(lv, "modo de transporte"),
                "freight_mode":   _first_by_label(lv, "modo de flete"),
                "dispatch_mode":  _first_by_label(lv, "gestión de despacho", "gestion de despacho"),
                "carrier":        _first_by_label(lv, "carrier"),
                "tracking":       _first_by_label(lv, "tracking"),
                "consolidation":  _first_by_label(lv, "consolidación", "consolidacion"),
                "dispatch_date":  _first_by_label(lv, "fecha de despacho"),
                "arrival_date":   _first_by_label(lv, "fecha de arrivo", "fecha de arribo"),
                "route":          _first_by_label(lv, "origen y destino", "ruta"),
                "due":            due,
            }

        # ── Packing List (título con 'packing') ──
        if ("packing" in title_l) and not packing:
            packing = {
                "cajas":      _first_by_label(lv, "cajas"),
                "peso_bruto": _first_by_label(lv, "peso bruto"),
                "peso_neto":  _first_by_label(lv, "peso neto"),
                "m3":         _first_by_label(lv, "metros cubicos", "metros cúbicos", "m³", "m3", "volumen"),
            }

        if shipping and packing:
            break

    return {"shipping": shipping, "packing": packing}
