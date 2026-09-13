export interface AppConfig { apiUrl: string; apiKey: string; authDomain: string; projectId: string; }
export function readConfig(values: Record<string, string | undefined>): AppConfig {
  const required = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_FIREBASE_API_KEY',
    'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'] as const;
  const missing = required.filter(key => !values[key]?.trim());
  if (missing.length) throw new Error('Missing app configuration: ' + missing.join(', '));
  const api = new URL(values.EXPO_PUBLIC_API_URL!.trim());
  if (api.username || api.password || api.search || api.hash || api.pathname !== '/')
    throw new Error('API URL must be an origin without credentials, query or path');
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(api.hostname);
  if (api.protocol !== 'https:' && !(api.protocol === 'http:' && local))
    throw new Error('API URL must use HTTPS outside local development');
  return { apiUrl: api.origin, apiKey: values.EXPO_PUBLIC_FIREBASE_API_KEY!.trim(),
    authDomain: values.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN!.trim(),
    projectId: values.EXPO_PUBLIC_FIREBASE_PROJECT_ID!.trim() };
}
export function getConfig() {
  return readConfig({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  });
}
