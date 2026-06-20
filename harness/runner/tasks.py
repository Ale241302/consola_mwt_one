"""Harness MWT — ``runner/tasks.py``: la cola de tareas que alimenta el READ.

Esta es la **Fase 4** del harness (ver ``harness/ARCHITECTURE.md`` §1 paso READ,
§7 runner, §8 plan por fases). Aquí vive la *fuente de tareas* del bucle REPL:

    READ  → :class:`ReplLoop`/:class:`~harness.runner.repl.ReplLoop` consume de
            un :class:`TaskQueue`; cada elemento es una :class:`Task`.

Diseño deliberado (acoplamiento débil con la Fase 2):

    - Este módulo **NO importa** ``repl.py`` ni ningún provider/gate. Define solo
      los *tipos de datos* (``Task``) y la *fuente* (``TaskQueue`` +
      ``load_from_sprints``). El runner los consume; nosotros no dependemos de él.
    - Si el contrato del runner necesita referenciarse, se hace por *duck typing*
      vía el :class:`TaskSource` Protocol — nunca por import duro. Así, ``tasks.py``
      es importable y testeable aunque ``repl.py`` aún no esté completo.
    - Sin dependencias externas: cola en memoria, parser de markdown a mano.

Formato real de ``sprints/`` y ``sprints_creacion/`` (junio 2026):

    - Cada archivo es markdown con un ``# H1`` (título del sprint) y secciones
      ``## N. ...``. Los *ítems accionables* son checkboxes GitHub-style
      ``- [ ]`` (pendiente) / ``- [x]`` (hecho), repartidos en secciones de
      auditoría o criterios de aceptación.
    - Las secciones "Hallazgos y correcciones" usan bullets con emoji de estado
      (``✅``/``🟢``/``🔴``) en lugar de checkbox; también se reconocen.
    - El parser es robusto a formato variable: si un archivo no produce ninguna
      tarea reconocible, se omite con un warning (no rompe el batch).
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Iterator, Optional, Protocol, runtime_checkable

__all__ = [
    "Task",
    "TaskQueue",
    "TaskSource",
    "load_from_sprints",
    "STATUS_PENDING",
    "STATUS_RUNNING",
    "STATUS_DONE",
    "STATUS_FAILED",
    "STATUS_SKIPPED",
]

logger = logging.getLogger("harness.runner.tasks")

# --------------------------------------------------------------------------- #
# Estados canónicos de una tarea (string libre, pero estos son los esperados). #
# --------------------------------------------------------------------------- #
STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"

#: Estados que cuentan como "ya no en la cola de trabajo".
_TERMINAL_STATUSES = frozenset({STATUS_DONE, STATUS_SKIPPED})

#: Prioridad por defecto cuando no se infiere ninguna del contenido.
DEFAULT_PRIORITY = 50


# --------------------------------------------------------------------------- #
# Tipo de dato de una tarea.                                                   #
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class Task:
    """Una unidad de trabajo que el bucle REPL ejecuta.

    :param id: Identificador estable y único dentro de una cola (p.ej.
        ``"03_expedientes#a1b2c3"``). Generado por el parser o por el caller.
    :param title: Título humano corto (la línea del checkbox o el H1).
    :param prompt: El prompt completo que se le pasa al CLI en el paso EVAL.
        Suele ser ``title`` enriquecido con el contexto del sprint.
    :param scope: Frontera de archivos/superficie (``"backend/"``,
        ``"frontend/"``, ``"backend/sql/"`` …) o ``None`` si no se infiere.
        Alimenta el *nearest-file-wins* del AGENTS.md de scope (§6).
    :param priority: Entero; **menor = más urgente** (orden de cola).
    :param status: Uno de los ``STATUS_*``; arranca en ``STATUS_PENDING``.
    :param source: Origen de la tarea (ruta del sprint, ``"manual"`` …) o
        ``None``.
    """

    id: str
    title: str
    prompt: str
    scope: Optional[str] = None
    priority: int = DEFAULT_PRIORITY
    status: str = STATUS_PENDING
    source: Optional[str] = None

    def __post_init__(self) -> None:
        # Validación estricta de tipos: el contrato lo exige.
        if not isinstance(self.id, str) or not self.id:
            raise TypeError("Task.id debe ser un str no vacío")
        if not isinstance(self.title, str):
            raise TypeError("Task.title debe ser str")
        if not isinstance(self.prompt, str):
            raise TypeError("Task.prompt debe ser str")
        if self.scope is not None and not isinstance(self.scope, str):
            raise TypeError("Task.scope debe ser str | None")
        if not isinstance(self.priority, int) or isinstance(self.priority, bool):
            raise TypeError("Task.priority debe ser int")
        if not isinstance(self.status, str) or not self.status:
            raise TypeError("Task.status debe ser un str no vacío")
        if self.source is not None and not isinstance(self.source, str):
            raise TypeError("Task.source debe ser str | None")

    @property
    def is_terminal(self) -> bool:
        """``True`` si la tarea ya no debe volver a la cola de trabajo."""
        return self.status in _TERMINAL_STATUSES


# --------------------------------------------------------------------------- #
# Protocolo (duck typing) de una fuente de tareas — contrato neutro con el     #
# runner. NO importamos repl.py; el runner consume *cualquier* TaskSource.     #
# --------------------------------------------------------------------------- #
@runtime_checkable
class TaskSource(Protocol):
    """Contrato mínimo que el ``ReplLoop.read()`` espera de una fuente.

    Cualquier objeto con estos métodos sirve de fuente para el bucle, sin
    acoplar este módulo al runner (inversión de dependencia por *duck typing*).
    """

    def next(self) -> Optional[Task]:  # pragma: no cover - sólo firma
        ...

    def peek(self) -> Optional[Task]:  # pragma: no cover - sólo firma
        ...

    def mark(self, task_id: str, status: str) -> None:  # pragma: no cover
        ...

    def pending(self) -> list[Task]:  # pragma: no cover - sólo firma
        ...


# --------------------------------------------------------------------------- #
# La cola en memoria.                                                          #
# --------------------------------------------------------------------------- #
class TaskQueue:
    """Cola de tareas en memoria, ordenada por prioridad (estable).

    No usa heaps ni deps externas: mantiene una lista y resuelve ``next()``/
    ``peek()`` buscando la tarea pendiente de menor prioridad, con desempate
    estable por orden de inserción. Es la *fuente* del paso READ del bucle.

    Implementa el :class:`TaskSource` Protocol por duck typing.
    """

    def __init__(self, tasks: Optional[Iterable[Task]] = None) -> None:
        self._tasks: list[Task] = []
        self._index: dict[str, Task] = {}
        self._seq: int = 0
        #: orden de inserción por id, para desempate estable.
        self._order: dict[str, int] = {}
        if tasks is not None:
            for t in tasks:
                self.add(t)

    # -- escritura --------------------------------------------------------- #
    def add(self, task: Task) -> None:
        """Añade una tarea. Lanza ``ValueError`` si el id ya existe."""
        if not isinstance(task, Task):
            raise TypeError("add() espera una Task")
        if task.id in self._index:
            raise ValueError(f"id de tarea duplicado: {task.id!r}")
        self._tasks.append(task)
        self._index[task.id] = task
        self._order[task.id] = self._seq
        self._seq += 1

    def mark(self, task_id: str, status: str) -> None:
        """Cambia el estado de una tarea por id. ``KeyError`` si no existe."""
        if not isinstance(status, str) or not status:
            raise TypeError("status debe ser un str no vacío")
        task = self._index.get(task_id)
        if task is None:
            raise KeyError(f"tarea desconocida: {task_id!r}")
        task.status = status

    # -- lectura ----------------------------------------------------------- #
    def _pending_sorted(self) -> list[Task]:
        pend = [t for t in self._tasks if not t.is_terminal and t.status != STATUS_RUNNING]
        pend.sort(key=lambda t: (t.priority, self._order[t.id]))
        return pend

    def peek(self) -> Optional[Task]:
        """Devuelve la siguiente tarea sin consumirla, o ``None``."""
        pend = self._pending_sorted()
        return pend[0] if pend else None

    def next(self) -> Optional[Task]:
        """Devuelve la siguiente tarea y la marca como ``running``.

        Es el método que consume el paso READ del bucle: la transición a
        ``running`` evita que dos lecturas tomen la misma tarea.
        """
        nxt = self.peek()
        if nxt is None:
            return None
        nxt.status = STATUS_RUNNING
        return nxt

    def pending(self) -> list[Task]:
        """Lista (ordenada por prioridad) de tareas aún por trabajar.

        Incluye ``running`` para dar visibilidad del trabajo en vuelo; el orden
        es prioridad ascendente con desempate estable.
        """
        work = [t for t in self._tasks if not t.is_terminal]
        work.sort(key=lambda t: (t.priority, self._order[t.id]))
        return work

    def get(self, task_id: str) -> Optional[Task]:
        """Acceso directo por id (no altera estado)."""
        return self._index.get(task_id)

    def all(self) -> list[Task]:
        """Todas las tareas en orden de inserción (incluye terminales)."""
        return list(self._tasks)

    def __len__(self) -> int:
        """Número de tareas **pendientes** (no terminales)."""
        return sum(1 for t in self._tasks if not t.is_terminal)

    def __iter__(self) -> Iterator[Task]:
        return iter(self.all())

    def __contains__(self, task_id: object) -> bool:
        return task_id in self._index

    def __repr__(self) -> str:  # pragma: no cover - cosmético
        return (
            f"TaskQueue(total={len(self._tasks)}, pending={len(self)})"
        )


# --------------------------------------------------------------------------- #
# Puente cola -> bucle REPL.                                                   #
# `ReplLoop.read()` (runner/repl.py) espera un `Callable[[], str | None]` que  #
# devuelva el siguiente PROMPT (o None para parar). Una `TaskQueue` es un      #
# objeto rico (Task/estado), no ese callable. Este adaptador cierra la costura #
# sin acoplar tasks.py al runner: el runner sigue consumiendo un callable      #
# neutro. Devuelve el `prompt` de la tarea y la deja en `running` (via next()).#
# --------------------------------------------------------------------------- #
def queue_repl_source(queue: TaskSource) -> "Callable[[], Optional[str]]":
    """Adapta una fuente de tareas al callable que consume ``ReplLoop.read()``.

    Uso típico::

        q = TaskQueue(load_from_sprints(Path("sprints/")))
        loop = ReplLoop(provider, cwd=repo, task_source=queue_repl_source(q))
        loop.loop()

    Cada invocación toma la siguiente tarea pendiente (mayor prioridad,
    desempate estable) y devuelve su ``prompt``; cuando no quedan, devuelve
    ``None`` y el bucle se detiene con ``StopReason.NO_TASK``.
    """

    def _read() -> Optional[str]:
        task = queue.next()
        return task.prompt if task is not None else None

    return _read


# --------------------------------------------------------------------------- #
# Parser de sprints → Tasks.                                                   #
# --------------------------------------------------------------------------- #

#: Checkbox GitHub-style: ``- [ ]`` / ``* [x]`` con sangría opcional.
_CHECKBOX_RE = re.compile(r"^\s*[-*]\s*\[(?P<mark>[^\]])\]\s*(?P<body>.+?)\s*$")

#: Bullet con emoji de estado en "Hallazgos y correcciones".
_EMOJI_STATUS = {
    "✅": STATUS_DONE,    # ✅
    "\U0001F7E2": STATUS_DONE,  # 🟢 (cerrado/verde)
    "\U0001F534": STATUS_PENDING,  # 🔴
    "\U0001F7E1": STATUS_PENDING,  # 🟡
}
_EMOJI_BULLET_RE = re.compile(
    r"^\s*[-*]\s*(?P<emoji>["
    + "".join(re.escape(e) for e in _EMOJI_STATUS)
    + r"])\s*(?P<body>.+?)\s*$"
)

#: H1 del sprint (``# Sprint 03 · Expedientes ...``).
_H1_RE = re.compile(r"^#\s+(?P<title>.+?)\s*$")
#: Encabezado de sección (``## 3. Auditoría ...``).
_SECTION_RE = re.compile(r"^#{2,6}\s+(?P<title>.+?)\s*$")

#: Palabras clave → scope (nearest-file-wins, §6). Orden = precedencia.
_SCOPE_KEYWORDS: tuple[tuple[str, str], ...] = (
    ("backend/sql/", ("sql:", " sql ", "índice", "indice", "idempotente",
                       "makemigrations", "migrate", "schema ", ".sql")),
    ("frontend/", ("frontend", ".jsx", ".tsx", "react", "vite", "tabular-nums",
                   "errorboundary", "devtools", "ui ", "componente")),
    ("mcp_server/", ("mcp", "fastmcp", "mcp_server")),
    ("backend/", ("backend", "django", "drf", "serializer", "viewset",
                  "endpoint", "query", "queries", "api ", "n+1", "lateral")),
)

#: Pistas de prioridad por marcadores en el cuerpo (menor = más urgente).
_PRIORITY_HINTS: tuple[tuple[int, tuple[str, ...]], ...] = (
    (10, ("critical", "crítico", "critico", "blocker", "bloqueante",
          "confirmado", "🔴")),
    (30, ("n+1", "lentitud", "performance", "estabilidad", "pantalla blanca",
          "race", "leak", "fuga")),
    # DEFAULT_PRIORITY (50) si nada matchea.
    (70, ("nice", "opcional", "cosmético", "cosmetico", "verificar",
          "medir", "confirmar")),
)


def _slug(text: str, maxlen: int = 48) -> str:
    s = re.sub(r"[^\w\-]+", "-", text.lower(), flags=re.UNICODE).strip("-")
    return s[:maxlen] or "task"


def _infer_scope(body: str, section: Optional[str]) -> Optional[str]:
    hay = f"{section or ''}\n{body}".lower()
    for scope, kws in _SCOPE_KEYWORDS:
        if any(kw in hay for kw in kws):
            return scope
    return None


def _infer_priority(body: str, mark: Optional[str]) -> int:
    low = body.lower()
    for prio, kws in _PRIORITY_HINTS:
        if any(kw in low for kw in kws):
            return prio
    return DEFAULT_PRIORITY


def _status_from_checkbox(mark: str) -> str:
    return STATUS_DONE if mark.strip().lower() == "x" else STATUS_PENDING


def parse_sprint_text(
    text: str,
    *,
    source: str,
    file_stem: str,
) -> list[Task]:
    """Parsea el contenido de un sprint a una lista de :class:`Task`.

    Reconoce checkboxes ``- [ ]``/``- [x]`` y bullets con emoji de estado.
    Adjunta a cada tarea el H1 del sprint y la sección activa como contexto del
    prompt, e infiere ``scope`` y ``priority`` de heurísticas léxicas.
    """
    tasks: list[Task] = []
    sprint_title: Optional[str] = None
    section: Optional[str] = None
    seen_ids: set[str] = set()

    for raw in text.splitlines():
        line = raw.rstrip("\n")

        # H1 del sprint (sólo el primero cuenta como título global).
        if sprint_title is None:
            m_h1 = _H1_RE.match(line)
            if m_h1:
                sprint_title = m_h1.group("title").strip()
                continue

        # Encabezado de sección (## ...). No es el H1 ya capturado.
        m_sec = _SECTION_RE.match(line)
        if m_sec:
            section = m_sec.group("title").strip()
            continue

        body: Optional[str] = None
        status = STATUS_PENDING
        mark: Optional[str] = None

        m_cb = _CHECKBOX_RE.match(line)
        if m_cb:
            mark = m_cb.group("mark")
            body = m_cb.group("body").strip()
            status = _status_from_checkbox(mark)
        else:
            m_em = _EMOJI_BULLET_RE.match(line)
            if m_em:
                emoji = m_em.group("emoji")
                body = m_em.group("body").strip()
                status = _EMOJI_STATUS.get(emoji, STATUS_PENDING)

        if not body:
            continue

        # Limpieza ligera de markdown inline para el título.
        title = re.sub(r"\*\*|`", "", body).strip()
        title = re.sub(r"\s+", " ", title)
        if not title:
            continue

        scope = _infer_scope(body, section)
        priority = _infer_priority(body, mark)

        # id estable y único: <stem>#<slug>(-n si colisiona).
        base_id = f"{file_stem}#{_slug(title)}"
        task_id = base_id
        n = 1
        while task_id in seen_ids:
            n += 1
            task_id = f"{base_id}-{n}"
        seen_ids.add(task_id)

        ctx_parts = [p for p in (sprint_title, section) if p]
        prompt = title
        if ctx_parts:
            prompt = f"[{' › '.join(ctx_parts)}]\n{title}"

        tasks.append(
            Task(
                id=task_id,
                title=title,
                prompt=prompt,
                scope=scope,
                priority=priority,
                status=status,
                source=source,
            )
        )

    return tasks


def load_from_sprints(
    sprints_dir: Path,
    *,
    pattern: str = "*.md",
    include_done: bool = True,
) -> list[Task]:
    """Carga todos los sprints de ``sprints_dir`` como :class:`Task`.

    Robusto a formato variable: un archivo que no produzca ninguna tarea
    reconocible se omite con un ``warning`` (no rompe el lote). Procesa los
    archivos en orden alfabético (que coincide con el numérico ``00_…``,
    ``01_…`` del repo).

    :param sprints_dir: Directorio con los ``.md`` de sprints.
    :param pattern: Glob de archivos a leer (por defecto ``"*.md"``).
    :param include_done: Si ``False``, descarta tareas ya en estado terminal
        (``done``/``skipped``) — útil para alimentar sólo trabajo pendiente.
    :returns: Lista plana de tareas de todos los archivos.
    :raises FileNotFoundError: si ``sprints_dir`` no existe.
    """
    sprints_dir = Path(sprints_dir)
    if not sprints_dir.exists():
        raise FileNotFoundError(f"directorio de sprints no encontrado: {sprints_dir}")
    if not sprints_dir.is_dir():
        raise NotADirectoryError(f"no es un directorio: {sprints_dir}")

    all_tasks: list[Task] = []
    files = sorted(sprints_dir.glob(pattern))
    if not files:
        logger.warning("sin archivos %r en %s", pattern, sprints_dir)
        return all_tasks

    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            logger.warning("no se pudo leer %s: %s — omitido", path.name, exc)
            continue

        try:
            tasks = parse_sprint_text(
                text, source=str(path), file_stem=path.stem
            )
        except re.error as exc:  # defensivo: parser no debería lanzar
            logger.warning("error parseando %s: %s — omitido", path.name, exc)
            continue

        if not tasks:
            logger.warning(
                "%s no produjo tareas reconocibles (sin checkboxes) — omitido",
                path.name,
            )
            continue

        if not include_done:
            tasks = [t for t in tasks if not t.is_terminal]

        all_tasks.extend(tasks)

    return all_tasks


# --------------------------------------------------------------------------- #
# CLI: python -m harness.runner.tasks --list --from sprints/                  #
# --------------------------------------------------------------------------- #
def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m harness.runner.tasks",
        description="Cola de tareas del harness MWT (Fase 4): carga sprints/ y "
        "muestra la cola que alimenta el bucle REPL.",
    )
    p.add_argument(
        "--list",
        action="store_true",
        help="Imprime la cola de tareas ordenada por prioridad.",
    )
    p.add_argument(
        "--from",
        dest="from_dir",
        metavar="DIR",
        default="sprints/",
        help="Directorio de sprints a parsear (default: sprints/).",
    )
    p.add_argument(
        "--pending-only",
        action="store_true",
        help="Sólo tareas pendientes (descarta done/skipped).",
    )
    p.add_argument(
        "--glob",
        default="*.md",
        help="Patrón de archivos a leer (default: *.md).",
    )
    return p


def _fmt_row(task: Task) -> str:
    scope = task.scope or "-"
    st = task.status
    title = task.title if len(task.title) <= 70 else task.title[:67] + "..."
    return f"  P{task.priority:>3}  {st:<8}  {scope:<14}  {title}"


def main(argv: Optional[list[str]] = None) -> int:
    logging.basicConfig(level=logging.WARNING, format="WARN %(name)s: %(message)s")
    args = _build_parser().parse_args(argv)

    if not args.list:
        # Sin acción explícita, comportarse como --list (utilidad de inspección).
        args.list = True

    sprints_dir = Path(args.from_dir)
    try:
        tasks = load_from_sprints(
            sprints_dir,
            pattern=args.glob,
            include_done=not args.pending_only,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    queue = TaskQueue(tasks)

    if args.list:
        rows = queue.all()
        # Mostrar ordenado por prioridad para reflejar el orden de consumo.
        rows.sort(key=lambda t: (t.priority, t.id))
        print(f"Cola de tareas — {sprints_dir}  "
              f"(total={len(rows)}, pendientes={len(queue)})")
        print(f"  {'PRIO':<5} {'STATUS':<8}  {'SCOPE':<14}  TÍTULO")
        for t in rows:
            print(_fmt_row(t))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
