import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAuth, type Auth } from 'firebase/auth';
// Firebase's React Native export is selected by Metro; its browser TS declarations omit this.
// @ts-expect-error React Native conditional export
import { getReactNativePersistence } from 'firebase/auth';
import { getConfig } from './config';
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
export const googleAvailable = false;
export async function googleSignIn(): Promise<void> {
  throw new Error('Google sign-in requires the configured native development build. Use email and password for this preview.');
}
