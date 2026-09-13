/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');

function validateAndroidService(service, target, webClientId) {
  if (service?.project_info?.project_id !== target.firebaseProjectId) throw new Error('Android Firebase project mismatch.');
  const client = service.client?.find((entry) => entry.client_info?.android_client_info?.package_name === target.androidPackage);
  if (!client || client.client_info.mobilesdk_app_id !== target.androidAppId) throw new Error('Android Firebase app/package mismatch.');
  const google = client.oauth_client?.find((entry) => entry.client_type === 3);
  if (!google || google.client_id !== target.googleWebClientId || webClientId !== target.googleWebClientId) throw new Error('Google web client does not match approved Android configuration.');
  if (!client.oauth_client?.some((entry) => entry.client_type === 1
    && entry.android_info?.package_name === target.androidPackage
    && entry.android_info?.certificate_hash?.toLowerCase() === target.androidSigningSha1)) throw new Error('Android OAuth signing certificate mismatch.');
  return client;
}

function nativeConfig(config, env = process.env, root = path.resolve(__dirname, '..')) {
  const result = structuredClone(config);
  result.extra = { ...result.extra, nativeFirebase: false };
  if (env.TCG_NATIVE_BUILD !== '1') return result;
  if (env.EAS_BUILD_PLATFORM && env.EAS_BUILD_PLATFORM !== 'android') throw new Error('iOS native release configuration is not yet validated.');
  const target = JSON.parse(fs.readFileSync(path.join(root, 'release-target.json'), 'utf8'));
  const servicePath = env.GOOGLE_SERVICES_JSON || path.join(root, 'google-services.json');
  const service = JSON.parse(fs.readFileSync(servicePath, 'utf8'));
  validateAndroidService(service, target, env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
  result.android = { ...result.android, googleServicesFile: servicePath };
  result.extra.nativeFirebase = true;
  result.plugins = [...(result.plugins || []), '@react-native-firebase/app',
    '@react-native-firebase/crashlytics', '@react-native-firebase/perf',
    '@react-native-google-signin/google-signin'];
  if (env.TCG_LOCAL_ANDROID_RELEASE === '1') result.plugins.push('./scripts/mobile/with-local-signing.cjs');
  return result;
}
module.exports = { nativeConfig, validateAndroidService };
