param([string]$ProxyUrl = '')

$ErrorActionPreference = 'Stop'
$env:EXPO_UNSTABLE_TUNNEL_V2 = $null

if ($ProxyUrl) {
  $env:HTTP_PROXY = $ProxyUrl
  $env:HTTPS_PROXY = $ProxyUrl
}

& npx.cmd expo start --dev-client --tunnel --clear --port 8081
exit $LASTEXITCODE
