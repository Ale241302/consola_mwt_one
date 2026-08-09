# =====================================================================
# tests/run.ps1 — espejo Windows de tests/run.sh
# Compila los bundles de src/lib con esbuild (mismas versiones que el
# proyecto) y corre la suite con el runner nativo de Node (node --test).
# Uso:  cd frontend && pwsh -NoProfile -File tests/run.ps1
# =====================================================================
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$defApi = '--define:import.meta.env.VITE_API_BASE=\"\/api\"'
$defNo  = '--define:import.meta.env.VITE_USE_MOCKS=\"0\"'
$defYes = '--define:import.meta.env.VITE_USE_MOCKS=\"1\"'
$OUT = "tests/.build"
New-Item -ItemType Directory -Force -Path $OUT | Out-Null

function Build-Lib($src, $out, $defines) {
  & npx -y esbuild@0.21.5 $src --bundle --format=esm --log-level=error @defines --outfile=$out
  if ($LASTEXITCODE -ne 0) { throw "esbuild falló para $src" }
}

$defApiNo  = @($defApi, $defNo)
$defApiYes = @($defApi, $defYes)

Build-Lib "src/lib/api.js"            "$OUT/api.real.mjs"           $defApiNo
Build-Lib "src/lib/api.js"            "$OUT/api.mock.mjs"           $defApiYes
Build-Lib "src/lib/errorReporter.js"  "$OUT/errorReporter.mjs"      $defApiNo
Build-Lib "src/lib/cronogramaData.js" "$OUT/cronogramaData.mjs"     $defApiNo
Build-Lib "src/lib/clientDashMetrics.js" "$OUT/clientDashMetrics.mjs" $defApiNo

& node --test "tests/*.test.mjs"
exit $LASTEXITCODE
