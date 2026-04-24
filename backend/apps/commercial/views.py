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

from django.db import transaction
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response

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

        # Buscar grade_item para grade_moq / size_multipliers / cost (siempre)
        # (tomamos el grade_item que pertenece al pricelist_version ACTIVO
        #  que tenga el precio MIN para este sku/brand)
        grade_qs = GradeItem.objects.filter(
            brand_id=brand_id,
            product_sku=sku,
            is_active=True,
        ).order_by("unit_price_usd")
        # filtramos a los que pertenezcan a pricelist_version activa
        active_plv_ids = set(
            PriceListVersion.objects.filter(
                brand_id=brand_id, is_active=True
            ).values_list("id", flat=True)
        )
        grade_item = next(
            (gi for gi in grade_qs if gi.pricelist_version_id in active_plv_ids),
            None,
        )

        if cpa:
            base_price = Decimal(str(cpa.cached_client_price))
            source = "CPA"
            notes.append(f"CPA override activo desde {cpa.valid_from}.")
        elif grade_item:
            base_price = Decimal(str(grade_item.unit_price_usd))
            source = "PRICELIST"
            notes.append("Precio resuelto por MIN sobre pricelist_versions activas.")

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
