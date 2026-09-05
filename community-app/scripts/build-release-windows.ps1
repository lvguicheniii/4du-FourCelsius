param(
    [string]$Toolchain = 'P:\NOESIS\.android-toolchain',
    [string]$Credentials = "$env:USERPROFILE\Documents\chat0716-secrets\android-signing\credentials.txt",
    [string]$StagingRoot = 'P:\sidu-cxx-key2'
)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$env:JAVA_HOME = Join-Path $Toolchain 'jdk17'
$env:ANDROID_HOME = Join-Path $Toolchain 'sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $Toolchain 'gradle-home'
$env:TEMP = Join-Path $Toolchain 'tmp'
$env:TMP = $env:TEMP
$env:NODE_ENV = 'production'
$env:SIDU_CMAKE_STAGING_ROOT = $StagingRoot
$cmakeRoot = Join-Path $Toolchain 'cmake-3.22.1'
if (!(Test-Path (Join-Path $cmakeRoot 'bin/cmake.exe'))) { throw 'A physical CMake installation at cmake-3.22.1 is required.' }
$localProperties = Join-Path $appRoot 'android/local.properties'
$properties = @()
if (Test-Path $localProperties) {
    $properties = @(Get-Content $localProperties | Where-Object { $_ -notmatch '^\s*(sdk|cmake)\.dir\s*=' })
}
$properties += 'sdk.dir=' + $env:ANDROID_HOME.Replace('\', '/')
$properties += 'cmake.dir=' + $cmakeRoot.Replace('\', '/')
[IO.File]::WriteAllLines($localProperties, $properties, [Text.UTF8Encoding]::new($false))
$credentialNames = @('SIDU_ANDROID_KEYSTORE_PATH', 'SIDU_ANDROID_KEYSTORE_PASSWORD', 'SIDU_ANDROID_KEY_ALIAS', 'SIDU_ANDROID_KEY_PASSWORD')
try {
    Get-Content -LiteralPath $Credentials | ForEach-Object {
        $pair = $_ -split '=', 2
        if ($pair.Count -eq 2 -and $pair[0] -in $credentialNames) {
            [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process')
        }
    }
    foreach ($name in $credentialNames) {
        if (![Environment]::GetEnvironmentVariable($name)) { throw "Missing signing setting: $name" }
    }
    Push-Location (Join-Path $appRoot 'android')
    try {
        & .\gradlew.bat assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a --max-workers=4 -I ../scripts/windows-native-build.gradle
        if ($LASTEXITCODE -ne 0) { throw 'Android Release build failed.' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $credentialNames) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
}
