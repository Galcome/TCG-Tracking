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

test('Android distribution refuses a repeated versionCode and names the release it ships', () => {
  const script = readFileSync(new URL('../scripts/mobile/android-local-release.ps1', import.meta.url), 'utf8');
  const distribution = script.slice(script.indexOf("if ($Command -in @('distribute', 'release'))"));
  assert.ok(distribution.indexOf('was already distributed') < distribution.indexOf('appdistribution:distribute'));
  assert.match(distribution, /--release-notes \$taskNotes/);
  assert.doesNotMatch(script, /Vite/);
  assert.ok(distribution.indexOf('Set-Content -LiteralPath $taskDistributedPath') > distribution.indexOf('appdistribution:distribute'));
});
