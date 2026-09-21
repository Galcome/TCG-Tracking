const GOOGLE_ERRORS: Record<string, string> = {
  'auth/unauthorized-domain':
    'This site is not an authorised Firebase domain. Add it under Authentication → Settings → Authorized domains.',
  'auth/account-exists-with-different-credential':
    'That email already signs in with a different method. Use email and password instead.',
  'auth/network-request-failed': 'Could not reach Firebase. Check your connection.',
};

/** Popups are unreliable on mobile browsers and in-app webviews; a redirect works everywhere. */
const USE_REDIRECT = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']);
/** The person closed the window themselves: not an error worth showing. */
const CANCELLED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

function errorCode(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * Always name the Firebase code. A bare "sign-in failed" is unactionable, and these
 * failures are almost always configuration, not the person signing in.
 */
export function googleError(cause: unknown): Error {
  const code = errorCode(cause);
  return new Error(GOOGLE_ERRORS[code] ?? `Google sign-in failed${code ? ` (${code})` : ''}.`);
}

export interface WebGoogleOptions {
  popup: () => Promise<unknown>;
  redirect: () => Promise<unknown>;
}

/**
 * Popup first, because a redirect costs a full page load; redirect only when the browser
 * will not open a popup. Returning from a redirect is picked up by the auth listener.
 */
export function createWebGoogleSignIn({ popup, redirect }: WebGoogleOptions): () => Promise<void> {
  return async () => {
    try {
      await popup();
    } catch (cause) {
      const code = errorCode(cause);
      if (USE_REDIRECT.has(code)) {
        await redirect();
        return;
      }
      if (CANCELLED.has(code)) return;
      throw googleError(cause);
    }
  };
}

/** A failed redirect sign-in only surfaces here, so the login screen asks once on load. */
export async function redirectSignInError(result: () => Promise<unknown>): Promise<Error | null> {
  try {
    await result();
    return null;
  } catch (cause) {
    return googleError(cause);
  }
}
