import { Capacitor } from '@capacitor/core'
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'
import { useState, type FormEvent } from 'react'

import { Wordmark } from '../components/AppShell'
import { FIELD_CLASS } from '../components/ui'
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
  const isNative = Capacitor.isNativePlatform()
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
    /* The sign-in screen is the one place with no data to show, so it is the one place
       the card-back backdrop can be turned up: lattice over a pool of light, with the
       panel sitting on top of it like a card on a playmat. */
    <div className="lattice relative flex min-h-full items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(45rem 28rem at 50% -15%, rgba(76,196,255,0.16), transparent 62%), ' +
            'radial-gradient(35rem 22rem at 50% 115%, rgba(255,203,5,0.14), transparent 60%)',
        }}
      />

      {/* The watermark. Line art at 7% on a near-black page is about as loud as a
          letterpress blind emboss - you register it before you consciously see it,
          and it never gets between the eye and the two fields that matter. Sized in
          vmin so it stays a backdrop on a phone instead of becoming the screen. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute h-[75vmin] w-[75vmin] text-(--color-game-pokemon) opacity-[0.07]"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.5"
      >
        <circle cx="12" cy="12" r="11" />
        <path d="M1 12h22" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="12" cy="12" r="2.3" />
      </svg>

      <form
        onSubmit={onSubmit}
        className="holo-panel foil relative w-full max-w-sm space-y-5 overflow-hidden rounded-2xl p-7 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <Wordmark size={42} />
          <div className="min-w-0">
            <h1 className="font-display truncate text-xl font-bold tracking-tight">
              TCG Investments
            </h1>
            <p className="text-[0.6875rem] font-semibold tracking-[0.14em] text-(--color-faint)">
              STORE LEDGER
            </p>
          </div>
        </div>

        {/* There is no sign-up, and saying so here saves the one question every new
            member would otherwise have to ask. */}
        <p className="text-sm leading-relaxed text-(--color-muted)">
          Members only. Sign in with the address that was added to the store.
        </p>

        {isNative ? (
          <p className="rounded-lg border border-(--color-edge) bg-(--color-raised) px-4 py-3 text-center text-sm leading-relaxed text-(--color-muted)">
            Google sign-in is not available in the native beta yet. Use your email and password
            below.
          </p>
        ) : (
          <button
            type="button"
            onClick={onGoogle}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-(--color-edge) bg-white px-4 py-3 font-medium text-slate-800 transition-all duration-150 hover:brightness-95 disabled:opacity-50"
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
        )}

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-(--color-edge)" />
          <span className="text-[0.625rem] font-semibold tracking-[0.12em] text-(--color-faint)">
            OR
          </span>
          <span className="h-px flex-1 bg-(--color-edge)" />
        </div>

        <label className="block">
          <span className="text-sm font-medium text-(--color-muted)">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-(--color-muted)">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        {error && (
          <p className="rounded-lg border border-(--color-loss)/40 bg-(--color-loss)/10 px-3 py-2 text-sm text-(--color-loss)">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-linear-to-b from-(--color-accent) to-(--color-accent-deep) px-4 py-3 font-semibold text-(--color-ink) shadow-sm transition-all duration-150 hover:brightness-110 disabled:opacity-50 disabled:hover:brightness-100"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
