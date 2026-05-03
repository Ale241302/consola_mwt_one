"""
=====================================================================
MWT.ONE · apps.clientes.serializers
Agente responsable: [AG-BACKEND]

Sprint Cliente M3b — soporta la ficha B2B completa:
  · Datos base + SAP (codigo_marluvas, cedula_juridica)
  · Ubicación + entrega (pais_iso2, direccion_entrega)
  · Contacto principal (contacto_nombre/email/tel)
  · Condiciones comerciales (canal, incoterm, medio_pago, dias_credito)
  · Gobernanza financiera CEO-ONLY (credito_limit_usd, comision_pct)
  · Estado operativo (ACTIVO · PAUSADO · BLOQUEADO · INACTIVO)

POL_VISIBILIDAD · política aplicada aquí:
  - Los campos `credito_limit_usd` (alias de credito_aprobado) y
    `comision_pct` SÓLO son mutables por caller con role superadmin/admin.
  - Un CLIENT B2B o cualquier otro rol los verá como read_only en el GET
    y serán descartados silenciosamente si aparecen en el PATCH/PUT.
  - El dato se persiste igual en la BD (SQL no cambia); la restricción
    es a nivel serializer porque el front puede mostrarlos en modo
    lectura al CEO.

Validaciones:
  · codigo_marluvas: exactamente 10 dígitos numéricos si se envía.
  · dias_credito:    rango 0..180.
  · comision_pct:    rango 0..1 (0.085 = 8.5%).
=====================================================================
"""
from __future__ import annotations

import re
from rest_framework import serializers

from .models import Cliente, ClienteCreditSnapshot


# ─────────────────────────────────────────────────────────────────────
# Roles que pueden mutar campos CEO-ONLY
# ─────────────────────────────────────────────────────────────────────
_ADMIN_ROLES = {"superadmin", "admin"}

#: Campos CEO-ONLY — se silencian en payload y se marcan read_only para no-admin.
CEO_ONLY_FIELDS = ("credito_limit_usd", "comision_pct", "credito_aprobado")


def _is_admin_request(context) -> bool:
    """True si el caller del serializer es superadmin/admin.

    El ``context`` se inyecta desde el ViewSet:
      self.get_serializer(context={'request': request, ...})
    (DRF lo hace automáticamente en todos los ModelViewSet).
    """
    request = context.get("request") if context else None
    if request is None:
        return False
    user = getattr(request, "user", None)
    if not user:
        return False
    if getattr(user, "is_superuser", False):
        return True
    return (getattr(user, "role", "") or "").lower() in _ADMIN_ROLES


