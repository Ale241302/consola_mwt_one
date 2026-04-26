"""
=====================================================================
MWT.ONE · Custom DRF exception handler — STUB
Agente responsable: [AG-BACKEND]

Esta versión simplemente delega al handler default de DRF. La versión
anterior intentaba interceptar excepciones para loguear a archivo, pero
generaba AssertionError(.accepted_renderer not set) en cascada,
convirtiendo TODAS las requests del módulo en HTTP 500 mudo.

Lección aprendida: NO override el EXCEPTION_HANDLER si no es absolutamente
necesario. El default de DRF maneja todos los casos correctamente y settea
el renderer apropiado para que el response pueda renderizarse.
=====================================================================
"""
from rest_framework.views import exception_handler as drf_default_handler


def custom_exception_handler(exc, context):
    return drf_default_handler(exc, context)
