import type { DataStore } from './types'

let current: DataStore | null = null
let currentUser: string | undefined

/** Wird nach der Anmeldung gesetzt; Repository-Funktionen verwenden diesen Speicher standardmäßig. */
export function setActiveStore(store: DataStore | null, userEmail?: string) {
  current = store
  currentUser = userEmail
}

export function activeStore(): DataStore {
  if (!current) throw new Error('Keine Datenverbindung – bitte neu anmelden.')
  return current
}

export function activeUserEmail(): string | undefined {
  return currentUser
}
