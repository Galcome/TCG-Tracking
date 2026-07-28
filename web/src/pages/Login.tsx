import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'
import { useState, type FormEvent } from 'react'

import { auth } from '../firebase'

const GOOGLE_ERRORS: Record<string, string> = {
  'auth/unauthorized-domain':
    'This site is not an authorised Firebase domain. Add it under Authentication → Settings → Authorized domains.',
  'auth/account-exists-with-different-credential':
    'That email already signs in with a different method. Use email and password instead.',
  'auth/network-request-failed': 'Could not reach Firebase. Check your connection.',
}

/**
 * There is no sign-up flow. Signing in only gets you in if your email is on the
 * backend's ALLOWED_MEMBER_EMAILS list - anyone can obtain a Google token for this
 * Firebase project, so the backend, not this screen, decides who is a member.
 */
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch {
      // Deliberately vague: never reveal whether an address has an account.
      setError('Email or password is incorrect.')
      setBusy(false)
    }
  }

  async function onGoogle() {
    setBusy(true)
    setError(null)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (cause) {
      const code = (cause as { code?: string }).code ?? ''
      // Popups are unreliable on mobile and inside in-app browsers; redirect works
      // everywhere but costs a full page load, so it is the fallback, not the default.
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment'
      ) {
        await signInWithRedirect(auth, new GoogleAuthProvider())
        return
      }
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        // Always surface the Firebase code. A bare "sign-in failed" is unactionable,
        // and these failures are almost always configuration, not the user.
        setError(GOOGLE_ERRORS[code] ?? `Google sign-in failed${code ? ` (${code})` : ''}.`)
      }
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">TCG Card Investments</h1>
          <p className="mt-1 text-sm text-(--color-muted)">Store ledger</p>
        </div>

        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-lg border border-(--color-edge) bg-white px-4 py-3 font-medium text-slate-800 disabled:opacity-50"
        >
          <svg viewBox="0 0 18 18" aria-hidden="true" className="h-5 w-5">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-(--color-edge)" />
          <span className="text-xs text-(--color-muted)">or</span>
          <span className="h-px flex-1 bg-(--color-edge)" />
        </div>

        <label className="block">
          <span className="text-sm text-(--color-muted)">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-(--color-edge) bg-(--color-surface) px-3 py-3 text-base outline-none focus:border-(--color-accent)"
          />
        </label>

        <label className="block">
          <span className="text-sm text-(--color-muted)">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-(--color-edge) bg-(--color-surface) px-3 py-3 text-base outline-none focus:border-(--color-accent)"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-(--color-accent) px-4 py-3 font-medium text-(--color-ink) disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
