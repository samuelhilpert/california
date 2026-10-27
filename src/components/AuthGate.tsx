import { useEffect, useState, type ReactNode } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { LogOut, MailCheck, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react'
import { BOOK_ID, getFirebase, isConfigured } from '../lib/firebase'
import { authErrorMessage, createBook, isValidEmail, subscribeBook, type BookState } from '../lib/book'
import { FirestoreStore } from '../lib/store/firestoreStore'
import { setActiveStore } from '../lib/store/active'
import { SessionContext, type Session } from '../lib/store/context'
import { Button, Field, Input, Notice } from './ui'
import { Logo } from './Logo'
import { Loading } from './Loading'
import { useFeedback } from './feedback-context'

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm sm:p-8">{children}</div>
      </div>
    </div>
  )
}

export function AuthGate({ children }: { children: ReactNode }) {
  if (!isConfigured()) return <NotConfigured />
  return <Gate>{children}</Gate>
}

function Gate({ children }: { children: ReactNode }) {
  const { auth, db } = getFirebase()
  const { toast } = useFeedback()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [verified, setVerified] = useState(false)
  // Zustand des Fahrtenbuchs je Benutzer – bei Benutzerwechsel gilt automatisch wieder „lädt“
  const [bookState, setBookState] = useState<{ uid: string; state: BookState } | null>(null)
  const [store, setStore] = useState<FirestoreStore | null>(null)

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u)
    setVerified(Boolean(u?.emailVerified))
  }), [auth])

  // Firestore beendet einen Listener nach „Keine Berechtigung“. Solange kein Zugriff besteht, wird daher
  // regelmäßig neu abonniert – so öffnet sich das Buch automatisch, sobald man freigeschaltet wurde.
  const [attempt, setAttempt] = useState(0)
  const uid = user?.uid
  useEffect(() => {
    if (!uid || !verified) return
    return subscribeBook(db, BOOK_ID, (state) => setBookState({ uid, state }))
  }, [db, uid, verified, attempt])
  const book: BookState = bookState && bookState.uid === uid ? bookState.state : { status: 'loading' }
  const denied = book.status === 'denied'
  useEffect(() => {
    if (!denied) return
    const t = setInterval(() => setAttempt((a) => a + 1), 10_000)
    return () => clearInterval(t)
  }, [denied])
  const retry = () => setAttempt((a) => a + 1)

  const hasAccess = book.status === 'ok'
  const email = user?.email ?? ''
  useEffect(() => {
    if (!hasAccess || !uid) return
    const s = new FirestoreStore(db, BOOK_ID)
    setActiveStore(s, email)
    const off = s.onError((e) => toast(`Änderung konnte nicht gespeichert werden: ${authErrorMessage(e)}`, 'error'))
    // Externe Ressource (Echtzeit-Listener): Erzeugen und Aufräumen gehören in denselben Effekt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStore(s)
    return () => {
      off()
      s.dispose()
      setActiveStore(null)
      setStore(null)
    }
  }, [db, hasAccess, uid, email, toast])

  if (user === undefined) return <Shell><Loading /></Shell>
  if (user === null) return <Shell><SignIn /></Shell>
  if (!verified) return <Shell><VerifyEmail user={user} onVerified={() => setVerified(true)} /></Shell>
  if (book.status === 'loading') return <Shell><Loading /></Shell>
  if (book.status === 'offline') return <Shell><OfflineFirstStart /></Shell>
  if (book.status === 'error') return <Shell><Notice level="error" title="Verbindungsfehler">{book.message}</Notice></Shell>
  if (book.status === 'denied') return <Shell><NoAccess email={email} onRetry={retry} /></Shell>
  if (!store) return <Shell><Loading /></Shell>

  const session: Session = {
    store,
    userEmail: email,
    bookId: BOOK_ID,
    memberEmails: book.book.memberEmails,
    signOut: () => signOut(auth),
  }
  return <SessionContext.Provider value={session}><StoreReady store={store}>{children}</StoreReady></SessionContext.Provider>
}

