import Constants from 'expo-constants';

export async function trackScreen(screen: string) {
  if (!Constants.expoConfig?.extra?.nativeFirebase) return;
  try {
    const { getCrashlytics, setAttributes } = await import('@react-native-firebase/crashlytics');
    await setAttributes(getCrashlytics(), {
      app_version: Constants.expoConfig?.version ?? 'unknown',
      screen: ['index', 'inventory', 'sales', 'money', 'products', 'reports', 'login'].includes(screen) ? screen : 'other',
    });
  } catch { /* Missing native telemetry never blocks auth or workflows. */ }
}
