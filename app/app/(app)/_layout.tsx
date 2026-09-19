import { useQuery } from '@tanstack/react-query';
import { Redirect, Slot, router, usePathname, useGlobalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Brand, Button, Copy, ErrorNotice, Loading, Row, Sheet } from '../../components/ui';
import { AddProductDialog } from '../../components/product-forms';
import { RecordSaleDialog } from '../../components/sale-form';
import { ScanSinglesDialog } from '../../components/scan-singles';
import { ExpenseDialog } from '../../components/money-forms';
import { RipPickerDialog } from '../../components/rip-picker';
import { canLiveScan } from '../../components/card-scanner';
import { useSession } from '../../context/AppContext';
import { colors, useResponsiveLayout } from '../../context/ThemeContext';
import { useTypography } from '../../context/TypographyContext';
import { NavigationIcon } from '../../components/navigation-icon';
export default function ProtectedLayout() {
  const fonts = useTypography();
  const { session, loading, error, signOut } = useSession();
  const [actionError, setActionError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [selling, setSelling] = useState(false);
  const [scanningSingles, setScanningSingles] = useState(false);
  const [expensing, setExpensing] = useState(false);
  const [ripping, setRipping] = useState(false);
  const [quickActions, setQuickActions] = useState(false);
  const [more, setMore] = useState(false);
  const [account, setAccount] = useState(false);
  const member = useQuery({ queryKey: ['me'], queryFn: () => session!.api.me(), enabled: Boolean(session) });
  const { isDesktop, fontScale } = useResponsiveLayout();
  const wrapNavigation = !isDesktop && fontScale > 1.3;
  const path = usePathname();
  const params = useGlobalSearchParams<{ bucket?: string }>();
  const links = ([
    { href: '/', label: 'Dashboard', short: 'Home', icon: '⌂', bucket: undefined },
    { href: '/inventory', label: 'Inventory', short: 'Inventory', icon: '▦', bucket: 'inventory' },
    { href: '/inventory', label: 'Store', short: 'Store', icon: '▤', bucket: 'store' },
    { href: '/vault', label: 'Vault', short: 'Vault', icon: '◇', bucket: undefined },
    { href: '/sales', label: 'Sales', short: 'Sales', icon: '↗', bucket: undefined },
    { href: '/money', label: 'Money', short: 'Money', icon: '$', bucket: undefined },
    { href: '/reports', label: 'Reports', short: 'Reports', icon: '▥', bucket: undefined },
  ] as const);
  const mobileLinks = [links[0], { ...links[1], label: 'Stock', short: 'Stock', bucket: undefined },
    { href: '/quick-actions', label: 'Add', short: 'Add', icon: '+', bucket: undefined }, links[4],
    { href: '/more', label: 'More', short: 'More', icon: '•••', bucket: undefined }] as const;
  const navigation = (isDesktop ? links : mobileLinks).map(link => {
    const isAdd = link.href === '/quick-actions';
    const selected = link.href === '/more' ? path === '/vault' || path === '/money' || path === '/reports' : !isAdd && path === link.href && (!link.bucket || params.bucket === link.bucket);
    const tint = link.label === 'Inventory' ? colors.inventory : link.label === 'Store' ? colors.store : link.label === 'Vault' ? colors.vault : colors.accent;
    return <Pressable key={link.label} accessibilityRole="button" accessibilityLabel={link.label} accessibilityState={{ selected, disabled: !member.data }} disabled={!member.data}
      onPress={() => { if (isAdd) setQuickActions(true); else if (link.href === '/more') setMore(true); else router.push(link.bucket ? { pathname: '/inventory', params: { bucket: link.bucket } } : link.href); }}
      style={({ pressed }) => ({ flex: isDesktop || wrapNavigation ? undefined : 1, width: wrapNavigation ? '25%' : undefined, minWidth: 0, minHeight: 48, paddingVertical: 8, paddingHorizontal: isDesktop ? 12 : 0, alignItems: isDesktop ? 'flex-start' : 'center', justifyContent: 'center', gap: 3, borderRadius: 8, backgroundColor: selected ? colors.raised : 'transparent', opacity: pressed ? 0.7 : !member.data ? 0.45 : 1 })}>
      {!isDesktop ? <View style={isAdd ? { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: -14 } : undefined}><NavigationIcon name={link.label} color={isAdd ? colors.background : selected ? tint : colors.muted} /></View> : null}
      <Text style={{ maxWidth: '100%', textAlign: isDesktop ? 'left' : 'center', color: selected ? tint : colors.muted, fontSize: isDesktop ? 14 : 12, fontWeight: selected ? '700' : '500', fontFamily: selected ? fonts.bold : fonts.medium }}>{isDesktop ? link.label : link.short}</Text>
    </Pressable>;
  });
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ flex: 1, flexDirection: isDesktop ? 'row' : 'column' }}>
      <View style={{ padding: isDesktop ? 16 : 12, gap: isDesktop ? 18 : 8, width: isDesktop ? 220 : '100%', borderColor: colors.edge, borderRightWidth: isDesktop ? 1 : 0, borderBottomWidth: isDesktop ? 0 : 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><Brand /><Button variant="link" label="Account" onPress={() => setAccount(true)} /></View>
        {isDesktop ? <Copy muted>{member.data?.display_name ?? 'Checking membership…'}</Copy> : null}
        {isDesktop ? <View accessibilityLabel="Main navigation" style={{ gap: 4 }}>{navigation}</View> : null}
        {isDesktop ? <Row><Button label="New product" disabled={!member.data} onPress={() => setAdding(true)} />
          <Button variant="primary" label="New sale" disabled={!member.data} onPress={() => setSelling(true)} />
          <Button label="New expense" disabled={!member.data} onPress={() => setExpensing(true)} /></Row> : null}
      </View>
      <View style={{ flex: 1 }}>
        <ErrorNotice error={error ?? actionError ?? member.error} retry={member.isError ? () => { void member.refetch(); } : undefined} />
        {member.isPending ? <Loading /> : member.data ? <Slot /> : null}
        {member.data && adding ? <AddProductDialog onClose={() => setAdding(false)} /> : null}
        {member.data && selling ? <RecordSaleDialog onClose={() => setSelling(false)} /> : null}
        {member.data && scanningSingles ? <ScanSinglesDialog onClose={() => setScanningSingles(false)} /> : null}
        {member.data && expensing ? <ExpenseDialog onClose={() => setExpensing(false)} /> : null}
        {member.data && ripping ? <RipPickerDialog onClose={() => setRipping(false)} /> : null}
      </View>
      {!isDesktop ? <View style={{ borderTopWidth: 1, borderColor: colors.edge, backgroundColor: colors.background }}>
        <View accessibilityLabel="Main navigation" style={{ flexDirection: 'row', flexWrap: wrapNavigation ? 'wrap' : 'nowrap', paddingHorizontal: 4 }}>{navigation}</View>
      </View> : null}
      <Sheet title="Quick actions" open={quickActions} compact onClose={() => setQuickActions(false)}>
        <Button variant="primary" label="Add product" onPress={() => { setQuickActions(false); setAdding(true); }} />
        {canLiveScan ? <Button label="Scan singles" onPress={() => { setQuickActions(false); setScanningSingles(true); }} /> : null}
        <Button label="Record sale" onPress={() => { setQuickActions(false); setSelling(true); }} />
        <Button label="Rip a box" onPress={() => { setQuickActions(false); setRipping(true); }} />
        <Button label="Add expense" onPress={() => { setQuickActions(false); setExpensing(true); }} />
      </Sheet>
      <Sheet title="More" open={more} compact onClose={() => setMore(false)}>
        {links.slice(3).filter(link => ['Vault', 'Money', 'Reports'].includes(link.label)).map(link => <Button key={link.label} label={link.label} onPress={() => { setMore(false); router.push(link.href); }} />)}
      </Sheet>
      <Sheet title="Account" open={account} compact onClose={() => setAccount(false)}><Copy>{member.data?.display_name}</Copy><Button label="Sign out" onPress={() => { setAccount(false); setAdding(false); setSelling(false); setScanningSingles(false); setExpensing(false); setRipping(false); void signOut().catch(setActionError); }} /></Sheet>
    </View>
  </SafeAreaView>;
}