function StoreReady({ store, children }: { store: FirestoreStore; children: ReactNode }) {
  const [ready, setReady] = useState(store.getStatus().loaded)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let alive = true
    store.ready.then(() => alive && setReady(true)).catch((e) => alive && setError(authErrorMessage(e)))
    return () => { alive = false }
  }, [store])
  if (error) return <Shell><Notice level="error" title="Daten konnten nicht geladen werden">{error}</Notice></Shell>
  if (!ready) return <Shell><Loading /></Shell>
  return <>{children}</>
}

type Mode = 'login' | 'register' | 'reset'

function SignIn() {
  const { auth } = getFirebase()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string>()
  const [info, setInfo] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError(undefined)
    setInfo(undefined)
    if (!isValidEmail(email)) return setError('Bitte eine gültige E-Mail-Adresse eingeben.')
    if (mode !== 'reset' && password.length < 8) return setError('Das Passwort muss mindestens 8 Zeichen lang sein.')
    if (mode === 'register' && password !== password2) return setError('Die Passwörter stimmen nicht überein.')
    setBusy(true)
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email.trim(), password)
      else if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await sendEmailVerification(cred.user)
      } else {
        await sendPasswordResetEmail(auth, email.trim())
        setInfo('Falls ein Konto mit dieser Adresse existiert, wurde eine E-Mail zum Zurücksetzen des Passworts gesendet.')
      }
    } catch (e) {
      setError(authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<Mode, string> = { login: 'Anmelden', register: 'Konto erstellen', reset: 'Passwort zurücksetzen' }
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{titles[mode]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {mode === 'register' ? 'Zugriff auf das gemeinsame Fahrtenbuch erhältst du, sobald ein Mitglied deine E-Mail-Adresse freigeschaltet hat.' : 'Gemeinsames Fahrtenbuch des VW California.'}
        </p>
      </div>
      {error && <Notice level="error">{error}</Notice>}
      {info && <Notice level="success">{info}</Notice>}
      <Field label="E-Mail" htmlFor="auth-email">
        <Input id="auth-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      {mode !== 'reset' && (
        <Field label="Passwort" htmlFor="auth-pw" hint={mode === 'register' ? 'Mindestens 8 Zeichen' : undefined}>
          <Input id="auth-pw" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
      )}
      {mode === 'register' && (
        <Field label="Passwort wiederholen" htmlFor="auth-pw2">
          <Input id="auth-pw2" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
        </Field>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>{busy ? 'Bitte warten …' : titles[mode]}</Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        {mode === 'login' ? (
          <>
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setMode('register')}>Konto erstellen</button>
            <button type="button" className="text-slate-500 hover:underline" onClick={() => setMode('reset')}>Passwort vergessen?</button>
          </>
        ) : (
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setMode('login')}>Zurück zur Anmeldung</button>
        )}
      </div>
    </form>
  )
}

