import { Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../context/AppContext';
import { ThemeProvider } from '../context/ThemeContext';
import { trackScreen } from '../lib/observability';
export default function RootLayout() {
  const segments = useSegments();
  const screen = segments.find((segment) => !segment.startsWith('(')) ?? 'index';
  useEffect(() => { void trackScreen(screen); }, [screen]);
  return <SafeAreaProvider><ThemeProvider><AppProvider>
    <StatusBar style="light" /><Stack screenOptions={{ headerShown: false }} />
  </AppProvider></ThemeProvider></SafeAreaProvider>;
}
