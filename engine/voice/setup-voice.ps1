<#
  Installs the optional voice helper (Kokoro text-to-speech + faster-whisper speech recognition).
  Usage:  powershell -ExecutionPolicy Bypass -File setup-voice.ps1 [-Gpu] [-Target <folder>]
  Needs Python 3.11 (https://www.python.org/downloads/) on PATH as "py -3.11" or "python".
  Downloads about 350 MB of Kokoro model files; the Whisper "small" model downloads on first use.
#>
param([switch]$Gpu, [string]$Target = "$env:APPDATA\com.kisahime.kindred\engine\voice")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path $Target, "$Target\models" | Out-Null
Copy-Item "$here\server.py", "$here\requirements.txt" $Target -Force

$py = $null
try { & py -3.11 --version *> $null; if ($LASTEXITCODE -eq 0) { $py = @("py", "-3.11") } } catch {}
if (-not $py) { $py = @("python") }
if (-not (Test-Path "$Target\venv\Scripts\python.exe")) {
  Write-Host "Creating Python environment in $Target\venv"
  & $py[0] $py[1..9] -m venv "$Target\venv"
}
$vpy = "$Target\venv\Scripts\python.exe"
& $vpy -m pip install --upgrade pip
& $vpy -m pip install -r "$Target\requirements.txt"
if ($Gpu) { & $vpy -m pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*" }

$base = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
foreach ($f in "kokoro-v1.0.onnx", "voices-v1.0.bin") {
  $out = "$Target\models\$f"
  if (-not (Test-Path $out)) { Write-Host "Downloading $f"; Invoke-WebRequest "$base/$f" -OutFile $out }
}
Write-Host "Voice helper installed in $Target. Restart Kindred and open the Setup checklist."
