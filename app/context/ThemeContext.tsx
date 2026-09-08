import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useWindowDimensions } from 'react-native';
export const colors = { background: '#0a0e1a', surface: '#121829', raised: '#1b2540',
  text: '#f2f5ff', muted: '#a7b7d8', edge: '#344364', accent: '#70d1ff',
  gain: '#74e4b3', loss: '#ff9ba6', inventory: '#70d1ff', store: '#74e4b3', vault: '#d4a8ff' };
const Context = createContext(colors);
export function ThemeProvider({ children }: PropsWithChildren) {
  return <Context.Provider value={colors}>{children}</Context.Provider>;
}
export const useTheme = () => useContext(Context);
export function useResponsiveLayout() {
  const { width } = useWindowDimensions();
  return useMemo(() => ({ isDesktop: width >= 1000, width }), [width]);
}
