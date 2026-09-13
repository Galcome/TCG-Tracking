import { View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { colors } from '../context/ThemeContext';
import { Copy } from './ui';

const gameColors: Record<string, string> = {
  pokemon: '#ffcb05', 'magic-the-gathering': '#f0932b', 'yu-gi-oh': '#a55eea',
  lorcana: '#26de81', 'one-piece': '#fc5c65', digimon: '#45aaf2',
};
// Same 24x24 geometry as the existing website, hoisted so list renders reuse it.
const marks: Record<string, React.ReactNode> = {
  pokemon: <><Circle cx="12" cy="12" r="11" fill="#f2f5fb" /><Path d="M1 12a11 11 0 0 1 22 0Z" fill="#ee2b3b" /><Path d="M1 12h22" stroke={colors.background} strokeWidth="2.6" /><Circle cx="12" cy="12" r="4.2" fill={colors.background} /><Circle cx="12" cy="12" r="2.3" fill="#f2f5fb" /></>,
  'magic-the-gathering': <>
    <Path d="M12 12 L12 1 A11 11 0 0 1 22.46 8.6 Z" fill="#f4f0dc" />
    <Path d="M12 12 L22.46 8.6 A11 11 0 0 1 18.47 20.9 Z" fill="#2f7fd0" />
    <Path d="M12 12 L18.47 20.9 A11 11 0 0 1 5.53 20.9 Z" fill="#4a4551" />
    <Path d="M12 12 L5.53 20.9 A11 11 0 0 1 1.54 8.6 Z" fill="#d9453c" />
    <Path d="M12 12 L1.54 8.6 A11 11 0 0 1 12 1 Z" fill="#3d9c63" />
    <Circle cx="12" cy="12" r="11" fill="none" stroke="#ffffff4d" />
  </>,
  'yu-gi-oh': <><Path d="M12 21.6 L2.2 4.6 H21.8 Z" fill={gameColors['yu-gi-oh']} /><Circle cx="12" cy="10.2" r="2.4" fill={colors.background} /></>,
  lorcana: <Path d="M12 2.2c0 0 7.6 8.6 7.6 12.6a7.6 7.6 0 0 1-15.2 0c0-4 7.6-12.6 7.6-12.6z" fill={gameColors.lorcana} />,
  'one-piece': <><Ellipse cx="12" cy="16.4" rx="10" ry="3.3" fill={gameColors['one-piece']} /><Path d="M6 16.4C6 9.9 8.7 5.4 12 5.4S18 9.9 18 16.4Z" fill={gameColors['one-piece']} /><Rect x="5.6" y="13.5" width="12.8" height="2.5" fill={colors.background} opacity="0.5" /></>,
  digimon: <><Ellipse cx="12" cy="13.2" rx="8.2" ry="9.6" fill={gameColors.digimon} /><Path d="M4.3 13.2 L7.6 11 L10.1 14.2 L13 11 L15.6 14.2 L19.7 12.2" fill="none" stroke={colors.background} strokeWidth="1.7" strokeLinejoin="round" /></>,
};
export function GameIdentity({ slug, name }: { slug: string; name: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={16} height={16} viewBox="0 0 24 24" aria-hidden>
        {marks[slug] ?? <Circle cx="12" cy="12" r="9" fill={gameColors[slug] ?? '#778ca3'} />}
      </Svg>
    </View><Copy muted>{name}</Copy>
  </View>;
}
