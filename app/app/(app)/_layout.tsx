import { useQuery } from '@tanstack/react-query';
import { Redirect, Slot, router, usePathname } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Copy, ErrorNotice, Loading, Row } from '../../components/ui';
import { useSession } from '../../context/AppContext';
import { colors, useResponsiveLayout } from '../../context/ThemeContext';
export default function ProtectedLayout() {
  const { session, loading, error, signOut } = useSession();
  const [actionError, setActionError] = useState<unknown>(null);
  const member = useQuery({ queryKey: ['me'], queryFn: () => session!.api.me(), enabled: Boolean(session) });
  const { isDesktop } = useResponsiveLayout();
  const path = usePathname();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
    <View style={{ flex: 1, flexDirection: isDesktop ? 'row' : 'column' }}>
      <View style={{ padding: 16, gap: 18, width: isDesktop ? 220 : '100%', borderColor: colors.edge, borderRightWidth: isDesktop ? 1 : 0, borderBottomWidth: isDesktop ? 0 : 1 }}>
        <Copy>TCG Investments</Copy><Copy muted>{member.data?.display_name ?? 'Checking membership…'}</Copy>
        <Row>{([{ href: '/', label: 'Dashboard' }, { href: '/inventory', label: 'Inventory' }, { href: '/sales', label: 'Sales' }, { href: '/money', label: 'Money' }] as const).map(link =>
          <Button key={link.href} label={(path === link.href ? '• ' : '') + link.label} onPress={() => router.push(link.href)} disabled={!member.data} />)}</Row>
        <Button label="Sign out" onPress={() => { void signOut().catch(setActionError); }} />
      </View>
      <View style={{ flex: 1 }}>
        <ErrorNotice error={error ?? actionError ?? member.error} retry={member.isError ? () => { void member.refetch(); } : undefined} />
        {member.isPending ? <Loading /> : member.data ? <Slot /> : null}
      </View>
    </View>
  </SafeAreaView>;
}
