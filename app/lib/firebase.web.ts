import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getConfig } from './config';
export function authInstance() {
  const c = getConfig();
  const app = getApps().length ? getApp() : initializeApp({
    apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId,
  });
  return getAuth(app);
}
export const googleAvailable = true;
export async function googleSignIn() {
  await signInWithPopup(authInstance(), new GoogleAuthProvider());
}