# ═════════════════════════════════════════════════════════════════════
# Serializer principal · full CRUD (Admin) + strip-down (CLIENT)
# ═════════════════════════════════════════════════════════════════════
class ClienteSerializer(serializers.ModelSerializer):
    """
    Serializer con POL_VISIBILIDAD.

    · Expone `credito_limit_usd` como alias de `credito_aprobado` (mapeo).
    · Si el caller NO es admin: los CEO_ONLY_FIELDS se marcan read_only.
    · Incluye `credito_disponible` y `tasa_utilizacion` derivados.
    """

    # Alias · el frontend usa credito_limit_usd (SAP naming),
    # la BD lo guarda en credito_aprobado (legacy).
    credito_limit_usd  = serializers.DecimalField(
        source="credito_aprobado",
        max_digits=14, decimal_places=2,
        required=False, allow_null=True,
    )

    # El estado ACTIVO/PAUSADO/BLOQUEADO/INACTIVO.
    # Alias semántico para que el frontend pueda usar `estado_operativo`.
    estado_operativo   = serializers.CharField(source="estado", required=False)

    # ── Campos opcionales explícitos ──
    # Filosofía MWT: "si el form no se lo pide al humano, BD/API no lo exigen".
    # El form `/clientes/nuevo` NO obliga a ningún campo de identidad/clasificación,
    # por eso aquí los marcamos required=False / allow_blank=True / allow_null=True.
    razon_social = serializers.CharField(max_length=200, required=False, allow_blank=True, allow_null=True)
    tax_id       = serializers.CharField(max_length=32,  required=False, allow_blank=True, allow_null=True)
    tipo         = serializers.CharField(max_length=16,  required=False, allow_blank=True, allow_null=True)
    pais_iso2    = serializers.CharField(max_length=2,   required=False, allow_blank=True, allow_null=True)
    ciudad       = serializers.CharField(max_length=96,  required=False, allow_blank=True, allow_null=True)
    direccion    = serializers.CharField(                 required=False, allow_blank=True, allow_null=True)

    # Sprint 2026-05-03 · CONSUMO DINÁMICO:
    # `credito_usado` ya no se lee del campo persistido (se queda obsoleto
    # cuando se borra/edita un expediente o sus líneas). Se calcula en VIVO
    # sumando líneas activas de expedientes activos del cliente — misma
    # fórmula que el wizard del portal en /portal/nueva-oc.
    credito_usado      = serializers.SerializerMethodField()
    credito_disponible = serializers.SerializerMethodField()
    tasa_utilizacion   = serializers.SerializerMethodField()

    # ── Parent-Child (sprint Parent-Child · 2026-04-29) ──
    # `parent_id` es el VARCHAR(36) que vive en la tabla; lo exponemos
    # tal cual para CRUD. `parent` es un dict de conveniencia que lee
    # el padre por joins en runtime (no rompe el "cero FK" porque es
    # una sola query adicional, no una relación física).
    parent              = serializers.SerializerMethodField()
    is_parent           = serializers.BooleanField(read_only=True)
    is_subsidiary       = serializers.BooleanField(read_only=True)
    subsidiarias_count  = serializers.SerializerMethodField()
    kpis_pool           = serializers.SerializerMethodField()

    class Meta:
        model  = Cliente
        fields = (
            # Identidad
            "id", "razon_social", "nombre_comercial", "tax_id",
            "codigo_marluvas", "cedula_juridica",
            # Clasificación
            "tipo", "segmento",
            # Parent-Child
            "parent_id", "parent", "is_parent", "is_subsidiary",
            "subsidiarias_count",
            # Ubicación
            "pais_iso2", "ciudad", "direccion", "direccion_entrega",
            # Contacto
            "contacto_nombre", "contacto_email", "contacto_tel",
            # Comercial
            "canal", "incoterm", "medio_pago", "dias_credito",
            "moneda",
            # CEO-ONLY
            "credito_limit_usd",         # ← alias credito_aprobado
            "credito_aprobado",           # ← dejamos expuesto para compat legacy
            "credito_usado",
            "credito_disponible", "tasa_utilizacion",
            "kpis_pool",                 # ← consolidación padre + subsidiarias
            "comision_pct",
            # Estado
            "estado", "estado_operativo",
            # Asignación interna
            "nodo_asignado_id", "responsable_id",
            "visibility_tier",
            # Auditoría
            "is_active", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "created_at", "updated_at",
            "credito_disponible", "tasa_utilizacion",
            "credito_usado",
            "parent", "is_parent", "is_subsidiary",
            "subsidiarias_count", "kpis_pool",
        )

    # ── POL_VISIBILIDAD · gate CEO-ONLY ────────────────────────
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not _is_admin_request(self.context):
            # Marcar CEO_ONLY_FIELDS como read_only para no-admin.
            # Aún los ven en el GET (Frontend los mostrará si el role
            # context también lo permite), pero no los pueden modificar.
            for field_name in CEO_ONLY_FIELDS:
                if field_name in self.fields:
                    self.fields[field_name].read_only = True

    # ── Validaciones de campos ─────────────────────────────────
    def validate_codigo_marluvas(self, value):
        """Exactamente 10 dígitos numéricos si se envía."""
        if value in (None, "", 0):
            return None
        value = str(value).strip()
        if not re.fullmatch(r"\d{10}", value):
            raise serializers.ValidationError(
                "codigo_marluvas debe tener exactamente 10 dígitos numéricos."
            )
        return value

    def validate_dias_credito(self, value):
        """Rango 0..180."""
        if value is None:
            return None
        v = int(value)
        if v < 0 or v > 180:
            raise serializers.ValidationError(
                "dias_credito debe estar entre 0 y 180."
            )
        return v

    def validate_comision_pct(self, value):
        """Rango 0..0.9999 (decimal, 0.085 = 8.5%)."""
        if value is None:
            return None
        v = float(value)
        if v < 0 or v > 0.9999:
            raise serializers.ValidationError(
                "comision_pct debe ser un decimal entre 0 y 0.9999 (0.085 = 8.5%)."
            )
        return value

    def validate_estado(self, value):
        """Enum canónico."""
        if value is None:
            return None
        allowed = {"ACTIVO", "PAUSADO", "BLOQUEADO", "INACTIVO"}
        v = str(value).upper()
        if v not in allowed:
            raise serializers.ValidationError(
                f"estado inválido. Valores permitidos: {sorted(allowed)}."
            )
        return v

    def validate_pais_iso2(self, value):
        """ISO-3166 alpha-2 en mayúsculas (CR, BR, CL, PE, MX, etc.)."""
        if value is None:
            return None
        v = str(value).strip().upper()
        if not re.fullmatch(r"[A-Z]{2}", v):
            raise serializers.ValidationError(
                "pais_iso2 debe ser código ISO-3166 alpha-2 (2 letras mayúsculas)."
            )
        return v

    def validate(self, attrs):
        """POL_VISIBILIDAD · defensa en profundidad.

        Aunque `__init__` ya marca los campos como read_only para
        no-admin, DRF permite que campos read_only lleguen al payload
        (solo los ignora en save). Aquí los eliminamos explícitamente
        como defensa adicional y dejamos un log (WARNING) si un CLIENT
        intentó modificarlos — señal de escalamiento malicioso.
        """
        if not _is_admin_request(self.context):
            leaked = [f for f in CEO_ONLY_FIELDS if f in attrs]
            if leaked:
                import logging
                log = logging.getLogger(__name__)
                request = self.context.get("request")
                log.warning(
                    "POL_VISIBILIDAD: CLIENT intentó modificar campos CEO-ONLY: %s · "
                    "email=%s role=%s path=%s",
                    leaked,
                    getattr(getattr(request, "user", None), "email", "?"),
                    getattr(getattr(request, "user", None), "role", "?"),
                    getattr(request, "path", "?"),
                )
                for f in leaked:
                    attrs.pop(f, None)
        return attrs

    # ── Derivados (sprint 2026-05-03 · consumo dinámico) ────────
    def _consumo_pool(self, o):
        """Cachea el cómputo dinámico por instancia de serializer.

        Para listings (many=True), DRF reutiliza el child serializer
        a través de las filas → cache acumulado evita 3 queries por fila.
        """
        cache = getattr(self, "_cached_consumo", None) or {}
        key = str(o.id)
        if key in cache:
            return cache[key]
        valor = float(o.calcular_consumo_credito_pool())
        cache[key] = valor
        self._cached_consumo = cache
        return valor

    def get_credito_usado(self, o):
        return self._consumo_pool(o)

    def get_credito_disponible(self, o):
        return max(0.0, float(o.credito_aprobado or 0) - self._consumo_pool(o))

    def get_tasa_utilizacion(self, o):
        aprobado = float(o.credito_aprobado or 0)
        usado    = self._consumo_pool(o)
        return round((usado / aprobado) * 100, 2) if aprobado > 0 else 0.0

    # ── Parent-Child resolvers (sprint Parent-Child) ───────────
    def get_parent(self, o):
        p = o.get_parent()
        if not p:
            return None
        return {
            "id":           str(p.id),
            "razon_social": p.razon_social or p.nombre_comercial or "",
            "nombre_comercial": p.nombre_comercial,
        }

    def get_subsidiarias_count(self, o):
        return o.get_subsidiaries().count() if o.is_parent else 0

    def get_kpis_pool(self, o):
        """KPIs financieros consolidados (padre + subsidiarias activas).

        El front-end usa este dict para renderizar los KPIs del header
        de la ficha de cliente. Si la entidad es subsidiaria, los valores
        reflejan el pool del PADRE (límite operativo compartido).
        """
        return o.calcular_kpis_consolidados()

    # ── Validación parent_id (regla 2 niveles) ─────────────────
    def validate_parent_id(self, value):
        """Anidación máxima 2 niveles + chequeo de existencia."""
        if value in (None, "", 0):
            return None
        v = str(value).strip()
        # Auto-referencia (en update; en create id aún no existe)
        if self.instance and str(self.instance.id) == v:
            raise serializers.ValidationError(
                "Un cliente no puede ser su propio padre."
            )
        parent = Cliente.objects.filter(id=v).first()
        if not parent:
            raise serializers.ValidationError(
                "Cliente padre no encontrado."
            )
        if parent.parent_id is not None:
            raise serializers.ValidationError(
                "Anidación > 2 niveles prohibida. "
                "El cliente seleccionado ya es subsidiaria."
            )
        if not parent.is_active:
            raise serializers.ValidationError(
                "El cliente padre está inactivo."
            )
        return v


