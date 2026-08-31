import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native shells load the same production bundle that Firebase Hosting serves.
 * Keep `server.url` out of this file: it is a live-reload escape hatch and would
 * make a store build depend on a developer machine or an external origin.
 */
const config: CapacitorConfig = {
  appId: 'com.galcome.tcgtracking',
  appName: 'TCG Investments',
  webDir: 'dist',
  loggingBehavior: 'debug',
  backgroundColor: '#0a0e1a',
  android: {
    allowMixedContent: false,
    loggingBehavior: 'debug',
    resolveServiceWorkerRequests: false,
  },
  ios: {
    // index.css owns env(safe-area-inset-*) padding for web and native alike.
    // Automatic native insets on top would pad the shell twice on notched devices.
    contentInset: 'never',
    loggingBehavior: 'debug',
  },
  server: {
    // The defaults are secure-context origins on both platforms. Keep them
    // explicit so the API CORS allowlist and release docs have a stable contract.
    hostname: 'localhost',
    androidScheme: 'https',
    iosScheme: 'capacitor',
    cleartext: false,
  },
}

export default config
