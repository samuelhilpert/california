import { clsx } from 'clsx'
import { useState } from 'react'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { ChevronRight, DatabaseBackup, KeyRound, LogOut, Monitor, Moon, Plus, Smartphone, Sun, Trash2, UserCog, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppData, useSession } from '../lib/store/context'
import { findMemberPerson, setPersonActive } from '../lib/store/repo'
import { getFirebase } from '../lib/firebase'
import { authErrorMessage, isValidEmail, normalizeEmail, updateMembers } from '../lib/book'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import { Badge, Button, Card, CardTitle, Field, Input, Notice, PageHeader } from '../components/ui'
import { useFeedback } from '../components/feedback-context'

export function SettingsPage() {
  const { userEmail, memberEmails, bookId, signOut } = useSession()
  const { toast, confirm } = useFeedback()
  const data = useAppData()
  const { auth, db } = getFirebase()
  const [newMember, setNewMember] = useState('')
  const [memberError, setMemberError] = useState<string>()
  const [theme, setTheme] = useState<ThemePref>(getThemePref)
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' })
  const [pwError, setPwError] = useState<string>()
  const me = normalizeEmail(userEmail)

  const addMember = async () => {
    setMemberError(undefined)
    const e = normalizeEmail(newMember)
    if (!isValidEmail(e)) return setMemberError('Bitte eine gültige E-Mail-Adresse eingeben.')
    if (memberEmails.includes(e)) return setMemberError('Diese Adresse ist bereits Mitglied.')
    try {
      await updateMembers(db, bookId, [...memberEmails, e])
      setNewMember('')
      toast(`${e} wurde freigeschaltet. Die Person kann sich jetzt mit dieser Adresse registrieren bzw. anmelden.`)
    } catch (err) {
      setMemberError(authErrorMessage(err))
    }
  }

  const removeMember = async (email: string) => {
    const self = email === me
    const ok = await confirm({
      title: self ? 'Eigenen Zugriff entfernen?' : `${email} entfernen?`,
      danger: true,
      confirmLabel: 'Entfernen',
      message: self
        ? 'Du verlierst sofort den Zugriff auf das gemeinsame Fahrtenbuch. Nur ein anderes Mitglied kann dich wieder freischalten.'
        : 'Die Person verliert sofort den Zugriff auf das gemeinsame Fahrtenbuch. Ihre bisherigen Fahrten bleiben erhalten, sie wird aber bei neuen Fahrten nicht mehr angeboten.',
    })
    if (!ok) return
    try {
      await updateMembers(db, bookId, memberEmails.filter((m) => m !== email))
      // Fahrten und Abrechnungen behalten die Person; bei neuen Einträgen wird sie nicht mehr angeboten.
      const person = findMemberPerson(data.persons, email)
      if (person?.active && !self) await setPersonActive(person.id, false)
      toast(`${email} wurde entfernt.`)
    } catch (err) {
      toast(authErrorMessage(err), 'error')
    }
  }

  const changePassword = async () => {
    setPwError(undefined)
    if (pw.next.length < 8) return setPwError('Das neue Passwort muss mindestens 8 Zeichen lang sein.')
    if (pw.next !== pw.repeat) return setPwError('Die neuen Passwörter stimmen nicht überein.')
    const u = auth.currentUser
    if (!u?.email) return
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, pw.current))
      await updatePassword(u, pw.next)
      setPw({ current: '', next: '', repeat: '' })
      toast('Passwort wurde geändert.')
    } catch (err) {
      setPwError(authErrorMessage(err))
    }
  }

  const pickTheme = (t: ThemePref) => {
    setTheme(t)
    setThemePref(t)
  }

  return (
    <>
      <PageHeader title="Einstellungen" description="Personen, Datensicherung, Mitglieder, Konto und Darstellung." />
      <div className="grid gap-6 lg:grid-cols-2">
        {([
          ['/personen', Users, 'Personen', 'Fahrer und Mitfahrer hinzufügen, umbenennen oder deaktivieren'],
          ['/daten', DatabaseBackup, 'Backup & Export', 'Daten sichern, wiederherstellen oder als Excel exportieren'],
        ] as const).map(([to, Icon, title, sub]) => (
          <Link key={to} to={to} className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-surface p-5 shadow-sm transition-colors hover:border-brand-600 hover:bg-brand-50">
            <span className="rounded-xl bg-brand-50 p-2.5 text-brand-700 group-hover:bg-surface"><Icon className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-900">{title}</span>
              <span className="block text-sm text-slate-500">{sub}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </Link>
        ))}

        <Card className="lg:col-span-2">
          <CardTitle sub="Nur diese E-Mail-Adressen haben Zugriff auf das gemeinsame Fahrtenbuch. Alle Mitglieder sehen und bearbeiten dieselben Daten.">
            <span className="flex items-center gap-2"><UserCog className="h-5 w-5 text-brand-700" />Mitglieder</span>
          </CardTitle>
          <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {memberEmails.map((m) => (
              <li key={m} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-slate-800">{m}</span>
                  {m === me && <Badge tone="brand">du</Badge>}
                </span>
                <Button variant="danger-ghost" size="icon" onClick={() => void removeMember(m)} disabled={memberEmails.length <= 1} aria-label={`${m} entfernen`} title="Entfernen">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <form className="flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); void addMember() }}>
            <div className="flex-1">
              <Input type="email" value={newMember} onChange={(e) => { setNewMember(e.target.value); setMemberError(undefined) }} placeholder="E-Mail-Adresse, z. B. name@example.com" aria-label="E-Mail-Adresse des neuen Mitglieds" invalid={!!memberError} />
              {memberError && <p className="mt-1 text-xs text-red-600">{memberError}</p>}
            </div>
            <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!newMember.trim()}>Freischalten</Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            So kommen weitere Mitglieder dazu: Adresse hier freischalten → App-Link schicken → dort „Konto erstellen“ mit genau dieser Adresse → E-Mail bestätigen. Fertig.
          </p>
        </Card>

        <Card>
          <CardTitle sub="Gilt nur für dieses Gerät.">Darstellung</CardTitle>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Design">
            {([['system', 'System', Monitor], ['light', 'Hell', Sun], ['dark', 'Dunkel', Moon]] as const).map(([v, label, Icon]) => (
              <button key={v} role="radio" aria-checked={theme === v} onClick={() => pickTheme(v)}
                className={clsx('flex flex-col items-center gap-2 rounded-xl border p-3 text-sm font-medium', theme === v ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                <Icon className="h-5 w-5" />{label}
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle sub={`Angemeldet als ${userEmail}`}>Konto</CardTitle>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void changePassword() }}>
            {pwError && <Notice level="error">{pwError}</Notice>}
            <input type="email" autoComplete="username" value={userEmail} readOnly hidden />
            <Field label="Aktuelles Passwort" htmlFor="pw-cur"><Input id="pw-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Neues Passwort" htmlFor="pw-new"><Input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
              <Field label="Wiederholen" htmlFor="pw-rep"><Input id="pw-rep" type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" icon={<KeyRound className="h-4 w-4" />} disabled={!pw.current || !pw.next}>Passwort ändern</Button>
              <Button variant="ghost" icon={<LogOut className="h-4 w-4" />} onClick={() => void signOut()}>Abmelden</Button>
            </div>
          </form>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle><span className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-brand-700" />App installieren & offline nutzen</span></CardTitle>
          <div className="grid gap-4 text-sm text-slate-600 sm:grid-cols-3">
            <div><div className="font-medium text-slate-800">iPhone/iPad (Safari)</div>Teilen-Symbol → „Zum Home-Bildschirm“. Wichtig: Nur so bleiben die Offline-Daten auf iOS dauerhaft erhalten.</div>
            <div><div className="font-medium text-slate-800">Android (Chrome)</div>Menü ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.</div>
            <div><div className="font-medium text-slate-800">Offline</div>Nach dem ersten Öffnen funktioniert die App ohne Netz. Änderungen werden gespeichert und automatisch übertragen, sobald wieder Verbindung besteht.</div>
          </div>
        </Card>
      </div>
    </>
  )
}
