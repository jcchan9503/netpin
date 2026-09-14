param([switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Build on 64-bit Windows.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS on the build computer first.' }
function Invoke-Npm([string[]]$Arguments) {
  & npm.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('npm failed: ' + ($Arguments -join ' ')) }
}
if (-not $SkipInstall) {
  if (Test-Path package-lock.json) { Invoke-Npm -Arguments @('ci','--no-audit','--no-fund') }
  else { Invoke-Npm -Arguments @('install','--no-audit','--no-fund') }
}
Invoke-Npm -Arguments @('run','build:helpers')
Invoke-Npm -Arguments @('run','check')
Invoke-Npm -Arguments @('test')
Invoke-Npm -Arguments @('run','test:integration')
Invoke-Npm -Arguments @('run','test:desktop')
Invoke-Npm -Arguments @('run','dist:win')
& node scripts/package-metadata.mjs
if ($LASTEXITCODE -ne 0) { throw 'Checksum generation failed.' }
Write-Host 'Installer and SHA256SUMS are in release/. End-user computers do not need Node.js.'
