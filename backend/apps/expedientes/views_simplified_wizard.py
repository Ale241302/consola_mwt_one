"""
=====================================================================
MWT.ONE · apps.expedientes.views_simplified_wizard
Agente responsable: [AG-BACKEND]

Sprint Wizard Simplificado · 2026-04-29.

Endpoints del nuevo wizard de 3 pasos:
  · POST /api/expedientes/parse-template/    → CSV/Excel → JSON validado vs CPA
  · POST /api/catalog/request-assignment/    → email al account manager
                                                con fallback a info@mwt.one

NO toca el endpoint principal POST /api/expedientes/. La relajación de
campos opcionales (marca/mode/currency/freight_mode) ya vive en el
serializer existente con required=False (ver `views_wizard.py` o
`serializers.py` según corresponda).

POL_VISIBILIDAD: ZERO datos financieros en respuestas de estos endpoints.
=====================================================================
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
import uuid
from datetime import date

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import connection
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

log = logging.getLogger(__name__)

# Configuración por defecto (overrideable vía env)
FALLBACK_TO = os.environ.get("CATALOG_REQUEST_FALLBACK_TO", "info@mwt.one")
DEFAULT_FROM = os.environ.get("DEFAULT_FROM_EMAIL", "info@mwt.one")
ADMIN_BASE_URL = os.environ.get("MWT_ADMIN_BASE_URL", "https://consola.mwt.one")


# =====================================================================
# Helpers
# =====================================================================
def _norm_sku(s):
    return (s or "").strip().upper()


def _norm_size(s):
    return (s or "").strip().upper()


def _safe_int(v, default=0):
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return default


def _read_template_rows(file_bytes: bytes, filename: str) -> list[dict]:
    """Lee CSV o XLSX/XLS y devuelve lista de dicts {sku, talla, cantidad}.

    Espera 3 columnas FIJAS por orden o por nombre (case-insensitive):
       SKU | Talla | Cantidad
    """
    name = (filename or "").lower()
    rows = []

    # ── XLSX / XLS via openpyxl ──
    if name.endswith(".xlsx") or name.endswith(".xlsm"):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise RuntimeError("openpyxl no instalado en el backend.")
        wb = load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
        ws = wb.active
        header = None
        for r_idx, row in enumerate(ws.iter_rows(values_only=True)):
            if r_idx == 0:
                header = [(c or "").strip().lower() if isinstance(c, str) else str(c or "").lower()
                          for c in row]
                continue
            d = _row_to_dict(row, header)
            if d:
                rows.append(d)
        return rows

    # ── CSV ──
    text = None
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = file_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise RuntimeError("No pude decodificar el archivo (utf-8 / latin-1).")

    # Saltar directiva Excel `sep=;` si está presente en la primera línea.
    # Microsoft Excel respeta este prefijo para forzar el separador
    # independientemente del locale (MX/CO/PE/ES usan `;`). El parser CSV
    # de Python no la entiende, por eso la quitamos antes de pasarla al
    # Sniffer para que detecte el delimitador real.
    text_for_parsing = text
    first_line = text.split("\n", 1)[0].strip().lower() if text else ""
    if first_line.startswith("sep="):
        text_for_parsing = text.split("\n", 1)[1] if "\n" in text else ""

    # Detectar separador
    sniffer = csv.Sniffer()
    sample = text_for_parsing[:2048]
    try:
        dialect = sniffer.sniff(sample, delimiters=",;|\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text_for_parsing), dialect=dialect)
    header = None
    for r_idx, row in enumerate(reader):
        if not row or all((c or "").strip() == "" for c in row):
            continue
        if header is None:
            header = [(c or "").strip().lower() for c in row]
            continue
        d = _row_to_dict(row, header)
        if d:
            rows.append(d)
    return rows


def _row_to_dict(row, header):
    """Map flexible: nombre conocido O posición."""
    if not row:
        return None
    if header and any(h in ("sku", "talla", "cantidad", "size", "qty", "quantity") for h in header):
        idx_sku   = next((i for i, h in enumerate(header) if h in ("sku", "codigo", "código", "code")), 0)
        idx_size  = next((i for i, h in enumerate(header) if h in ("talla", "size", "tamaño")), 1)
        idx_qty   = next((i for i, h in enumerate(header) if h in ("cantidad", "qty", "quantity", "unidades", "units")), 2)
    else:
        idx_sku, idx_size, idx_qty = 0, 1, 2

    try:
        sku  = _norm_sku(row[idx_sku])
        size = _norm_size(row[idx_size])
        qty  = _safe_int(row[idx_qty], 0)
    except IndexError:
        return None
    if not sku or qty <= 0:
        return None
    return {"sku": sku, "talla": size, "cantidad": qty}


def _resolve_account_manager_email(client_id):
    """Devuelve email del Account Manager del cliente, o (None) si no se puede.

    Lógica:
      1. cliente.responsable_id → core.users.email (si la tabla existe)
      2. fallback NULL → caller usa FALLBACK_TO.
    """
    if not client_id:
        return None, None
    try:
        with connection.cursor() as c:
            c.execute("""
                SELECT cl.responsable_id, cl.razon_social, cl.contacto_nombre,
                       cl.contacto_email
                  FROM clientes.cliente cl
                 WHERE cl.id = %s
            """, [str(client_id)])
            row = c.fetchone()
            if not row:
                return None, None
            resp_id, razon_social, contacto_nombre, contacto_email = row

            am_email = None
            am_name = None
            if resp_id:
                # core.users (Sprint M3)
                try:
                    c.execute("""
                        SELECT email, full_name FROM core.users
                         WHERE id = %s AND is_active = TRUE
                    """, [str(resp_id)])
                    user_row = c.fetchone()
                    if user_row:
                        am_email, am_name = user_row[0], user_row[1]
                except Exception:
                    # core.users puede no existir en builds viejos
                    pass

            return (am_email or contacto_email or None,
                    am_name or contacto_nombre or razon_social or "")
    except Exception:
        log.exception("[catalog/request_assignment] resolve AM falló")
        return None, None


# =====================================================================
# /api/expedientes/parse-template/
# =====================================================================
class ParseTemplateView(APIView):
    """POST multipart con `file` + form `client_id`.

    Devuelve:
      {
        "lines": [
          {"sku":"...", "talla":"...", "cantidad":12,
           "is_assigned": true|false,
           "product_label":"...",
           "producto_id":"...",
           "row":  3 },
          ...
        ],
        "summary": {
          "total_rows":         42,
          "valid_rows":         40,
          "assigned_rows":      37,
          "unassigned_rows":     3,
          "client_id":         "...",
          "client_label":      "..."
        },
        "unassigned_skus": ["NIK-AIR-001", "ADI-PRO-002"],
        "errors": []
      }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        f = request.FILES.get("file") or request.FILES.get("upload")
        if not f:
            return Response({"detail": "Falta el archivo (`file`)."}, status=400)
        if f.size > 10 * 1024 * 1024:
            return Response({"detail": "Archivo > 10MB."}, status=413)

        client_id = (request.data.get("client_id") or "").strip()
        if not client_id:
            return Response({"detail": "client_id requerido para validar CPA."}, status=400)

        # Parse
        try:
            rows = _read_template_rows(f.read(), f.name)
        except Exception as e:
            return Response({"detail": f"No pude parsear el archivo: {e}"}, status=400)

        if not rows:
            return Response({
                "lines":            [],
                "summary":          {"total_rows": 0, "valid_rows": 0,
                                     "assigned_rows": 0, "unassigned_rows": 0,
                                     "client_id": client_id, "client_label": ""},
                "unassigned_skus":  [],
                "errors":           ["Archivo vacío o sin líneas válidas."],
            }, status=200)

        # Snapshot del cliente
        client_label = ""
        try:
            with connection.cursor() as c:
                c.execute(
                    "SELECT razon_social FROM clientes.cliente WHERE id = %s",
                    [client_id],
                )
                r = c.fetchone()
                if r:
                    client_label = r[0] or ""
        except Exception:
            pass

        # SKUs únicos para el lookup CPA
        unique_skus = list({r["sku"] for r in rows if r.get("sku")})
        assignment_skus = set()
        product_meta = {}
        if unique_skus:
            try:
                with connection.cursor() as c:
                    # CPA → solo SKUs activos asignados al cliente
                    c.execute("""
                        SELECT brand_sku
                          FROM pricing.client_assignment
                         WHERE client_id = %s
                           AND is_active = TRUE
                           AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
                           AND brand_sku = ANY(%s)
                    """, [client_id, unique_skus])
                    assignment_skus = {row[0] for row in c.fetchall()}
            except Exception:
                log.exception("[parse_template] CPA lookup falló")

            try:
                with connection.cursor() as c:
                    c.execute("""
                        SELECT id, sku, nombre
                          FROM productos.producto
                         WHERE sku = ANY(%s)
                    """, [unique_skus])
                    for row in c.fetchall():
                        product_meta[row[1]] = {
                            "producto_id":   str(row[0]),
                            "product_label": row[2] or "",
                        }
            except Exception:
                pass

        out_lines = []
        unassigned = []
        for i, r in enumerate(rows):
            is_assigned = r["sku"] in assignment_skus
            if not is_assigned and r["sku"] not in unassigned:
                unassigned.append(r["sku"])
            meta = product_meta.get(r["sku"]) or {}
            out_lines.append({
                "row":           i + 2,           # +2 = header + 1-based
                "sku":           r["sku"],
                "talla":         r["talla"],
                "cantidad":      r["cantidad"],
                "is_assigned":   is_assigned,
                "producto_id":   meta.get("producto_id"),
                "product_label": meta.get("product_label"),
            })

        return Response({
            "lines":           out_lines,
            "summary": {
                "total_rows":      len(rows),
                "valid_rows":      len(out_lines),
                "assigned_rows":   len([l for l in out_lines if l["is_assigned"]]),
                "unassigned_rows": len([l for l in out_lines if not l["is_assigned"]]),
                "client_id":       client_id,
                "client_label":    client_label,
            },
            "unassigned_skus": unassigned,
            "errors":          [],
        })


