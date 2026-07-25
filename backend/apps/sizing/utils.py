"""
Utilidades de resolución de matrices de tallas.

Reglas de negocio (alineadas con el Motor de Tallas / SizingEngine):
  · El TIPO de producto (ops.tipo_producto_cat.sistemas) decide qué
    unidades de medida están habilitadas y en qué orden.
  · ops.tipo_producto_matriz se usa para valores por defecto u otras
    reglas por marca/familia, pero NUNCA amplía la lista de unidades por
    encima de lo que el tipo de producto permite.
"""
from typing import List
from apps.sizing.models import TipoProductoCat, TipoProductoMatriz


def resolve_size_systems(tipo: str, marca_id=None, familia_id=None) -> List[str]:
    """
    Devuelve la lista de códigos de sistema de medida que deben mostrarse
    para un producto de tipo `tipo`.

    Args:
        tipo: Código del tipo de producto (ej. 'calzado', 'plantilla').
        marca_id: UUID de la marca (reservado; aún no afecta la lista).
        familia_id: UUID de la familia (reservado; aún no afecta la lista).

    Returns:
        Lista de códigos de ops.medida_sistema_cat, en el orden definido por
        ops.tipo_producto_cat.sistemas. Si el tipo no tiene sistemas, se usa
        la matriz default como fallback legacy.
    """
    tipo_cat = TipoProductoCat.objects.filter(pk=tipo).first()
    if tipo_cat and tipo_cat.sistemas:
        return list(tipo_cat.sistemas)

    # Fallback legacy: tipos migrados desde G23 que aún no tienen
    # sistemas en el catálogo. Se usa la matriz default del tipo.
    matriz = TipoProductoMatriz.objects.filter(
        tipo_producto=tipo,
        marca_id=None,
        familia_id=None,
        is_active=True,
    ).first()
    if matriz and matriz.sistemas:
        return list(matriz.sistemas)

    return []
