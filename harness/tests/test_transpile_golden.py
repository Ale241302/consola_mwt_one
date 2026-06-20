"""Tests golden de transpilación: canónico → Gemini / Kimi (Fase 3).

Dado el fixture canónico en ``tests/fixtures/canonical/`` (un AGENTS.md, dos
subagentes — uno con mapeo de modelo por target y otro con rol neutro —, una skill
y un manifiesto de tools MCP), verifican que :class:`GeminiAdapter` y
:class:`KimiAdapter`:

  - emiten exactamente los archivos esperados (extensión Gemini válida / specs
    YAML Kimi);
  - el contenido clave es correcto (frontmatter/TOML/YAML, mcp config presente,
    resolución de modelo por target, banner auto-generado);
  - la emisión es **idempotente** (emitir 2 veces = byte-por-byte el mismo
    resultado).

Sin dependencias nuevas más allá de ``pyyaml``. Ejecutable como:

    python -m pytest harness/tests/test_transpile_golden.py -q
    python harness/tests/test_transpile_golden.py            # unittest fallback
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

# --- Resolución de import: permite ejecutar como script suelto o como módulo ---
_THIS = Path(__file__).resolve()
_HARNESS_DIR = _THIS.parent.parent          # harness/
_REPO_ROOT = _HARNESS_DIR.parent            # consola_mwt_one/
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from harness.adapters.gemini import GeminiAdapter  # noqa: E402
from harness.adapters.kimi import KimiAdapter  # noqa: E402

_FIXTURE_CANONICAL = _THIS.parent / "fixtures" / "canonical"
_BANNER_TOKEN = "AUTO-GENERADO por harness"


def _gemini_config() -> dict[str, object]:
    return {
        "name": "mwt",
        "version": "0.1.0",
        "models": {"architect": "gemini-2.5-pro", "worker": "gemini-2.5-flash"},
    }


def _kimi_config() -> dict[str, object]:
    return {"models": {"architect": "k2.5", "worker": "k2.5"}}


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------
class TestGeminiTranspile(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = GeminiAdapter(_gemini_config())
        self.spec = self.adapter.load(_FIXTURE_CANONICAL)
        self._tmp = tempfile.TemporaryDirectory()
        self.out = Path(self._tmp.name) / "ext" / "mwt"
        self.written = self.adapter.emit(self.spec, self.out)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_load_populated(self) -> None:
        self.assertTrue(self.spec.base_instructions.strip())
        self.assertEqual(len(self.spec.agents), 2)
        self.assertEqual(len(self.spec.skills), 1)
        self.assertEqual(len(self.spec.tools), 1)

    def test_expected_files_exist(self) -> None:
        expected = {
            self.out / "GEMINI.md",
            self.out / "gemini-extension.json",
            self.out / "agents" / "db-architect.md",
            self.out / "agents" / "frontend-architect.md",
            self.out / "commands" / "genera_ui.toml",
        }
        self.assertTrue(expected.issubset(set(self.written)))
        for p in expected:
            self.assertTrue(p.is_file(), f"falta {p}")

    def test_gemini_md_has_banner_and_content(self) -> None:
        text = (self.out / "GEMINI.md").read_text(encoding="utf-8")
        self.assertIn(_BANNER_TOKEN, text)
        self.assertIn("SQL-first", text)

    def test_manifest_has_mcp_servers(self) -> None:
        manifest = json.loads(
            (self.out / "gemini-extension.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["name"], "mwt")
        self.assertEqual(manifest["contextFileName"], "GEMINI.md")
        servers = manifest["mcpServers"]
        self.assertIn("mwt", servers)
        self.assertEqual(servers["mwt"]["command"], "python")
        self.assertEqual(servers["mwt"]["args"], ["-m", "mwt_mcp"])
        self.assertEqual(servers["mwt"]["cwd"], "mcp_server/")

    def test_agent_frontmatter_and_model_resolution(self) -> None:
        # frontend-architect declara model.gemini explícito.
        fa = (self.out / "agents" / "frontend-architect.md").read_text(encoding="utf-8")
        self.assertTrue(fa.startswith("---"))
        fm = yaml.safe_load(fa.split("---", 2)[1])
        self.assertEqual(fm["name"], "frontend-architect")
        self.assertEqual(fm["model"], "gemini-2.5-pro")
        self.assertIn("mcp:mwt.*", fm["tools"])
        self.assertIn(_BANNER_TOKEN, fa)
        # db-architect usa rol neutro -> resuelto contra config.models.architect.
        da = (self.out / "agents" / "db-architect.md").read_text(encoding="utf-8")
        fm_da = yaml.safe_load(da.split("---", 2)[1])
        self.assertEqual(fm_da["model"], "gemini-2.5-pro")

    def test_command_toml_valid(self) -> None:
        toml_text = (self.out / "commands" / "genera_ui.toml").read_text(encoding="utf-8")
        self.assertIn(_BANNER_TOKEN, toml_text)
        self.assertIn("description = ", toml_text)
        self.assertIn('prompt = """', toml_text)
        self.assertIn("Gate de Componentes", toml_text)
        # Parse real con un parser TOML si está disponible (3.11+ tomllib).
        try:
            import tomllib  # type: ignore
        except ModuleNotFoundError:
            return
        # Reaplica el banner como comentario es válido TOML; parsea sin error.
        data = tomllib.loads(toml_text)
        self.assertIn("description", data)
        self.assertIn("prompt", data)
        self.assertIn("Trigger:", data["prompt"])

    def test_idempotent(self) -> None:
        snap1 = _snapshot(self.out)
        self.adapter.emit(self.spec, self.out)
        snap2 = _snapshot(self.out)
        self.assertEqual(snap1, snap2)


