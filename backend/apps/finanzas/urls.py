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
    # Etapa 5 · Portada CEO (respuestas pendientes + proximas salidas de produccion)
    path("finanzas/radiografia/",                    views.radiografia_ceo,    name="finanzas-radiografia"),
    # Etapa 5 · Comisiones por marca + ventana 10–20
    path("finanzas/comisiones-por-marca/",           views.comisiones_por_marca, name="finanzas-comisiones-marca"),
    path("finanzas/comisiones-historicas/",          views.comisiones_historicas, name="finanzas-comisiones-historicas"),
    path("finanzas/comisiones-calendario/",          views.comisiones_calendario, name="finanzas-comisiones-calendario"),
    # Etapa 5 · Flujo de dinero (90 dias, USD+CRC) + saldo inicial
    path("finanzas/flujo/",                           views.flujo,              name="finanzas-flujo"),
    path("finanzas/saldo-inicial/",                   views.saldo_inicial,      name="finanzas-saldo-inicial"),
    # Etapa 5 · Arbitraje por fechas de factura (compra MWT vs venta cliente)
    path("finanzas/arbitraje/",                        views.arbitraje,          name="finanzas-arbitraje"),
    # Etapa 6 · Objetivos y evolución de clientes
    path("finanzas/cliente-evolucion/",                views.cliente_evolucion,  name="finanzas-cliente-evolucion"),
    path("finanzas/cliente-objetivos/",                views.cliente_objetivos,  name="finanzas-cliente-objetivos"),
    path("finanzas/meta-cliente/",                     views.meta_cliente,       name="finanzas-meta-cliente"),
]
