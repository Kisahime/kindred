<#
  Kindred launcher (called by start.bat at the repo root).

  Modes:
    run    (default) check requirements, offer an update, install npm packages and build
           the app when needed, then start it.
    dev    same checks, then run "npm run tauri dev" (hot reload, for development).
    check  dry run: only checks and reports. Installs, pulls and builds nothing.

  Nothing is ever installed or updated without asking you first (Y/N).
  Everything printed here also goes to launcher.log in the repo root.

  For automated testing only: set LAUNCHER_ANSWER=n (or y) to answer every Y/N question.
#>
param([ValidateSet("run", "dev", "check")][string]$Mode = "run")

# Native tools (git, npm, cargo) write progress to stderr; we check exit codes ourselves instead.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$LogFile = Join-Path $Root "launcher.log"
$StampFile = Join-Path $Root ".launcher-build-stamp"
$LockStamp = Join-Path $Root "node_modules\.launcher-lock-hash"
$ExePath = Join-Path $Root "src-tauri\target\release\kindred.exe"
$DryRun = ($Mode -eq "check")
$script:Problems = @()

# ---------------------------------------------------------------- helpers

function Write-Log([string]$Text, [string]$Color = "Gray") {
  Write-Host $Text -ForegroundColor $Color
  Add-Content -Path $LogFile -Value ("{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Text) -Encoding UTF8
}
function Write-Ok([string]$t)   { Write-Log "  [ok]   $t" "Green" }
function Write-Warn([string]$t) { Write-Log "  [warn] $t" "Yellow" }
function Write-Miss([string]$t) { Write-Log "  [need] $t" "Red" }
function Write-Step([string]$t) { Write-Log ""; Write-Log "== $t" "Cyan" }

# Asks a Y/N question. Returns $true only for an explicit "y".
function Read-YesNo([string]$Question) {
  if ($DryRun) { Write-Log "  (check mode: would ask) $Question"; return $false }
  if ($env:LAUNCHER_ANSWER) { $a = $env:LAUNCHER_ANSWER; Write-Log "  $Question [Y/N] $a (LAUNCHER_ANSWER)" }
  else { $a = Read-Host "  $Question [Y/N]"; Add-Content -Path $LogFile -Value "  $Question -> $a" }
  return ($a -match '^\s*y')
}

# Stops with a clear message; the main block catches it, logs it and pauses.
function Stop-Launcher([string]$Message) { throw $Message }

# Re-reads PATH from the registry so freshly installed tools are found without reopening the window.
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
  $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  if ((Test-Path $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) { $env:Path += ";$cargoBin" }
  $ollamaDir = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
  if ((Test-Path $ollamaDir) -and ($env:Path -notlike "*$ollamaDir*")) { $env:Path += ";$ollamaDir" }
}

function Test-Tool([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Offers "winget install <id>" after asking. Returns $true if it ran successfully.
function Install-WithWinget([string]$Id, [string]$Label, [string]$ExtraArgs = "") {
  if (-not (Test-Tool "winget")) { Write-Warn "winget is not available, so please install $Label yourself from the link above."; return $false }
  if (-not (Read-YesNo "Install $Label now with winget ($Id)?")) { return $false }
  Write-Log "  Running: winget install --id $Id -e $ExtraArgs"
  $wargs = @("install", "--id", $Id, "-e", "--accept-package-agreements", "--accept-source-agreements")
  if ($ExtraArgs) { $wargs += @("--override", $ExtraArgs) }
  & winget @wargs
  $ok = ($LASTEXITCODE -eq 0)
  Update-SessionPath
  if ($ok) { Write-Ok "$Label installed." } else { Write-Warn "winget finished with code $LASTEXITCODE for $Label." }
  return $ok
}

# One SHA-256 over the content of every file that affects the built app.
function Get-SourceHash {
  $items = @()
  foreach ($dir in "src", "src-tauri\src", "src-tauri\capabilities", "src-tauri\icons") {
    if (Test-Path $dir) { $items += Get-ChildItem $dir -Recurse -File }
  }
  foreach ($f in "package-lock.json", "package.json", "index.html", "vite.config.ts", "tsconfig.json",
                 "src-tauri\Cargo.toml", "src-tauri\Cargo.lock", "src-tauri\tauri.conf.json", "src-tauri\build.rs") {
    if (Test-Path $f) { $items += Get-Item $f }
  }
  $lines = $items | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length + 1)
    "{0}:{1}" -f $rel, (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  } | Sort-Object
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  $sha = [Security.Cryptography.SHA256]::Create()
  return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace "-", "")
}

# The default chat model, read from the app source so it never goes out of date.
function Get-DefaultModel {
  $m = Select-String -Path "src\types.ts" -Pattern 'DEFAULT_MODEL\s*=\s*"([^"]+)"' | Select-Object -First 1
  if ($m) { return $m.Matches[0].Groups[1].Value } else { return "qwen3:8b" }
}

# ---------------------------------------------------------------- requirement checks

function Test-Requirements {
  Write-Step "Checking requirements"
  Update-SessionPath

  # Git (only needed for updates)
  if (Test-Tool "git") { Write-Ok ("Git " + ((git --version) -replace "git version ", "")) }
  else {
    Write-Warn "Git not found (needed only for updates). Download: https://git-scm.com/download/win"
    [void](Install-WithWinget "Git.Git" "Git")
  }

  # Node.js LTS 20+
  $nodeOk = $false
  if (Test-Tool "node") {
    $v = (node --version) -replace "^v", ""
    if ([int]($v.Split(".")[0]) -ge 20) { Write-Ok "Node.js $v"; $nodeOk = $true }
    else { Write-Miss "Node.js $v is too old (need 20 or newer). Download the LTS: https://nodejs.org/en/download" }
  } else { Write-Miss "Node.js not found. Download the LTS: https://nodejs.org/en/download" }
  if (-not $nodeOk) {
    if ((Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS") -and (Test-Tool "node")) { $nodeOk = $true }
    else { $script:Problems += "Node.js" }
  }

  # Rust (rustup + cargo)
  $rustOk = Test-Tool "cargo"
  if ($rustOk) { Write-Ok ("Rust " + ((cargo --version) -replace "cargo ", "cargo ")) }
  else {
    if (Test-Tool "rustup") {
      Write-Miss "rustup is installed but no Rust toolchain is set."
      if (Read-YesNo "Run 'rustup default stable' now?") { rustup default stable; Update-SessionPath; $rustOk = Test-Tool "cargo" }
    } else {
      Write-Miss "Rust not found. Download rustup: https://rustup.rs"
      if (Install-WithWinget "Rustlang.Rustup" "Rust (rustup)") { $rustOk = Test-Tool "cargo" }
    }
    if (-not $rustOk) { $script:Problems += "Rust" }
  }

  # Microsoft C++ Build Tools (the Rust compiler needs its linker on Windows)
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  $vc = $null
  if (Test-Path $vswhere) { $vc = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1 }
  if ($vc) { Write-Ok "Microsoft C++ Build Tools ($vc)" }
  else {
    Write-Miss "Microsoft C++ Build Tools not found. Download: https://visualstudio.microsoft.com/visual-cpp-build-tools/ (choose 'Desktop development with C++')"
    $ok = Install-WithWinget "Microsoft.VisualStudio.2022.BuildTools" "Microsoft C++ Build Tools" "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    if (-not $ok) { $script:Problems += "C++ Build Tools" }
  }

  # WebView2 runtime (built into Windows 11; most Windows 10 PCs have it too)
  $wv = $null
  foreach ($k in "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
                 "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}") {
    $p = Get-ItemProperty -Path $k -Name pv -ErrorAction SilentlyContinue
    if ($p -and $p.pv -and $p.pv -ne "0.0.0.0") { $wv = $p.pv; break }
  }
  if ($wv) { Write-Ok "WebView2 runtime $wv" }
  else {
    Write-Miss "WebView2 runtime not found. Download: https://developer.microsoft.com/microsoft-edge/webview2/"
    if (-not (Install-WithWinget "Microsoft.EdgeWebView2Runtime" "WebView2 runtime")) { $script:Problems += "WebView2" }
  }

  # Ollama (needed to chat; the app itself still opens without it)
  if (-not (Test-Tool "ollama")) {
    Write-Warn "Ollama not found. Chat needs it. Download: https://ollama.com/download"
    [void](Install-WithWinget "Ollama.Ollama" "Ollama")
  }
  if (Test-Tool "ollama") {
    $tags = $null
    try { $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3 } catch {}
    if (-not $tags -and (Read-YesNo "Ollama is installed but not running. Start it now?")) {
      Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
      Start-Sleep -Seconds 4
      try { $tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5 } catch {}
    }
    if ($tags) {
      Write-Ok "Ollama is running"
      $model = Get-DefaultModel
      $names = @($tags.models | ForEach-Object { $_.name })
      if ($names -contains $model -or $names -contains "${model}:latest") { Write-Ok "Default chat model $model" }
      else {
        Write-Warn ("Default chat model '$model' is not installed (you have: " + ($(if ($names) { $names -join ", " } else { "none" })) + ").")
        Write-Log "         You can also pick any installed model per character in the app."
        if (Read-YesNo "Download it now with 'ollama pull $model'? (several GB)") {
          ollama pull $model
          if ($LASTEXITCODE -eq 0) { Write-Ok "Model $model downloaded" } else { Write-Warn "ollama pull failed (code $LASTEXITCODE)" }
        }
      }
    } else { Write-Warn "Ollama is not running. Start the Ollama app before chatting." }
  }

  # Optional extras: never required
  $appData = Join-Path $env:APPDATA "com.kisahime.kindred"
  if (Test-Path (Join-Path $appData "engine\sd-cuda12\sd-cli.exe")) { Write-Ok "Image engine found (optional)" }
  else { Write-Log "  [opt]  Image engine not set up (optional). See engine\sd-cuda12\README.md" }
  if (Test-Path (Join-Path $appData "engine\voice\venv\Scripts\python.exe")) { Write-Ok "Voice helper found (optional)" }
  else { Write-Log "  [opt]  Voice calls not set up (optional). Run engine\voice\setup-voice.ps1" }

  if ($script:Problems.Count -gt 0) {
    $msg = "Missing to build the app: " + ($script:Problems -join ", ") + ". Install them (links above), then run start.bat again."
    if ($DryRun) { Write-Warn $msg } else { Stop-Launcher $msg }
  }
}

# ---------------------------------------------------------------- update check

function Update-FromRemote {
  Write-Step "Checking for updates"
  if (-not (Test-Tool "git") -or -not (Test-Path (Join-Path $Root ".git"))) { Write-Log "  Not a git clone, skipping."; return }
  $remote = git remote 2>$null
  if (-not $remote) { Write-Log "  No remote configured, skipping."; return }
  $upstream = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
  if (-not $upstream) { Write-Log "  This branch has no upstream, skipping."; return }
  git fetch --quiet 2>$null
  if ($LASTEXITCODE -ne 0) { Write-Warn "Could not reach $upstream (offline?). Skipping the update check."; return }
  $behind = [int](git rev-list --count "HEAD..$upstream")
  $ahead = [int](git rev-list --count "$upstream..HEAD")
  if ($behind -eq 0) { Write-Ok "Up to date with $upstream"; return }
  Write-Log "  $behind new update(s) available on ${upstream}:" "Yellow"
  git log --oneline "HEAD..$upstream" | Select-Object -First 10 | ForEach-Object { Write-Log "    $_" }
  $dirty = git status --porcelain --untracked-files=no
  if ($dirty) { Write-Warn "You have local changes to tracked files, so the update is skipped. Commit or stash them first."; return }
  if ($ahead -gt 0) { Write-Warn "You also have $ahead local commit(s); a fast-forward update is not possible. Skipping."; return }
  if (Read-YesNo "Update now with 'git pull --ff-only'?") {
    git pull --ff-only
    if ($LASTEXITCODE -eq 0) { Write-Ok "Updated" } else { Write-Warn "git pull failed (code $LASTEXITCODE); continuing with the current version." }
  }
}

# ---------------------------------------------------------------- npm packages

function Install-Packages {
  Write-Step "Checking npm packages"
  $lockHash = (Get-FileHash "package-lock.json" -Algorithm SHA256).Hash
  $have = if (Test-Path $LockStamp) { (Get-Content $LockStamp -Raw).Trim() } else { "" }
  if ((Test-Path "node_modules") -and $have -eq $lockHash) { Write-Ok "node_modules up to date"; return }
  $why = if (-not (Test-Path "node_modules")) { "node_modules is missing" } else { "package-lock.json changed" }
  if ($DryRun) { Write-Log "  (check mode) would run 'npm ci' because $why"; return }
  Write-Log "  Running 'npm ci' because $why ..."
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Stop-Launcher "npm ci failed (code $LASTEXITCODE)." }
  Set-Content -Path $LockStamp -Value $lockHash -Encoding ASCII
  Write-Ok "npm packages installed"
}

# ---------------------------------------------------------------- build and launch

function Build-App {
  Write-Step "Checking the build"
  $hash = Get-SourceHash
  $old = if (Test-Path $StampFile) { (Get-Content $StampFile -Raw).Trim() } else { "" }
  if ((Test-Path $ExePath) -and $old -eq $hash) { Write-Ok "Build is up to date"; return }
  $why = if (-not (Test-Path $ExePath)) { "there is no build yet" } else { "the source changed since the last build" }
  if ($DryRun) { Write-Log "  (check mode) would build because $why"; return }
  Write-Log "  Building the app because $why. The first build takes several minutes ..."
  npm run tauri build -- --no-bundle
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ExePath)) { Stop-Launcher "The build failed (code $LASTEXITCODE). See the messages above and launcher.log." }
  Set-Content -Path $StampFile -Value $hash -Encoding ASCII
  Write-Ok "Built $ExePath"
}

# ---------------------------------------------------------------- main

Add-Content -Path $LogFile -Value "`n==================== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') start.bat $Mode" -Encoding UTF8
try {
  Write-Log "Kindred launcher ($Mode mode)" "White"
  Test-Requirements
  Update-FromRemote
  Install-Packages
  if ($Mode -eq "dev") {
    Write-Step "Starting in development mode (close the app window or press Ctrl+C to stop)"
    npm run tauri dev
    if ($LASTEXITCODE -ne 0) { Stop-Launcher "npm run tauri dev exited with code $LASTEXITCODE." }
  } else {
    Build-App
    if ($DryRun) { Write-Step "Check finished. Nothing was installed, updated or built."; exit 0 }
    Write-Step "Starting Kindred"
    Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path $ExePath)
    Write-Ok "Started. You can close this window."
  }
  exit 0
} catch {
  Write-Log ""
  Write-Log ("ERROR: " + $_.Exception.Message) "Red"
  Write-Log "Details are in $LogFile"
  Read-Host "Press Enter to close" | Out-Null
  exit 1
}
