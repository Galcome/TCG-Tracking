/**
 * Environment config, validated at startup.
 *
 * Failing loudly here beats a blank screen or a wall of 401s caused by a typo'd
 * project id. VITE_FIREBASE_PROJECT_ID must match the backend's FIREBASE_PROJECT_ID.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy web/.env.example to web/.env and fill it in.`,
    )
  }
  return value
}

export const config = {
  apiUrl: required('VITE_API_URL', import.meta.env.VITE_API_URL).replace(/\/$/, ''),
  firebase: {
    apiKey: required('VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY),
    authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: required('VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  },
  sentryDsn: import.meta.env.VITE_SENTRY_DSN ?? '',
}
