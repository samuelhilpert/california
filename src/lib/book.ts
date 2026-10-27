import { doc, onSnapshot, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
import { DEFAULT_CATEGORIES } from './store/defaults'

export interface Book {
  name: string
  memberEmails: string[]
  createdAt?: string
  createdBy?: string
}

export type BookState =
  | { status: 'loading' }
  | { status: 'ok'; book: Book }
  /** Kein Zugriff: Buch existiert nicht oder man ist kein Mitglied (die Regeln unterscheiden das bewusst nicht). */
  | { status: 'denied' }
  /** Offline und noch nichts im lokalen Cache. */
  | { status: 'offline' }
  | { status: 'error'; message: string }

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function subscribeBook(db: Firestore, bookId: string, cb: (s: BookState) => void): () => void {
  return onSnapshot(
    doc(db, 'books', bookId),
    { includeMetadataChanges: true },
    (snap) => {
      if (!snap.exists() && snap.metadata.fromCache) cb({ status: navigator.onLine ? 'loading' : 'offline' })
      else if (!snap.exists()) cb({ status: 'denied' })
      else cb({ status: 'ok', book: snap.data() as Book })
    },
    (err) => {
      if ((err as { code?: string }).code === 'permission-denied') cb({ status: 'denied' })
      else cb({ status: 'error', message: err.message })
    },
  )
}

/** Legt das gemeinsame Fahrtenbuch an (nur möglich, wenn es noch nicht existiert). */
export async function createBook(db: Firestore, bookId: string, ownerEmail: string): Promise<void> {
  const email = normalizeEmail(ownerEmail)
  // Zuerst das Buch selbst (die Regeln prüfen die Mitgliedschaft über dieses Dokument) …
  await setDoc(doc(db, 'books', bookId), {
    name: 'VW California',
    memberEmails: [email],
    createdAt: new Date().toISOString(),
    createdBy: email,
  } satisfies Book)
  // … danach die Standardkategorien
  const batch = writeBatch(db)
  for (const c of DEFAULT_CATEGORIES) batch.set(doc(db, 'books', bookId, 'categories', c.id), c)
  await batch.commit()
}

export async function updateMembers(db: Firestore, bookId: string, emails: string[]): Promise<void> {
  const list = [...new Set(emails.map(normalizeEmail))]
  if (list.length === 0) throw new Error('Mindestens ein Mitglied muss bestehen bleiben.')
  if (list.length > 20) throw new Error('Maximal 20 Mitglieder.')
  await updateDoc(doc(db, 'books', bookId), { memberEmails: list })
}

/** Firebase-Fehlercodes in verständliche deutsche Meldungen übersetzen. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string }).code ?? ''
  const map: Record<string, string> = {
    'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
    'auth/missing-password': 'Bitte ein Passwort eingeben.',
    'auth/invalid-credential': 'E-Mail oder Passwort ist falsch.',
    'auth/wrong-password': 'E-Mail oder Passwort ist falsch.',
    'auth/user-not-found': 'E-Mail oder Passwort ist falsch.',
    'auth/email-already-in-use': 'Für diese E-Mail-Adresse gibt es bereits ein Konto. Bitte anmelden oder Passwort zurücksetzen.',
    'auth/weak-password': 'Das Passwort ist zu schwach (mindestens 8 Zeichen).',
    'auth/too-many-requests': 'Zu viele Versuche. Bitte später erneut versuchen.',
    'auth/network-request-failed': 'Keine Verbindung zum Server. Bitte Internetverbindung prüfen.',
    'auth/requires-recent-login': 'Bitte zur Sicherheit erneut anmelden und dann wiederholen.',
    'permission-denied': 'Keine Berechtigung.',
  }
  return map[code] ?? (err instanceof Error ? err.message : 'Unbekannter Fehler')
}
