"""Tests de la Fase 4 — ``harness/runner/tasks.py``.

Cubre:
    - ``Task`` valida tipos en construcción.
    - ``TaskQueue`` ordena por prioridad (con desempate estable), ``next()``
      consume, ``mark()`` cambia estado, ``pending()``/``__len__`` reflejan
      sólo trabajo no terminal.
    - ``load_from_sprints`` parsea el fixture y produce >=1 Task, reconociendo
      checkboxes y bullets con emoji de estado.
    - El parser es robusto: un archivo sin tareas se omite (no rompe el lote).

Ejecutable como ``pytest`` o ``python -m unittest``. Sin deps externas.
"""

from __future__ import annotations

import io
import logging
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

# Permitir importar ``runner.tasks`` corriendo desde harness/ o desde el repo.
_HARNESS_DIR = Path(__file__).resolve().parents[1]
if str(_HARNESS_DIR) not in sys.path:
    sys.path.insert(0, str(_HARNESS_DIR))

from runner import tasks as T  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures_tasks"


def _task(id_, priority=T.DEFAULT_PRIORITY, status=T.STATUS_PENDING, **kw):
    return T.Task(
        id=id_,
        title=kw.get("title", id_),
        prompt=kw.get("prompt", id_),
        scope=kw.get("scope"),
        priority=priority,
        status=status,
        source=kw.get("source"),
    )


class TestTask(unittest.TestCase):
    def test_defaults(self):
        t = T.Task(id="x", title="t", prompt="p")
        self.assertEqual(t.priority, T.DEFAULT_PRIORITY)
        self.assertEqual(t.status, T.STATUS_PENDING)
        self.assertIsNone(t.scope)
        self.assertFalse(t.is_terminal)

    def test_type_validation(self):
        with self.assertRaises(TypeError):
            T.Task(id="", title="t", prompt="p")  # id vacío
        with self.assertRaises(TypeError):
            T.Task(id="x", title="t", prompt="p", priority="hi")  # type: ignore[arg-type]
        with self.assertRaises(TypeError):
            T.Task(id="x", title="t", prompt="p", priority=True)  # bool no es int válido

    def test_is_terminal(self):
        self.assertTrue(_task("a", status=T.STATUS_DONE).is_terminal)
        self.assertTrue(_task("b", status=T.STATUS_SKIPPED).is_terminal)
        self.assertFalse(_task("c", status=T.STATUS_FAILED).is_terminal)


class TestTaskQueue(unittest.TestCase):
    def test_orders_by_priority(self):
        q = T.TaskQueue([
            _task("low", priority=70),
            _task("hi", priority=10),
            _task("mid", priority=50),
        ])
        order = [t.id for t in q.pending()]
        self.assertEqual(order, ["hi", "mid", "low"])
        self.assertEqual(q.peek().id, "hi")

    def test_stable_tiebreak(self):
        q = T.TaskQueue([
            _task("first", priority=20),
            _task("second", priority=20),
            _task("third", priority=20),
        ])
        self.assertEqual([t.id for t in q.pending()], ["first", "second", "third"])

    def test_next_consumes_and_sets_running(self):
        q = T.TaskQueue([_task("a", priority=10), _task("b", priority=20)])
        nxt = q.next()
        self.assertEqual(nxt.id, "a")
        self.assertEqual(nxt.status, T.STATUS_RUNNING)
        # running no vuelve por peek (está en vuelo)
        self.assertEqual(q.peek().id, "b")
        # pero sí cuenta como pendiente (trabajo no terminal)
        self.assertIn("a", [t.id for t in q.pending()])

    def test_mark_changes_status(self):
        q = T.TaskQueue([_task("a"), _task("b")])
        self.assertEqual(len(q), 2)
        q.mark("a", T.STATUS_DONE)
        self.assertEqual(q.get("a").status, T.STATUS_DONE)
        self.assertTrue(q.get("a").is_terminal)
        self.assertEqual(len(q), 1)  # __len__ = pendientes
        self.assertNotIn("a", [t.id for t in q.pending()])

    def test_mark_unknown_raises(self):
        q = T.TaskQueue([_task("a")])
        with self.assertRaises(KeyError):
            q.mark("nope", T.STATUS_DONE)

    def test_duplicate_id_raises(self):
        q = T.TaskQueue([_task("a")])
        with self.assertRaises(ValueError):
            q.add(_task("a"))

    def test_next_returns_none_when_empty(self):
        q = T.TaskQueue()
        self.assertIsNone(q.next())
        self.assertIsNone(q.peek())
        self.assertEqual(len(q), 0)

    def test_full_drain(self):
        q = T.TaskQueue([_task(f"t{i}", priority=i) for i in range(5)])
        drained = []
        while (t := q.next()) is not None:
            drained.append(t.id)
            q.mark(t.id, T.STATUS_DONE)
        self.assertEqual(drained, ["t0", "t1", "t2", "t3", "t4"])
        self.assertEqual(len(q), 0)

    def test_implements_tasksource_protocol(self):
        q = T.TaskQueue([_task("a")])
        self.assertIsInstance(q, T.TaskSource)


