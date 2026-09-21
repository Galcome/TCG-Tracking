import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebGoogleSignIn, googleError, redirectSignInError } from '../lib/web-google.ts';

const failWith = (code: string) => async () => { throw Object.assign(new Error(code), { code }); };

test('a working popup signs in without redirecting', async () => {
  const calls: string[] = [];
  await createWebGoogleSignIn({ popup: async () => calls.push('popup'), redirect: async () => calls.push('redirect') })();
  assert.deepEqual(calls, ['popup']);
});

for (const code of ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']) {
  test(`${code} falls back to a redirect`, async () => {
    const calls: string[] = [];
    await createWebGoogleSignIn({ popup: failWith(code), redirect: async () => calls.push('redirect') })();
    assert.deepEqual(calls, ['redirect']);
  });
}

for (const code of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request']) {
  test(`${code} is a quiet cancel`, async () => {
    await createWebGoogleSignIn({ popup: failWith(code), redirect: failWith('unexpected') })();
  });
}

test('other failures name the problem', async () => {
  await assert.rejects(
    createWebGoogleSignIn({ popup: failWith('auth/unauthorized-domain'), redirect: async () => null }),
    /not an authorised Firebase domain/,
  );
  await assert.rejects(
    createWebGoogleSignIn({ popup: failWith('auth/internal-error'), redirect: async () => null }),
    /^Error: Google sign-in failed \(auth\/internal-error\)\.$/,
  );
});

test('an error with no code still reads as a sentence', () => {
  assert.equal(googleError(new Error('boom')).message, 'Google sign-in failed.');
  assert.equal(googleError(null).message, 'Google sign-in failed.');
});

test('the redirect result reports only real failures', async () => {
  assert.equal(await redirectSignInError(async () => null), null);
  const failure = await redirectSignInError(failWith('auth/account-exists-with-different-credential'));
  assert.match(failure!.message, /different method/);
});
