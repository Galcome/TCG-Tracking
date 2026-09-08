import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../context/AppContext';
import { ThemeProvider } from '../context/ThemeContext';
export default function RootLayout() {
  return <SafeAreaProvider><ThemeProvider><AppProvider>
    <StatusBar style="light" /><Stack screenOptions={{ headerShown: false }} />
  </AppProvider></ThemeProvider></SafeAreaProvider>;
}
