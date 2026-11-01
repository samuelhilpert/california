import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AppData, DataStore, SyncStatus } from './types'
import type { Person, Setting } from '../domain/types'
import { findMemberPerson, setSetting } from './repo'

export interface Session {
  store: DataStore
  userEmail: string
  bookId: string
  memberEmails: string[]
  signOut: () => Promise<void>
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('Keine Sitzung')
  return s
}

/** Alle Daten des gemeinsamen Fahrtenbuchs, live aktualisiert. */
export function useAppData(): AppData {
  const { store } = useSession()
  return useSyncExternalStore((l) => store.subscribe(l), () => store.getData())
}

/** Die Person des angemeldeten Kontos (falls verknüpft). */
export function useMyPerson(): Person | undefined {
  const { userEmail } = useSession()
  return findMemberPerson(useAppData().persons, userEmail)
}

/**
 * Pro-Modus: zusätzliche Bereiche (Statistik, Karte, Rückblick) und Felder, die nur anzeigen
 * bzw. zusätzlich pflegen – nie die Abrechnung verändern. Gilt je Konto auf allen Geräten.
 */
export function useProMode(): [boolean, (on: boolean) => Promise<void>] {
  const { userEmail } = useSession()
  const key = `pro:${userEmail.trim().toLowerCase()}`
  const on = useSetting<boolean>(key) === true
  return [on, (v: boolean) => setSetting(key, v)]
}

export function useSyncStatus(): SyncStatus {
  const { store } = useSession()
  return useSyncExternalStore((l) => store.subscribeStatus(l), () => store.getStatus())
}

export function settingValue<T>(settings: Setting[], key: string): T | undefined {
  return settings.find((s) => s.id === key)?.value as T | undefined
}

export function useSetting<T>(key: string): T | undefined {
  return settingValue<T>(useAppData().settings, key)
}