# ═════════════════════════════════════════════════════════════════════
# Lista ligera para el grid (Clientes.jsx) y para subsidiarias
# ═════════════════════════════════════════════════════════════════════
class ClienteListSerializer(serializers.ModelSerializer):
    """Versión ligera · no expone comision_pct en el listado.

    Incluye `parent_id` y `subsidiarias_count` para que el dashboard y
    el grid de subsidiarias compartan el mismo serializer.
    """
    # Sprint 2026-05-03 · CONSUMO DINÁMICO (mismo enfoque que ClienteSerializer)
    credito_usado      = serializers.SerializerMethodField()
    credito_disponible = serializers.SerializerMethodField()
    tasa_utilizacion   = serializers.SerializerMethodField()
    credito_limit_usd  = serializers.DecimalField(
        source="credito_aprobado",
        max_digits=14, decimal_places=2,
        required=False, allow_null=True,
    )
    is_parent          = serializers.BooleanField(read_only=True)
    is_subsidiary      = serializers.BooleanField(read_only=True)
    subsidiarias_count = serializers.SerializerMethodField()
    expedientes_activos = serializers.SerializerMethodField()

    class Meta:
        model  = Cliente
        fields = (
            "id", "razon_social", "nombre_comercial", "tax_id",
            "codigo_marluvas", "cedula_juridica",
            "tipo", "segmento", "pais_iso2", "ciudad",
            "estado",
            # Parent-Child
            "parent_id", "is_parent", "is_subsidiary", "subsidiarias_count",
            # Crédito
            "credito_aprobado", "credito_limit_usd", "credito_usado",
            "credito_disponible", "tasa_utilizacion", "dias_credito",
            # Asignación
            "nodo_asignado_id", "responsable_id",
            # Comercial
            "canal", "incoterm", "medio_pago",
            "contacto_nombre", "contacto_email",
            "direccion_entrega",
            # Stats
            "expedientes_activos",
            "is_active", "updated_at",
        )

    def _consumo_pool(self, o):
        cache = getattr(self, "_cached_consumo", None) or {}
        key = str(o.id)
        if key in cache:
            return cache[key]
        valor = float(o.calcular_consumo_credito_pool())
        cache[key] = valor
        self._cached_consumo = cache
        return valor

    def get_credito_usado(self, o):
        return self._consumo_pool(o)

    def get_credito_disponible(self, o):
        return max(0.0, float(o.credito_aprobado or 0) - self._consumo_pool(o))

    def get_tasa_utilizacion(self, o):
        aprobado = float(o.credito_aprobado or 0)
        usado    = self._consumo_pool(o)
        return round((usado / aprobado) * 100, 2) if aprobado > 0 else 0.0

    def get_subsidiarias_count(self, o):
        return o.get_subsidiaries().count() if o.is_parent else 0

    def get_expedientes_activos(self, o):
        """Cuenta de expedientes abiertos del cliente (raw SQL — sin FK).

        En padre cuenta padre + subsidiarias (pool consolidado).

        Sprint 2026-05-03 · BUGFIX: la columna real en expedientes.expediente
        es ``client_id`` (antes filtrábamos por ``cliente_id`` que nunca
        existió → la query rompía y siempre devolvía 0). Añadido también
        el filtro ``is_active = TRUE`` para no contar expedientes borrados.
        """
        from django.db import connection
        ids = o.pool_ids() if o.is_parent else [str(o.id)]
        if not ids:
            return 0
        try:
            with connection.cursor() as c:
                placeholders = ",".join(["%s"] * len(ids))
                c.execute(
                    f"SELECT COUNT(*) FROM expedientes.expediente "
                    f"WHERE client_id::text IN ({placeholders}) "
                    f"AND is_active = TRUE "
                    f"AND estado NOT IN ('CERRADO','CANCELADO')",
                    ids,
                )
                return int(c.fetchone()[0] or 0)
        except Exception:
            return 0


# ═════════════════════════════════════════════════════════════════════
# Snapshot semáforo de crédito
# ═════════════════════════════════════════════════════════════════════
class ClienteCreditSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ClienteCreditSnapshot
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
