import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';

/** Original sleeve geometry; static, low contrast, non-interactive and screen-reader hidden. */
export function CardBackdrop({ lattice = false }: { lattice?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradient = 'foil' + id;
  const pattern = 'sleeve' + id;
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" aria-hidden>
      <Defs>
        <LinearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#4cc4ff" stopOpacity="0.10" />
          <Stop offset="50%" stopColor="#a55eea" stopOpacity="0.035" />
          <Stop offset="100%" stopColor="#ffcb05" stopOpacity="0.04" />
        </LinearGradient>
        <Pattern id={pattern} width="32" height="28" patternUnits="userSpaceOnUse">
          <Path d="M-16 0L0 28L16 0L32 28L48 0" stroke="#ffffff" strokeOpacity="0.022" strokeWidth="1" fill="none" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={'url(#' + gradient + ')'} />
      {lattice ? <Rect width="100%" height="100%" fill={'url(#' + pattern + ')'} /> : null}
    </Svg>
  </View>;
}
