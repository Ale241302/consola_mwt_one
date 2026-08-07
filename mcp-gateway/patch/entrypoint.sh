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

exec /app/docker-entrypoint.sh "$@"
