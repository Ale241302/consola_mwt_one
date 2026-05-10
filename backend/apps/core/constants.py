"""
=====================================================================
MWT.ONE · apps.core.constants
Agente responsable: [AG-BACKEND]

Constantes globales del dominio. Una sola fuente de verdad para
identificadores que se referencian desde varias apps (expedientes,
clientes, commercial, etc.).
=====================================================================
"""

# Cliente "Muito Work Limitada" en clientes.cliente — usado como
# operating_company por defecto y para resolver pricing MWT.
# Sprint 2026-05-10 · FIX produccion: el UUID anterior
# 61a3763d-75fb-461d-af4c-e17cbea880f0 era un placeholder que NO existia
# como fila en clientes.cliente. Por eso el lookup en
# producto.especificaciones.client_prices siempre fallaba y caia a
# precio_lista. El UUID real (creado por UI) es el de abajo.
MWT_OPERATING_CLIENT_ID = "5525986c-3b09-4d13-bf8f-43ccaa2deae3"
