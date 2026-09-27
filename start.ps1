param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer before starting the sandbox.' }
$env:PORT = "$Port"
Write-Host "Open http://127.0.0.1:$Port"
Write-Host 'The sandbox manages its SSH tunnel and reconnects automatically.'
node.exe server.mjs
