import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, useResponsiveLayout } from '../context/ThemeContext';
import { useTypography } from '../context/TypographyContext';
import { CardBackdrop } from './card-backdrop';
export function Brand() {
  const fonts = useTypography();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1, minWidth: 0, maxWidth: '100%' }}>
    <View accessible={false} style={{ width: 30, height: 36, flexShrink: 0 }}>
      <View style={{ position: 'absolute', width: 22, height: 29, borderRadius: 4, borderWidth: 1, borderColor: colors.vault, transform: [{ rotate: '-18deg' }], left: 0, top: 3 }} />
      <View style={{ position: 'absolute', width: 22, height: 29, borderRadius: 4, borderWidth: 1, borderColor: colors.store, transform: [{ rotate: '12deg' }], left: 7, top: 3 }} />
      <View style={{ position: 'absolute', width: 22, height: 29, borderRadius: 4, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.raised, left: 4 }} />
    </View><Text style={{ color: colors.text, fontSize: 18, fontWeight: '700', fontFamily: fonts.display, flexShrink: 1 }}>TCG Investments</Text>
  </View>;
}
export function Copy({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) {
  const fonts = useTypography();
  return <Text style={[styles.copy, { fontFamily: fonts.body }, muted && { color: colors.muted }]}>{children}</Text>;
}
export function Heading({ children }: PropsWithChildren) { const fonts = useTypography(); return <Text accessibilityRole="header" style={[styles.heading, { fontFamily: fonts.display }]}>{children}</Text>; }
export function Card({ children, accent = false, style }: PropsWithChildren<{ accent?: boolean; style?: StyleProp<ViewStyle> }>) { return <View style={[styles.card, accent && { overflow: 'hidden', borderTopColor: colors.accent }, style]}>{accent ? <CardBackdrop /> : null}{children}</View>; }
export function Row({ children }: PropsWithChildren) { return <View style={styles.row}>{children}</View>; }
export function Disclosure({ title, children }: PropsWithChildren<{ title: string }>) {
  const [open, setOpen] = useState(false);
  const fonts = useTypography();
  return <View style={{ gap: 12 }}><Pressable accessibilityRole="button" accessibilityLabel={title} aria-expanded={open} accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderColor: colors.edge }}>
    <Text style={{ color: colors.text, fontFamily: fonts.strong, fontSize: 16, flexShrink: 1 }}>{title}</Text><Text accessible={false} style={{ color: colors.accent, fontSize: 20 }}>{open ? '−' : '+'}</Text>
  </Pressable><View style={{ display: open ? 'flex' : 'none', gap: 12 }}>{children}</View></View>;
}
export function Button({ label, onPress, disabled = false, danger = false, variant = 'secondary', style }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; variant?: 'primary' | 'secondary' | 'link'; style?: StyleProp<ViewStyle> }) {
  const fonts = useTypography();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, variant === 'primary' && { backgroundColor: colors.accent, borderColor: colors.accent }, variant === 'link' && { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 0 }, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }, danger && { borderColor: colors.loss }, style]}>
    <Text style={{ color: danger ? colors.loss : variant === 'primary' ? colors.background : variant === 'link' ? colors.accent : colors.text, fontWeight: '600', fontFamily: fonts.strong }}>{label}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const fonts = useTypography();
  return <View style={styles.field}><Text style={[styles.label, { fontFamily: fonts.medium }]}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={colors.muted}
      style={[styles.input, { fontFamily: fonts.body }, props.multiline && { minHeight: 80 }, props.style]} /></View>;
}
export function Choice({ label, value, options, onChange, disabled = false }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const fonts = useTypography();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const close = () => { setOpen(false); setQ(''); };
  return <View style={styles.field}><Text style={[styles.label, { fontFamily: fonts.medium }]}>{label}</Text>
    <Button label={label + ': ' + (options.find(o => o.value === value)?.label ?? 'Choose')} disabled={disabled} onPress={() => setOpen(true)} />
    <Sheet title={label} open={open} onClose={close}>
      {options.length > 10 && <Field label="Find option" value={q} onChangeText={setQ} />}
      {options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())).map(o =>
        <Button key={o.value} label={o.label} disabled={disabled} onPress={() => { onChange(o.value); close(); }} />)}
    </Sheet></View>;
}
export function Sheet({ title, children, open, onClose, dismissDisabled = false, footer, compact = false }: PropsWithChildren<{ title: string; open: boolean; onClose: () => void; dismissDisabled?: boolean; footer?: ReactNode; compact?: boolean }>) {
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsiveLayout();
  const close = () => { if (!dismissDisabled) onClose(); };
  if (!open) return null;
  return <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
    <KeyboardAvoidingView enabled={Platform.OS !== 'web'} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.backdrop, !isDesktop && (compact
      ? { justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 12) }
      : { padding: 0, paddingTop: insets.top, paddingBottom: insets.bottom })]}><View role="dialog" accessibilityLabel={title} accessibilityViewIsModal style={[styles.sheet, !isDesktop && (compact
        ? { maxHeight: '80%', borderRadius: 16 }
        : { flex: 1, maxHeight: '100%', borderRadius: 0 })]}>
      <Row><Heading>{title}</Heading><Button label="Close" disabled={dismissDisabled} onPress={close} /></Row>
      <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>{children}</ScrollView>
      {footer ? <View style={{ borderTopWidth: 1, borderColor: colors.edge, paddingTop: 12, gap: 8 }}>{footer}</View> : null}
    </View></KeyboardAvoidingView>
  </Modal>;
}
export function Page({ title, children }: PropsWithChildren<{ title: string }>) {
  return <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <Heading>{title}</Heading>{children}</ScrollView>;
}
export function Loading() { return <ActivityIndicator accessibilityLabel="Loading" color={colors.accent} style={{ padding: 30 }} />; }
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const fonts = useTypography();
  if (!error) return null;
  return <Card><Text accessibilityRole="alert" style={{ color: colors.loss, fontFamily: fonts.body }}>{error instanceof Error ? error.message : 'Something went wrong'}</Text>
    {retry && <Button label="Try again" onPress={retry} />}</Card>;
}
export const styles = StyleSheet.create({
  copy: { color: colors.text, fontSize: 15, lineHeight: 22, fontVariant: ['tabular-nums'] }, heading: { color: colors.text, fontSize: 25, fontWeight: '700', letterSpacing: -0.5 },
  card: { backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderTopColor: '#35426a', borderRadius: 14, padding: 16, gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  button: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.edge, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 12, minHeight: 48, justifyContent: 'center' },
  field: { gap: 7, minWidth: 160, flexGrow: 1 }, label: { color: colors.muted, fontSize: 13 },
  input: { color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.edge, borderRadius: 8, padding: 12, minHeight: 48, fontSize: 16 },
  page: { padding: 16, gap: 16, width: '100%', maxWidth: 1440, alignSelf: 'center', paddingBottom: 32 },
  backdrop: { flex: 1, backgroundColor: '#000b', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 680, maxHeight: '90%', gap: 18 },
});
