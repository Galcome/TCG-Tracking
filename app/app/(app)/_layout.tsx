import { useQuery } from '@tanstack/react-query';
import { Redirect, Slot, router, usePathname } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Copy, ErrorNotice, Loading, Row } from '../../components/ui';
import { AddProductDialog } from '../../components/product-forms';
import { RecordSaleDialog } from '../../components/sale-form';
import { useSession } from '../../context/AppContext';
import { colors, useResponsiveLayout } from '../../context/ThemeContext';
export default function ProtectedLayout() {
  const { session, loading, error, signOut } = useSession();
  const [actionError, setActionError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [selling, setSelling] = useState(false);
  const member = useQuery({ queryKey: ['me'], queryFn: () => session!.api.me(), enabled: Boolean(session) });
  const { isDesktop } = useResponsiveLayout();
  const path = usePathname();
  const navigation = ([{ href: '/', label: 'Dashboard' }, { href: '/inventory', label: 'Inventory' }, { href: '/sales', label: 'Sales' }, { href: '/money', label: 'Money' }, { href: '/reports', label: 'Reports' }, { href: '/vault', label: 'Vault' }] as const).map(link =>
    <Button key={link.href} label={(path === link.href ? '• ' : '') + link.label} onPress={() => router.push(link.href)} disabled={!member.data} />);
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ flex: 1, flexDirection: isDesktop ? 'row' : 'column' }}>
      <View style={{ padding: isDesktop ? 16 : 12, gap: isDesktop ? 18 : 8, width: isDesktop ? 220 : '100%', borderColor: colors.edge, borderRightWidth: isDesktop ? 1 : 0, borderBottomWidth: isDesktop ? 0 : 1 }}>
        <Row><Copy>TCG Investments</Copy><Copy muted>{member.data?.display_name ?? 'Checking membership…'}</Copy></Row>
        {isDesktop ? <View style={{ gap: 8 }}>{navigation}</View> : <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="Main navigation" style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>{navigation}</ScrollView>}
        <Row><Button label="New product" disabled={!member.data} onPress={() => setAdding(true)} />
          <Button label="New sale" disabled={!member.data} onPress={() => setSelling(true)} />
          <Button label="Sign out" onPress={() => { setAdding(false); setSelling(false); void signOut().catch(setActionError); }} /></Row>
      </View>
      <View style={{ flex: 1 }}>
        <ErrorNotice error={error ?? actionError ?? member.error} retry={member.isError ? () => { void member.refetch(); } : undefined} />
        {member.isPending ? <Loading /> : member.data ? <Slot /> : null}
        {member.data && adding ? <AddProductDialog onClose={() => setAdding(false)} /> : null}
        {member.data && selling ? <RecordSaleDialog onClose={() => setSelling(false)} /> : null}
      </View>
    </View>
  </SafeAreaView>;
}
