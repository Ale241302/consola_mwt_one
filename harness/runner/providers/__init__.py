"""Registro/descubrimiento de providers de CLI (Claude / Gemini / Kimi).

Cada provider sabe cómo lanzar un CLI concreto en modo headless (ver
:mod:`harness.runner.providers.base`). Este módulo expone un **registro tolerante**:

  - ``claude`` existe en esta fase.
  - ``gemini`` / ``kimi`` los añade la Fase 3 como ``providers/gemini.py`` y
    ``providers/kimi.py``. El descubrimiento es **dinámico por nombre**: si el
    módulo aún no existe, :func:`get_provider` lanza un error claro en vez de
    asumir que solo hay ``claude``.

Diseño:
  - El import de este paquete **no** importa los módulos de provider de forma
    rígida; el de ``claude`` se registra de forma perezosa/tolerante para que la
    ausencia del binario nunca rompa el import.
  - Las Fases 3 solo tienen que dejar caer ``providers/<name>.py`` con una clase
    ``Provider`` (convención: ``<Name>Provider``) y quedará descubrible.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

from .base import Provider, ProviderNotAvailable, ProviderResult

if TYPE_CHECKING:  # pragma: no cover - solo para typing
    from collections.abc import Iterable

__all__ = [
    "Provider",
    "ProviderResult",
    "ProviderNotAvailable",
    "get_provider",
    "available_providers",
    "KNOWN_PROVIDERS",
]

# Nombres de target conocidos (deben coincidir con harness.config.yaml → targets).
# Que un nombre esté aquí NO implica que su módulo exista todavía: la Fase 3
# añade gemini/kimi. El descubrimiento real es dinámico (ver _resolve).
KNOWN_PROVIDERS: tuple[str, ...] = ("claude", "gemini", "kimi")

# Convención de nombre de clase por módulo (excepciones explícitas aquí).
_CLASS_NAME_OVERRIDES: dict[str, str] = {}


def _class_name_for(name: str) -> str:
    """Nombre de clase esperado para el provider ``name``.

    Convención: ``claude`` → ``ClaudeProvider``. Override vía
    :data:`_CLASS_NAME_OVERRIDES`.
    """
    if name in _CLASS_NAME_OVERRIDES:
        return _CLASS_NAME_OVERRIDES[name]
    return f"{name.capitalize()}Provider"


def _resolve(name: str) -> type[Provider]:
    """Importa dinámicamente la clase Provider de ``providers/<name>.py``.

    Raises:
        ValueError: ``name`` desconocido (no está en :data:`KNOWN_PROVIDERS`).
        ProviderNotAvailable: el módulo aún no existe (p.ej. gemini/kimi pre-Fase 3)
            o no expone la clase esperada.
    """
    if name not in KNOWN_PROVIDERS:
        raise ValueError(
            f"Provider desconocido: {name!r}. Conocidos: {', '.join(KNOWN_PROVIDERS)}."
        )
    module_path = f"{__name__}.{name}"
    try:
        module = importlib.import_module(module_path)
    except ModuleNotFoundError as exc:
        raise ProviderNotAvailable(
            f"El provider {name!r} aún no está implementado "
            f"(falta {module_path}). Las Fases 3 añaden gemini/kimi."
        ) from exc
    except (SyntaxError, ImportError) as exc:
        # El módulo existe pero no importa (p.ej. un provider de Fase 3 aún a
        # medio escribir, con SyntaxError). Lo tratamos como "no disponible" para
        # que el descubrimiento NO arrastre al runner a un crash.
        raise ProviderNotAvailable(
            f"El provider {name!r} ({module_path}) no se pudo importar: "
            f"{type(exc).__name__}: {exc}"
        ) from exc
    cls_name = _class_name_for(name)
    cls = getattr(module, cls_name, None)
    if cls is None or not (isinstance(cls, type) and issubclass(cls, Provider)):
        raise ProviderNotAvailable(
            f"El módulo {module_path} no expone una clase {cls_name}(Provider)."
        )
    return cls


def get_provider(name: str, config: dict[str, object] | None = None) -> Provider:
    """Instancia el provider ``name`` (descubrimiento dinámico por módulo).

    Args:
        name: Nombre del target (``"claude"``, ``"gemini"``, ``"kimi"``).
        config: Sub-config del target (de ``harness.config.yaml``).

    Returns:
        Una instancia de :class:`Provider`.

    Raises:
        ValueError: nombre desconocido.
        ProviderNotAvailable: el módulo del provider no existe todavía.
    """
    cls = _resolve(name)
    return cls(config or {})


def available_providers(names: "Iterable[str] | None" = None) -> list[str]:
    """Lista los providers cuyo módulo existe Y cuyo CLI está instalado.

    Útil para que el runner elija un fallback. No lanza: los nombres no
    resolubles (módulo ausente, binario no instalado) simplemente se omiten.

    Args:
        names: Subconjunto a comprobar; ``None`` = :data:`KNOWN_PROVIDERS`.

    Returns:
        Nombres de providers usables, en orden.
    """
    result: list[str] = []
    for name in names or KNOWN_PROVIDERS:
        try:
            provider = get_provider(name)
        except (ValueError, ProviderNotAvailable):
            continue
        try:
            if provider.available():
                result.append(name)
        except Exception:  # noqa: BLE001 - una sonda defectuosa no debe romper el descubrimiento
            continue
    return result
