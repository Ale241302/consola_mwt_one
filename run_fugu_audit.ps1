# Script para ejecutar la auditoría con Codex -p fugu
# Uso: .\run_fugu_audit.ps1

# Definir la API Key de Sakana AI (si no está definida en la sesión actual)
if ($null -eq $env:SAKANA_API_KEY) {
    $env:SAKANA_API_KEY="fish_20503a6891d6300aae854df1c0d85ba7a82267ba024e78c0768b79760117bbce"
}

Write-Host "Iniciando auditoría del proyecto consola_mwt_one..." -ForegroundColor Cyan
Write-Host "Usando Codex con perfil fugu (Sakana AI)..." -ForegroundColor Cyan

# Ejecutar Codex no interactivo apuntando a las instrucciones detalladas
$null | codex -p fugu -s workspace-write exec "Audita el proyecto según las pautas detalladas en codex_audit_instructions.md. Genera el reporte de hallazgos en codex_audit_report.md."

Write-Host "Auditoría completada. Revisa los resultados en codex_audit_report.md" -ForegroundColor Green
