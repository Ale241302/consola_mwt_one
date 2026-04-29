"""
=====================================================================
MWT.ONE · apps.commercial.views
Agente responsable: [AG-BACKEND]

ViewSets + endpoint crítico `resolve_client_price`.

Recursos REST:
  · /api/commercial/pricelist-versions/     (CRUD)
  · /api/commercial/grade-items/            (CRUD · cost_usd enmascarado si ≠ CEO)
  · /api/commercial/client-assignments/     (CRUD · CPA)
  · /api/commercial/early-payment-policies/ (CRUD)
  · /api/commercial/early-payment-tiers/    (CRUD)
  · /api/commercial/commission-rules/       (CEO-ONLY · CRUD)
  · /api/commercial/catalogs/currencies/    (read-only)
  · /api/commercial/catalogs/sources/       (read-only)
  · /api/commercial/catalogs/commission-bases/ (read-only)

Endpoints de negocio:
  · POST /api/commercial/resolve_client_price/  → waterfall (CPA → MIN pricelist → EPP tier)
  · POST /api/commercial/pricelist-versions/<id>/bulk-upsert-items/
        → carga masiva de grade_items desde un Excel pre-parseado (JSON)

Reglas MWT:
  · CEO-ONLY: cost_usd / margenes / commission_rule completa NO llegan a CLIENT.
  · Idempotencia: CRUD usa _ensure_uuid() para auto-asignar UUID.
  · Soft-delete: DELETE hace is_active=False.
=====================================================================
"""
import uuid
import logging
from decimal import Decimal

from django.db import transaction, connection
from django.db.models import Q, Case, When, Value, IntegerField
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .models import (
    PriceListVersion, GradeItem, ClientAssignment,
    EarlyPaymentPolicy, EarlyPaymentTier, CommissionRule,
    CurrencyCat, PriceListSourceCat, CommissionBaseCat,
)
from .serializers import (
    PriceListVersionSerializer, PriceListVersionListSerializer,
    GradeItemSerializer, GradeItemPublicSerializer,
    ClientAssignmentSerializer,
    EarlyPaymentPolicySerializer, EarlyPaymentTierSerializer,
    CommissionRuleSerializer,
    CurrencyCatSerializer, PriceListSourceCatSerializer,
    CommissionBaseCatSerializer,
    ResolveClientPriceInputSerializer, ResolveClientPriceOutputSerializer,
)

log = logging.getLogger(__name__)


# =====================================================================
# Helpers
# =====================================================================
CEO_ROLES = {"admin", "superadmin", "ceo"}


def _is_ceo(request) -> bool:
    """True si el JWT trae un role CEO-like (admin/superadmin/ceo)."""
    if not request or not getattr(request, "auth", None):
        return False
    role = (request.auth.get("role") or "").lower()
    return role in CEO_ROLES


def _ensure_uuid(data: dict) -> dict:
    if not data.get("id"):
        data["id"] = str(uuid.uuid4())
    return data


def _request_data_copy(request):
    if hasattr(request.data, "copy"):
        return request.data.copy()
    return dict(request.data)


def _sum_size_multipliers(size_multipliers: dict) -> int:
    if not isinstance(size_multipliers, dict):
        return 0
    total = 0
    for v in size_multipliers.values():
        try:
            total += int(v)
        except (TypeError, ValueError):
            continue
    return total


# =====================================================================
# PriceListVersion ViewSet
# =====================================================================
class PriceListVersionViewSet(viewsets.ModelViewSet):
    queryset = PriceListVersion.objects.filter(is_active=True)
    serializer_class = PriceListVersionSerializer

    def get_serializer_class(self):
        if self.action == "list":
            return PriceListVersionListSerializer
        return PriceListVersionSerializer

    def get_queryset(self):
        qs = PriceListVersion.objects.filter(is_active=True)
        brand_id = self.request.query_params.get("brand_id")
        source   = self.request.query_params.get("source")
        q        = self.request.query_params.get("q")
        if brand_id:
            qs = qs.filter(brand_id=brand_id)
        if source:
            qs = qs.filter(source=source)
        if q:
            qs = qs.filter(nombre__icontains=q) | qs.filter(codigo__icontains=q)
        return qs.order_by("-valid_from", "codigo")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    # ── POST /api/commercial/pricelist-versions/<id>/bulk-upsert-items/ ─
    @action(detail=True, methods=["post"], url_path="bulk-upsert-items")
    def bulk_upsert_items(self, request, pk=None):
        """Carga masiva de grade_items desde un Excel ya parseado a JSON.

        Payload:
          {
            "items": [
              {
                "product_sku": "NIK-AIR-001",
                "product_name": "Air Max 001",
                "unit_price_usd": 42.50,
                "cost_usd": 18.20,                  # CEO-ONLY, opcional
                "size_multipliers": {"37": 2, "38": 4, "39": 6},
                "tags": ["ss26"],
                "metadata": {}
              },
              ...
            ],
            "replace_existing": true   # default false (upsert)
          }
        """
        try:
            plv = PriceListVersion.objects.get(pk=pk, is_active=True)
        except PriceListVersion.DoesNotExist:
            return Response({"detail": "PriceListVersion no encontrada."},
                            status=status.HTTP_404_NOT_FOUND)

        data = _request_data_copy(request)
        items = data.get("items") or []
        if not isinstance(items, list) or not items:
            return Response({"detail": "items[] vacío."},
                            status=status.HTTP_400_BAD_REQUEST)
        replace_existing = bool(data.get("replace_existing", False))

        created = 0
        updated = 0
        errors  = []

        with transaction.atomic():
            if replace_existing:
                GradeItem.objects.filter(
                    pricelist_version_id=plv.id, is_active=True
                ).update(is_active=False)

            for raw in items:
                sku = (raw.get("product_sku") or "").strip()
                if not sku:
                    errors.append({"row": raw, "error": "product_sku vacío"})
                    continue
                try:
                    unit_price = Decimal(str(raw.get("unit_price_usd", 0)))
                except Exception:
                    errors.append({"row": raw, "error": "unit_price_usd inválido"})
                    continue
                cost = raw.get("cost_usd")
                try:
                    cost_dec = Decimal(str(cost)) if cost is not None and cost != "" else None
                except Exception:
                    cost_dec = None

                size_multipliers = raw.get("size_multipliers") or {}
                if not isinstance(size_multipliers, dict):
                    size_multipliers = {}
                grade_total = _sum_size_multipliers(size_multipliers)

                existing = GradeItem.objects.filter(
                    pricelist_version_id=plv.id,
                    product_sku=sku,
                    is_active=True,
                ).first()

                if existing:
                    existing.product_name     = raw.get("product_name") or existing.product_name
                    existing.unit_price_usd   = unit_price
                    if cost_dec is not None:
                        existing.cost_usd     = cost_dec
                    existing.size_multipliers = size_multipliers
                    existing.grade_moq_total  = grade_total
                    existing.tags             = raw.get("tags") or existing.tags
                    existing.metadata         = raw.get("metadata") or existing.metadata
                    existing.save(update_fields=[
                        "product_name", "unit_price_usd", "cost_usd",
                        "size_multipliers", "grade_moq_total",
                        "tags", "metadata", "updated_at",
                    ])
                    updated += 1
                else:
                    GradeItem.objects.create(
                        id                   = uuid.uuid4(),
                        pricelist_version_id = plv.id,
                        brand_id             = plv.brand_id,
                        product_sku          = sku,
                        product_name         = raw.get("product_name") or "",
                        unit_price_usd       = unit_price,
                        cost_usd             = cost_dec,
                        size_multipliers     = size_multipliers,
                        grade_moq_total      = grade_total,
                        tags                 = raw.get("tags") or [],
                        metadata             = raw.get("metadata") or {},
                        is_active            = True,
                    )
                    created += 1

        return Response({
            "ok":      True,
            "created": created,
            "updated": updated,
            "errors":  errors,
        }, status=status.HTTP_200_OK)

    # ── GET /api/commercial/pricelist-versions/<id>/items/ ─────────────
    @action(detail=True, methods=["get"])
    def items(self, request, pk=None):
        """Lista los grade_items de esta pricelist (enmascarando cost si ≠ CEO)."""
        qs = GradeItem.objects.filter(
            pricelist_version_id=pk, is_active=True
        ).order_by("product_sku")
        ser_cls = GradeItemSerializer if _is_ceo(request) else GradeItemPublicSerializer
        return Response(ser_cls(qs, many=True).data)


