# Inspector V2 Dev Environment Setup (Windows PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "=== Inspector V2 Dev Environment Setup ===" -ForegroundColor Cyan

# Navigate to inspector root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$ScriptDir\.."

# Install dependencies (when packages exist)
if ((Test-Path "client") -and (Test-Path "client\package.json")) {
    Write-Host "Installing client dependencies..."
    Push-Location client
    npm install
    Pop-Location
}

if ((Test-Path "proxy-server") -and (Test-Path "proxy-server\package.json")) {
    Write-Host "Installing proxy-server dependencies..."
    Push-Location proxy-server
    npm install
    Pop-Location
}

# Run smoke test if available
if (Test-Path "scripts\smoke-test.ps1") {
    Write-Host "Running smoke tests..."
    & ".\scripts\smoke-test.ps1"
}

Write-Host ""
Write-Host "=== Session Checklist ===" -ForegroundColor Yellow
Write-Host "1. Review claude-progress.md for context"
Write-Host "2. Check v2-features.json for current status"
Write-Host "3. Pick ONE feature to work on"
Write-Host "4. Update feature status to in_progress"
Write-Host ""
Write-Host "=== Ready for development ===" -ForegroundColor Green
