# =====================================================================
# Consola MWT.ONE · deploy_consola.ps1
# Agente responsable: [AG-DEVOPS]
#
# One-click deploy desde Windows al VPS Hostinger.
# No requiere docker context previo: lo crea si no existe.
#
# Qué hace (idempotente, puedes correrlo cuantas veces quieras):
#   1. Crea/activa docker context "consola-mwt-one-vps" apuntando al VPS.
#   2. Genera un par de llaves SSH ed25519 dedicadas para GitHub Actions
#      si no existen: ~/.ssh/consola_mwt_one_deploy (+ .pub).
#   3. Sube la pub-key al authorized_keys del VPS (si aún no está).
#   4. Ejecuta bootstrap_vps.sh vía SSH → queda backend + frontend corriendo.
#   5. Imprime lo que debes pegar en GitHub Secrets para el auto-deploy.
#
# Uso:
#   cd "C:\Users\ale13\Downloads\Consola MWT.ONE\mwt-one"
#   .\scripts\deploy_consola.ps1
# =====================================================================

[CmdletBinding()]
param(
    [string]$VpsHost = "187.77.218.102",
    [int]   $VpsPort = 2222,
    [string]$VpsUser = "root",
    [string]$ContextName = "mwt-vps",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "    [OK] $msg" -ForegroundColor Green
}

# ---------------------------------------------------------------------
# 1) Docker context
# ---------------------------------------------------------------------
Write-Step "Docker context '$ContextName'"
$existing = docker context ls --format "{{.Name}}" | Select-String -SimpleMatch -Quiet $ContextName
if (-not $existing) {
    docker context create $ContextName `
        --docker "host=ssh://${VpsUser}@${VpsHost}:${VpsPort}" `
        --description "Consola MWT.ONE - VPS Hostinger" | Out-Null
    Write-OK "creado"
} else {
    Write-OK "ya existía"
}

docker context use $ContextName | Out-Null
Write-OK "activado"

# ---------------------------------------------------------------------
# 2) Llave SSH dedicada para GitHub Actions
# ---------------------------------------------------------------------
Write-Step "Llave SSH dedicada para GitHub Actions"
$sshDir = Join-Path $HOME ".ssh"
if (-not (Test-Path $sshDir)) {
    New-Item -ItemType Directory -Path $sshDir | Out-Null
}
$privKey = Join-Path $sshDir "consola_mwt_one_deploy"
$pubKey  = "${privKey}.pub"

if (-not (Test-Path $privKey)) {
    $keygenArgs = @("-t", "ed25519", "-N", "", "-C", "github-actions@consola-mwt-one", "-f", $privKey)
    & ssh-keygen @keygenArgs | Out-Null
    Write-OK "nueva key ed25519 generada en $privKey"
} else {
    Write-OK "ya existe en $privKey"
}

$pubContent = Get-Content $pubKey -Raw

# ---------------------------------------------------------------------
# 3) Subir la pub-key al authorized_keys del VPS
# ---------------------------------------------------------------------
Write-Step "Autorizando la key en el VPS"
$cmdAuthorize = @"
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
grep -qxF '$($pubContent.Trim())' ~/.ssh/authorized_keys || echo '$($pubContent.Trim())' >> ~/.ssh/authorized_keys
echo AUTHORIZED_OK
"@
ssh -p $VpsPort -o StrictHostKeyChecking=accept-new "${VpsUser}@${VpsHost}" $cmdAuthorize
Write-OK "pub-key añadida al VPS (o ya estaba)"

# ---------------------------------------------------------------------
# 4) Ejecutar bootstrap_vps.sh en el VPS
# ---------------------------------------------------------------------
Write-Step "Ejecutando bootstrap en el VPS (puede tardar 2-5 min la primera vez)"
$bootstrapUrl = "https://raw.githubusercontent.com/Ale241302/consola_mwt_one/$Branch/scripts/bootstrap_vps.sh"
ssh -p $VpsPort "${VpsUser}@${VpsHost}" "curl -fsSL $bootstrapUrl | bash -s"

# ---------------------------------------------------------------------
# 5) Instrucciones para GitHub Secrets
# ---------------------------------------------------------------------
Write-Step "Pega esto en https://github.com/Ale241302/consola_mwt_one/settings/secrets/actions"
Write-Host ""
Write-Host "  Secret name:  VPS_HOST"    -ForegroundColor Yellow
Write-Host "  Secret value: $VpsHost"
Write-Host ""
Write-Host "  Secret name:  VPS_PORT"    -ForegroundColor Yellow
Write-Host "  Secret value: $VpsPort"
Write-Host ""
Write-Host "  Secret name:  VPS_USER"    -ForegroundColor Yellow
Write-Host "  Secret value: $VpsUser"
Write-Host ""
Write-Host "  Secret name:  VPS_SSH_KEY" -ForegroundColor Yellow
Write-Host "  Secret value: (pega EXACTO el contenido del archivo de abajo)"
Write-Host ""
Write-Host "  Archivo con la key privada (copia completo, BEGIN y END incluidos):"
Write-Host "    $privKey" -ForegroundColor Green
Write-Host ""
Write-Host "[SUGERENCIA] Para copiarla al portapapeles en una sola línea:"
Write-Host "  Get-Content '$privKey' -Raw | Set-Clipboard" -ForegroundColor Gray
Write-Host ""
Write-Step "Listo"
Write-Host "  Frontend:  http://${VpsHost}:3100" -ForegroundColor Green
Write-Host "  API:       http://${VpsHost}:8100/api/" -ForegroundColor Green
Write-Host "  Login:     alejandro@muitowork.com / MuitoWork2026?" -ForegroundColor Green
