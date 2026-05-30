"""
apps.finanzas · urls
Sprint 2026-05-24

Patron: el config/urls.py incluye 'apps.finanzas.urls' con prefijo "api/".
Los endpoints quedan en /api/finanzas/...
"""
from django.urls import path

from . import views

urlpatterns = [
    path("finanzas/overview/",                       views.overview,           name="finanzas-overview"),
    path("finanzas/comisiones/",                     views.comisiones_list,    name="finanzas-comisiones"),
    # Sprint 2026-05-30 (CEO) - graficas:
    path("finanzas/commission-by-month/",            views.commission_by_month, name="finanzas-commission-by-month"),
    path("finanzas/margin-scatter/",                 views.margin_scatter,      name="finanzas-margin-scatter"),
    path("finanzas/cliente/<uuid:client_id>/",       views.cliente_profile,    name="finanzas-cliente"),
]
