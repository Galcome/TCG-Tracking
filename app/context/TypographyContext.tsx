import { createContext, useContext, type PropsWithChildren } from 'react';
import { useFonts } from 'expo-font';

// Direct asset imports bundle only these weights, not every font in the package.
const fontAssets = {
  Inter: require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'),
  InterMedium: require('@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'),
  InterSemiBold: require('@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'),
  InterBold: require('@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf'),
  SpaceGroteskBold: require('@expo-google-fonts/space-grotesk/700Bold/SpaceGrotesk_700Bold.ttf'),
};
const bundled = { body: 'Inter', medium: 'InterMedium', strong: 'InterSemiBold', bold: 'InterBold', display: 'SpaceGroteskBold' };
const fallback = { body: undefined, medium: undefined, strong: undefined, bold: undefined, display: undefined };
const Context = createContext<typeof bundled | typeof fallback>(fallback);
export const useBundledFonts = () => useFonts(fontAssets);
export function TypographyProvider({ ready, children }: PropsWithChildren<{ ready: boolean }>) {
  return <Context.Provider value={ready ? bundled : fallback}>{children}</Context.Provider>;
}
export const useTypography = () => useContext(Context);
