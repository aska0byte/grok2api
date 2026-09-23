# grok2api one-shot packaging script (run from anywhere)
# Output: dist/grok2api/ deployment dir + dist/grok2api-linux-x86_64.zip
# Usage: powershell -ExecutionPolicy Bypass -File scripts\package-dist.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$root\backend\cmd\grok2api")) { $root = Get-Location }
Write-Output "repo root: $root"

# ---------- 1. frontend ----------
Push-Location "$root\frontend"
cmd /c "pnpm install --frozen-lockfile" | Out-Null
cmd /c "pnpm build"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend build failed" }
Pop-Location
Write-Output "[1/4] frontend built"

# ---------- 2. linux amd64 static binary (works on CentOS 7/9) ----------
Push-Location "$root\backend"
$env:CGO_ENABLED = "0"; $env:GOOS = "linux"; $env:GOARCH = "amd64"
go build -trimpath -ldflags "-s -w" -o "$root\dist\grok2api-linux-amd64" ./cmd/grok2api
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "go build failed" }
Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
Pop-Location
Write-Output "[2/4] linux/amd64 binary built"

# ---------- 3. assemble package ----------
$pkg = "$root\dist\grok2api"
Remove-Item $pkg -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$pkg\frontend", "$pkg\egress-quality-guard", "$pkg\qg", "$pkg\data", "$pkg\logs" | Out-Null

Copy-Item "$root\dist\grok2api-linux-amd64" "$pkg\grok2api" -Force
Copy-Item "$root\frontend\dist" "$pkg\frontend\dist" -Recurse -Force

# Stamp the package with a build timestamp; the header badge reads it via
# buildinfo.CurrentVersion() so stale deployments are instantly recognizable.
$buildStamp = Get-Date -Format "yyyyMMdd-HHmm"
[System.IO.File]::WriteAllText("$pkg\VERSION", "dev-$buildStamp", (New-Object System.Text.UTF8Encoding($false)))
Copy-Item "$root\tools\egress-quality-guard\quality_guard.py" "$pkg\egress-quality-guard\" -Force

# Ship the example template only: the server keeps its own config.yaml, and
# upgrades never touch configuration.
$configSrc = "$root\config.example.yaml"
if (-not (Test-Path $configSrc)) { throw "missing config.example.yaml" }
$e = [System.IO.File]::ReadAllText($configSrc, [System.Text.Encoding]::UTF8)
$e = $e.Replace('listen: "127.0.0.1:8000"', 'listen: "0.0.0.0:8000"')
[System.IO.File]::WriteAllText("$pkg\config.example.yaml", $e, (New-Object System.Text.UTF8Encoding($false)))

Copy-Item "$PSScriptRoot\packaging\ecosystem.config.js" "$pkg\" -Force
Copy-Item "$PSScriptRoot\packaging\ecosystem.guard.js" "$pkg\" -Force
Copy-Item "$PSScriptRoot\packaging\start.sh" "$pkg\" -Force
Copy-Item "$PSScriptRoot\packaging\stop.sh" "$pkg\" -Force
Copy-Item "$PSScriptRoot\packaging\migrate-probe.sh" "$pkg\" -Force
# upgrade.sh ships OUTSIDE the zip (next to it in dist/) so old deployments
# can always fetch/use the latest script; it contains the unzip flow itself.
Copy-Item "$PSScriptRoot\packaging\upgrade.sh" "$root\dist\upgrade.sh" -Force
Write-Output "[3/4] package assembled -> $pkg"

# ---------- 4. zip ----------
# Windows PowerShell 5.1's Compress-Archive writes '\' entry separators, which
# Linux unzip extracts as literal backslash file names. Build the archive via
# ZipArchive with explicit '/' separators so upgrade.sh's unzip works cleanly.
$zip = "$root\dist\grok2api-linux-x86_64.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -LiteralPath $pkg -Recurse -File | ForEach-Object {
            $entryName = $_.FullName.Substring($pkg.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Write-Output "[4/4] zip -> $zip"
