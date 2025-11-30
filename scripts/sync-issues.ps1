# Sync v2-features.json from GitHub issues (Windows PowerShell)
# Run this at session start to get current issue state

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$ScriptDir\.."

Write-Host "Fetching V2 issues from upstream..."

# Query all v2-labeled issues
$issues = gh issue list -R modelcontextprotocol/inspector -l v2 --state all --json number,title,state,labels,url --limit 100 | ConvertFrom-Json

# Build cache object
$cache = @{
    generated = (Get-Date -Format "o")
    source = "gh issue list -R modelcontextprotocol/inspector -l v2"
    projectBoard = "https://github.com/orgs/modelcontextprotocol/projects/28/views/1"
    issues = $issues
}

# Write to file
$cache | ConvertTo-Json -Depth 10 | Set-Content -Path "v2-features.json" -Encoding UTF8

Write-Host "Updated v2-features.json with $($issues.Count) issues"
Write-Host ""
Write-Host "Open issues:" -ForegroundColor Yellow
gh issue list -R modelcontextprotocol/inspector -l v2 --state open