# ---------------------------------------------------------------------------
# Kimi
# ---------------------------------------------------------------------------
class TestKimiTranspile(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = KimiAdapter(_kimi_config())
        self.spec = self.adapter.load(_FIXTURE_CANONICAL)
        self._tmp = tempfile.TemporaryDirectory()
        self.out = Path(self._tmp.name) / "kimi"
        self.written = self.adapter.emit(self.spec, self.out)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_expected_files_exist(self) -> None:
        expected = {
            self.out / "AGENTS.md",
            self.out / "agents" / "db-architect.yaml",
            self.out / "agents" / "frontend-architect.yaml",
            self.out / "mcp-config.json",
        }
        self.assertTrue(expected.issubset(set(self.written)))
        for p in expected:
            self.assertTrue(p.is_file(), f"falta {p}")

    def test_agents_md_banner(self) -> None:
        text = (self.out / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn(_BANNER_TOKEN, text)
        self.assertIn("SQL-first", text)

    def test_agent_yaml_valid_with_subagents(self) -> None:
        text = (self.out / "agents" / "frontend-architect.yaml").read_text(encoding="utf-8")
        self.assertIn(_BANNER_TOKEN, text)
        data = yaml.safe_load(text)
        self.assertEqual(data["id"], "frontend-architect")
        self.assertEqual(data["model"], "k2.5")  # model.kimi explícito
        self.assertIn("subagents", data)
        self.assertEqual(data["subagents"], ["reviewer"])  # de extra.subagents
        self.assertIn("system_prompt", data)
        self.assertIn("AG-03", data["system_prompt"])
        self.assertIn("mcp:mwt.*", data["tools"])

    def test_agent_yaml_role_resolution(self) -> None:
        text = (self.out / "agents" / "db-architect.yaml").read_text(encoding="utf-8")
        data = yaml.safe_load(text)
        # role:architect -> config.models.architect == k2.5
        self.assertEqual(data["model"], "k2.5")
        self.assertEqual(data["subagents"], [])  # sin subagents en frontmatter

    def test_mcp_config_present(self) -> None:
        data = json.loads((self.out / "mcp-config.json").read_text(encoding="utf-8"))
        self.assertIn("mcpServers", data)
        self.assertIn("mwt", data["mcpServers"])
        srv = data["mcpServers"]["mwt"]
        self.assertEqual(srv["command"], "python")
        self.assertEqual(srv["args"], ["-m", "mwt_mcp"])

    def test_idempotent(self) -> None:
        snap1 = _snapshot(self.out)
        self.adapter.emit(self.spec, self.out)
        snap2 = _snapshot(self.out)
        self.assertEqual(snap1, snap2)


def _snapshot(root: Path) -> dict[str, bytes]:
    """Mapa {ruta relativa: bytes} de todos los archivos bajo ``root``."""
    out: dict[str, bytes] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[str(p.relative_to(root))] = p.read_bytes()
    return out


if __name__ == "__main__":
    unittest.main(verbosity=2)