# =====================================================================
# GradeItem ViewSet (cost_usd enmascarado si ≠ CEO)
# =====================================================================
class GradeItemViewSet(viewsets.ModelViewSet):
    queryset = GradeItem.objects.filter(is_active=True)

    def get_serializer_class(self):
        return GradeItemSerializer if _is_ceo(self.request) else GradeItemPublicSerializer

    def get_queryset(self):
        qs = GradeItem.objects.filter(is_active=True)
        plv_id   = self.request.query_params.get("pricelist_version_id")
        brand_id = self.request.query_params.get("brand_id")
        sku      = self.request.query_params.get("product_sku")
        q        = self.request.query_params.get("q")
        if plv_id:
            qs = qs.filter(pricelist_version_id=plv_id)
        if brand_id:
            qs = qs.filter(brand_id=brand_id)
        if sku:
            qs = qs.filter(product_sku=sku)
        if q:
            qs = qs.filter(product_sku__icontains=q) | qs.filter(product_name__icontains=q)
        return qs.order_by("product_sku")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        # si no-CEO intenta enviar cost_usd → se descarta silenciosamente
        if not _is_ceo(request):
            data.pop("cost_usd", None)
        # Recalcula grade_moq_total por seguridad (no confiar en cliente)
        sm = data.get("size_multipliers") or {}
        data["grade_moq_total"] = _sum_size_multipliers(sm)
        serializer = GradeItemSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Respuesta con el serializer público si ≠ CEO
        out_cls = GradeItemSerializer if _is_ceo(request) else GradeItemPublicSerializer
        return Response(out_cls(serializer.instance).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        data = _request_data_copy(request)
        if not _is_ceo(request):
            data.pop("cost_usd", None)
        sm = data.get("size_multipliers")
        if sm is not None:
            data["grade_moq_total"] = _sum_size_multipliers(sm)
        serializer = GradeItemSerializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        out_cls = GradeItemSerializer if _is_ceo(request) else GradeItemPublicSerializer
        return Response(out_cls(serializer.instance).data)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# =====================================================================
# ClientAssignment ViewSet (CPA)
# =====================================================================
class ClientAssignmentViewSet(viewsets.ModelViewSet):
    queryset = ClientAssignment.objects.filter(is_active=True)
    serializer_class = ClientAssignmentSerializer

    def get_queryset(self):
        qs = ClientAssignment.objects.filter(is_active=True)
        client_id = self.request.query_params.get("client_id")
        brand_id  = self.request.query_params.get("brand_id")
        sku       = self.request.query_params.get("brand_sku")
        if client_id:
            qs = qs.filter(client_id=client_id)
        if brand_id:
            qs = qs.filter(brand_id=brand_id)
        if sku:
            qs = qs.filter(brand_sku=sku)
        return qs.order_by("brand_sku")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# =====================================================================
# EarlyPaymentPolicy ViewSet
# =====================================================================
class EarlyPaymentPolicyViewSet(viewsets.ModelViewSet):
    queryset = EarlyPaymentPolicy.objects.filter(is_active=True)
    serializer_class = EarlyPaymentPolicySerializer

    def get_queryset(self):
        qs = EarlyPaymentPolicy.objects.filter(is_active=True)
        client_id = self.request.query_params.get("client_id")
        brand_id  = self.request.query_params.get("brand_id")
        if client_id:
            qs = qs.filter(client_id=client_id)
        if brand_id:
            qs = qs.filter(brand_id=brand_id)
        return qs.order_by("-valid_from", "codigo")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    # ── POST /api/commercial/early-payment-policies/<id>/replace-tiers/ ─
    @action(detail=True, methods=["post"], url_path="replace-tiers")
    def replace_tiers(self, request, pk=None):
        """Reemplaza atómicamente los tiers de una policy.

        Payload:
          { "tiers": [
              { "payment_days": 0,  "discount_pct": 5.0, "tier_label": "Contado" },
              { "payment_days": 30, "discount_pct": 2.5, "tier_label": "30 días" },
              { "payment_days": 60, "discount_pct": 0.0, "tier_label": "60 días" }
          ] }
        """
        try:
            policy = EarlyPaymentPolicy.objects.get(pk=pk, is_active=True)
        except EarlyPaymentPolicy.DoesNotExist:
            return Response({"detail": "Policy no encontrada."},
                            status=status.HTTP_404_NOT_FOUND)

        data = _request_data_copy(request)
        tiers = data.get("tiers") or []
        if not isinstance(tiers, list):
            return Response({"detail": "tiers[] inválido."},
                            status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            EarlyPaymentTier.objects.filter(
                policy_id=policy.id, is_active=True
            ).update(is_active=False)

            created = []
            for i, raw in enumerate(tiers):
                try:
                    days = int(raw.get("payment_days", 0))
                    pct  = Decimal(str(raw.get("discount_pct", 0)))
                except Exception:
                    continue
                tier = EarlyPaymentTier.objects.create(
                    id           = uuid.uuid4(),
                    policy_id    = policy.id,
                    payment_days = days,
                    discount_pct = pct,
                    tier_label   = raw.get("tier_label") or f"{days} días",
                    orden        = i,
                    metadata     = raw.get("metadata") or {},
                    is_active    = True,
                )
                created.append(tier)

        return Response({
            "ok": True,
            "policy_id": str(policy.id),
            "tiers": EarlyPaymentTierSerializer(created, many=True).data,
        })


# =====================================================================
# EarlyPaymentTier ViewSet (CRUD bajo nivel)
# =====================================================================
class EarlyPaymentTierViewSet(viewsets.ModelViewSet):
    queryset = EarlyPaymentTier.objects.filter(is_active=True)
    serializer_class = EarlyPaymentTierSerializer

    def get_queryset(self):
        qs = EarlyPaymentTier.objects.filter(is_active=True)
        policy_id = self.request.query_params.get("policy_id")
        if policy_id:
            qs = qs.filter(policy_id=policy_id)
        return qs.order_by("payment_days")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# =====================================================================
# CommissionRule ViewSet            [CEO-ONLY]
# =====================================================================
class CommissionRuleViewSet(viewsets.ModelViewSet):
    """CRUD CEO-ONLY. Si not _is_ceo → 403 sobre TODOS los métodos."""
    queryset = CommissionRule.objects.filter(is_active=True)
    serializer_class = CommissionRuleSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not _is_ceo(request):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("CommissionRule: CEO-ONLY.")

    def get_queryset(self):
        qs = CommissionRule.objects.filter(is_active=True)
        brand_id  = self.request.query_params.get("brand_id")
        client_id = self.request.query_params.get("client_id")
        base      = self.request.query_params.get("commission_base")
        if brand_id:
            qs = qs.filter(brand_id=brand_id)
        if client_id:
            qs = qs.filter(client_id=client_id)
        if base:
            qs = qs.filter(commission_base=base)
        return qs.order_by("-valid_from", "codigo")

    def create(self, request, *args, **kwargs):
        data = _ensure_uuid(_request_data_copy(request))
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


# =====================================================================
# Catálogos read-only
# =====================================================================
class CurrencyCatViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CurrencyCat.objects.filter(is_active=True)
    serializer_class = CurrencyCatSerializer


class PriceListSourceCatViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = PriceListSourceCat.objects.filter(is_active=True).order_by("orden")
    serializer_class = PriceListSourceCatSerializer


class CommissionBaseCatViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CommissionBaseCat.objects.filter(is_active=True).order_by("orden")
    serializer_class = CommissionBaseCatSerializer


# =====================================================================
# Endpoint crítico: resolve_client_price (WATERFALL)
# =====================================================================
from rest_framework.views import APIView


class ResolveClientPriceView(APIView):
    """POST /api/commercial/resolve_client_price/

    Waterfall:
      1. CPA override: pricing.client_assignment WHERE (client_id, brand_id, brand_sku)
         → si existe: base_price = cached_client_price · source = 'CPA'
      2. MIN(unit_price_usd) sobre pricing.grade_item WHERE is_active y
         pricelist_version_id ∈ versiones ACTIVAS de brand_id
         → base_price = min · source = 'PRICELIST'
      3. Aplica el tier MÁS CERCANO por arriba de early_payment_policy
         para (client_id, brand_id) donde payment_days >= requested_payment_days
         → discount_pct · source = 'CPA+EPP' o 'PRICELIST+EPP'

    Retorna:
      { ok, client_id, brand_id, product_sku, base_price, discount_applied,
        final_price, grade_moq, size_multipliers, source, notes[] }
      Si is_ceo también: cost_usd, margen_usd, margen_pct,
                         commission_pct, commission_base.

    Este endpoint NUNCA expone cost/margen a usuarios no-CEO — aún cuando el
    GradeItem los tiene, el resultado los OMITE antes de serializar.
    """

    def post(self, request):
        ser = ResolveClientPriceInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        p = ser.validated_data

        client_id  = p["client_id"]
        brand_id   = p["brand_id"]
        sku        = p["product_sku"]
        days_req   = p.get("requested_payment_days", 0) or 0
        currency   = p.get("currency", "USD")

        notes = []
        base_price = None
        grade_moq = None
        size_mult = {}
        source = "NONE"
        grade_item = None

        # ── 1. CPA override ─────────────────────────────────────
        cpa = ClientAssignment.objects.filter(
            client_id=client_id,
            brand_id=brand_id,
            brand_sku=sku,
            is_active=True,
        ).order_by("-valid_from").first()

        # ── Selección de la PLV ganadora ──
        # Reglas (en este orden):
        #   1. Solo PLVs ACTIVE Y vigentes hoy (valid_from <= today AND
        #      (valid_to IS NULL OR valid_to >= today)).
        #   2. Closed-window (valid_to IS NOT NULL) gana sobre open-window
        #      (valid_to IS NULL). Razón: si el operador especificó fecha_fin,
        #      es una ventana intencional con prioridad sobre listas "por
        #      defecto"/sin caducidad.
        #   3. Empate → created_at DESC (la más reciente cargada gana).
        #
        # Antes la lógica era MIN(unit_price_usd), lo cual elegía la lista
        # más barata sin importar qué tan vieja fuera — incorrecto cuando
        # hay varias listas históricas activas.
        today = timezone.now().date()
        winning_plv = (
            PriceListVersion.objects.filter(
                brand_id=brand_id, is_active=True,
                valid_from__lte=today,
            ).filter(
                Q(valid_to__isnull=True) | Q(valid_to__gte=today)
            ).annotate(
                _has_end=Case(
                    When(valid_to__isnull=False, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                )
            ).order_by("_has_end", "-created_at").first()
        )
        grade_item = None
        if winning_plv:
            grade_item = GradeItem.objects.filter(
                pricelist_version_id=winning_plv.id,
                product_sku=sku,
                is_active=True,
            ).first()

        if cpa:
            base_price = Decimal(str(cpa.cached_client_price))
            source = "CPA"
            notes.append(f"CPA override activo desde {cpa.valid_from}.")
        elif grade_item:
            base_price = Decimal(str(grade_item.unit_price_usd))
            source = "PRICELIST"
            notes.append(
                f"Precio resuelto por priority-order sobre pricelist_versions vigentes "
                f"(closed-window > open-window > created_at DESC). "
                f"PLV ganadora: {winning_plv.codigo} "
                f"({winning_plv.valid_from}..{winning_plv.valid_to or '∞'})."
            )

        if grade_item:
            grade_moq = grade_item.grade_moq_total
            size_mult = grade_item.size_multipliers or {}

        if base_price is None:
            # No hay precio resoluble
            out = {
                "ok": False,
                "client_id": str(client_id),
                "brand_id":  str(brand_id),
                "product_sku": sku,
                "currency": currency,
                "base_price": None,
                "discount_applied": Decimal("0"),
                "final_price": None,
                "grade_moq": grade_moq,
                "size_multipliers": size_mult,
                "source": source,
                "notes": notes + ["Sin CPA ni pricelist activa para (brand_id, product_sku)."],
            }
            return Response(out, status=status.HTTP_404_NOT_FOUND)

        # ── 2. Early Payment Tier ───────────────────────────────
        discount_pct = Decimal("0")
        policy = EarlyPaymentPolicy.objects.filter(
            client_id=client_id, brand_id=brand_id, is_active=True,
        ).order_by("-valid_from").first()

        if policy:
            tier = EarlyPaymentTier.objects.filter(
                policy_id=policy.id,
                is_active=True,
                payment_days__gte=days_req,
            ).order_by("payment_days").first()
            if tier is None:
                # fallback: el tier con MAYOR payment_days disponible
                tier = EarlyPaymentTier.objects.filter(
                    policy_id=policy.id, is_active=True,
                ).order_by("-payment_days").first()
                if tier:
                    notes.append(
                        f"No hay tier ≥ {days_req} días; se usa tier mayor disponible ({tier.payment_days}d)."
                    )
            if tier:
                discount_pct = Decimal(str(tier.discount_pct))
                source = f"{source}+EPP"
                notes.append(f"Tier aplicado: {tier.payment_days}d → {tier.discount_pct}%.")
        else:
            notes.append("Sin EarlyPaymentPolicy para (client_id, brand_id).")

        # ── 3. Final price ──────────────────────────────────────
        final_price = (base_price * (Decimal("100") - discount_pct) / Decimal("100")).quantize(
            Decimal("0.0001")
        )

        out = {
            "ok": True,
            "client_id": str(client_id),
            "brand_id":  str(brand_id),
            "product_sku": sku,
            "currency": currency,
            "base_price": base_price,
            "discount_applied": discount_pct,
            "final_price": final_price,
            "grade_moq": grade_moq,
            "size_multipliers": size_mult,
            "source": source,
            "notes": notes,
        }

        # ── 4. CEO-ONLY enrichments (cost / margen / commission) ──
        if _is_ceo(request) and grade_item and grade_item.cost_usd is not None:
            cost = Decimal(str(grade_item.cost_usd))
            margen_usd = final_price - cost
            if final_price > 0:
                margen_pct = (margen_usd / final_price * Decimal("100")).quantize(Decimal("0.001"))
            else:
                margen_pct = None

            out["cost_usd"]   = cost
            out["margen_usd"] = margen_usd
            out["margen_pct"] = margen_pct

            # Commission Rule aplicable (client-specific primero, luego global por marca)
            rule = (
                CommissionRule.objects.filter(
                    brand_id=brand_id, client_id=client_id, is_active=True,
                ).order_by("-valid_from").first()
                or
                CommissionRule.objects.filter(
                    brand_id=brand_id, client_id__isnull=True, is_active=True,
                ).order_by("-valid_from").first()
            )
            if rule:
                out["commission_pct"]  = Decimal(str(rule.commission_pct))
                out["commission_base"] = rule.commission_base
                notes.append(f"Commission rule: {rule.codigo} ({rule.commission_base}).")
            out["notes"] = notes

        out_ser = ResolveClientPriceOutputSerializer(out)
        return Response(out_ser.data, status=status.HTTP_200_OK)


# =====================================================================
# COMEX pricing waterfall · endpoint de la calculadora del Excel v6
# =====================================================================
from .models import PricingConstant, PaymentIndex, GradeItem  # noqa: E402


class ResolveComexPriceView(APIView):
    """POST /api/commercial/resolve_price/

    Implementa la fórmula EXACTA de la hoja 'Calculadora' del Excel
    'Tabela de preços COMEX 2026 v6', celda J18:

        precio_final = VLOOKUP(sku, 'Tabela de Preços', col_10)      ← precio_base
                     × (1.0183 ^ (100 × comisión_pct))                ← factor_comisión
                     × VLOOKUP(días, 'Tabela de indices', col_3, 0)   ← factor_índice_ME

    Payload:
        {
          "sku":            "701407",            // obligatorio
          "comision_pct":   0.08,                // opcional (default 0) — decimal, 0.08 = 8%
          "dias_pago":      28,                  // opcional (default 0)
          "mercado":        "ME"                 // "MI" | "ME" (default ME)
        }

    Respuesta:
        {
          "sku":           "701407",
          "price_base_usd":  5.0013,
          "commission_pct":  0.08,
          "commission_factor": 1.15565,
          "payment_days":    28,
          "payment_market":  "ME",
          "payment_factor":  1.009,
          "price_final_usd": 5.8312,
          "breakdown": [
            "precio_base(701407) = 5.0013 USD",
            "commission_factor = 1.0183 ^ (100 × 0.08) = 1.15565",
            "payment_factor(28d, ME) = 1.009",
            "final = 5.0013 × 1.15565 × 1.009 = 5.8312 USD"
          ]
        }

    Errores:
      · 404 · SKU no encontrado o sin pricelist activa.
      · 404 · No existe índice para esos `dias_pago` (sugerir los cercanos).
      · 400 · comision_pct fuera de [0, 1].
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        sku           = (request.data.get("sku") or "").strip()
        comision_pct  = request.data.get("comision_pct")
        dias_pago     = request.data.get("dias_pago")
        mercado       = (request.data.get("mercado") or "ME").upper()

        if not sku:
            return Response({"detail": "sku es obligatorio."}, status=400)

        try:
            comision_pct = Decimal(str(comision_pct)) if comision_pct is not None else Decimal("0")
        except Exception:
            return Response({"detail": "comision_pct debe ser decimal."}, status=400)

        if comision_pct < 0 or comision_pct > 1:
            return Response(
                {"detail": "comision_pct fuera de rango. Usar decimal entre 0 y 1 (ej. 0.08 = 8%)."},
                status=400,
            )

        try:
            dias_pago = int(dias_pago) if dias_pago is not None else 0
        except Exception:
            return Response({"detail": "dias_pago debe ser entero."}, status=400)

        if mercado not in ("MI", "ME"):
            return Response({"detail": "mercado debe ser 'MI' o 'ME'."}, status=400)

        # ── 1. precio base del SKU (GradeItem activo + más reciente) ─────
        gi = (
            GradeItem.objects.filter(product_sku=sku, is_active=True)
            .order_by("-updated_at")
            .first()
        )
        if not gi:
            return Response(
                {"detail": f"SKU '{sku}' no encontrado en pricelists activas."},
                status=404,
            )
        price_base_usd = Decimal(str(gi.unit_price_usd))

        # ── 2. factor de comisión (base ^ (100 × pct)) ───────────────────
        base_const = PricingConstant.objects.filter(
            slug="base_commission_rate", is_active=True,
        ).first()
        base = Decimal(str(base_const.value)) if base_const else Decimal("1.0183")
        # Decimal ^ Decimal no es natural — convertimos via float y
        # volvemos a Decimal con 6 decimales para mantener determinismo.
        import math
        commission_factor = Decimal(
            f"{math.pow(float(base), float(100 * comision_pct)):.6f}"
        )

        # ── 3. factor de plazo (índice MI/ME) ────────────────────────────
        pi = PaymentIndex.objects.filter(dias=dias_pago, is_active=True).first()
        if not pi:
            # Sugerir los plazos cercanos disponibles.
            near = list(
                PaymentIndex.objects.filter(is_active=True)
                .values_list("dias", flat=True)
                .order_by("dias")
            )
            return Response(
                {"detail": f"No existe índice para {dias_pago} días.",
                 "dias_disponibles": near},
                status=404,
            )
        payment_factor = Decimal(str(pi.factor_me if mercado == "ME" else pi.factor_mi))

        # ── 4. precio final ──────────────────────────────────────────────
        price_final = (price_base_usd * commission_factor * payment_factor).quantize(Decimal("0.0001"))

        breakdown = [
            f"precio_base({sku}) = {price_base_usd:.4f} USD",
            f"commission_factor = {base} ^ (100 × {comision_pct}) = {commission_factor}",
            f"payment_factor({dias_pago}d, {mercado}) = {payment_factor}",
            f"final = {price_base_usd:.4f} × {commission_factor} × {payment_factor} = {price_final} USD",
        ]

        return Response({
            "sku":               sku,
            "price_base_usd":    str(price_base_usd),
            "commission_pct":    str(comision_pct),
            "commission_factor": str(commission_factor),
            "payment_days":      dias_pago,
            "payment_market":    mercado,
            "payment_factor":    str(payment_factor),
            "price_final_usd":   str(price_final),
            "currency":          "USD",
            "breakdown":         breakdown,
        }, status=200)


class PaymentIndexListView(APIView):
    """GET /api/commercial/payment_index/ · lista los 34 índices del Excel."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = PaymentIndex.objects.filter(is_active=True).order_by("dias")
        return Response([
            {
                "dias":       p.dias,
                "factor_mi":  str(p.factor_mi),
                "factor_me":  str(p.factor_me),
                "descripcion": p.descripcion,
            }
            for p in qs
        ], status=200)


class PricingConstantListView(APIView):
    """GET /api/commercial/pricing_constants/ · constantes editables."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = PricingConstant.objects.filter(is_active=True).order_by("slug")
        return Response([
            {
                "slug":        c.slug,
                "nombre":      c.nombre,
                "descripcion": c.descripcion,
                "value":       str(c.value),
                "unit":        c.unit,
            }
            for c in qs
        ], status=200)


# =====================================================================
# Sprint M3c · BrandClientPricingAssignment
# =====================================================================
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser  # noqa: E402
from .models import BrandClientPricingAssignment  # noqa: E402
from .serializers import (                         # noqa: E402
    BrandClientPricingAssignmentSerializer,
    BrandClientPricingAssignmentListSerializer,
)


_ADMIN_ROLES = {"superadmin", "admin"}


def _is_admin(user) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    return (getattr(user, "role", "") or "").lower() in _ADMIN_ROLES


class BrandClientPricingAssignmentViewSet(viewsets.ModelViewSet):
    """CRUD de asignaciones cliente↔marca con archivo + modificadores.

      GET  /api/commercial/brand-client-pricing/?brand_id=<uuid>
      GET  /api/commercial/brand-client-pricing/?cliente_id=<uuid>
      POST /api/commercial/brand-client-pricing/
      POST /api/commercial/brand-client-pricing/<id>/upload-file/
      DELETE /api/commercial/brand-client-pricing/<id>/  → soft delete
    """
    queryset = BrandClientPricingAssignment.objects.filter(is_active=True)
    serializer_class = BrandClientPricingAssignmentSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_serializer_class(self):
        if self.action == "list":
            return BrandClientPricingAssignmentListSerializer
        return BrandClientPricingAssignmentSerializer

    def get_queryset(self):
        qs = BrandClientPricingAssignment.objects.filter(is_active=True)
        brand_id   = self.request.query_params.get("brand_id")
        cliente_id = self.request.query_params.get("cliente_id")
        if brand_id:
            qs = qs.filter(brand_id=brand_id)
        if cliente_id:
            qs = qs.filter(cliente_id=cliente_id)
        return qs.order_by("-updated_at")

    def create(self, request, *args, **kwargs):
        """Crea una asignación cliente↔marca de pricing.

        TODO_LOS_CAMPOS_OPCIONALES excepto brand_id y cliente_id.
        - id: lo generamos server-side si no llega
        - fecha_inicio: default = CURRENT_DATE si llega null/vacío
        - modificadores (sobre_precio, pronto_pago, volumen, fechas): null OK
        - snapshot del cliente: best-effort, tolerante a NULLs y errores SQL
        """
        try:
            data = dict(request.data)

            # ── 1. Defaults server-side ──
            if not data.get("id"):
                data["id"] = str(uuid.uuid4())
            if not data.get("fecha_inicio"):
                data["fecha_inicio"] = timezone.now().date().isoformat()

            # Validación mínima (los únicos 2 obligatorios)
            brand_id   = data.get("brand_id")
            cliente_id = data.get("cliente_id")
            if not brand_id or not cliente_id:
                return Response(
                    {"detail": "brand_id y cliente_id son obligatorios."},
                    status=400,
                )

            # ── 2. Snapshot del cliente (best-effort) ──
            snap_comision = snap_dias = snap_limit = None
            try:
                with connection.cursor() as cur:
                    cur.execute("""
                        SELECT comision_pct, dias_credito, credito_aprobado
                          FROM clientes.cliente
                         WHERE id = %s AND is_active = TRUE
                         LIMIT 1
                    """, [cliente_id])
                    row = cur.fetchone()
                    if row:
                        snap_comision, snap_dias, snap_limit = row
            except Exception as exc:
                log.warning("BCPA snapshot failed: %s", exc)

            # ── 3. Atomic: invalidar asignación previa + crear la nueva ──
            with transaction.atomic():
                BrandClientPricingAssignment.objects.filter(
                    brand_id=brand_id, cliente_id=cliente_id, is_active=True,
                ).update(is_active=False)

                # created_by_id / updated_by_id (tolerante a AnonymousUser)
                user_id = getattr(request.user, "id", None)
                if user_id:
                    data["created_by_id"] = str(user_id)
                    data["updated_by_id"] = str(user_id)

                ser = self.get_serializer(data=data)
                ser.is_valid(raise_exception=True)
                instance = ser.save()

                # Snapshot vía direct field assignment (read_only_fields o no
                # del serializer). Solo seteamos campos efectivamente leídos.
                snapshot_updates = {}
                if snap_comision is not None:
                    snapshot_updates["comision_pct_snapshot"] = snap_comision
                if snap_dias is not None:
                    snapshot_updates["credito_dias_snapshot"] = snap_dias
                if snap_limit is not None:
                    snapshot_updates["credito_limit_snapshot"] = snap_limit
                if snapshot_updates:
                    for k, v in snapshot_updates.items():
                        setattr(instance, k, v)
                    instance.save(update_fields=list(snapshot_updates.keys()))

            return Response(self.get_serializer(instance).data, status=201)

        except Exception as exc:
            log.exception("BCPA create failed")
            return Response(
                {"detail": f"Error al crear asignación: {exc.__class__.__name__}: {exc}"},
                status=500,
            )

    def perform_destroy(self, instance):
        """Soft delete (los archivos permanecen en MinIO)."""
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    # ── POST /api/commercial/brand-client-pricing/<id>/upload-file/ ─────
    @action(detail=True, methods=["post"], url_path="upload-file",
            parser_classes=[MultiPartParser, FormParser])
    def upload_file(self, request, pk=None):
        """Sube un Excel COMEX (Tabela de preços v6+), parsea y puebla
        pricing.pricelist_version + pricing.grade_item.
        """
        try:
            bcpa = BrandClientPricingAssignment.objects.get(pk=pk, is_active=True)
        except BrandClientPricingAssignment.DoesNotExist:
            return Response({"detail": "Asignación no encontrada."}, status=404)

        f = request.FILES.get("file") or request.data.get("file")
        if not f:
            return Response({"detail": "file es obligatorio (multipart)."}, status=400)

        try:
            object_key = f"commercial/pricing/{bcpa.brand_id}/{bcpa.cliente_id}/{uuid.uuid4()}.xlsx"
            bcpa.file_object_key  = object_key
            bcpa.file_name        = getattr(f, "name", "price_list.xlsx")[:255]
            bcpa.file_size_bytes  = getattr(f, "size", None)
            # file_mime es VARCHAR(64). El MIME de xlsx es 71 chars
            # ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            # así que truncamos a 64.
            _mime = getattr(f, "content_type", None)
            bcpa.file_mime        = _mime[:64] if _mime else None
            bcpa.file_uploaded_at = timezone.now()
            # file_uploaded_by es UUIDField — solo seteamos si parece UUID
            uid = getattr(request.user, "id", None)
            try:
                bcpa.file_uploaded_by = uuid.UUID(str(uid)) if uid else None
            except Exception:
                bcpa.file_uploaded_by = None
            bcpa.save()
        except Exception as exc:
            log.exception("upload_file metadata save failed")
            return Response({
                "detail": f"Error al guardar metadata: {exc.__class__.__name__}: {exc}",
            }, status=500)

        try:
            import openpyxl  # type: ignore
        except ImportError:
            return Response({"detail": "openpyxl no instalado.",
                             "assignment": self.get_serializer(bcpa).data}, status=500)
        try:
            wb = openpyxl.load_workbook(f, data_only=True)
        except Exception as exc:
            return Response({"detail": f"Excel inválido: {exc}",
                             "assignment": self.get_serializer(bcpa).data}, status=400)

        sheet = "Tabela de Preços"
        if sheet not in wb.sheetnames:
            return Response({"detail": f"Hoja '{sheet}' no encontrada. Hojas: {wb.sheetnames}",
                             "assignment": self.get_serializer(bcpa).data}, status=400)
        tp = wb[sheet]

        # Normalizar brand_id (puede llegar como UUID o string desde managed=False)
        try:
            brand_uuid = bcpa.brand_id if hasattr(bcpa.brand_id, 'hex') else uuid.UUID(str(bcpa.brand_id))
        except Exception:
            brand_uuid = uuid.uuid4()

        plv_id = uuid.uuid4()
        codigo = f"COMEX-{brand_uuid.hex[:8]}-{int(timezone.now().timestamp())}"
        skus_imported = 0
        skus_skipped = 0
        sample = []

        try:
         with transaction.atomic():
             # ── Desactivar PLVs previas de ESTA asignación cuyo rango
             #    de fechas SE SOLAPA con el nuevo upload ──
             # Política temporal:
             #   · Re-upload con MISMAS fechas (mismo rango)        → solapa → desactiva
             #     vieja. Reemplazo idempotente.
             #   · Upload con fechas FUTURAS (no solapa con activa) → coexisten.
             #     La vigente hoy gana al resolver; cuando expira, la futura
             #     toma el relevo automáticamente (filtrado por fecha en
             #     resolve_client_price y resolved-prices).
             #
             # Lógica de solapamiento entre ranges A=[a1,a2] y B=[b1,b2]:
             #     overlap ⇔ a1 <= b2 AND b1 <= a2  (con null = infinito)
             new_from = bcpa.fecha_inicio or timezone.now().date()
             new_to   = bcpa.fecha_fin  # None ⇒ +infinity

             # existing.valid_to >= new_from  OR  existing.valid_to IS NULL
             cond_a = Q(valid_to__gte=new_from) | Q(valid_to__isnull=True)
             # existing.valid_from <= new_to  (si new_to es None, condición trivial)
             cond_b = Q(valid_from__lte=new_to) if new_to is not None else Q()

             stale_plvs = list(PriceListVersion.objects.filter(
                 brand_id=bcpa.brand_id,
                 is_active=True,
                 metadata__assignment_id=str(bcpa.id),
             ).filter(cond_a & cond_b).values_list("id", flat=True))

             if stale_plvs:
                 GradeItem.objects.filter(
                     pricelist_version_id__in=stale_plvs,
                     is_active=True,
                 ).update(is_active=False)
                 PriceListVersion.objects.filter(
                     id__in=stale_plvs,
                 ).update(is_active=False)
                 log.info(
                     "upload_file: desactivadas %d PLVs previas de BCPA %s "
                     "(solapan con %s..%s)",
                     len(stale_plvs), bcpa.id, new_from, new_to or "∞",
                 )

             PriceListVersion.objects.create(
                 id=plv_id, brand_id=bcpa.brand_id, codigo=codigo,
                 nombre=bcpa.file_name or "COMEX upload",
                 descripcion=f"Upload via BCPA {bcpa.id}", currency="USD",
                 valid_from=bcpa.fecha_inicio or timezone.now().date(),
                 valid_to=bcpa.fecha_fin, storage_key=object_key, source="UPLOAD",
                 uploaded_by_id=getattr(request.user, "id", None),
                 metadata={"assignment_id": str(bcpa.id)},
             )
             grade_items = []
             for row_idx in range(2, tp.max_row + 1):
                 sku_raw = tp.cell(row=row_idx, column=1).value
                 price_raw = tp.cell(row=row_idx, column=10).value
                 if sku_raw is None or price_raw is None:
                     skus_skipped += 1; continue
                 try:
                     sku = str(sku_raw).strip()
                     price = Decimal(str(price_raw))
                 except Exception:
                     skus_skipped += 1; continue
                 if not sku or price < 0:
                     skus_skipped += 1; continue
                 product_name = (tp.cell(row=row_idx, column=2).value
                                 or tp.cell(row=row_idx, column=4).value or "")
                 ncm = tp.cell(row=row_idx, column=6).value
                 ca  = tp.cell(row=row_idx, column=7).value
                 centro = tp.cell(row=row_idx, column=9).value
                 grade_items.append(GradeItem(
                     id=uuid.uuid4(), pricelist_version_id=plv_id,
                     brand_id=bcpa.brand_id, product_sku=sku,
                     product_name=str(product_name)[:240], unit_price_usd=price,
                     grade_moq_total=0, size_multipliers={}, tags=[],
                     metadata={"ncm": str(ncm) if ncm is not None else None,
                               "ca":  str(ca)  if ca  is not None else None,
                               "centro_facturacion": str(centro) if centro is not None else None,
                               "row_excel": row_idx},
                 ))
                 if len(sample) < 5: sample.append(sku)
                 skus_imported += 1
             if grade_items:
                 GradeItem.objects.bulk_create(grade_items, batch_size=200)

             # ── Auto-clear CPAs override del cliente para los SKUs subidos ──
             # Si el operador sube un Excel nuevo, asume que esos precios son
             # los nuevos. Cualquier override manual previo (introducido desde
             # el detalle del producto u otro flujo) queda obsoleto y se desactiva.
             # Usamos SOFT-delete (is_active=FALSE) para preservar trazabilidad
             # — los CPAs viejos quedan en la BD pero ya no aplican en el waterfall.
             cpas_cleared = 0
             if grade_items:
                 imported_skus = list({gi.product_sku for gi in grade_items})
                 # Hacemos en chunks de 1000 para evitar query gigante con un Excel
                 # grande (ANY() con miles de SKUs en un IN clause es OK pero por
                 # las dudas).
                 chunk = 1000
                 for i in range(0, len(imported_skus), chunk):
                     chunk_skus = imported_skus[i:i + chunk]
                     n = ClientAssignment.objects.filter(
                         client_id=bcpa.cliente_id,
                         brand_id=bcpa.brand_id,
                         brand_sku__in=chunk_skus,
                         is_active=True,
                     ).update(is_active=False)
                     cpas_cleared += n
                 if cpas_cleared:
                     log.info(
                         "upload_file: desactivados %d CPA overrides para "
                         "cliente %s / marca %s (SKUs del Excel)",
                         cpas_cleared, bcpa.cliente_id, bcpa.brand_id,
                     )

         return Response({"assignment": self.get_serializer(bcpa).data,
                          "pricelist_version_id": str(plv_id),
                          "pricelist_codigo": codigo,
                          "skus_imported": skus_imported,
                          "skus_skipped": skus_skipped,
                          "cpas_cleared": cpas_cleared,
                          "sample": sample}, status=200)
        except Exception as exc:
            log.exception("upload_file failed")
            return Response({
                "detail": f"{exc.__class__.__name__}: {exc}",
                "assignment": self.get_serializer(bcpa).data,
                "skus_imported": skus_imported,
                "skus_skipped": skus_skipped,
            }, status=500)


# =====================================================================
class BrandClientsSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, brand_id):
        is_admin = _is_admin(request.user)

        # 1. Todos los clientes activos (ligero — no filtramos por ventas
        #    por ahora; en fase 2 podemos enlazar con expedientes.expediente
        #    WHERE brand_id = ...).
        with connection.cursor() as cur:
            cur.execute("""
                SELECT id, razon_social, nombre_comercial, pais_iso2,
                       estado, dias_credito,
                       credito_aprobado, comision_pct
                  FROM clientes.cliente
                 WHERE is_active = TRUE
                 ORDER BY razon_social
                 LIMIT 500
            """)
            cols = [c[0] for c in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]

        # 2. Asignaciones vigentes para esta marca.
        bcpas = {
            str(a.cliente_id): a
            for a in BrandClientPricingAssignment.objects.filter(
                brand_id=brand_id, is_active=True,
            )
        }

        def _assignment_dict(a):
            if not a:
                return None
            return {
                "id":                str(a.id),
                "file_name":         a.file_name,
                "file_size_bytes":   a.file_size_bytes,
                "file_uploaded_at":  a.file_uploaded_at.isoformat() if a.file_uploaded_at else None,
                "fecha_inicio":      a.fecha_inicio.isoformat() if a.fecha_inicio else None,
                "fecha_fin":         a.fecha_fin.isoformat() if a.fecha_fin else None,
                "sobre_precio_pct":  str(a.sobre_precio_pct)   if a.sobre_precio_pct  is not None else None,
                "pronto_pago_dias":  a.pronto_pago_dias,
                "pronto_pago_pct":   str(a.pronto_pago_pct)    if a.pronto_pago_pct   is not None else None,
                "volumen_pct":       str(a.volumen_pct)        if a.volumen_pct      is not None else None,
                "volumen_min_units": a.volumen_min_units,
                "updated_at":        a.updated_at.isoformat()  if a.updated_at else None,
            }

        out = []
        for r in rows:
            assignment = bcpas.get(str(r["id"]))
            card = {
                "cliente_id":       str(r["id"]),
                "razon_social":     r["razon_social"],
                "nombre_comercial": r["nombre_comercial"],
                "pais_iso2":        r["pais_iso2"],
                "estado":           r["estado"],
                "dias_credito":     r["dias_credito"],
                # CEO-ONLY — enmascarado para no-admin
                "credito_limit_usd": str(r["credito_aprobado"]) if is_admin and r["credito_aprobado"] is not None else None,
                "comision_pct":      str(r["comision_pct"])    if is_admin and r["comision_pct"]    is not None else None,
                "assignment":        _assignment_dict(assignment),
            }
            out.append(card)

        return Response({
            "brand_id": str(brand_id),
            "is_admin": is_admin,
            "is_admin": is_admin,
            "count":    len(out),
            "clients":  out,
        }, status=200)


# =====================================================================
# Helpers waterfall — fórmula COMEX + modificadores BCPA
# =====================================================================
def _comex_factor_comision(comision_pct):
    import math
    base = Decimal("1.0183")
    bc = PricingConstant.objects.filter(slug="base_commission_rate", is_active=True).first()
    if bc:
        base = Decimal(str(bc.value))
    return Decimal(f"{math.pow(float(base), float(100 * comision_pct)):.6f}")


def _comex_factor_indice(dias, mercado="ME"):
    pi = PaymentIndex.objects.filter(dias=dias, is_active=True).first()
    if not pi:
        return Decimal("1.0")
    return Decimal(str(pi.factor_me if mercado == "ME" else pi.factor_mi))


def _resolve_price_for_assignment(gi, bcpa):
    precio_base = Decimal(str(gi.unit_price_usd))
    comision = Decimal(str(bcpa.comision_pct_snapshot or 0))
    fc = _comex_factor_comision(comision)
    # D6 del Excel = días de pago para el factor índice. Prioridad:
    #   1. pronto_pago_dias (override explícito de la asignación)
    #   2. credito_dias_snapshot (snapshot de días de crédito del cliente)
    #   3. 0 (contado, factor_me = 1.0)
    if bcpa.pronto_pago_dias is not None:
        dias = int(bcpa.pronto_pago_dias)
    elif bcpa.credito_dias_snapshot is not None:
        dias = int(bcpa.credito_dias_snapshot)
    else:
        dias = 0
    fi = _comex_factor_indice(dias, mercado="ME")
    # Precio calculadora redondeado a 2 decimales (centavos USD) — coincide
    # con la "Preço Líquido" del Excel (14,96 no 14,9647).
    precio_calculadora = (precio_base * fc * fi).quantize(Decimal("0.01"))
    sp_pct  = Decimal(str(bcpa.sobre_precio_pct or 0))
    pp_pct  = Decimal(str(bcpa.pronto_pago_pct or 0))
    vol_pct = Decimal(str(bcpa.volumen_pct or 0))
    factor_mod = (Decimal("1") + sp_pct) * (Decimal("1") - pp_pct) * (Decimal("1") - vol_pct)
    precio_final = (precio_calculadora * factor_mod).quantize(Decimal("0.01"))
    return {
        "sku":                gi.product_sku,
        "product_name":       gi.product_name,
        "precio_base_usd":    str(precio_base),
        "comision_pct":       str(comision),
        "factor_comision":    str(fc),
        "pronto_pago_dias":   dias,
        "factor_indice":      str(fi),
        "precio_calculadora": str(precio_calculadora),
        "sobre_precio_pct":   str(sp_pct),
        "pronto_pago_pct":    str(pp_pct),
        "volumen_pct":        str(vol_pct),
        "factor_modificadores": str(factor_mod.quantize(Decimal("0.000001"))),
        "precio_final_usd":   str(precio_final),
    }


# =====================================================================
# GET /api/commercial/brand-client-pricing/<id>/resolved-prices/
# =====================================================================
class ResolvedPricesByAssignmentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            bcpa = BrandClientPricingAssignment.objects.get(pk=pk, is_active=True)
        except BrandClientPricingAssignment.DoesNotExist:
            return Response({"detail": "Asignación no encontrada."}, status=404)

        # Selección de la PLV ganadora (mismo criterio que resolve_client_price):
        #   1. PLVs ACTIVE y vigentes HOY.
        #   2. Closed-window (valid_to IS NOT NULL) gana sobre open-window.
        #   3. Empate → created_at DESC (la más reciente).
        # Solo mostramos los SKUs de esa PLV — antes mostraba todos de todas
        # las activas, lo que producía duplicados (mismo SKU N veces) y daba
        # la impresión de que el sistema no actualizaba los precios.
        today = timezone.now().date()
        winning_plv = (
            PriceListVersion.objects.filter(
                brand_id=bcpa.brand_id, is_active=True,
                valid_from__lte=today,
            ).filter(
                Q(valid_to__isnull=True) | Q(valid_to__gte=today)
            ).annotate(
                _has_end=Case(
                    When(valid_to__isnull=False, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                )
            ).order_by("_has_end", "-created_at").first()
        )
        if winning_plv:
            items = GradeItem.objects.filter(
                pricelist_version_id=winning_plv.id, is_active=True,
            ).order_by("product_sku")
        else:
            items = GradeItem.objects.none()

        limit = int(request.query_params.get("limit", 1000))
        sku_filter = request.query_params.get("sku")
        if sku_filter:
            items = items.filter(product_sku=sku_filter)

        out = [_resolve_price_for_assignment(gi, bcpa) for gi in items[:limit]]
        return Response({
            "assignment_id":  str(bcpa.id),
            "brand_id":       str(bcpa.brand_id),
            "cliente_id":     str(bcpa.cliente_id),
            "count":          len(out),
            "items":          out,
            # Info de la PLV ganadora (transparencia para debugging y UI):
            "winning_plv": {
                "id":         str(winning_plv.id),
                "codigo":     winning_plv.codigo,
                "valid_from": winning_plv.valid_from.isoformat() if winning_plv.valid_from else None,
                "valid_to":   winning_plv.valid_to.isoformat()   if winning_plv.valid_to   else None,
                "created_at": winning_plv.created_at.isoformat() if winning_plv.created_at else None,
                "selected_by": (
                    "closed_window" if winning_plv.valid_to else "latest_open_window"
                ),
            } if winning_plv else None,
        }, status=200)


# =====================================================================
# GET /api/commercial/products/<sku>/clients-pricing/
# =====================================================================
class ProductClientsPricingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, sku):
        is_admin = _is_admin(request.user)
        gi = (
            GradeItem.objects.filter(product_sku=str(sku), is_active=True)
            .order_by("-updated_at").first()
        )
        if not gi:
            return Response({
                "sku": sku, "found": False,
                "detail": "SKU sin grade_item activo.",
                "clients": [],
            }, status=200)
        bcpas = list(BrandClientPricingAssignment.objects.filter(
            brand_id=gi.brand_id, is_active=True,
        ))
        cliente_ids = [str(b.cliente_id) for b in bcpas]
        clientes_map = {}
        if cliente_ids:
            with connection.cursor() as cur:
                cur.execute("""
                    SELECT id, razon_social, nombre_comercial, pais_iso2
                      FROM clientes.cliente
                     WHERE is_active = TRUE
                       AND id::text = ANY(%s)
                """, [cliente_ids])
                for row in cur.fetchall():
                    clientes_map[str(row[0])] = {
                        "razon_social":     row[1],
                        "nombre_comercial": row[2],
                        "pais_iso2":        row[3],
                    }

        out_clients = []
        for bcpa in bcpas:
            cli_id = str(bcpa.cliente_id)
            cli = clientes_map.get(cli_id, {})
            resolved = _resolve_price_for_assignment(gi, bcpa)
            out_clients.append({
                "cliente_id":         cli_id,
                "razon_social":       cli.get("razon_social"),
                "nombre_comercial":   cli.get("nombre_comercial"),
                "pais_iso2":          cli.get("pais_iso2"),
                "assignment_id":      str(bcpa.id),
                "precio_calculadora": resolved["precio_calculadora"],
                "precio_final_usd":   resolved["precio_final_usd"],
                "breakdown":          resolved if is_admin else None,
            })

        return Response({
            "sku":              str(sku),
            "brand_id":         str(gi.brand_id),
            "product_name":     gi.product_name,
            "precio_base_usd":  str(gi.unit_price_usd),
            "is_admin":         is_admin,
            "count":            len(out_clients),
            "clients":          out_clients,
        }, status=200)
