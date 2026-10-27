import { db as defaultDb, newId, nowStamp, type CaliforniaDB } from './db'
import type { Category, Expense, Person, Trip } from '../domain/types'
import { hasErrors, validateExpense, validateTrip, type ExpenseDraft, type TripDraft } from '../domain/validation'

export class ValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Ungültige Eingabe')
  }
}

const clean = <T extends object>(o: T): T => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) continue
    out[k] = typeof v === 'string' ? v.trim() : v
  }
  return out as T
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

// ---------- Personen ----------
export async function addPerson(name: string, database: CaliforniaDB = defaultDb): Promise<Person> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  if (n.length > 60) throw new ValidationError({ name: 'Der Name ist zu lang (max. 60 Zeichen).' })
  const existing = (await database.persons.toArray()).find((p) => p.name.toLowerCase() === n.toLowerCase())
  if (existing) {
    if (!existing.active) {
      await database.persons.update(existing.id, { active: true })
      return { ...existing, active: true }
    }
    throw new ValidationError({ name: `„${n}“ ist bereits angelegt.` })
  }
  const p: Person = { id: newId(), name: n, active: true, createdAt: nowStamp() }
  await database.persons.add(p)
  return p
}

export async function renamePerson(id: string, name: string, database: CaliforniaDB = defaultDb): Promise<void> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  const clash = (await database.persons.toArray()).find((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase())
  if (clash) throw new ValidationError({ name: `„${n}“ ist bereits vergeben.` })
  await database.persons.update(id, { name: n })
}

export async function setPersonActive(id: string, active: boolean, database: CaliforniaDB = defaultDb): Promise<void> {
  await database.persons.update(id, { active })
}

export async function personUsage(id: string, database: CaliforniaDB = defaultDb): Promise<{ trips: number; expenses: number }> {
  const trips = await database.trips.where('personIds').equals(id).count()
  const expenses = (await database.expenses.toArray()).filter((e) => e.directPersonIds?.includes(id)).length
  return { trips, expenses }
}

/** Löschen ist nur möglich, wenn die Person nirgends verwendet wird – sonst nur deaktivieren. */
export async function deletePerson(id: string, database: CaliforniaDB = defaultDb): Promise<void> {
  const u = await personUsage(id, database)
  if (u.trips + u.expenses > 0) throw new Error('Diese Person wird in Fahrten oder Kosten verwendet und kann nur deaktiviert werden.')
  await database.persons.delete(id)
}

// ---------- Fahrten ----------
export async function saveTrip(draft: TripDraft, id?: string, database: CaliforniaDB = defaultDb): Promise<Trip> {
  const d = clean(draft)
  const errors = validateTrip(d)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const now = nowStamp()
  if (id) {
    const old = await database.trips.get(id)
    if (!old) throw new Error('Die Fahrt existiert nicht mehr.')
    const trip: Trip = { ...d, id, importKey: old.importKey, createdAt: old.createdAt, updatedAt: now }
    await database.trips.put(trip)
    return trip
  }
  const trip: Trip = { ...d, id: newId(), createdAt: now, updatedAt: now }
  await database.trips.add(trip)
  return trip
}

export async function deleteTrip(id: string, database: CaliforniaDB = defaultDb): Promise<void> {
  await database.trips.delete(id)
}

// ---------- Kosten ----------
export async function saveExpense(draft: ExpenseDraft, id?: string, database: CaliforniaDB = defaultDb): Promise<Expense> {
  const d = clean(draft)
  if (d.allocation !== 'direct') delete d.directPersonIds
  if (d.recurrence) d.recurrence = clean(d.recurrence)
  const errors = validateExpense(d)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const now = nowStamp()
  if (id) {
    const old = await database.expenses.get(id)
    if (!old) throw new Error('Die Ausgabe existiert nicht mehr.')
    const e: Expense = { ...d, id, importKey: old.importKey, createdAt: old.createdAt, updatedAt: now }
    await database.expenses.put(e)
    return e
  }
  const e: Expense = { ...d, id: newId(), createdAt: now, updatedAt: now }
  await database.expenses.add(e)
  return e
}

export async function deleteExpense(id: string, database: CaliforniaDB = defaultDb): Promise<void> {
  await database.expenses.delete(id)
}

// ---------- Kategorien ----------
const PALETTE = ['#0891b2', '#ca8a04', '#9333ea', '#e11d48', '#65a30d', '#0284c7', '#c2410c', '#4f46e5']

export async function addCategory(name: string, database: CaliforniaDB = defaultDb): Promise<Category> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  const all = await database.categories.toArray()
  if (all.some((c) => c.name.toLowerCase() === n.toLowerCase())) throw new ValidationError({ name: `Die Kategorie „${n}“ gibt es bereits.` })
  const c: Category = { id: newId(), name: n, builtin: false, color: PALETTE[all.length % PALETTE.length] }
  await database.categories.add(c)
  return c
}

export async function renameCategory(id: string, name: string, database: CaliforniaDB = defaultDb): Promise<void> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  const all = await database.categories.toArray()
  if (all.some((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase())) throw new ValidationError({ name: `Die Kategorie „${n}“ gibt es bereits.` })
  await database.categories.update(id, { name: n })
}

export async function deleteCategory(id: string, database: CaliforniaDB = defaultDb): Promise<void> {
  const c = await database.categories.get(id)
  if (c?.builtin) throw new Error('Standardkategorien können nicht gelöscht werden.')
  const used = await database.expenses.where('categoryId').equals(id).count()
  if (used > 0) throw new Error(`Die Kategorie wird von ${used} Ausgabe(n) verwendet und kann nicht gelöscht werden.`)
  await database.categories.delete(id)
}

// ---------- Einstellungen ----------
export async function getSetting<T>(key: string, database: CaliforniaDB = defaultDb): Promise<T | undefined> {
  return (await database.settings.get(key))?.value as T | undefined
}

export async function setSetting(key: string, value: unknown, database: CaliforniaDB = defaultDb): Promise<void> {
  await database.settings.put({ key, value })
}
