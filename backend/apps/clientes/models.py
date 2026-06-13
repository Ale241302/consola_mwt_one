"""apps.clientes.models — tabla `clientes.cliente` (SQL puro, Meta.managed=False)."""
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.db import models


class Cliente(models.Model):
    id               = models.UUIDField(primary_key=True)
    razon_social     = models.CharField(max_length=200, null=True, blank=True)
    nombre_comercial = models.CharField(max_length=160, null=True, blank=True)
    tax_id           = models.CharField(max_length=32,  null=True, blank=True)
    tipo             = models.CharField(max_length=16,  null=True, blank=True)
    segmento         = models.CharField(max_length=1, default="C")
    pais_iso2        = models.CharField(max_length=2,  null=True, blank=True)
    ciudad           = models.CharField(max_length=96, null=True, blank=True)
    direccion        = models.TextField(null=True, blank=True)
    moneda           = models.CharField(max_length=3, default="USD")
    credito_aprobado = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credito_usado    = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    dias_credito     = models.SmallIntegerField(default=0)
    contacto_nombre  = models.CharField(max_length=160, null=True, blank=True)
    contacto_email   = models.CharField(max_length=160, null=True, blank=True)
    contacto_tel     = models.CharField(max_length=32,  null=True, blank=True)
    estado           = models.CharField(max_length=16, default="ACTIVO")
    nodo_asignado_id = models.UUIDField(null=True, blank=True)          # sin FK
    responsable_id   = models.UUIDField(null=True, blank=True)          # sin FK
    visibility_tier  = models.CharField(max_length=16, default="INTERNAL")

    # Extensiones 93_schema_extensions.sql §4 (comerciales):
    codigo_marluvas   = models.CharField(max_length=32, null=True, blank=True)
    canal             = models.CharField(max_length=32, null=True, blank=True)
    incoterm          = models.CharField(max_length=8,  null=True, blank=True)
    medio_pago        = models.CharField(max_length=48, null=True, blank=True)
    direccion_entrega = models.TextField(null=True, blank=True)

    # Extensiones 32_clientes_extensions.sql (sprint Cliente M3b):
    cedula_juridica   = models.CharField(max_length=32, null=True, blank=True)
    comision_pct      = models.DecimalField(
        max_digits=6, decimal_places=4, null=True, blank=True,
    )   # CEO-ONLY — ver POL_VISIBILIDAD en serializers.

    # Extensión 33_clientes_parent_child.sql (sprint Parent-Child):
    # Self-referential UUID en texto plano. CERO FK física. NULL = top-level.
    # Validación 2 niveles en app layer (clean()) y serializer.
    parent_id         = models.CharField(max_length=36, null=True, blank=True)

    is_active        = models.BooleanField(default=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'clientes\".\"cliente'

    # ═════════════════════════════════════════════════════════════════
    # Parent-Child helpers (sprint Parent-Child · 2026-04-29)
    # ═════════════════════════════════════════════════════════════════
    @property
    def is_subsidiary(self) -> bool:
        """True si este cliente tiene un cliente padre."""
        return bool(self.parent_id)

    @property
    def is_parent(self) -> bool:
        """True si este cliente es top-level (puede tener subsidiarias)."""
        return not self.parent_id

    def get_parent(self):
        """Devuelve el cliente padre activo o None."""
        if not self.parent_id:
            return None
        return Cliente.objects.filter(id=self.parent_id, is_active=True).first()

    def get_subsidiaries(self):
        """QuerySet de subsidiarias ACTIVAS de este cliente.

        Solo retorna resultados si self es top-level (parent_id IS NULL);
        en una subsidiaria devuelve queryset vacío (anidación prohibida).
        """
        if not self.is_parent:
            return Cliente.objects.none()
        return Cliente.objects.filter(parent_id=str(self.id), is_active=True)

    def pool_ids(self) -> list:
        """IDs (str) que componen el pool de crédito.

        - Top-level: incluye al padre y a TODAS sus subsidiarias activas.
        - Subsidiaria: solo a sí misma (el cap operativo lo aplica el padre).
        """
        ids = [str(self.id)]
        if self.is_parent:
            ids.extend(str(s.id) for s in self.get_subsidiaries())
        return ids

    # ─────────────────────────────────────────────────────────────────
    # Sprint 2026-05-03 · CONSUMO DINÁMICO DE CRÉDITO
    # El campo persistido `credito_usado` queda obsoleto cuando se borra
    # o edita un expediente/sus líneas. Las funciones de abajo calculan
    # el consumo en VIVO sumando líneas activas de expedientes activos
    # del pool — misma fórmula que el wizard del portal en /portal/nueva-oc.
    #
    #   consumido = Σ qty * COALESCE(
    #       linea.unit_price,
    #       producto.especificaciones.client_prices[client_id],
    #       producto.precio_lista,
    #       0
    #   )
    #
    # Resultado:
    #   · Eliminar expediente → todas sus líneas dejan de sumar (con/sin SAP).
    #   · Eliminar/agregar producto → suma o resta automáticamente.
    #   · Cambios en proforma o discrepancias OC → recálculo inmediato.
    #   · Padre con subsidiarias → suma todo el pool.
    # ─────────────────────────────────────────────────────────────────
    def calcular_consumo_credito_pool(self) -> Decimal:
        """Crédito consumido en VIVO por el pool (padre + subsidiarias).

        Sprint 2026-05-06 · el crédito impacta al OPERADOR del expediente
        (e.operating_company_id), no al cliente final. Si operating_company_id
        es NULL (filas legacy pre-C0), fallback a e.client_id.
        """
        from django.db import connection
        ids = self.pool_ids() if self.is_parent else [str(self.id)]
        if not ids:
            return Decimal(0)
        try:
            with connection.cursor() as c:
                placeholders = ",".join(["%s"] * len(ids))
                c.execute(
                    f"""
                    SELECT COALESCE(SUM(
                        l.qty * COALESCE(
                            NULLIF(l.unit_price, 0),
                            CASE
                                WHEN p.especificaciones IS NOT NULL
                                 AND jsonb_typeof(p.especificaciones->'client_prices') = 'object'
                                 AND jsonb_typeof(p.especificaciones->'client_prices'->(e.client_id::text)) = 'number'
                                THEN (p.especificaciones->'client_prices'->>(e.client_id::text))::numeric
                                ELSE NULL
                            END,
                            NULLIF(p.precio_lista, 0),
                            0
                        )
                    ), 0)
                    FROM expedientes.linea l
                    INNER JOIN expedientes.expediente e
                            ON e.id = l.expediente_id
                           AND (
                             -- (a) Expediente vivo y CONFIRMADO (fuera de REGISTRO): todas sus
                             -- líneas activas cuentan. Sprint 2026-06-13 · una OC recién subida
                             -- por el portal (estado REGISTRO) NO consume crédito hasta que MWT
                             -- la confirma (pasa a PRODUCCION) o le asigna SAP.
                             (e.is_active = TRUE AND e.estado NOT IN ('CERRADO','CANCELADO','REGISTRO'))
                             OR
                             -- (a2) REGISTRO pero ya con SAP = compromiso real con fábrica → cuenta.
                             (e.is_active = TRUE AND e.estado = 'REGISTRO' AND l.sap IS NOT NULL AND l.sap <> '')
                             OR
                             -- (b) Expediente soft-deleted: SOLO las líneas con SAP siguen
                             -- consumiendo crédito (compromiso con fábrica). Sin SAP → libera.
                             (e.is_active = FALSE AND l.sap IS NOT NULL AND l.sap <> '')
                           )
                           -- Sprint 2026-05-06 · CONTADO no afecta crédito.
                           -- IS NULL = retro-compat con expedientes pre-fix (asumimos CREDITO).
                           AND (e.forma_pago = 'CREDITO' OR e.forma_pago IS NULL)
                    LEFT JOIN productos.producto p ON p.id = l.producto_id
                    WHERE l.is_active = TRUE
                      AND COALESCE(e.operating_company_id, e.client_id)::text IN ({placeholders})
                    """,
                    ids,
                )
                row = c.fetchone()
                return Decimal(row[0] or 0)
        except Exception:
            # Fallback al campo persistido si la BD aún no está migrada.
            if self.is_parent:
                agg = Cliente.objects.filter(
                    models.Q(id=self.id) |
                    models.Q(parent_id=str(self.id), is_active=True)
                ).aggregate(t=models.Sum("credito_usado"))
                return Decimal(agg["t"] or 0)
            return Decimal(self.credito_usado or 0)

    def calcular_credito_consumido(self) -> Decimal:
        """Crédito consumido SOLO por este cliente (sin pool consolidado).

        Sprint 2026-05-06 · el crédito impacta al OPERADOR del expediente
        (e.operating_company_id), no al cliente final. Si operating_company_id
        es NULL (filas legacy pre-C0), fallback a e.client_id.
        """
        from django.db import connection
        try:
            with connection.cursor() as c:
                c.execute(
                    """
                    SELECT COALESCE(SUM(
                        l.qty * COALESCE(
                            NULLIF(l.unit_price, 0),
                            CASE
                                WHEN p.especificaciones IS NOT NULL
                                 AND jsonb_typeof(p.especificaciones->'client_prices') = 'object'
                                 AND jsonb_typeof(p.especificaciones->'client_prices'->(e.client_id::text)) = 'number'
                                THEN (p.especificaciones->'client_prices'->>(e.client_id::text))::numeric
                                ELSE NULL
                            END,
                            NULLIF(p.precio_lista, 0),
                            0
                        )
                    ), 0)
                    FROM expedientes.linea l
                    INNER JOIN expedientes.expediente e
                            ON e.id = l.expediente_id
                           AND (
                             -- (a) Expediente vivo y CONFIRMADO (fuera de REGISTRO): todas sus
                             -- líneas activas cuentan. Sprint 2026-06-13 · una OC recién subida
                             -- por el portal (estado REGISTRO) NO consume crédito hasta que MWT
                             -- la confirma (pasa a PRODUCCION) o le asigna SAP.
                             (e.is_active = TRUE AND e.estado NOT IN ('CERRADO','CANCELADO','REGISTRO'))
                             OR
                             -- (a2) REGISTRO pero ya con SAP = compromiso real con fábrica → cuenta.
                             (e.is_active = TRUE AND e.estado = 'REGISTRO' AND l.sap IS NOT NULL AND l.sap <> '')
                             OR
                             -- (b) Expediente soft-deleted: SOLO las líneas con SAP siguen
                             -- consumiendo crédito (compromiso con fábrica). Sin SAP → libera.
                             (e.is_active = FALSE AND l.sap IS NOT NULL AND l.sap <> '')
                           )
                           -- Sprint 2026-05-06 · CONTADO no afecta crédito.
                           -- IS NULL = retro-compat con expedientes pre-fix (asumimos CREDITO).
                           AND (e.forma_pago = 'CREDITO' OR e.forma_pago IS NULL)
                    LEFT JOIN productos.producto p ON p.id = l.producto_id
                    WHERE l.is_active = TRUE
                      AND COALESCE(e.operating_company_id, e.client_id)::text = %s
                    """,
                    [str(self.id)],
                )
                row = c.fetchone()
                return Decimal(row[0] or 0)
        except Exception:
            return Decimal(self.credito_usado or 0)

    def calcular_kpis_consolidados(self) -> dict:
        """KPIs financieros del cliente.

        Reglas:
          · Padre: el límite es self.credito_aprobado (pool).
                   El consumo suma padre + subsidiarias.
          · Subsidiaria: el límite operativo es el del padre.
                         El consumo "individual" es self.credito_usado.

        El BACKEND es la fuente de verdad de estos números — el FE solo
        renderiza. Si Expedientes/Facturación todavía no tienen datos,
        los valores quedan en 0 sin romper el endpoint.
        """
        if self.is_parent:
            limite = Decimal(self.credito_aprobado or 0)
            usado_pool = self.calcular_consumo_credito_pool()
            usado_self = self.calcular_credito_consumido()
        else:
            parent = self.get_parent()
            limite = Decimal(parent.credito_aprobado or 0) if parent else Decimal(0)
            # Subsidiaria: el cap operativo lo aplica el padre (consumo del pool).
            usado_pool = parent.calcular_consumo_credito_pool() if parent else self.calcular_credito_consumido()
            usado_self = self.calcular_credito_consumido()

        disponible = max(Decimal(0), limite - usado_pool)
        tasa = float((usado_pool / limite) * 100) if limite > 0 else 0.0
        tasa = round(tasa, 2)

        return {
            "limite_credito":      float(limite),
            "credito_usado":       float(usado_pool),
            "credito_usado_self":  float(usado_self),
            "credito_disponible":  float(disponible),
            "tasa_utilizacion":    tasa,
            "credito_porcentaje":  int(round(tasa)),
            "is_parent":           self.is_parent,
            "is_subsidiary":       self.is_subsidiary,
            "subsidiarias_count":  self.get_subsidiaries().count() if self.is_parent else 0,
        }

    def clean(self):
        """Validación canónica de la regla 2 niveles.

        Se llama desde el serializer (`validate()`); duplicada aquí como
        red de seguridad si alguien usa el ORM directamente.
        """
        super().clean()
        if not self.parent_id:
            return
        if str(self.parent_id) == str(self.id):
            raise ValidationError(
                {"parent_id": "Un cliente no puede ser su propio padre."}
            )
        parent = Cliente.objects.filter(id=self.parent_id).first()
        if not parent:
            raise ValidationError(
                {"parent_id": "Cliente padre no encontrado."}
            )
        if parent.parent_id is not None:
            raise ValidationError(
                {"parent_id": "Anidación > 2 niveles prohibida. "
                              "El cliente seleccionado ya es subsidiaria."}
            )


class TipoCat(models.Model):
    codigo = models.CharField(max_length=16, primary_key=True)
    label  = models.CharField(max_length=64)
    orden  = models.SmallIntegerField(default=0)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"tipo_cat'
        ordering = ('orden',)


class EstadoCat(models.Model):
    codigo = models.CharField(max_length=16, primary_key=True)
    label  = models.CharField(max_length=64)
    color  = models.CharField(max_length=16, null=True, blank=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"estado_cat'


class SegmentoCat(models.Model):
    codigo = models.CharField(max_length=1, primary_key=True)
    label  = models.CharField(max_length=64)
    color  = models.CharField(max_length=16, null=True, blank=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"segmento_cat'


class CanalCat(models.Model):
    """Catálogo de canales — creado por 31_clientes_audit.sql."""
    codigo    = models.CharField(max_length=32, primary_key=True)
    label     = models.CharField(max_length=96)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"canal_cat'
        ordering = ('orden',)


class MedioPagoCat(models.Model):
    """Catálogo de medios de pago — creado por 31_clientes_audit.sql."""
    codigo    = models.CharField(max_length=48, primary_key=True)
    label     = models.CharField(max_length=96)
    orden     = models.IntegerField(default=100)
    is_active = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"medio_pago_cat'
        ordering = ('orden',)


class IncotermCat(models.Model):
    """Catálogo de incoterms — creado por 31_clientes_audit.sql."""
    codigo      = models.CharField(max_length=8, primary_key=True)
    label       = models.CharField(max_length=64)
    descripcion = models.TextField(null=True, blank=True)
    orden       = models.IntegerField(default=100)
    is_active   = models.BooleanField(default=True)
    class Meta:
        managed  = False
        db_table = 'clientes\".\"incoterm_cat'
        ordering = ('orden',)


class ClienteCreditSnapshot(models.Model):
    """Histórico auditable del semáforo de crédito — 31_clientes_audit.sql."""
    id                 = models.UUIDField(primary_key=True)
    cliente_id         = models.UUIDField()                        # ⛔ sin FK
    snapshot_date      = models.DateField()

    credito_aprobado   = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credito_usado      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credito_disponible = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tasa_utilizacion   = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    dias_mora_max      = models.IntegerField(default=0)
    facturas_vencidas  = models.IntegerField(default=0)
    monto_vencido_usd  = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    estado_semaforo    = models.CharField(max_length=16, default='VERDE')
    motivo             = models.TextField(null=True, blank=True)
    calculo_json       = models.JSONField(default=dict, blank=True)

    triggered_by       = models.UUIDField(null=True, blank=True)   # ⛔ sin FK
    source             = models.CharField(max_length=32, default='MANUAL')

    is_active          = models.BooleanField(default=True)
    created_at         = models.DateTimeField(auto_now_add=True)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        managed  = False
        db_table = 'clientes\".\"cliente_credit_snapshot'
        ordering = ('-snapshot_date', '-created_at')


# ════════════════════════════════════════════════════════════
# Credit Clock v2.0 — Fase 5A
# Tablas creadas por backend/sql/B8_finance_credit_clock.sql
# ════════════════════════════════════════════════════════════
class ClienteCreditConfig(models.Model):
    """Configuración del reloj de crédito por cliente.

    Defaults globales: 90 / 60 / 75. Premium 120/90/105, nuevos 60/40/50.
    Editado por CEO/ADMIN desde el perfil del cliente.
    """
    cliente_id           = models.UUIDField(primary_key=True)
    tope_dias            = models.PositiveIntegerField(default=90)
    umbral_amarillo_dias = models.PositiveIntegerField(default=60)
    umbral_rojo_dias     = models.PositiveIntegerField(default=75)
    bloqueo_automatico   = models.BooleanField(default=True)
    notas                = models.TextField(null=True, blank=True)
    updated_by           = models.UUIDField(null=True, blank=True)
    created_at           = models.DateTimeField()
    updated_at           = models.DateTimeField()

    class Meta:
        managed  = False
        db_table = 'clientes\".\"credit_config'


class ClienteCreditClock(models.Model):
    """Cache derivada del estado de crédito.

    Recomputada por CreditClockProjector cuando un Payment confirmado
    cambia el balance del cliente. Append-only de hecho via UPDATE
    (no se borra; siempre hay 1 fila por cliente).
    """
    cliente_id                    = models.UUIDField(primary_key=True)
    dias_credito_consumidos       = models.PositiveIntegerField(default=0)
    expedientes_abiertos_total    = models.IntegerField(default=0)
    expedientes_abiertos_amarillo = models.IntegerField(default=0)
    expedientes_abiertos_rojo     = models.IntegerField(default=0)
    monto_pendiente_usd           = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    bloqueado                     = models.BooleanField(default=False)
    bloqueo_reason                = models.CharField(max_length=64, null=True, blank=True)
    last_recalc_at                = models.DateTimeField()
    last_payment_id               = models.UUIDField(null=True, blank=True)
    updated_at                    = models.DateTimeField()

    class Meta:
        managed  = False
        db_table = 'clientes\".\"credit_clock'
