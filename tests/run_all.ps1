# =====================================================================
# MWT.ONE · tests/run_all.ps1 — Runner unificado (Windows)
# Espejo de run_all.sh para la máquina del CEO. Requiere Python 3.10+,
# Node 18+ y acceso a la DB (DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD;
# por defecto 127.0.0.1:5432 mwt/mwt/mwt_one — el postgres del Docker
# local: docker compose up -d postgres).
# Uso:  powershell -File tests\run_all.ps1   [-SinE2E]
# =====================================================================
param([switch]$SinE2E)
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Fallos = 0
function Paso($t) { Write-Host "`n════════ $t ════════" }

Paso "1/6 · db_guard snapshot"
python tests/db_guard.py snapshot; if ($LASTEXITCODE -ne 0) { exit 2 }

Paso "2/6 · Tests estructurales de base de datos"
python -m pytest tests/db/ -q --no-header -p no:cacheprovider; if ($LASTEXITCODE -ne 0) { $Fallos++ }

Paso "3/6 · Suite backend (pytest, rollback transaccional)"
Push-Location backend
python -m pytest tests/ -q --no-header -p no:cacheprovider; if ($LASTEXITCODE -ne 0) { $Fallos++ }
Pop-Location

Paso "4/6 · Suite frontend (node --test)"
Push-Location frontend
bash tests/run.sh; if ($LASTEXITCODE -ne 0) { $Fallos++ }
Pop-Location

if (-not $SinE2E) {
  Paso "5/6 · E2E flujos completos (servidor real)"
  bash tests/e2e/run_e2e.sh; if ($LASTEXITCODE -ne 0) { $Fallos++ }
} else { Paso "5/6 · E2E omitido (-SinE2E)" }

Paso "6/6 · db_guard purge + verify (limpieza garantizada)"
python tests/db_guard.py purge; if ($LASTEXITCODE -ne 0) { $Fallos++ }

if ($Fallos -eq 0) { Write-Host "`n🟢 SUITE COMPLETA EN VERDE — base de datos intacta." }
else { Write-Host "`n🔴 $Fallos capa(s) con fallos. (La base igual quedó purgada.)" }
exit $Fallos
