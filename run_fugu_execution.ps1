# Script para ejecutar la remediación del plan con Codex -p fugu
# Uso: .\run_fugu_execution.ps1

# Definir la API Key de Sakana AI (si no está definida en la sesión actual)
if ($null -eq $env:SAKANA_API_KEY) {
    $env:SAKANA_API_KEY="fish_20503a6891d6300aae854df1c0d85ba7a82267ba024e78c0768b79760117bbce"
}

Write-Host "Iniciando ejecución del plan de implementación con Codex -p fugu..." -ForegroundColor Cyan
Write-Host "Invocando agentes de desarrollo, auditoría, QA y orquestador..." -ForegroundColor Cyan

# Definir la ruta absoluta del plan de implementación
$planPath = "C:\Users\ale13\.gemini\antigravity-ide\brain\cd956ca7-d331-480e-88d5-e9ad90d50579\implementation_plan.md"

# Ejecutar Codex con acceso de escritura al workspace
$null | codex -p fugu exec --dangerously-bypass-approvals-and-sandbox "Lee el plan de implementación en '$planPath'. Ejecuta de manera secuencial y paso por paso todas las modificaciones propuestas en los Componentes 1, 2 y 3. Para cada archivo modificado, actúa coordinando agentes virtuales (un orquestador, un desarrollador, un auditor y un QA) para verificar la calidad, evitar loops de renderizado y asegurar el RBAC. Deja los archivos modificados funcionando al 100% y documenta el progreso detallado y el checklist de cada cambio en el archivo 'codex_execution_log.md'."

Write-Host "Ejecución completada. Revisa los resultados y cambios en el log 'codex_execution_log.md'." -ForegroundColor Green
