import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useWindowDimensions } from 'react-native';
export const colors = { background: '#0a0e1a', surface: '#121829', raised: '#182036',
  text: '#eef2fb', muted: '#8b9bc0', edge: '#232d47', accent: '#4cc4ff',
  gain: '#74e4b3', loss: '#ff9ba6', inventory: '#70d1ff', store: '#74e4b3', vault: '#d4a8ff' };
const Context = createContext(colors);
export function ThemeProvider({ children }: PropsWithChildren) {
  return <Context.Provider value={colors}>{children}</Context.Provider>;
}
export const useTheme = () => useContext(Context);
export function useResponsiveLayout() {
  const { width, fontScale } = useWindowDimensions();
  return useMemo(() => ({ isDesktop: width >= 1000, width, fontScale }), [width, fontScale]);
}
