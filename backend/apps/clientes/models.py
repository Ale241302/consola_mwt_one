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

    def calcular_consumo_credito_pool(self) -> Decimal:
        """Suma de credito_usado del pool (padre + subsidiarias activas)."""
        if self.is_parent:
            agg = Cliente.objects.filter(
                models.Q(id=self.id) |
                models.Q(parent_id=str(self.id), is_active=True)
            ).aggregate(t=models.Sum("credito_usado"))
            return Decimal(agg["t"] or 0)
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
            usado_self = Decimal(self.credito_usado or 0)
        else:
            parent = self.get_parent()
            limite = Decimal(parent.credito_aprobado or 0) if parent else Decimal(0)
            usado_pool = Decimal(self.credito_usado or 0)
            usado_self = usado_pool

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
