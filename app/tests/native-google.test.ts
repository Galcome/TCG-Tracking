import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoogleSignIn, createGoogleSignOut, getNativeGoogle, type NativeGoogleSignin } from '../lib/native-google.ts';

const clientId = 'web-client.apps.googleusercontent.com';

function fakeGoogle(response: NativeGoogleSignin['signIn'] extends () => Promise<infer T> ? T : never) {
  const calls: string[] = [];
  const google: NativeGoogleSignin = {
    configure: ({ webClientId }) => calls.push(`configure:${webClientId}`),
    signIn: async () => response,
    signOut: async () => { calls.push('signOut'); return null; },
  };
  return { google, calls };
}

test('successful Google response becomes a Firebase credential', async () => {
  const { google, calls } = fakeGoogle({ type: 'success', data: { idToken: 'id-token' } });
  const credentials: unknown[] = [];
  const signedIn: unknown[] = [];
  await createGoogleSignIn({
    nativeGoogle: google,
    webClientId: ` ${clientId} `,
    credential: (token) => { credentials.push(token); return { token }; },
    signInWithCredential: async (credential) => { signedIn.push(credential); },
  })();
  assert.deepEqual(calls, [`configure:${clientId}`]);
  assert.deepEqual(credentials, ['id-token']);
  assert.deepEqual(signedIn, [{ token: 'id-token' }]);
});

test('cancelled Google response does not mutate Firebase', async () => {
  const { google } = fakeGoogle({ type: 'cancelled', data: null });
  let credentialCalls = 0;
  let firebaseCalls = 0;
  await createGoogleSignIn({
    nativeGoogle: google,
    webClientId: clientId,
    credential: () => { credentialCalls += 1; return {}; },
    signInWithCredential: async () => { firebaseCalls += 1; },
  })();
  assert.equal(credentialCalls, 0);
  assert.equal(firebaseCalls, 0);
});

test('missing ID token fails before Firebase mutation', async () => {
  const { google } = fakeGoogle({ type: 'success', data: { idToken: null } });
  let firebaseCalls = 0;
  await assert.rejects(
    createGoogleSignIn({
      nativeGoogle: google,
      webClientId: clientId,
      credential: () => ({}),
      signInWithCredential: async () => { firebaseCalls += 1; },
    })(),
    /did not return an ID token/,
  );
  assert.equal(firebaseCalls, 0);
});

test('Google or Firebase errors propagate without logging or masking them', async () => {
  const googleError = new Error('native sign-in failed');
  const google: NativeGoogleSignin = {
    configure: () => undefined,
    signIn: async () => { throw googleError; },
    signOut: async () => null,
  };
  await assert.rejects(
    createGoogleSignIn({ nativeGoogle: google, webClientId: clientId, credential: () => ({}), signInWithCredential: async () => undefined })(),
    googleError,
  );

  const firebaseError = new Error('Firebase sign-in failed');
  const { google: successfulGoogle } = fakeGoogle({ type: 'success', data: { idToken: 'id-token' } });
  await assert.rejects(
    createGoogleSignIn({ nativeGoogle: successfulGoogle, webClientId: clientId, credential: () => ({}), signInWithCredential: async () => { throw firebaseError; } })(),
    firebaseError,
  );
});

test('unavailable native Google is explicit and does not mutate Firebase', async () => {
  let firebaseCalls = 0;
  await assert.rejects(
    createGoogleSignIn({ nativeGoogle: null, webClientId: clientId, credential: () => ({}), signInWithCredential: async () => { firebaseCalls += 1; } })(),
    /unavailable in this build/,
  );
  assert.equal(firebaseCalls, 0);
});

test('native module loading is gated for Expo Go and ordinary Expo exports', () => {
  let moduleLoads = 0;
  const loadModule = () => {
    moduleLoads += 1;
    return { GoogleSignin: fakeGoogle({ type: 'cancelled', data: null }).google };
  };
  assert.equal(getNativeGoogle(clientId, { appOwnership: 'expo', expoConfig: { extra: { nativeFirebase: true } } }, loadModule), null);
  assert.equal(getNativeGoogle(clientId, { appOwnership: null, expoConfig: { extra: { nativeFirebase: false } } }, loadModule), null);
  assert.equal(moduleLoads, 0);
  assert.ok(getNativeGoogle(clientId, { appOwnership: null, expoConfig: { extra: { nativeFirebase: true } } }, loadModule));
  assert.equal(moduleLoads, 1);
  assert.equal(getNativeGoogle(clientId, { appOwnership: null, expoConfig: { extra: { nativeFirebase: true } } }, () => { throw new Error('module unavailable'); }), null);
});

test('Firebase sign-out runs first and native Google cleanup is best effort', async () => {
  const events: string[] = [];
  const { google } = fakeGoogle({ type: 'cancelled', data: null });
  const signOut = createGoogleSignOut({
    nativeGoogle: { ...google, signOut: async () => { events.push('google'); throw new Error('cleanup failed'); } },
    firebaseSignOut: async () => { events.push('firebase'); },
  });
  await signOut();
  assert.deepEqual(events, ['firebase', 'google']);
});

test('failed Firebase sign-out does not clear native Google state', async () => {
  let googleCalls = 0;
  const google = fakeGoogle({ type: 'cancelled', data: null }).google;
  const signOut = createGoogleSignOut({
    nativeGoogle: { ...google, signOut: async () => { googleCalls += 1; return null; } },
    firebaseSignOut: async () => { throw new Error('persistence failed'); },
  });
  await assert.rejects(signOut(), /persistence failed/);
  assert.equal(googleCalls, 0);
});

test('sign-out tolerates unavailable native Google', async () => {
  let firebaseCalls = 0;
  await createGoogleSignOut({ nativeGoogle: null, firebaseSignOut: async () => { firebaseCalls += 1; } })();
  assert.equal(firebaseCalls, 1);
});