# =====================================================================
# /api/catalog/request-assignment/
# =====================================================================
class CatalogRequestAssignmentView(APIView):
    """POST {client_id, sku, talla?, cantidad?, client_email?}

    Resuelve el destinatario:
      1. responsable_id del cliente → core.users.email
      2. fallback: clientes.cliente.contacto_email
      3. fallback final: info@mwt.one (env CATALOG_REQUEST_FALLBACK_TO)

    Devuelve:
      {ok: true, sent_to: "...", subject: "...", fallback_used: bool}
    """
    permission_classes = [IsAuthenticated]

    EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

    def post(self, request):
        d = request.data or {}
        client_id = (d.get("client_id") or "").strip()
        sku       = _norm_sku(d.get("sku"))
        talla     = _norm_size(d.get("talla"))
        cantidad  = _safe_int(d.get("cantidad"), 0)
        client_email = (d.get("client_email") or "").strip()

        if not client_id or not sku:
            return Response({"detail": "client_id y sku requeridos."}, status=400)

        # Resolver destinatario
        am_email, am_name = _resolve_account_manager_email(client_id)
        fallback_used = False
        if not am_email or not self.EMAIL_RE.match(am_email):
            am_email = FALLBACK_TO
            am_name  = "Equipo MWT"
            fallback_used = True

        # Cliente metadata
        client_label = ""
        client_contact_email = ""
        try:
            with connection.cursor() as c:
                c.execute("""
                    SELECT razon_social, contacto_email FROM clientes.cliente WHERE id = %s
                """, [client_id])
                row = c.fetchone()
                if row:
                    client_label = row[0] or ""
                    client_contact_email = row[1] or ""
        except Exception:
            pass

        if not client_email:
            client_email = client_contact_email

        # Buscar producto / brand para el link
        product_label = ""
        producto_id = None
        brand_id = None
        try:
            with connection.cursor() as c:
                c.execute("""
                    SELECT id, nombre, marca_id FROM productos.producto WHERE sku = %s LIMIT 1
                """, [sku])
                pr = c.fetchone()
                if pr:
                    producto_id, product_label, brand_id = str(pr[0]), pr[1] or "", pr[2]
        except Exception:
            pass

        link_admin = (
            f"{ADMIN_BASE_URL}/marcas/{brand_id}/clientes/{client_id}/precios"
            if brand_id else
            f"{ADMIN_BASE_URL}/clientes/{client_id}"
        )

        # Componer email
        subject = f"[MWT.ONE] Solicitud de asignación de SKU {sku} — {client_label}"
        text_body = (
            f"Hola {am_name or ''},\n\n"
            f"El cliente {client_label}"
            + (f" ({client_email})" if client_email else "")
            + " ha solicitado acceso al siguiente producto:\n\n"
            f"  · SKU:      {sku}\n"
            f"  · Producto: {product_label or '—'}\n"
            f"  · Talla:    {talla or '—'}\n"
            f"  · Cantidad: {cantidad or '—'}\n\n"
            f"Para autorizar y asignar el SKU al cliente, abrí la siguiente vista:\n"
            f"  {link_admin}\n\n"
            f"— MWT.ONE · Catálogo Comercial"
        )
        html_body = f"""
        <div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#0B1E3A;
                    max-width:600px;margin:0 auto;padding:24px;
                    background:#F8FAFC;border-radius:12px">
          <div style="background:#0B1E3A;color:#fff;padding:16px 20px;border-radius:10px;
                      margin-bottom:18px">
            <div style="font-size:11px;color:#1DE394;letter-spacing:1.5px;font-weight:700">
              SOLICITUD DE ASIGNACIÓN DE SKU
            </div>
            <div style="font-size:18px;font-weight:700;margin-top:4px">{client_label}</div>
          </div>

          <p>Hola <strong>{am_name or ''}</strong>,</p>
          <p>Tu cliente <strong>{client_label}</strong>
             {f"(<a href='mailto:{client_email}'>{client_email}</a>)" if client_email else ""}
             solicita acceso al siguiente producto:</p>

          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#64748B;font-size:11px;
                           text-transform:uppercase;letter-spacing:0.5px">SKU</td>
                <td style="padding:8px;font-weight:700;font-family:monospace">{sku}</td></tr>
            <tr><td style="padding:8px;color:#64748B;font-size:11px;
                           text-transform:uppercase;letter-spacing:0.5px">Producto</td>
                <td style="padding:8px">{product_label or '—'}</td></tr>
            <tr><td style="padding:8px;color:#64748B;font-size:11px;
                           text-transform:uppercase;letter-spacing:0.5px">Talla</td>
                <td style="padding:8px">{talla or '—'}</td></tr>
            <tr><td style="padding:8px;color:#64748B;font-size:11px;
                           text-transform:uppercase;letter-spacing:0.5px">Cantidad</td>
                <td style="padding:8px;font-weight:600">{cantidad or '—'}</td></tr>
          </table>

          <a href="{link_admin}"
             style="display:inline-block;background:#00B286;color:#fff;text-decoration:none;
                    padding:12px 22px;border-radius:8px;font-weight:700;letter-spacing:0.3px">
            Autorizar / Asignar SKU →
          </a>

          <p style="margin-top:24px;color:#64748B;font-size:12px">
            Este mensaje fue generado automáticamente por MWT.ONE. No respondas a este correo.
          </p>
        </div>
        """

        try:
            msg = EmailMultiAlternatives(
                subject = subject,
                body    = text_body,
                from_email = DEFAULT_FROM,
                to      = [am_email],
                reply_to = [client_email] if client_email else None,
            )
            msg.attach_alternative(html_body, "text/html")
            msg.send(fail_silently=False)
        except Exception as e:
            log.exception("[catalog/request_assignment] envío SMTP falló")
            return Response({
                "detail": f"No pude enviar el email: {type(e).__name__}: {e}",
                "sent_to": am_email,
                "fallback_used": fallback_used,
            }, status=500)

        return Response({
            "ok":            True,
            "sent_to":       am_email,
            "sent_to_name":  am_name,
            "subject":       subject,
            "fallback_used": fallback_used,
            "link_admin":    link_admin,
        })
