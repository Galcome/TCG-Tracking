import { useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from '../context/ThemeContext';
export function Copy({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) {
  return <Text style={[styles.copy, muted && { color: colors.muted }]}>{children}</Text>;
}
export function Heading({ children }: PropsWithChildren) { return <Text accessibilityRole="header" style={styles.heading}>{children}</Text>; }
export function Card({ children }: PropsWithChildren) { return <View style={styles.card}>{children}</View>; }
export function Row({ children }: PropsWithChildren) { return <View style={styles.row}>{children}</View>; }
export function Button({ label, onPress, disabled = false, danger = false }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }, danger && { borderColor: colors.loss }]}>
    <Text style={{ color: danger ? colors.loss : colors.text, fontWeight: '600' }}>{label}</Text>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>
    <TextInput {...props} accessibilityLabel={label} placeholderTextColor={colors.muted}
      style={[styles.input, props.multiline && { minHeight: 80 }, props.style]} /></View>;
}
export function Choice({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const close = () => { setOpen(false); setQ(''); };
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>
    <Button label={label + ': ' + (options.find(o => o.value === value)?.label ?? 'Choose')} onPress={() => setOpen(true)} />
    <Sheet title={label} open={open} onClose={close}>
      {options.length > 10 && <Field label="Find option" value={q} onChangeText={setQ} />}
      {options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())).map(o =>
        <Button key={o.value} label={o.label} onPress={() => { onChange(o.value); close(); }} />)}
    </Sheet></View>;
}
export function Sheet({ title, children, open, onClose, dismissDisabled = false }: PropsWithChildren<{ title: string; open: boolean; onClose: () => void; dismissDisabled?: boolean }>) {
  const close = () => { if (!dismissDisabled) onClose(); };
  return <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
    <View style={styles.backdrop}><View role="dialog" accessibilityLabel={title} accessibilityViewIsModal style={styles.sheet}>
      <Row><Heading>{title}</Heading><Button label="Close" disabled={dismissDisabled} onPress={close} /></Row>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>{children}</ScrollView>
    </View></View>
  </Modal>;
}
export function Page({ title, children }: PropsWithChildren<{ title: string }>) {
  return <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <Heading>{title}</Heading>{children}</ScrollView>;
}
export function Loading() { return <ActivityIndicator accessibilityLabel="Loading" color={colors.accent} style={{ padding: 30 }} />; }
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return <Card><Text accessibilityRole="alert" style={{ color: colors.loss }}>{error instanceof Error ? error.message : 'Something went wrong'}</Text>
    {retry && <Button label="Try again" onPress={retry} />}</Card>;
}
export const styles = StyleSheet.create({
  copy: { color: colors.text, fontSize: 15, lineHeight: 22 }, heading: { color: colors.text, fontSize: 25, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  button: { backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.edge, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  field: { gap: 7, minWidth: 160, flexGrow: 1 }, label: { color: colors.muted, fontSize: 13 },
  input: { color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.edge, borderRadius: 8, padding: 12, minHeight: 44, fontSize: 16 },
  page: { padding: 20, gap: 18, width: '100%', maxWidth: 1440, alignSelf: 'center', paddingBottom: 60 },
  backdrop: { flex: 1, backgroundColor: '#000b', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 680, maxHeight: '90%', gap: 18 },
});
