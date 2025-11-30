# Smoke Tests (Windows PowerShell)
$ErrorActionPreference = "Stop"

Write-Host "=== Running Smoke Tests ===" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$ScriptDir\.."

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    npm install
}

# Check if Playwright browsers are installed
$playwrightInstalled = $false
try {
    npx playwright --version 2>&1 | Out-Null
    $playwrightInstalled = $true
} catch {
    $playwrightInstalled = $false
}

if (-not $playwrightInstalled) {
    Write-Host "Installing Playwright browsers..."
    npx playwright install chromium
}

# Check if there's a dev server to test
$hasClient = (Test-Path "client") -and (Test-Path "client\package.json")

if (-not $hasClient) {
    Write-Host "No client package found - skipping browser smoke tests" -ForegroundColor Yellow
    Write-Host "(This is expected until UI implementation begins)"
    Write-Host ""
    Write-Host "To run smoke tests later: npm run test:smoke"
    exit 0
}

# Run smoke tests
Write-Host "Running Playwright smoke tests..."
npm run test:smoke

Write-Host "=== Smoke Tests Passed ===" -ForegroundColor Green
