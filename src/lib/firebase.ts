import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'

const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

/** ID des gemeinsamen Fahrtenbuchs (Dokument `books/<id>` in Firestore). */
export const BOOK_ID = (env.VITE_BOOK_ID as string | undefined) || 'california'
export const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true'

export function isConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)
}

let app: FirebaseApp | undefined
let auth: Auth | undefined
let db: Firestore | undefined

export function getFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } {
  if (!app) {
    app = initializeApp(firebaseConfig)
    auth = getAuth(app)
    let cache
    try {
      // Offline-Cache in IndexedDB, über mehrere Tabs geteilt
      cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    } catch {
      cache = memoryLocalCache()
    }
    db = initializeFirestore(app, { localCache: cache, ignoreUndefinedProperties: true })
    if (USE_EMULATORS) {
      const host = (env.VITE_EMULATOR_HOST as string | undefined) || '127.0.0.1'
      connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
      connectFirestoreEmulator(db, host, 8080)
    }
  }
  return { app: app!, auth: auth!, db: db! }
}
