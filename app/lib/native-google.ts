export type NativeGoogleSignInResponse =
  | { type: 'success'; data: { idToken?: string | null } }
  | { type: 'cancelled'; data: null };

export interface NativeGoogleSignin {
  configure(options: { webClientId: string }): void;
  signIn(): Promise<NativeGoogleSignInResponse>;
  signOut(): Promise<unknown>;
}

type NativeGooglePackage = { GoogleSignin?: NativeGoogleSignin };

interface ExpoRuntimeConstants {
  appOwnership?: string | null;
  expoConfig?: { extra?: Record<string, unknown> | null } | null;
}

function readExpoConstants(): ExpoRuntimeConstants {
  try {
    // Expo Constants is optional in the Node unit-test environment.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('expo-constants') as { default?: ExpoRuntimeConstants } & ExpoRuntimeConstants;
    return module.default ?? module;
  } catch {
    return {};
  }
}

function isExpoGo(constants: ExpoRuntimeConstants): boolean {
  return constants.appOwnership === 'expo';
}

function hasNativeFirebaseConfig(constants: ExpoRuntimeConstants): boolean {
  try {
    return constants.expoConfig?.extra?.nativeFirebase === true;
  } catch {
    return false;
  }
}

function loadNativeGoogleModule(): NativeGooglePackage {
  // This require must stay lazy: Expo Go does not ship the native module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-google-signin/google-signin') as NativeGooglePackage;
}

/**
 * Load the native module only in a configured native build. Expo Go does not
 * include the module, so a static import would fail before the app can render.
 */
export function getNativeGoogle(
  webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  constants = readExpoConstants(),
  loadModule: () => NativeGooglePackage = loadNativeGoogleModule,
): NativeGoogleSignin | null {
  if (!webClientId?.trim() || isExpoGo(constants) || !hasNativeFirebaseConfig(constants)) return null;
  try {
    const module = loadModule();
    return module.GoogleSignin ?? null;
  } catch {
    return null;
  }
}

export interface GoogleSignInFlowOptions {
  nativeGoogle: NativeGoogleSignin | null;
  webClientId: string | undefined;
  credential: (idToken: string) => unknown;
  signInWithCredential: (credential: unknown) => Promise<unknown>;
}

/**
 * Build the Firebase-backed Google sign-in action. Keeping this flow injected
 * makes response handling testable without loading a native module or Firebase.
 */
export function createGoogleSignIn({
  nativeGoogle,
  webClientId,
  credential,
  signInWithCredential,
}: GoogleSignInFlowOptions): () => Promise<void> {
  return async () => {
    const clientId = webClientId?.trim();
    if (!clientId) throw new Error('Google sign-in is unavailable: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not configured.');
    if (!nativeGoogle) throw new Error('Google sign-in is unavailable in this build.');

    nativeGoogle.configure({ webClientId: clientId });
    const response = await nativeGoogle.signIn();
    if (response.type === 'cancelled') return;

    const idToken = response.data.idToken;
    if (!idToken?.trim()) throw new Error('Google sign-in did not return an ID token.');
    await signInWithCredential(credential(idToken));
  };
}

export interface GoogleSignOutOptions {
  firebaseSignOut: () => Promise<void>;
  nativeGoogle: NativeGoogleSignin | null;
}

/**
 * Firebase persistence is authoritative. Only clear Google's cached session
 * after Firebase sign-out succeeds, and do not turn a best-effort cleanup
 * failure into a failed app sign-out.
 */
export function createGoogleSignOut({
  firebaseSignOut,
  nativeGoogle,
}: GoogleSignOutOptions): () => Promise<void> {
  return async () => {
    await firebaseSignOut();
    if (!nativeGoogle) return;
    try {
      await nativeGoogle.signOut();
    } catch {
      // Firebase has already signed out; the native Google cache is best effort.
    }
  };
}
