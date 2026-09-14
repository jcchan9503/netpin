# End-user installer wrapper. Does not download packages or bypass execution policy.
param([Parameter(Mandatory=$true)][string]$Installer, [switch]$Silent)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows 10 or newer is required.' }
if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'Windows 10 or newer is required.' }
$file = Get-Item -LiteralPath $Installer
if ($file.Name -notmatch '^NetPin-.*-win10-x64-setup\.exe$') { throw 'Select the NetPin Windows x64 EXE installer.' }
$sums = Join-Path $file.DirectoryName 'SHA256SUMS'
if (-not (Test-Path -LiteralPath $sums)) { throw 'Put SHA256SUMS from the same build next to the installer.' }
$entries = @(Get-Content -LiteralPath $sums | Where-Object { $_ -match ('^[0-9a-fA-F]{64}\s+\*?' + [regex]::Escape($file.Name) + '$') })
if ($entries.Count -ne 1) { throw 'Missing or ambiguous checksum entry.' }
$expected = ($entries[0] -split '\s+')[0]
if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $expected) { throw 'Checksum mismatch. Installation stopped.' }
# SHA256 validates integrity, not publisher identity. Use trusted installation media.
if ($Silent) { $p = Start-Process -FilePath $file.FullName -ArgumentList '/S' -Wait -PassThru }
else { $p = Start-Process -FilePath $file.FullName -Wait -PassThru }
if ($p.ExitCode -ne 0) { throw ('Installer failed, exit code ' + $p.ExitCode) }
Write-Host 'NetPin installation finished. Existing user data was preserved.'
