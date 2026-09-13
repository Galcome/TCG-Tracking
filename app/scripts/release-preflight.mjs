import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nativeHelpers from './native-config.cjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profiles = ['development', 'preview', 'production'];
const platforms = ['android', 'ios'];
const publicNames = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'];
const caveat = 'Native registration, Google sign-in, telemetry, signing, device verification and distribution authorization remain separate gates. Key ownership and backend compatibility are not verified offline.';

export function buildContext(argv, env) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--profile', '--platform'].includes(key) || !argv[i + 1] || values[key]) {
      throw new Error('Only one --profile and --platform option are supported.');
    }
    values[key] = argv[i + 1];
  }
  const profile = values['--profile'] ?? env.EAS_BUILD_PROFILE;
  const platform = values['--platform'] ?? env.EAS_BUILD_PLATFORM;
  if (!profiles.includes(profile) || !platforms.includes(platform)) throw new Error('Valid build context required.');
  if ((env.EAS_BUILD_PROFILE && env.EAS_BUILD_PROFILE !== profile)
    || (env.EAS_BUILD_PLATFORM && env.EAS_BUILD_PLATFORM !== platform)) throw new Error('Build context conflict.');
  return { profile, platform };
}

/** @param {Record<string, any>} input */
export function validateRelease({ context, env = {}, target, eas, app, manifest, nativeFiles = [], dynamicConfig = false, androidService }) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!profiles.includes(context?.profile) || !platforms.includes(context?.platform)) {
    return { ok: false, errors: ['Valid explicit profile and platform context are required.'] };
  }
  if (context.profile === 'development') return { ok: true, skipped: true, errors: [], caveat };
  if (!target || target.firebaseProjectId !== 'tcg-tracking'
    || target.firebaseAuthDomain !== 'tcg-tracking.firebaseapp.com'
    || target.apiOrigin !== 'https://api-production-6ea5.up.railway.app'
    || target.androidPackage !== 'com.galcome.tcgtracking'
    || target.iosBundleIdentifier !== 'com.galcome.tcgtracking'
    || target.androidAppId !== '1:304233430839:android:75a3507eda63cefe3b64b2'
    || target.iosAppId !== '1:304233430839:ios:c1b31c756ff1e22f3b64b2'
    || target.googleWebClientId !== '304233430839-95kp2702183c867u13giihdmkc6rpkfc.apps.googleusercontent.com'
    || target.androidSigningSha1 !== 'd703f6ed97fb5ad55465c5d6611640d77ea1e140'
    || target.androidSigningSha256 !== 'aa28fc92e91998056f37fbb4eb776f04f1945f7041257c544e35e127385db85d'
    || target.nativeMode !== 'pending') fail('Release target is missing, malformed or unapproved; full native mode is unsupported.');
  if (eas?.cli?.appVersionSource !== 'local'
    || profiles.some((p) => eas?.build?.[p]?.environment !== p)
    || ['preview', 'production'].some((p) => eas?.build?.[p]?.env?.EXPO_NO_DOTENV !== '1')) {
    fail('EAS requires local versions, explicit environments and release EXPO_NO_DOTENV=1.');
  }
  if (env.EXPO_NO_DOTENV !== '1') fail('EXPO_NO_DOTENV must equal 1.');
  for (const name of publicNames) {
    if (typeof env[name] !== 'string' || !env[name].trim()) fail(`${name} is required.`);
    else if (env[name] !== env[name].trim()) fail(`${name} must not contain surrounding whitespace.`);
  }
  // Exact equality rejects normalization, credentials, paths, queries and other hosts.
  if (env.EXPO_PUBLIC_API_URL !== target?.apiOrigin) fail('EXPO_PUBLIC_API_URL must equal the approved HTTPS origin.');
  if (env.EXPO_PUBLIC_FIREBASE_PROJECT_ID !== target?.firebaseProjectId) fail('EXPO_PUBLIC_FIREBASE_PROJECT_ID does not match TCG.');
  if (env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN !== target?.firebaseAuthDomain) fail('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN does not match TCG.');
  const key = env.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (typeof key !== 'string' || !/^AIza[\w-]{35}$/.test(key)
    || /placeholder|fixture|example|household|test|your.?key/i.test(key)) fail('EXPO_PUBLIC_FIREBASE_API_KEY must be a non-placeholder Firebase public key.');
  if (!app?.expo?.android?.package || !app?.expo?.ios?.bundleIdentifier
    || app.expo.android.package !== target?.androidPackage
    || app.expo.ios.bundleIdentifier !== target?.iosBundleIdentifier
    || !manifest || dynamicConfig) fail('Static app/package configuration is missing or has unreviewed overrides/identifiers.');
  const dependencies = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((section) => Object.keys(manifest?.[section] ?? {}));
  const plugins = (app?.expo?.plugins ?? []).map((p) => Array.isArray(p) ? p[0] : p);
  const nativeAndroid = env.TCG_NATIVE_BUILD === '1' && context.platform === 'android';
  if (env.TCG_NATIVE_BUILD === '1' && context.platform !== 'android') fail('iOS native validation is not implemented yet.');
  if (nativeAndroid) {
    try {
      nativeHelpers.validateAndroidService(androidService, target, env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
      for (const dependency of ['@react-native-firebase/app', '@react-native-firebase/crashlytics', '@react-native-firebase/perf', '@react-native-google-signin/google-signin']) {
        if (!dependencies.includes(dependency)) throw new Error('Missing native dependency.');
      }
    } catch { fail('Android native service/OAuth/dependency configuration could not be validated.'); }
  }
  if (!nativeAndroid && (plugins.some((p) => /react-native-firebase|google-signin|sentry\/react-native/i.test(String(p)))
    || Object.hasOwn(app?.expo?.android ?? {}, 'googleServicesFile')
    || Object.hasOwn(app?.expo?.ios ?? {}, 'googleServicesFile')
    // Installed dependencies alone do not activate plugins in ordinary exports.
    || nativeFiles.length
    || Object.keys(env).some((name) => /GOOGLE_SERVICES|GOOGLE_SERVICE_INFO|FIREBASE_SERVICE_FILE/.test(name) && env[name]))) {
    fail('Partial native activation is forbidden while native configuration is pending.');
  }
  return { ok: errors.length === 0, skipped: false, errors, caveat };
}

function main() {
  try {
    const context = buildContext(process.argv.slice(2), process.env);
    if (context.profile === 'development') return validateRelease({ context });
    const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
    return validateRelease({ context, env: process.env,
      target: read('release-target.json'), eas: read('eas.json'), app: read('app.json'), manifest: read('package.json'),
      androidService: process.env.TCG_NATIVE_BUILD === '1' && context.platform === 'android'
        ? JSON.parse(readFileSync(process.env.GOOGLE_SERVICES_JSON || resolve(root, 'google-services.json'), 'utf8')) : undefined,
      nativeFiles: ['google-services.json', 'GoogleService-Info.plist'].filter((name) => existsSync(resolve(root, name))),
      // Pre-existing native projects can wire SDKs/service files outside app.json.
      // Reject them until full native validation is reviewed and implemented.
      dynamicConfig: ['app.config.ts', 'app.config.mjs', 'app.config.cjs', 'ios', ...(process.env.TCG_NATIVE_BUILD === '1' ? [] : ['android'])].some((name) => existsSync(resolve(root, name))),
    });
  } catch {
    // Never print parser exceptions, environment values or service-file contents.
    return { ok: false, errors: ['Release context/configuration could not be validated.'], caveat };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = main();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
