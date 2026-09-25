param(
    [ValidateSet('doctor', 'build', 'distribute', 'release')][string]$Command = 'doctor',
    [string]$TesterGroups = $env:FIREBASE_TESTER_GROUPS
)
$ErrorActionPreference = 'Stop'
$taskAppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
function Get-ReleaseFileHash([string]$Path) {
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead([IO.Path]::GetFullPath($Path))
    try { return [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '') }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
}
function Get-SourceFingerprint {
    $taskFiles = @(& git ls-files --cached --others --exclude-standard -- .) | Sort-Object -Unique
    if ($LASTEXITCODE -ne 0) { throw 'Cannot fingerprint release sources' }
    $taskLines = foreach ($taskFile in $taskFiles) {
        if (Test-Path -LiteralPath $taskFile -PathType Leaf) { "$taskFile $(Get-ReleaseFileHash $taskFile)" }
    }
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($taskHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(($taskLines -join "`n")))) }
    finally { $taskHasher.Dispose() }
}
Push-Location -LiteralPath $taskAppRoot
try {
    $target = Get-Content -LiteralPath release-target.json -Raw | ConvertFrom-Json
    if ($target.firebaseProjectId -ne 'tcg-tracking' -or $target.androidPackage -ne 'com.galcome.tcgtracking') { throw 'Unapproved release target' }
    & java -version
    if ($LASTEXITCODE -ne 0) { throw 'Java unavailable' }
    if (-not (Test-Path -LiteralPath $env:ANDROID_HOME)) { throw 'ANDROID_HOME must identify an installed Android SDK' }
    if ($Command -eq 'doctor') {
        Write-Output 'Local Java/Android SDK available. Release remains subject to auth, signing, exact-commit and tester acceptance.'
        return
    }
    # Use the already authenticated local CLI directly. On Windows, repeatedly launching
    # firebase-tools through `npx -y` can crash after a successful config download with a
    # libuv handle assertion, leaving a valid file but a false nonzero exit code.
    $taskFirebase = (Get-Command firebase -ErrorAction SilentlyContinue).Source
    if ([string]::IsNullOrWhiteSpace($taskFirebase)) { throw 'Authenticated Firebase CLI unavailable' }
    if ($Command -in @('build', 'release')) {
        # Never package code that fails its own checks; CI runs the same two.
        & npm run typecheck
        if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed; not building' }
        & npm test
        if ($LASTEXITCODE -ne 0) { throw 'Tests failed; not building' }
        $taskSourceFingerprint = Get-SourceFingerprint
        New-Item -ItemType Directory -Path .native-release -Force | Out-Null
        $taskServiceSnapshot = [IO.Path]::GetFullPath((Join-Path $taskAppRoot ".native-release/google-services-$([guid]::NewGuid()).json"))
        & $taskFirebase apps:sdkconfig ANDROID $target.androidAppId --project $target.firebaseProjectId --out $taskServiceSnapshot
        if ($LASTEXITCODE -ne 0) { throw 'Android service config fetch failed' }
        $env:GOOGLE_SERVICES_JSON = $taskServiceSnapshot
        if (-not (Test-Path -LiteralPath .firebase-web-config.json)) {
            & $taskFirebase apps:sdkconfig WEB '1:304233430839:web:2573fce7cf46858d3b64b2' --project $target.firebaseProjectId --out .firebase-web-config.json
            if ($LASTEXITCODE -ne 0) { throw 'Firebase web config fetch failed' }
        }
        $web = Get-Content -LiteralPath .firebase-web-config.json -Raw | ConvertFrom-Json
        if ($web.projectId -ne $target.firebaseProjectId -or $web.authDomain -ne $target.firebaseAuthDomain) { throw 'Firebase web identity mismatch' }
        $env:EXPO_PUBLIC_API_URL = $target.apiOrigin
        $env:EXPO_PUBLIC_FIREBASE_PROJECT_ID = $web.projectId
        $env:EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN = $web.authDomain
        $env:EXPO_PUBLIC_FIREBASE_API_KEY = $web.apiKey
        $env:EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = $target.googleWebClientId
        $env:EXPO_NO_DOTENV = '1'
        $env:TCG_NATIVE_BUILD = '1'
        $env:TCG_LOCAL_ANDROID_RELEASE = '1'
        $env:NODE_ENV = 'production'
        & node scripts/release-preflight.mjs --profile preview --platform android
        if ($LASTEXITCODE -ne 0) { throw 'Release configuration preflight failed' }
        & node scripts/mobile/ensure-signing.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Local release signing preparation failed' }
        # No --clean: preserve local native signing state. Generated project is ignored.
        & npx expo prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { throw 'Android prebuild failed' }
        $taskWrapper = [IO.Path]::GetFullPath((Join-Path $taskAppRoot 'android/gradlew.bat'))
        Push-Location -LiteralPath (Join-Path $taskAppRoot 'android')
        try {
            $taskToolchain = Join-Path $taskAppRoot 'scripts/mobile/cmake-toolchain.gradle'
            & $taskWrapper ':app:assembleRelease' '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m' --max-workers=2 --init-script $taskToolchain
            if ($LASTEXITCODE -ne 0) { throw 'Gradle release build failed' }
        } finally { Pop-Location }
        if ((Get-SourceFingerprint) -ne $taskSourceFingerprint) { throw 'Release sources changed during build; rebuild before distribution' }
    }
    $taskApk = Join-Path $taskAppRoot 'android/app/build/outputs/apk/release/app-release.apk'
    if (-not (Test-Path -LiteralPath $taskApk) -or (Get-Item -LiteralPath $taskApk).Length -eq 0) { throw 'APK absent or empty' }
    Write-Output "Internal Android APK ready: $taskApk"
    $taskApkSigner = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/apksigner.bat'
    $taskSignature = (& $taskApkSigner verify --print-certs $taskApk | Out-String)
    $taskSignerExitCode = $LASTEXITCODE
    $taskDigest = [regex]::Match($taskSignature, '(?im)^Signer #1 certificate SHA-256 digest:\s*([a-f0-9:]+)\s*$')
    if ($taskSignerExitCode -ne 0 -or -not $taskDigest.Success -or $taskDigest.Groups[1].Value.Replace(':', '').ToLowerInvariant() -ne $target.androidSigningSha256.ToLowerInvariant()) { throw 'APK is not signed with the approved TCG release certificate' }
    $taskReceiptPath = Join-Path $taskAppRoot '.native-release/build-receipt.json'
    if ($Command -in @('build', 'release')) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $taskReceiptPath) -Force | Out-Null
        @{ source = $taskSourceFingerprint; apk = (Get-ReleaseFileHash $taskApk) } |
            ConvertTo-Json | Set-Content -LiteralPath $taskReceiptPath -Encoding UTF8
    }
    if ($Command -in @('distribute', 'release')) {
        # Verify the actual remote main commit, not a mutable local branch label.
        # Detached origin/main allows release from the isolated Codex worktree.
        & node scripts/mobile/assert-main-release.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Exact remote-main release validation failed' }
        if (-not (Test-Path -LiteralPath $taskReceiptPath)) { throw 'Missing build receipt; build with this script first' }
        $taskReceipt = Get-Content -LiteralPath $taskReceiptPath -Raw | ConvertFrom-Json
        if ($taskReceipt.source -ne (Get-SourceFingerprint) -or $taskReceipt.apk -ne (Get-ReleaseFileHash $taskApk)) { throw 'Sources or APK differ from validated build receipt' }
        $taskAapt = Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/aapt.exe'
        $taskBadging = (& $taskAapt dump badging $taskApk | Out-String)
        $taskConfig = Get-Content -LiteralPath app.json -Raw | ConvertFrom-Json
        $taskIdentity = [regex]::Escape("package: name='$($target.androidPackage)' versionCode='$($taskConfig.expo.android.versionCode)' versionName='$($taskConfig.expo.version)'")
        if ($LASTEXITCODE -ne 0 -or $taskBadging -notmatch $taskIdentity) { throw 'APK identity/version verification failed' }
        if ([string]::IsNullOrWhiteSpace($TesterGroups) -or $TesterGroups -notmatch '^[a-zA-Z0-9_,\-]+$') { throw 'Explicit valid Firebase tester group aliases required' }
        # Android will not install a versionCode over an equal one, so a repeat upload is
        # a release testers cannot take. Refuse it here instead of after the upload.
        $taskVersionCode = [int]$taskConfig.expo.android.versionCode
        $taskDistributedPath = Join-Path $taskAppRoot '.native-release/distributed.json'
        if (Test-Path -LiteralPath $taskDistributedPath) {
            $taskDistributed = Get-Content -LiteralPath $taskDistributedPath -Raw | ConvertFrom-Json
            if ($taskVersionCode -le [int]$taskDistributed.versionCode) { throw "versionCode $taskVersionCode was already distributed; bump expo.android.versionCode and expo.version in app.json" }
        }
        $taskCommit = (& git rev-parse --short=12 HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read the release commit' }
        $taskNotes = "TCG Tracking $($taskConfig.expo.version) ($taskVersionCode) from main $taskCommit. Same app as https://tcg-tracking.web.app."
        & $taskFirebase appdistribution:distribute $taskApk --app $target.androidAppId --project $target.firebaseProjectId --groups $TesterGroups --release-notes $taskNotes
        if ($LASTEXITCODE -ne 0) { throw 'Firebase distribution failed; local APK retained' }
        @{ versionCode = $taskVersionCode; version = $taskConfig.expo.version; commit = $taskCommit } |
            ConvertTo-Json | Set-Content -LiteralPath $taskDistributedPath -Encoding UTF8
    }
} finally { Pop-Location }
