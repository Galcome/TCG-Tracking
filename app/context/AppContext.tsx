import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { onAuthStateChanged, signInWithEmailAndPassword, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { createApi, type Api } from '../lib/api';
import { createRequest, isWorthRetrying } from '../lib/transport';
import { authInstance, googleAvailable, googleSignIn, signOut as platformSignOut } from '../lib/firebase';
import { getConfig } from '../lib/config';
import { createSessionGuard } from '../lib/session';
type Session = { uid: string; api: Api; queries: QueryClient };
interface State {
  loading: boolean; error: unknown; session: Session | null;
  login(email: string, password: string): Promise<void>;
  signOut(): Promise<void>; google(): Promise<void>; googleAvailable: boolean;
}
const Context = createContext<State | null>(null);
export function AppProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<{ loading: boolean; error: unknown; session: Session | null }>({ loading: true, error: null, session: null });
  const guard = useRef(createSessionGuard());
  const session = useRef<Session | null>(null);
  const [anonymousQueries] = useState(() => new QueryClient());
  useEffect(() => {
    const sessionGuard = guard.current;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const fail = (error: unknown) => {
      if (!active) return;
      sessionGuard.invalidate();
      session.current?.queries.clear();
      session.current = null;
      setState({ loading: false, error, session: null });
    };
    try {
      const auth = authInstance();
      const config = getConfig();
      unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
        if (!active) return;
        if (user && session.current?.uid === user.uid) return;
        session.current?.queries.clear();
        const isCurrent = sessionGuard.update(user?.uid ?? null);
        const next = user ? {
          uid: user.uid,
          queries: new QueryClient({ defaultOptions: { queries: { retry: (count, error) => count < 2 && isWorthRetrying(error), staleTime: 15000 } } }),
          api: createApi(createRequest({ baseUrl: config.apiUrl, isCurrent,
            getIdToken: () => user.getIdToken(),
            transport: (url, options) => fetch(url, { method: options.method, headers: options.headers, body: options.body as BodyInit | null | undefined }),
          })),
        } : null;
        session.current = next;
        setState({ loading: false, error: null, session: next });
      }, fail);
    } catch (error) {
      // Report initialization failure through the same asynchronous observer path.
      void Promise.resolve().then(() => fail(error));
    }
    return () => {
      active = false;
      unsubscribe?.();
      sessionGuard.invalidate();
      session.current?.queries.clear();
      session.current = null;
    };
  }, []);
  const signOut = async () => {
    // Keep the authenticated screen mounted so a persistence failure is visible and
    // retryable. Only report sign-out after Firebase has actually cleared the session.
    await platformSignOut();
    guard.current.invalidate();
    session.current?.queries.clear();
    session.current = null;
    setState({ loading: false, error: null, session: null });
  };
  return <Context.Provider value={{ ...state, signOut, googleAvailable, google: googleSignIn,
    login: async (email, password) => { await signInWithEmailAndPassword(authInstance(), email.trim(), password); } }}>
    <QueryClientProvider client={state.session?.queries ?? anonymousQueries} key={state.session?.uid ?? 'anonymous'}>
      {children}
    </QueryClientProvider>
  </Context.Provider>;
}
export function useSession() {
  const state = useContext(Context);
  if (!state) throw new Error('AppProvider is missing');
  return state;
}
export function useApi() {
  const { session } = useSession();
  if (!session) throw new Error('Sign in before opening this screen');
  return session.api;
}
