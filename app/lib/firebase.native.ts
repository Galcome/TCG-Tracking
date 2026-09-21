import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, initializeAuth, signInWithCredential, signOut as firebaseSignOut, type Auth } from 'firebase/auth';
// Firebase's React Native export is selected by Metro; its browser TS declarations omit this.
// @ts-expect-error React Native conditional export
import { getReactNativePersistence } from 'firebase/auth';
import { getConfig } from './config';
import { createGoogleSignIn, createGoogleSignOut, getNativeGoogle } from './native-google';

let nativeAuth: Auth | undefined;

export function authInstance(): Auth {
  if (nativeAuth) return nativeAuth;
  const c = getConfig();
  const app = getApps().length ? getApp() : initializeApp({
    apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId,
  });
  nativeAuth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  return nativeAuth;
}

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
export const nativeGoogle = getNativeGoogle(googleWebClientId);
export const googleAvailable = Boolean(googleWebClientId && nativeGoogle);

export const googleSignIn = createGoogleSignIn({
  nativeGoogle,
  webClientId: googleWebClientId,
  credential: (idToken) => GoogleAuthProvider.credential(idToken),
  signInWithCredential: (credential) => signInWithCredential(authInstance(), credential as Parameters<typeof signInWithCredential>[1]),
});

// Native sign-in never leaves the app, so there is no redirect to come back from.
export const googleRedirectError = async (): Promise<Error | null> => null;

export const signOut = createGoogleSignOut({
  nativeGoogle,
  firebaseSignOut: () => firebaseSignOut(authInstance()),
});

export const googleSignOut = signOut;
