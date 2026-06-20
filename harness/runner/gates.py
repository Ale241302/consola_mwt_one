"""Gates — el checklist §8 de CLAUDE.md como funciones verificables.

Cada gate es una **función pura** que recibe rutas (o un directorio) y devuelve
un :class:`GateResult` estructurado. El runner (:mod:`harness.runner.repl`) los
agrega con :func:`run_gates` y decide reintentar/escalar/entregar según el
veredicto, separando **CRÍTICOS** (bloquean) de **warnings**.

Gates implementados (mapeo a las 6 reglas de oro y §1 de CLAUDE.md):

  - :func:`gate_no_hardcoded_hex`   — R1: cero hex literales. **CRÍTICO**.
  - :func:`gate_tabular_nums`       — R5: montos/fechas en tablas con tabular-nums.
  - :func:`gate_r3_visibility_leak` — R3: datos CEO_ONLY en rama CLIENT_*. **CRÍTICO**.
  - :func:`gate_no_django_migrations` — SQL-first: sin migraciones Django. **CRÍTICO**.
  - :func:`gate_vite_build`         — build/transpile REAL con esbuild (no balance de llaves).

Diseño deliberado: las funciones aceptan rutas de archivo y/o *contenido en
memoria* (parámetro ``contents``) para poder testearse sin tocar disco. Todas
degradan con gracia: una ruta inexistente no lanza, se reporta como detalle.

Ver ``CLAUDE.md`` §2 (R1–R6), §8 (checklist), §12 (no makemigrations/migrate) y
``harness/ARCHITECTURE.md`` §7/§8.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

__all__ = [
    "GateResult",
    "GateVerdict",
    "gate_no_hardcoded_hex",
    "gate_tabular_nums",
    "gate_r3_visibility_leak",
    "gate_no_django_migrations",
    "gate_vite_build",
    "run_gates",
]


# --------------------------------------------------------------------------- #
# Resultado estructurado
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class GateResult:
    """Resultado de correr un gate.

    Atributos:
        name: Identificador del gate (p.ej. ``"no_hardcoded_hex"``).
        passed: ``True`` si el gate pasó. Un gate **SKIP** se reporta con
            ``passed=True`` y ``skipped=True`` (no es un falso PASS: el detalle lo
            explica y ``skipped`` lo marca).
        details: Texto legible: qué se encontró / por qué falló o se saltó.
        critical: Si ``True``, fallar este gate **bloquea** la entrega (R1/R3/
            SQL-first). Si ``False``, es warning.
        violations: Lista de líneas/ubicaciones concretas (para realimentar al CLI).
        skipped: ``True`` si el gate no pudo ejecutarse (p.ej. esbuild ausente).
    """

    name: str
    passed: bool
    details: str = ""
    critical: bool = False
    violations: list[str] = field(default_factory=list)
    skipped: bool = False

    @property
    def blocking(self) -> bool:
        """``True`` si este resultado debe bloquear la entrega (crítico fallado)."""
        return self.critical and not self.passed and not self.skipped


@dataclass(slots=True)
class GateVerdict:
    """Veredicto agregado de :func:`run_gates`.

    Atributos:
        results: Todos los :class:`GateResult` corridos.
        passed: ``True`` si **ningún gate crítico** falló (warnings no bloquean).
    """

    results: list[GateResult]

    @property
    def passed(self) -> bool:
        return not any(r.blocking for r in self.results)

    @property
    def critical_failures(self) -> list[GateResult]:
        return [r for r in self.results if r.blocking]

    @property
    def warnings(self) -> list[GateResult]:
        return [r for r in self.results if not r.passed and not r.critical and not r.skipped]

    @property
    def skipped(self) -> list[GateResult]:
        return [r for r in self.results if r.skipped]

    def summary(self) -> str:
        """Resumen de una línea por gate, para PRINT/log."""
        lines = []
        for r in self.results:
            if r.skipped:
                mark = "SKIP"
            elif r.passed:
                mark = "PASS"
            elif r.critical:
                mark = "FAIL*"
            else:
                mark = "warn"
            lines.append(f"[{mark}] {r.name}: {r.details}")
        verdict = "PASS" if self.passed else "BLOCKED"
        return f"VERDICT={verdict}\n" + "\n".join(lines)


# --------------------------------------------------------------------------- #
# Utilidades internas
# --------------------------------------------------------------------------- #
_SOURCE_SUFFIXES = {".jsx", ".tsx", ".js", ".ts", ".css", ".scss"}

# Archivos donde SÍ se permiten hex (definición de tokens). Heurística por nombre.
_TOKEN_FILE_HINTS = ("token", "theme", "palette", "fonts.css", "globals.css", "tailwind.config")

_HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b")
_RGB_RE = re.compile(r"\brgba?\s*\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}", re.IGNORECASE)

# Detección (heurística) de comentarios para excluirlos. OJO: en .css/.jsx/.ts el
# '#' NO es comentario (y además inicia un hex), así que NO se trata como tal aquí;
# solo se reconocen los comentarios de estilo C (// y /* */).
_LINE_COMMENT_RE = re.compile(r"(//.*$)|(/\*.*?\*/)")


def _iter_source(
    paths: Iterable[Path] | None,
    contents: Mapping[str, str] | None,
    *,
    suffixes: set[str] | None = None,
) -> Iterable[tuple[str, str]]:
    """Genera ``(etiqueta, texto)`` desde rutas y/o contenidos en memoria.

    - ``contents``: dict ``{etiqueta: texto}`` — para tests sin disco.
    - ``paths``: rutas reales; las inexistentes se omiten silenciosamente.
    - ``suffixes``: filtro de extensión para las rutas (no para ``contents``).
    """
    if contents:
        for label, text in contents.items():
            yield label, text
    if paths:
        for p in paths:
            try:
                if not p.is_file():
                    continue
                if suffixes is not None and p.suffix.lower() not in suffixes:
                    continue
                yield str(p), p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue


def _is_token_file(label: str) -> bool:
    low = label.lower()
    return any(hint in low for hint in _TOKEN_FILE_HINTS)


def _strip_comment(line: str) -> str:
    """Quita comentarios de una línea (heurística) para evitar falsos positivos."""
    return _LINE_COMMENT_RE.sub("", line)


# --------------------------------------------------------------------------- #
# R1 — Cero hex hardcodeados (CRÍTICO)
# --------------------------------------------------------------------------- #
def gate_no_hardcoded_hex(
    paths: Iterable[Path] | None = None,
    *,
    contents: Mapping[str, str] | None = None,
) -> GateResult:
    """R1: prohíbe hex literales (``#RRGGBB``, ``rgb(...)``) en fuentes UI.

    Excluye comentarios y archivos de tokens (``*token*``, ``*theme*``,
    ``tailwind.config*``, ``fonts.css``, ``globals.css``). Crítico (§11.1).

    Args:
        paths: Rutas a inspeccionar (.jsx/.tsx/.js/.ts/.css).
        contents: Alternativa en memoria ``{etiqueta: texto}`` (tests).
    """
    violations: list[str] = []
    for label, text in _iter_source(paths, contents, suffixes=_SOURCE_SUFFIXES):
        if _is_token_file(label):
            continue
        for i, raw in enumerate(text.splitlines(), start=1):
            line = _strip_comment(raw)
            if _HEX_RE.search(line) or _RGB_RE.search(line):
                snippet = raw.strip()[:120]
                violations.append(f"{label}:{i}: {snippet}")

    passed = not violations
    details = (
        "Sin hex literales en fuentes UI."
        if passed
        else f"{len(violations)} hex/rgb literal(es) fuera de archivos de tokens."
    )
    return GateResult(
        name="no_hardcoded_hex",
        passed=passed,
        details=details,
        critical=True,
        violations=violations,
    )


# --------------------------------------------------------------------------- #
# R5 — tabular-nums en montos/fechas de tablas (warning)
# --------------------------------------------------------------------------- #
# Señales de que una línea renderiza un monto/fecha en contexto de tabla.
_MONEY_HINT_RE = re.compile(
    r"(toLocaleString|toFixed|Intl\.NumberFormat|formatCurrency|formatMoney|"
    r"formatDate|\$\{[^}]*(?:amount|total|monto|precio|price|saldo)[^}]*\})",
    re.IGNORECASE,
)
_CELL_HINT_RE = re.compile(r"<t[dh]\b", re.IGNORECASE)
_TABULAR_RE = re.compile(r"tabular-nums|font-variant-numeric\s*:\s*tabular-nums")


def gate_tabular_nums(
    paths: Iterable[Path] | None = None,
    *,
    contents: Mapping[str, str] | None = None,
) -> GateResult:
    """R5: heurística — montos/fechas en celdas de tabla deben usar tabular-nums.

    Marca como warning (no crítico) las líneas que (a) renderizan un monto/fecha
    formateado dentro de una celda ``<td>/<th>`` y (b) no incluyen
    ``tabular-nums`` en la misma línea. Es una heurística: ruido posible, por eso
    no bloquea.
    """
    violations: list[str] = []
    for label, text in _iter_source(paths, contents, suffixes={".jsx", ".tsx"}):
        for i, raw in enumerate(text.splitlines(), start=1):
            in_cell = bool(_CELL_HINT_RE.search(raw))
            has_money = bool(_MONEY_HINT_RE.search(raw))
            if in_cell and has_money and not _TABULAR_RE.search(raw):
                violations.append(f"{label}:{i}: {raw.strip()[:120]}")

    passed = not violations
    details = (
        "Montos/fechas en tablas parecen usar tabular-nums (o no se detectaron)."
        if passed
        else f"{len(violations)} celda(s) con monto/fecha sin tabular-nums (heurística)."
    )
    return GateResult(
        name="tabular_nums",
        passed=passed,
        details=details,
        critical=False,
        violations=violations,
    )


# --------------------------------------------------------------------------- #
# R3 — Fuga de visibilidad CEO_ONLY en rama CLIENT_* (CRÍTICO)
# --------------------------------------------------------------------------- #
# Términos sensibles que un rol CLIENT_* NUNCA debe ver renderizados.
_CEO_ONLY_RE = re.compile(
    r"\b(cost(o|_price|Price)?|margen|margin|comisi[oó]n|commission|"
    r"unit_price_mwt|exposici[oó]n|markup|profit|utilidad)\b",
    re.IGNORECASE,
)
# Señal de que estamos dentro de una rama de render condicionada a CLIENT_*.
_CLIENT_BRANCH_RE = re.compile(
    r"(CLIENT_[A-Z_]+|role\s*===?\s*['\"]CLIENT|isClient|esCliente|"
    r"role\.startsWith\(\s*['\"]CLIENT)",
)


def gate_r3_visibility_leak(
    paths: Iterable[Path] | None = None,
    *,
    contents: Mapping[str, str] | None = None,
    window: int = 25,
) -> GateResult:
    """R3: detecta datos CEO_ONLY (costo/margen/comisión) en ramas CLIENT_*.

    Heurística de ventana: si dentro de las ``window`` líneas que siguen a una
    señal de rama CLIENT_* aparece un término sensible, se reporta como fuga.
    Crítico (§11.1): el dato no debe llegar al DOM del cliente.

    Args:
        window: Nº de líneas tras la señal CLIENT_* que se consideran "dentro".
    """
    violations: list[str] = []
    for label, text in _iter_source(paths, contents, suffixes={".jsx", ".tsx"}):
        lines = text.splitlines()
        active_until = -1  # índice hasta el que sigue "activa" una rama CLIENT_*
        for i, raw in enumerate(lines):
            if _CLIENT_BRANCH_RE.search(raw):
                active_until = i + window
            if i <= active_until:
                m = _CEO_ONLY_RE.search(_strip_comment(raw))
                if m:
                    violations.append(
                        f"{label}:{i + 1}: término sensible '{m.group(0)}' en rama CLIENT_*: "
                        f"{raw.strip()[:100]}"
                    )

    passed = not violations
    details = (
        "Sin fugas de datos CEO_ONLY en ramas CLIENT_*."
        if passed
        else f"{len(violations)} posible(s) fuga(s) de costo/margen/comisión a CLIENT_*."
    )
    return GateResult(
        name="r3_visibility_leak",
        passed=passed,
        details=details,
        critical=True,
        violations=violations,
    )


# --------------------------------------------------------------------------- #
# SQL-first — sin migraciones Django (CRÍTICO)
# --------------------------------------------------------------------------- #
_MIGRATION_PATH_RE = re.compile(r"(^|[\\/])migrations[\\/].+\.py$", re.IGNORECASE)
_MIGRATE_CALL_RE = re.compile(
    r"manage\.py\s+(makemigrations|migrate)\b|"
    r"call_command\(\s*['\"](makemigrations|migrate)['\"]",
)


def gate_no_django_migrations(
    paths: Iterable[Path] | None = None,
    *,
    contents: Mapping[str, str] | None = None,
) -> GateResult:
    """SQL-first: bloquea archivos de migración Django y llamadas a migrate.

    El esquema es SQL-first (``MIGRATION_MODULES`` desactivado, modelos
    ``managed=False``). Reporta como CRÍTICO (§12):
      - cualquier ruta que sea un archivo bajo ``.../migrations/*.py``;
      - cualquier contenido que invoque ``manage.py makemigrations|migrate`` o
        ``call_command("migrate")``.

    Args:
        paths: Rutas a inspeccionar (se evalúa el *nombre* y el contenido .py/.sh).
        contents: Alternativa en memoria ``{etiqueta: texto}`` (tests). La
            etiqueta también se evalúa como posible ruta de migración.
    """
    violations: list[str] = []

    # 1) Rutas que son archivos de migración (por path).
    if paths:
        for p in paths:
            sp = str(p)
            if _MIGRATION_PATH_RE.search(sp) and "__init__.py" not in sp:
                violations.append(f"{sp}: archivo de migración Django (prohibido; usa backend/sql/).")

    # 2) Llamadas a makemigrations/migrate en contenidos (y etiquetas-como-path).
    for label, text in _iter_source(paths, contents):
        if _MIGRATION_PATH_RE.search(label) and "__init__.py" not in label:
            violations.append(f"{label}: archivo de migración Django (prohibido; usa backend/sql/).")
        for i, raw in enumerate(text.splitlines(), start=1):
            if _MIGRATE_CALL_RE.search(raw):
                violations.append(f"{label}:{i}: llamada a makemigrations/migrate: {raw.strip()[:100]}")

    # Dedup conservando orden.
    seen: set[str] = set()
    deduped = [v for v in violations if not (v in seen or seen.add(v))]

    passed = not deduped
    details = (
        "Sin migraciones Django ni llamadas a migrate (SQL-first respetado)."
        if passed
        else f"{len(deduped)} violación(es) de SQL-first (migraciones/migrate)."
    )
    return GateResult(
        name="no_django_migrations",
        passed=passed,
        details=details,
        critical=True,
        violations=deduped,
    )


# --------------------------------------------------------------------------- #
# Build real de Vite/JSX con esbuild (warning si no se puede correr -> SKIP)
# --------------------------------------------------------------------------- #
def _esbuild_cmd() -> list[str] | None:
    """Devuelve el comando base de esbuild disponible, o ``None``.

    Prioriza un ``esbuild`` en PATH; si no, intenta ``npx --yes esbuild``.
    """
    if shutil.which("esbuild"):
        return ["esbuild"]
    if shutil.which("npx"):
        return ["npx", "--yes", "esbuild"]
    return None


def gate_vite_build(
    frontend_dir: Path | None = None,
    *,
    paths: Iterable[Path] | None = None,
    contents: Mapping[str, str] | None = None,
    timeout_s: float = 120.0,
) -> GateResult:
    """Valida JSX con un transpile REAL de esbuild (no balance de llaves).

    Modos:
      - ``paths``/``contents``: transpila solo esos archivos .jsx/.tsx (rápido,
        ideal para el diff del último turno).
      - ``frontend_dir``: si no se dan paths, intenta transpilar el entrypoint
        (``src/main.jsx``) con ``--bundle=false`` como smoke. Si no existe, hace
        un transpile de cada .jsx/.tsx encontrado (muestreo).

    Degradación honesta: si esbuild no está instalado **ni** vía PATH **ni** vía
    ``npx``, devuelve **SKIP** explícito (``passed=True``, ``skipped=True``) — NO
    un falso PASS.

    Args:
        frontend_dir: Carpeta ``frontend/`` (para el modo entrypoint).
        paths: Archivos .jsx/.tsx concretos a validar.
        contents: ``{etiqueta: texto}`` para validar fuentes en memoria (tests).
        timeout_s: Timeout total del subprocess de esbuild.
    """
    cmd = _esbuild_cmd()
    if cmd is None:
        return GateResult(
            name="vite_build",
            passed=True,
            details=(
                "SKIP: esbuild no disponible (ni en PATH ni vía npx). "
                "Instala con `npm i -g esbuild` para activar este gate."
            ),
            critical=False,
            skipped=True,
        )

    # Reúne las fuentes a validar.
    sources: list[tuple[str, str]] = []
    jsx_suffixes = {".jsx", ".tsx"}
    if contents:
        sources.extend((lbl, txt) for lbl, txt in contents.items())
    if paths:
        for p in paths:
            try:
                if p.is_file() and p.suffix.lower() in jsx_suffixes:
                    sources.append((str(p), p.read_text(encoding="utf-8", errors="replace")))
            except OSError:
                continue
    if not sources and frontend_dir is not None:
        entry = frontend_dir / "src" / "main.jsx"
        if entry.is_file():
            sources.append((str(entry), entry.read_text(encoding="utf-8", errors="replace")))
        else:
            for p in sorted((frontend_dir / "src").rglob("*.jsx"))[:20]:
                try:
                    sources.append((str(p), p.read_text(encoding="utf-8", errors="replace")))
                except OSError:
                    continue

    if not sources:
        return GateResult(
            name="vite_build",
            passed=True,
            details="SKIP: no se encontraron fuentes .jsx/.tsx para transpilar.",
            critical=False,
            skipped=True,
        )

    failures: list[str] = []
    for label, text in sources:
        loader = "tsx" if label.lower().endswith(".tsx") else "jsx"
        try:
            proc = subprocess.run(  # noqa: S603 - cmd controlado; stdin desde memoria
                [*cmd, f"--loader={loader}", "--format=esm"],
                input=text,
                capture_output=True,
                text=True,
                timeout=timeout_s,
                check=False,
            )
        except FileNotFoundError:
            return GateResult(
                name="vite_build",
                passed=True,
                details="SKIP: esbuild desapareció en ejecución.",
                critical=False,
                skipped=True,
            )
        except subprocess.TimeoutExpired:
            failures.append(f"{label}: esbuild timeout tras {timeout_s}s.")
            continue
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip().splitlines()
            head = " | ".join(err[:3]) if err else "error desconocido de esbuild"
            failures.append(f"{label}: {head}")

    passed = not failures
    details = (
        f"esbuild transpiló OK {len(sources)} archivo(s) JSX/TSX."
        if passed
        else f"esbuild falló en {len(failures)}/{len(sources)} archivo(s)."
    )
    return GateResult(
        name="vite_build",
        passed=passed,
        details=details,
        critical=False,
        violations=failures,
    )


# --------------------------------------------------------------------------- #
# Agregador
# --------------------------------------------------------------------------- #
def run_gates(
    paths: Iterable[Path] | None = None,
    *,
    frontend_dir: Path | None = None,
    contents: Mapping[str, str] | None = None,
    include_build: bool = True,
) -> GateVerdict:
    """Corre el checklist completo y devuelve un :class:`GateVerdict`.

    Agrega los gates de §8 separando críticos (R1, R3, SQL-first) de warnings
    (R5, build). El veredicto pasa si **ningún gate crítico** falla.

    Args:
        paths: Archivos tocados por el último turno (diff). Puede ir vacío.
        frontend_dir: Carpeta ``frontend/`` para el gate de build (entrypoint).
        contents: Fuentes en memoria ``{etiqueta: texto}`` (tests / pipe del CLI).
        include_build: Si ``False``, omite :func:`gate_vite_build` (más rápido).

    Returns:
        :class:`GateVerdict` con todos los resultados y el veredicto agregado.
    """
    # Materializa paths una vez (puede ser un generador de un solo uso).
    path_list = list(paths) if paths is not None else None

    results: list[GateResult] = [
        gate_no_hardcoded_hex(path_list, contents=contents),
        gate_r3_visibility_leak(path_list, contents=contents),
        gate_no_django_migrations(path_list, contents=contents),
        gate_tabular_nums(path_list, contents=contents),
    ]
    if include_build:
        results.append(
            gate_vite_build(frontend_dir, paths=path_list, contents=contents)
        )
    return GateVerdict(results=results)
