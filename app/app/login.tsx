import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Brand, Button, Card, Copy, ErrorNotice, Field, Loading, Page } from '../components/ui';
import { useSession } from '../context/AppContext';
import { googleRedirectError } from '../lib/firebase';
import { colors } from '../context/ThemeContext';
import { CardBackdrop } from '../components/card-backdrop';
export default function Login() {
  const auth = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void googleRedirectError().then((failure) => { if (active && failure) setError(failure); });
    return () => { active = false; };
  }, []);
  if (auth.loading) return <Loading />;
  if (auth.session) return <Redirect href="/" />;
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><CardBackdrop lattice /><Page title="Welcome back">
    <View style={{ maxWidth: 480, width: '100%', alignSelf: 'center' }}><Card accent>
      <Brand />
      <Copy>Sign in with the account added to your store.</Copy>
      <ErrorNotice error={auth.error ?? error} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={() => { if (!busy && email && password) void run(() => auth.login(email, password)); }} />
      <Button variant="primary" label={busy ? 'Signing in…' : 'Sign in'} disabled={busy || !email || !password || Boolean(auth.error)} onPress={() => void run(() => auth.login(email, password))} />
      {auth.googleAvailable ? <Button label="Continue with Google" disabled={busy || Boolean(auth.error)} onPress={() => void run(auth.google)} /> :
        <Copy muted>Use email and password in this preview. Google sign-in will be available in the configured native release.</Copy>}
    </Card></View>
  </Page></SafeAreaView>;
}
