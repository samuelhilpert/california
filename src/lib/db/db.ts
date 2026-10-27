import Dexie, { type EntityTable } from 'dexie'
import type { Category, Expense, Person, Setting, Trip } from '../domain/types'

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'leasing', name: 'Leasingrate', builtin: true, color: '#0f766e' },
  { id: 'insurance', name: 'Versicherung', builtin: true, color: '#2563eb' },
  { id: 'fuel', name: 'Kraftstoff', builtin: true, color: '#d97706' },
  { id: 'maintenance', name: 'Wartung & Reparaturen', builtin: true, color: '#7c3aed' },
  { id: 'tax', name: 'Steuer', builtin: true, color: '#475569' },
  { id: 'camping', name: 'Camping & Stellplätze', builtin: true, color: '#16a34a' },
  { id: 'other', name: 'Sonstige Fahrzeugkosten', builtin: true, color: '#db2777' },
]

export class CaliforniaDB extends Dexie {
  persons!: EntityTable<Person, 'id'>
  trips!: EntityTable<Trip, 'id'>
  expenses!: EntityTable<Expense, 'id'>
  categories!: EntityTable<Category, 'id'>
  settings!: EntityTable<Setting, 'key'>

  constructor(name = 'vw-california') {
    super(name)
    this.version(1).stores({
      persons: 'id, name, active',
      trips: 'id, startDate, importKey, *personIds',
      expenses: 'id, date, categoryId, importKey',
      categories: 'id, name',
      settings: 'key',
    })
    this.on('populate', (tx) => {
      tx.table('categories').bulkAdd(DEFAULT_CATEGORIES)
    })
  }
}

export const db = new CaliforniaDB()

export function newId(): string {
  return crypto.randomUUID()
}

export function nowStamp(): string {
  return new Date().toISOString()
}
