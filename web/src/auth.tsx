import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth'
import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { auth } from './firebase'

interface AuthState {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => onAuthStateChanged(auth, (next) => {
    setUser(next)
    setLoading(false)
  }), [])

  const value = useMemo(
    () => ({ user, loading, signOut: () => firebaseSignOut(auth) }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
