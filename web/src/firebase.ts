import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

import { config } from './config'

export const firebaseApp = initializeApp(config.firebase)
export const auth = getAuth(firebaseApp)
