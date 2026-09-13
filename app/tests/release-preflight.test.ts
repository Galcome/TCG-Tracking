import assert from 'node:assert/strict';
import { readFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContext, validateRelease } from '../scripts/release-preflight.mjs';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const target = read('release-target.json');
const env = {
  EXPO_NO_DOTENV: '1', EXPO_PUBLIC_API_URL: target.apiOrigin,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: target.firebaseProjectId,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: target.firebaseAuthDomain,
  EXPO_PUBLIC_FIREBASE_API_KEY: `AIza${'a'.repeat(35)}`,
};
const fixture = () => ({ context: { profile: 'preview', platform: 'android' }, env: { ...env },
  target: structuredClone(target), eas: read('eas.json'), app: read('app.json'), manifest: read('package.json') });

test('all release contexts pass configuration only; development explicitly skips', () => {
  for (const profile of ['preview', 'production']) for (const platform of ['android', 'ios']) {
    const result = validateRelease({ ...fixture(), context: { profile, platform } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.caveat ?? '', /separate gates/);
  }
  assert.equal(validateRelease({ context: { profile: 'development', platform: 'android' } }).skipped, true);
});

test('context fails closed, without bypass options or conflicting values', () => {
  assert.deepEqual(buildContext([], { EAS_BUILD_PROFILE: 'preview', EAS_BUILD_PLATFORM: 'ios' }), { profile: 'preview', platform: 'ios' });
  for (const args of [[], ['--profile', 'unknown', '--platform', 'ios'], ['--profile', 'preview'],
    ['--profile', 'preview', '--platform', 'web'], ['--target', 'anything'],
    ['--profile', 'preview', '--profile', 'preview', '--platform', 'ios']]) {
    assert.throws(() => buildContext(args, {}));
  }
  assert.throws(() => buildContext(['--profile', 'production', '--platform', 'ios'], { EAS_BUILD_PROFILE: 'preview' }));
  assert.throws(() => buildContext(['--profile', 'preview', '--platform', 'ios'], { EAS_BUILD_PLATFORM: 'android' }));
});

test('every public variable and dotenv guard is required', () => {
  for (const name of Object.keys(env)) {
    for (const value of ['', ' ', undefined]) {
      const input = fixture();
      Object.assign(input.env, { [name]: value });
      assert.equal(validateRelease(input).ok, false, name);
    }
  }
  const input = fixture();
  input.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID += ' ';
  assert.equal(validateRelease(input).ok, false);
});

test('only exact approved API origin is accepted', () => {
  for (const url of ['http://localhost:8001', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://10.0.2.2', 'https://192.168.1.2', 'https://household.example.com', 'https://test.invalid',
    'https://demo.ngrok.app', `${target.apiOrigin}/`, `${target.apiOrigin}/api`,
    `${target.apiOrigin}?key=secret`, `${target.apiOrigin}#secret`, target.apiOrigin.replace('https://', 'https://user:secret@'), 'not a URL']) {
    assert.equal(validateRelease({ ...fixture(), env: { ...env, EXPO_PUBLIC_API_URL: url } }).ok, false, url);
  }
});

test('wrong identities, fixture keys, malformed policies and missing configs are rejected', () => {
  for (const field of Object.keys(target)) {
    const input = fixture(); input.target[field] = 'household';
    assert.equal(validateRelease(input).ok, false, field);
  }
  for (const name of ['EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'EXPO_PUBLIC_FIREBASE_API_KEY']) {
    assert.equal(validateRelease({ ...fixture(), env: { ...env, [name]: 'e2e-public-placeholder' } }).ok, false);
  }
  for (const field of ['target', 'eas', 'app', 'manifest']) {
    assert.equal(validateRelease({ ...fixture(), [field]: undefined }).ok, false, field);
  }
  const input = fixture(); input.eas.build.production.env.EXPO_NO_DOTENV = '0';
  assert.equal(validateRelease(input).ok, false);
  input.eas = read('eas.json'); input.eas.build.preview.environment = 'development';
  assert.equal(validateRelease(input).ok, false);
  const wrongApp = fixture(); wrongApp.app.expo.ios.bundleIdentifier = 'com.household';
  assert.equal(validateRelease(wrongApp).ok, false);
});

test('pending native mode rejects partial activation and dynamic overrides', () => {
  for (const name of ['@react-native-firebase/app', '@react-native-google-signin/google-signin', '@sentry/react-native']) {
    const input = fixture(); input.manifest.dependencies[name] = '1';
    // Dormant native dependencies are allowed; activation requires a validated build.
    assert.equal(validateRelease(input).ok, true, name);
  }
  const plugin = fixture(); plugin.app.expo.plugins.push(['@react-native-firebase/app', {}]);
  assert.equal(validateRelease(plugin).ok, false);
  const service = fixture(); service.app.expo.android.googleServicesFile = 'arbitrary-path';
  assert.equal(validateRelease(service).ok, false);
  assert.equal(validateRelease({ ...fixture(), nativeFiles: ['GoogleService-Info.plist'] }).ok, false);
  assert.equal(validateRelease({ ...fixture(), dynamicConfig: true }).ok, false);
  assert.equal(validateRelease({ ...fixture(), env: { ...env, GOOGLE_SERVICES_JSON: '/secret/path' } }).ok, false);
});

test('CLI/hook sanitize rejected values and return nonzero; explicit development passes', () => {
  const script = new URL('../scripts/release-preflight.mjs', import.meta.url);
  const run = (args: string[], overrides: Record<string, string>) => spawnSync(process.execPath, [fileURLToPath(script), ...args], {
    encoding: 'utf8', env: { NODE_ENV: 'test', ...env, ...overrides },
  });
  const rejected = run(['--profile', 'preview', '--platform', 'android'], {
    EXPO_PUBLIC_FIREBASE_API_KEY: 'secret-never-print-this', EXPO_PUBLIC_API_URL: 'https://user:secret@wrong.example',
  });
  assert.equal(rejected.status, 1);
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /secret-never|user:secret|wrong.example/);
  assert.equal(run(['--profile', 'development', '--platform', 'ios'], {}).status, 0);
  const scripts = read('package.json').scripts;
  assert.equal(scripts['eas-build-pre-install'], 'node scripts/release-preflight.mjs');
  assert.equal(scripts['release:preflight'], scripts['eas-build-pre-install']);
});

test('CLI rejects pre-existing Android/iOS projects while native mode is pending', () => {
  const temporaryRoot = resolve(mkdtempSync(join(tmpdir(), 'tcg-preflight-test-')));
  assert.equal(temporaryRoot.startsWith(resolve(tmpdir()) + '\\') || temporaryRoot.startsWith(resolve(tmpdir()) + '/'), true);
  try {
    mkdirSync(join(temporaryRoot, 'scripts'));
    copyFileSync(new URL('../scripts/release-preflight.mjs', import.meta.url), join(temporaryRoot, 'scripts/release-preflight.mjs'));
    copyFileSync(new URL('../scripts/native-config.cjs', import.meta.url), join(temporaryRoot, 'scripts/native-config.cjs'));
    for (const name of ['release-target.json', 'eas.json', 'app.json', 'package.json']) {
      copyFileSync(new URL(`../${name}`, import.meta.url), join(temporaryRoot, name));
    }
    const run = () => spawnSync(process.execPath, [join(temporaryRoot, 'scripts/release-preflight.mjs'), '--profile', 'preview', '--platform', 'android'], {
      encoding: 'utf8', env: { NODE_ENV: 'test', ...env },
    });
    assert.equal(run().status, 0);
    for (const platform of ['android', 'ios']) {
      mkdirSync(join(temporaryRoot, platform));
      const result = run();
      assert.equal(result.status, 1);
      assert.match(result.stdout, /unreviewed overrides/);
      rmSync(join(temporaryRoot, platform), { recursive: true });
    }
  } finally {
    // Only this test-owned, verified temp directory is removed.
    rmSync(temporaryRoot, { recursive: true });
  }
});

test('Android native build requires matching registration, service, OAuth and dependencies', () => {
  const input = fixture();
  Object.assign(input.env, { TCG_NATIVE_BUILD: '1', EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: target.googleWebClientId });
  const service = { project_info: { project_id: target.firebaseProjectId }, client: [{
    client_info: { mobilesdk_app_id: target.androidAppId, android_client_info: { package_name: target.androidPackage } },
    oauth_client: [{ client_type: 3, client_id: target.googleWebClientId },
      { client_type: 1, android_info: { package_name: target.androidPackage, certificate_hash: target.androidSigningSha1 } }],
  }] };
  assert.equal(validateRelease({ ...input, androidService: service }).ok, true);
  assert.equal(validateRelease(input).ok, false);
  const withoutAndroidOAuth = structuredClone(service);
  withoutAndroidOAuth.client[0].oauth_client = withoutAndroidOAuth.client[0].oauth_client.filter((entry) => entry.client_type !== 1);
  assert.equal(validateRelease({ ...input, androidService: withoutAndroidOAuth }).ok, false);
  assert.equal(validateRelease({ ...input, androidService: { ...service, project_info: { project_id: 'household' } } }).ok, false);
  assert.equal(validateRelease({ ...input, context: { profile: 'preview', platform: 'ios' }, androidService: service }).ok, false);
  const missing = structuredClone(input); delete missing.manifest.dependencies['@react-native-firebase/perf'];
  assert.equal(validateRelease({ ...missing, androidService: service }).ok, false);
});
