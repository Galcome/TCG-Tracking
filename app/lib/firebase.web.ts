import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth, getRedirectResult, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as firebaseSignOut,
} from 'firebase/auth';
import { getConfig } from './config';
import { createWebGoogleSignIn, redirectSignInError } from './web-google';
export function authInstance() {
  const c = getConfig();
  const app = getApps().length ? getApp() : initializeApp({
    apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId,
  });
  return getAuth(app);
}
export const googleAvailable = true;
export const signOut = () => firebaseSignOut(authInstance());
export const googleSignIn = createWebGoogleSignIn({
  popup: () => signInWithPopup(authInstance(), new GoogleAuthProvider()),
  redirect: () => signInWithRedirect(authInstance(), new GoogleAuthProvider()),
});
export const googleRedirectError = () => redirectSignInError(() => getRedirectResult(authInstance()));
