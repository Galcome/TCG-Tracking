import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Android distribution calls the exact-main guard and retains artifact gates', () => {
  const script = readFileSync(new URL('../scripts/mobile/android-local-release.ps1', import.meta.url), 'utf8');
  const distribution = script.slice(script.indexOf("if ($Command -in @('distribute', 'release'))"));
  assert.match(distribution, /& node scripts\/mobile\/assert-main-release\.mjs/);
  assert.match(distribution, /if \(\$LASTEXITCODE -ne 0\) \{ throw 'Exact remote-main release validation failed' \}/);
  assert.doesNotMatch(script, /TCG_INTERNAL_BRANCH_RELEASE_APPROVED|--status success|git branch --show-current/);
  assert.match(distribution, /\$taskReceipt\.source -ne \(Get-SourceFingerprint\)/);
  assert.match(distribution, /\$taskReceipt\.apk -ne \(Get-ReleaseFileHash \$taskApk\)/);
  assert.match(distribution, /APK identity\/version verification failed/);
  assert.match(script, /approved TCG release certificate/);
  assert.ok(distribution.indexOf('assert-main-release.mjs') < distribution.indexOf('appdistribution:distribute'));
});

test('Android build runs typecheck and tests before it fetches config or builds', () => {
  const script = readFileSync(new URL('../scripts/mobile/android-local-release.ps1', import.meta.url), 'utf8');
  const build = script.slice(script.indexOf("if ($Command -in @('build', 'release'))"));
  const typecheck = build.indexOf('& npm run typecheck');
  const tests = build.indexOf('& npm test');
  assert.ok(typecheck > -1 && tests > -1);
  assert.match(build, /throw 'Typecheck failed; not building'/);
  assert.match(build, /throw 'Tests failed; not building'/);
  assert.ok(tests < build.indexOf('apps:sdkconfig ANDROID'), 'checks run before any release work');
  assert.ok(tests < build.indexOf('expo prebuild'));
});

test('Android distribution refuses a repeated versionCode and names the release it ships', () => {
  const script = readFileSync(new URL('../scripts/mobile/android-local-release.ps1', import.meta.url), 'utf8');
  const distribution = script.slice(script.indexOf("if ($Command -in @('distribute', 'release'))"));
  assert.ok(distribution.indexOf('was already distributed') < distribution.indexOf('appdistribution:distribute'));
  assert.match(distribution, /--release-notes \$taskNotes/);
  assert.doesNotMatch(script, /Vite/);
  assert.ok(distribution.indexOf('Set-Content -LiteralPath $taskDistributedPath') > distribution.indexOf('appdistribution:distribute'));
});

test('Android build keeps the verified APK outside the worktree, then deletes native build output', () => {
  const script = readFileSync(new URL('../scripts/mobile/android-local-release.ps1', import.meta.url), 'utf8');
  const cleanup = script.slice(script.indexOf('function Remove-NativeBuildOutput'), script.indexOf('function Get-SourceFingerprint'));
  assert.match(cleanup, /node_modules\/\*\/android/);
  assert.match(cleanup, /@\('build', '\.cxx'\)/);
  assert.doesNotMatch(cleanup, /native-release/, 'signing state must survive cleanup');
  assert.match(script, /TCG_RELEASE_ARTIFACT_DIR/);
  const copy = script.indexOf('Copy-Item -LiteralPath $taskApk -Destination $taskReleaseApk');
  assert.ok(script.indexOf('approved TCG release certificate') < copy, 'only a verified APK is kept');
  assert.ok(script.indexOf('Set-Content -LiteralPath $taskReceiptPath') < copy, 'the receipt hashes the same bytes that are kept');
  assert.ok(copy < script.lastIndexOf('Remove-NativeBuildOutput'), 'the APK is copied before build output is deleted');
  assert.ok(script.lastIndexOf('Remove-NativeBuildOutput') < script.indexOf("if ($Command -in @('distribute', 'release'))"));
});
