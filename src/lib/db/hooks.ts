import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { Category, Expense, Person, Trip } from '../domain/types'

export interface AppData {
  persons: Person[]
  trips: Trip[]
  expenses: Expense[]
  categories: Category[]
}

/** Alle Daten live aus IndexedDB; undefined, solange noch geladen wird. */
export function useAppData(): AppData | undefined {
  return useLiveQuery(async () => {
    const [persons, trips, expenses, categories] = await Promise.all([
      db.persons.toArray(),
      db.trips.toArray(),
      db.expenses.toArray(),
      db.categories.toArray(),
    ])
    persons.sort((a, b) => a.name.localeCompare(b.name, 'de'))
    categories.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.name.localeCompare(b.name, 'de'))
    return { persons, trips, expenses, categories }
  }, [])
}

export function useSetting<T>(key: string): T | undefined {
  return useLiveQuery(async () => (await db.settings.get(key))?.value as T | undefined, [key])
}
