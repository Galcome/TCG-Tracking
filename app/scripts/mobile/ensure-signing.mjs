import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Lowercase hex of the certificate SHA-256 keytool printed, without separators. */
export function parseFingerprint(output) {
  // keytool prints either "SHA256:" or "Certificate fingerprint (SHA-256):" by version.
  const match = /(?:^|[\s(])SHA-?256\)?:\s*((?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2})(?![A-Fa-f0-9:])/.exec(output);
  if (!match) throw new Error('Cannot read the local signing certificate fingerprint.');
  return match[1].replace(/:/g, '').toLowerCase();
}

/**
 * Decide what the local signing state allows, given the release target's approved
 * certificate. Generating a replacement key whenever the keystore is absent is the
 * trap this guards: every fresh worktree has an empty (gitignored) .native-release,
 * so the build silently produces an APK that fails certificate verification minutes
 * later and could never upgrade an existing install. Only a project that has not yet
 * pinned a certificate may mint one.
 */
export function planSigning({ hasKeyStore, hasPassword, approvedFingerprint }) {
  if (hasKeyStore !== hasPassword) throw new Error('Incomplete local signing state; restore matching signing files.');
  if (hasKeyStore) return 'verify';
  if (approvedFingerprint) throw new Error('Approved release signing key is missing; restore .native-release from your backup instead of building.');
  return 'generate';
}

/** Compare against the pinned certificate before the build spends minutes on a doomed APK. */
export function assertApproved({ fingerprint, approvedFingerprint }) {
  if (approvedFingerprint && fingerprint !== approvedFingerprint.toLowerCase()) {
    throw new Error('Local signing key is not the approved TCG release certificate; restore .native-release from your backup.');
  }
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const directory = resolve(root, '.native-release');
  const keyStore = resolve(directory, 'tcg-release.jks');
  const passwordFile = resolve(directory, 'signing-password');
  const approvedFingerprint = JSON.parse(readFileSync(resolve(root, 'release-target.json'), 'utf8')).androidSigningSha256;
  if (planSigning({ hasKeyStore: existsSync(keyStore), hasPassword: existsSync(passwordFile), approvedFingerprint }) === 'generate') {
    mkdirSync(directory, { recursive: true });
    writeFileSync(passwordFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    try {
      execFileSync('keytool', ['-genkeypair', '-keystore', keyStore, '-storetype', 'JKS', '-alias', 'tcg-release',
        '-storepass:file', passwordFile, '-keypass:file', passwordFile, '-keyalg', 'RSA', '-keysize', '2048',
        '-sigalg', 'SHA256withRSA', '-validity', '10000', '-dname', 'CN=TCG Tracking Android', '-noprompt'], { stdio: 'pipe' });
    } catch { throw new Error('Local release key generation failed; no signing secrets were printed.'); }
  }
  // Validate retained key/password together without printing their contents.
  let listing;
  try {
    listing = execFileSync('keytool', ['-list', '-v', '-keystore', keyStore, '-alias', 'tcg-release', '-storepass:file', passwordFile],
      { stdio: 'pipe', encoding: 'utf8' });
  } catch { throw new Error('Local signing key/password verification failed.'); }
  assertApproved({ fingerprint: parseFingerprint(listing), approvedFingerprint });
  if (!readFileSync(passwordFile, 'utf8').trim()) throw new Error('Signing password file is empty.');
  process.stdout.write('Stable TCG release signing key verified; retain a secure backup of .native-release signing files.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
