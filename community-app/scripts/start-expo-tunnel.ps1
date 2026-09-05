$ErrorActionPreference = 'Stop'
$env:EXPO_UNSTABLE_TUNNEL_V2 = $null
$env:HTTP_PROXY = 'http://127.0.0.1:7897'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'

& npx.cmd expo start --dev-client --tunnel --clear --port 8081
exit $LASTEXITCODE
