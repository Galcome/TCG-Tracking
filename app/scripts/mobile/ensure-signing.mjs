import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../.native-release');
const keyStore = resolve(directory, 'tcg-release.jks');
const passwordFile = resolve(directory, 'signing-password');
if (existsSync(keyStore) !== existsSync(passwordFile)) throw new Error('Incomplete local signing state; restore matching signing files.');
if (!existsSync(keyStore)) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(passwordFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  try {
    execFileSync('keytool', ['-genkeypair', '-keystore', keyStore, '-storetype', 'JKS', '-alias', 'tcg-release',
      '-storepass:file', passwordFile, '-keypass:file', passwordFile, '-keyalg', 'RSA', '-keysize', '2048',
      '-sigalg', 'SHA256withRSA', '-validity', '10000', '-dname', 'CN=TCG Tracking Android', '-noprompt'], { stdio: 'pipe' });
  } catch { throw new Error('Local release key generation failed; no signing secrets were printed.'); }
}
// Validate retained key/password together without printing their contents.
try {
  execFileSync('keytool', ['-list', '-keystore', keyStore, '-alias', 'tcg-release', '-storepass:file', passwordFile], { stdio: 'pipe' });
} catch { throw new Error('Local signing key/password verification failed.'); }
if (!readFileSync(passwordFile, 'utf8').trim()) throw new Error('Signing password file is empty.');
process.stdout.write('Stable TCG release signing key verified; retain a secure backup of .native-release signing files.\n');
