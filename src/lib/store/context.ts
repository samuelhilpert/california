import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AppData, DataStore, SyncStatus } from './types'
import type { Setting } from '../domain/types'

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
