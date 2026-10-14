# Build FlixLeo Android on Windows, then install and smoke-test if a USB/ADB device is connected.
# Usage: powershell -ExecutionPolicy Bypass -File .\android-native\build-and-test.ps1
# Builds a DEBUG-signed APK only. Does not uninstall an existing app or touch release keys.
param(
  [switch]$BuildOnly,
  [string]$GradleCommand = "",
  [string]$AdbCommand = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$project = (Resolve-Path (Join-Path $PSScriptRoot ".")).Path
$repoRoot = Split-Path $PSScriptRoot -Parent
$apk = Join-Path $project "app\build\outputs\apk\debug\app-debug.apk"
$dest = Join-Path $repoRoot "FlixLeo-Android-debug.apk"
$package = "cyou.flixleo.android"

function Resolve-Executable([string]$name, [string[]]$candidates) {
  foreach ($candidate in $candidates) {
    if (-not $candidate) { continue }
    if (Test-Path $candidate -PathType Leaf) { return (Resolve-Path $candidate).Path }
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  throw "Cannot find $name. Install/configure $name or provide its full executable path."
}

$java = Resolve-Executable "Java 17 or 21" @("java.exe")
Write-Host "Java: $java"
& $java -version
if ($LASTEXITCODE -ne 0) { throw "Java failed" }

$sdkCandidates = @($env:ANDROID_SDK_ROOT, $env:ANDROID_HOME, (Join-Path $env:LOCALAPPDATA "Android\Sdk")) | Where-Object { $_ }
$sdk = $sdkCandidates | Where-Object { (Test-Path (Join-Path $_ "platforms\android-35\android.jar")) } | Select-Object -First 1
if (-not $sdk) {
  throw "Android SDK API 35 is missing. Install Android SDK Platform 35 and set ANDROID_SDK_ROOT."
}
$env:ANDROID_SDK_ROOT = $sdk
$env:ANDROID_HOME = $sdk
Write-Host "Android SDK: $sdk"

$gradleCandidates = @(
  $GradleCommand,
  (Join-Path $project "gradlew.bat"),
  "gradle.bat",
  "gradle"
)
$gradle = Resolve-Executable "Gradle 8.10+ / Gradle Wrapper" $gradleCandidates
Write-Host "Gradle: $gradle"
Push-Location $project
try {
  & $gradle --no-daemon -p $project :app:assembleDebug
  if ($LASTEXITCODE -ne 0) { throw "Android Gradle build failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
if (-not (Test-Path $apk -PathType Leaf)) { throw "Build returned success, but APK is missing at $apk" }
Copy-Item -Path $apk -Destination $dest -Force
Write-Host "BUILD PASS: $dest" -ForegroundColor Green

if ($BuildOnly) { Write-Host "Skipped phone tests (-BuildOnly)."; exit 0 }
$adbCandidates = @($AdbCommand, "adb.exe", (Join-Path $sdk "platform-tools\adb.exe"))
try { $adb = Resolve-Executable "Android adb (platform-tools)" $adbCandidates }
catch { Write-Warning "APK built; no adb installed, so device tests are skipped."; exit 0 }
& $adb start-server | Out-Null
$devices = @(& $adb devices | Where-Object { $_ -match '^[\w.:-]+\s+device\s*$' })
if ($devices.Count -ne 1) {
  Write-Warning "APK built, but $($devices.Count) authorized Android devices detected. Connect exactly one device with USB debugging to test."
  & $adb devices
  exit 0
}
$serial = ($devices[0] -split '\s+')[0]
Write-Host "Testing on: $serial"
& $adb -s $serial install -r $dest
if ($LASTEXITCODE -ne 0) {
  throw "Installation failed. If Android reports UPDATE_INCOMPATIBLE, the existing app has a different signing key. Do not uninstall without backing up app data."
}
& $adb -s $serial logcat -c | Out-Null
& $adb -s $serial shell am force-stop $package | Out-Null
& $adb -s $serial shell am start -W -n "$package/.MainActivity"
if ($LASTEXITCODE -ne 0) { throw "FlixLeo launch failed" }
Start-Sleep -Seconds 8
$pidList = & $adb -s $serial shell pidof $package
if (-not $pidList) { throw "SMOKE TEST FAIL: FlixLeo process exited. Check adb logcat." }
$log = Join-Path $repoRoot "FlixLeo-Android-smoke-test.log"
(& $adb -s $serial logcat -d -v brief -t 1200 |
  Select-String -Pattern "FATAL EXCEPTION|AndroidRuntime|libvlc|LibVLC|FlixLeo|cyou.flixleo.android" ) |
  Out-File -FilePath $log -Encoding utf8
if (Select-String -Path $log -Pattern "FATAL EXCEPTION" -Quiet) {
  throw "SMOKE TEST FAIL: Android fatal crash found. Read $log"
}
Write-Host "SMOKE TEST PASS: App installed and stayed running; log saved: $log" -ForegroundColor Green
Write-Host "MANUAL VIDEO TEST: In FlixLeo open a stream, select quality, and verify VLC video, audio, subtitles, seek, fullscreen and Continue Watching."
