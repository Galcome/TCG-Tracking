import { Text, View } from 'react-native';
import { colors } from '../context/ThemeContext';
import { useTypography } from '../context/TypographyContext';
import { todayIso } from '../lib/format';
import type { DateFieldProps } from './date-field';
import { styles } from './ui';

/** Browsers ship a good calendar; use it rather than a native module that has no web build. */
export function DateField({ label, value, onChange, disabled = false }: DateFieldProps) {
  const fonts = useTypography();
  return <View style={styles.field}><Text style={[styles.label, { fontFamily: fonts.medium }]}>{label}</Text>
    <input type="date" aria-label={label} value={value} max={todayIso()} disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      style={{ color: colors.text, backgroundColor: colors.background, border: `1px solid ${colors.edge}`, borderRadius: 8,
        padding: 12, minHeight: 48, boxSizing: 'border-box', fontSize: 16, fontFamily: fonts.body, colorScheme: 'dark' }} />
  </View>;
}