function VerifyEmail({ user, onVerified }: { user: User; onVerified: () => void }) {
  const { auth } = getFirebase()
  const [msg, setMsg] = useState<{ level: 'info' | 'error' | 'success'; text: string }>()
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true)
    try {
      await user.reload()
      if (auth.currentUser?.emailVerified) {
        await auth.currentUser.getIdToken(true) // neues Token mit email_verified für die Datenbankregeln
        onVerified()
      } else setMsg({ level: 'info', text: 'Die E-Mail-Adresse ist noch nicht bestätigt. Bitte den Link in der E-Mail anklicken (auch im Spam-Ordner nachsehen).' })
    } catch (e) {
      setMsg({ level: 'error', text: authErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  const resend = async () => {
    try {
      await sendEmailVerification(user)
      setMsg({ level: 'success', text: 'Bestätigungs-E-Mail wurde erneut gesendet.' })
    } catch (e) {
      setMsg({ level: 'error', text: authErrorMessage(e) })
    }
  }
  return (
    <div className="space-y-4 text-center">
      <MailCheck className="mx-auto h-10 w-10 text-brand-700" />
      <h1 className="text-xl font-semibold text-slate-900">E-Mail-Adresse bestätigen</h1>
      <p className="text-sm text-slate-600">Wir haben eine E-Mail an <strong>{user.email}</strong> gesendet. Bitte den Link darin anklicken und danach hier fortfahren.</p>
      {msg && <div className="text-left"><Notice level={msg.level}>{msg.text}</Notice></div>}
      <Button variant="primary" className="w-full" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void check()} disabled={busy}>Ich habe bestätigt</Button>
      <div className="flex justify-between text-sm">
        <button className="font-medium text-brand-700 hover:underline" onClick={() => void resend()}>E-Mail erneut senden</button>
        <button className="text-slate-500 hover:underline" onClick={() => void signOut(auth)}>Abmelden</button>
      </div>
    </div>
  )
}

function NoAccess({ email, onRetry }: { email: string; onRetry: () => void }) {
  const { auth, db } = getFirebase()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const setup = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await createBook(db, BOOK_ID, email)
      onRetry()
    } catch (e) {
      setError((e as { code?: string }).code === 'permission-denied'
        ? 'Das gemeinsame Fahrtenbuch existiert bereits. Bitte ein Mitglied, deine E-Mail-Adresse unter „Einstellungen → Mitglieder“ freizuschalten.'
        : authErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-4">
      <ShieldAlert className="h-10 w-10 text-amber-600" />
      <h1 className="text-xl font-semibold text-slate-900">Noch kein Zugriff</h1>
      <p className="text-sm text-slate-600">
        Du bist als <strong>{email}</strong> angemeldet. Damit du das gemeinsame Fahrtenbuch siehst, muss ein Mitglied diese Adresse unter
        „Einstellungen → Mitglieder“ hinzufügen. Danach öffnet sich das Fahrtenbuch automatisch.
      </p>
      {error && <Notice level="warning">{error}</Notice>}
      <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        <div className="font-medium text-slate-800">Erste Einrichtung?</div>
        <p className="mt-1">Gibt es noch kein Fahrtenbuch, kannst du es jetzt anlegen. Du wirst das erste Mitglied und kannst danach die anderen freischalten.</p>
        <Button className="mt-3" onClick={() => void setup()} disabled={busy}>Fahrtenbuch einrichten</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>Erneut prüfen</Button>
        <Button variant="ghost" icon={<LogOut className="h-4 w-4" />} onClick={() => void signOut(auth)}>Abmelden</Button>
      </div>
    </div>
  )
}

function OfflineFirstStart() {
  return (
    <div className="space-y-3 text-center">
      <WifiOff className="mx-auto h-10 w-10 text-slate-500" />
      <h1 className="text-xl font-semibold text-slate-900">Keine Verbindung</h1>
      <p className="text-sm text-slate-600">Auf diesem Gerät sind noch keine Daten zwischengespeichert. Beim ersten Öffnen wird eine Internetverbindung benötigt – danach funktioniert die App auch offline.</p>
    </div>
  )
}

function NotConfigured() {
  return (
    <Shell>
      <div className="space-y-3 text-sm text-slate-600">
        <h1 className="text-xl font-semibold text-slate-900">Firebase ist nicht konfiguriert</h1>
        <p>Es fehlen die Firebase-Zugangsdaten. Lege eine Datei <code className="rounded bg-slate-100 px-1">.env.local</code> nach dem Muster von <code className="rounded bg-slate-100 px-1">.env.example</code> an und starte die App neu.</p>
        <p>Für lokale Tests ohne Firebase-Projekt: <code className="rounded bg-slate-100 px-1">npm run emulators</code> und <code className="rounded bg-slate-100 px-1">npm run dev:emulator</code>.</p>
        <p>Die vollständige Anleitung steht in der README unter „Einrichtung“.</p>
      </div>
    </Shell>
  )
}
