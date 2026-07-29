/**
 * Stands in for the Firebase Auth SDK during end-to-end tests.
 *
 * Aliased over the `firebase/app` and `firebase/auth` packages by vite.e2e.config.ts, so
 * no application source knows this exists and no bypass flag ships in the real bundle.
 * `src/firebase.ts` still calls initializeApp and getAuth exactly as it does in
 * production - it just gets these instead.
 *
 * The token is a fixed string. The API under test has its verification dependency
 * overridden (tests/e2e/server.py), so nothing tries to validate it. Identity is the only
 * thing faked; everything downstream is the real system.
 */

export const E2E_TOKEN = 'e2e-fake-id-token'

const user = {
  uid: 'e2e-uid',
  email: 'e2e@example.test',
  displayName: 'E2E Tester',
  getIdToken: async () => E2E_TOKEN,
}

export function initializeApp(options: unknown) {
  return { options }
}

export function getAuth() {
  return { currentUser: user }
}

export function onAuthStateChanged(_auth: unknown, callback: (next: unknown) => void) {
  // Synchronously signed in: these tests are about the ledger, not the sign-in screen,
  // and an async hop here would only add a loading state to wait out on every page.
  callback(user)
  return () => {}
}

export async function signOut() {}

export class GoogleAuthProvider {}
export async function signInWithEmailAndPassword() {
  return { user }
}
export async function signInWithPopup() {
  return { user }
}
export async function signInWithRedirect() {}