class TestLoadFromSprints(unittest.TestCase):
    def test_parses_fixture(self):
        tasks = T.load_from_sprints(FIXTURE_DIR)
        self.assertGreaterEqual(len(tasks), 1)
        # Todas con source apuntando al fixture
        self.assertTrue(all(t.source and "sample_sprint.md" in t.source for t in tasks))
        # ids únicos
        ids = [t.id for t in tasks]
        self.assertEqual(len(ids), len(set(ids)))

    def test_recognizes_checkboxes_and_status(self):
        tasks = T.load_from_sprints(FIXTURE_DIR)
        by_status: dict[str, int] = {}
        for t in tasks:
            by_status[t.status] = by_status.get(t.status, 0) + 1
        # hay al menos un pendiente y un done (el `- [x]` y los ✅/🟢)
        self.assertGreaterEqual(by_status.get(T.STATUS_PENDING, 0), 1)
        self.assertGreaterEqual(by_status.get(T.STATUS_DONE, 0), 1)

    def test_infers_scope(self):
        tasks = T.load_from_sprints(FIXTURE_DIR)
        scopes = {t.scope for t in tasks if t.scope}
        # el fixture menciona backend/sql, frontend y backend
        self.assertTrue(scopes, "se esperaba al menos un scope inferido")
        self.assertIn("backend/sql/", scopes)
        self.assertIn("frontend/", scopes)

    def test_infers_priority(self):
        tasks = T.load_from_sprints(FIXTURE_DIR)
        # el N+1 confirmado / crítico debe quedar con prioridad < default
        prios = [t.priority for t in tasks]
        self.assertTrue(any(p < T.DEFAULT_PRIORITY for p in prios))

    def test_pending_only_filter(self):
        all_t = T.load_from_sprints(FIXTURE_DIR, include_done=True)
        pend = T.load_from_sprints(FIXTURE_DIR, include_done=False)
        self.assertLess(len(pend), len(all_t))
        self.assertTrue(all(not t.is_terminal for t in pend))

    def test_missing_dir_raises(self):
        with self.assertRaises(FileNotFoundError):
            T.load_from_sprints(FIXTURE_DIR / "does_not_exist")

    def test_empty_file_skipped_with_warning(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            dirp = Path(d)
            (dirp / "empty.md").write_text("# Solo un título\n\nSin checkboxes.\n", encoding="utf-8")
            with self.assertLogs("harness.runner.tasks", level="WARNING") as cm:
                tasks = T.load_from_sprints(dirp)
            self.assertEqual(tasks, [])
            self.assertTrue(any("no produjo tareas" in m for m in cm.output))

    def test_feeds_a_queue(self):
        # Integración: sprints → cola consumible por el bucle.
        q = T.TaskQueue(T.load_from_sprints(FIXTURE_DIR, include_done=False))
        first = q.next()
        self.assertIsNotNone(first)
        self.assertEqual(first.status, T.STATUS_RUNNING)


class TestCLI(unittest.TestCase):
    def test_list_runs(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = T.main(["--list", "--from", str(FIXTURE_DIR)])
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("Cola de tareas", out)
        self.assertIn("TÍTULO", out)

    def test_missing_dir_returns_2(self):
        buf = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(buf):
            old = sys.stderr
            sys.stderr = err
            try:
                rc = T.main(["--list", "--from", str(FIXTURE_DIR / "nope")])
            finally:
                sys.stderr = old
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)  # silenciar warnings del parser en CLI manual
    unittest.main(verbosity=2)
