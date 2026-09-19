import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertApproved, parseFingerprint, planSigning } from '../scripts/mobile/ensure-signing.mjs';

const approvedFingerprint = JSON.parse(readFileSync(new URL('../release-target.json', import.meta.url), 'utf8')).androidSigningSha256;
// Synthetic, so certificate rotation never breaks the parser's tests.
const digest = Array.from({ length: 32 }, (_unused, index) => index.toString(16).padStart(2, '0').toUpperCase()).join(':');
const expected = digest.replace(/:/g, '').toLowerCase();

test('a missing keystore never mints a replacement once a certificate is pinned', () => {
  assert.throws(() => planSigning({ hasKeyStore: false, hasPassword: false, approvedFingerprint }), /restore \.native-release/);
  // Only a project that has not pinned a certificate yet may bootstrap one.
  assert.equal(planSigning({ hasKeyStore: false, hasPassword: false, approvedFingerprint: undefined }), 'generate');
  assert.equal(planSigning({ hasKeyStore: true, hasPassword: true, approvedFingerprint }), 'verify');
});

test('a half-restored signing state is rejected either way round', () => {
  for (const [hasKeyStore, hasPassword] of [[true, false], [false, true]]) {
    assert.throws(() => planSigning({ hasKeyStore, hasPassword, approvedFingerprint }), /Incomplete local signing state/);
  }
});

test('keytool output is read case- and spelling-insensitively, or rejected', () => {
  assert.equal(parseFingerprint(`\t SHA256: ${digest}\n`), expected);
  assert.equal(parseFingerprint(`Certificate fingerprint (SHA-256): ${digest}`), expected);
  assert.equal(parseFingerprint(`SHA256: ${digest.toLowerCase()}`), expected);
  for (const output of ['', 'SHA1: 00:01:02:03', `SHA256: ${digest.slice(0, -3)}`, 'SHA256: not-a-digest']) {
    assert.throws(() => parseFingerprint(output), /Cannot read the local signing certificate/);
  }
});

test('only the approved certificate passes, and an unpinned project accepts any', () => {
  assertApproved({ fingerprint: approvedFingerprint, approvedFingerprint: approvedFingerprint.toUpperCase() });
  assertApproved({ fingerprint: 'f'.repeat(64), approvedFingerprint: undefined });
  assert.throws(() => assertApproved({ fingerprint: 'f'.repeat(64), approvedFingerprint }), /not the approved TCG release certificate/);
});
