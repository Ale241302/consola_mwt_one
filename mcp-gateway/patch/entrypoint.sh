#!/usr/bin/env bash
set -euo pipefail

echo "Applying ContextForge userinfo fallback patch v3..."
/app/.venv/bin/python3 /patch/contextforge_patch_v3.py

echo "Applying ContextForge OAuth resource-omit patch v4..."
/app/.venv/bin/python3 /patch/contextforge_patch_v4.py

echo "Applying ContextForge OAuth resource-restore patch v5..."
/app/.venv/bin/python3 /patch/contextforge_patch_v5.py

echo "Applying ContextForge OAuth identity propagation patch v6..."
/app/.venv/bin/python3 /patch/contextforge_patch_v6.py

echo "Applying ContextForge MCP identity fallback patch v7..."
/app/.venv/bin/python3 /patch/contextforge_patch_v7.py

echo "Applying ContextForge MWT live tools/list by identity patch v8..."
/app/.venv/bin/python3 /patch/contextforge_patch_v8.py

echo "Applying ContextForge MWT call_tool direct_proxy patch v9..."
/app/.venv/bin/python3 /patch/contextforge_patch_v9.py

echo "Applying ContextForge MWT call_tool user_context patch v9b..."
/app/.venv/bin/python3 /patch/contextforge_patch_v9b.py

echo "Applying ContextForge MWT RBAC-skip patch v10..."
/app/.venv/bin/python3 /patch/contextforge_patch_v10.py

echo "Applying ContextForge MWT multi-server direct_proxy patch v11 (Ola 5)..."
/app/.venv/bin/python3 /patch/contextforge_patch_v11.py

exec /app/docker-entrypoint.sh "$@"
