import Svg, { Path } from 'react-native-svg';

const paths: Record<string, string> = {
  Dashboard: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  Stock: 'M4 5h16v16H4zM4 10h16M9 5v5M15 5v5M9 15h6',
  Vault: 'm12 3 9 9-9 9-9-9zM8 12h8M12 8v8',
  Sales: 'M4 20h16M6 16l5-5 4 3 5-9M15 5h5v5',
  More: 'M5 11h2v2H5zM11 11h2v2h-2zM17 11h2v2h-2z',
};

export function NavigationIcon({ name, color }: { name: string; color: string }) {
  return <Svg accessible={false} width={22} height={22} viewBox="0 0 24 24" fill="none"><Path d={paths[name] ?? paths.Stock} stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /></Svg>;
}
