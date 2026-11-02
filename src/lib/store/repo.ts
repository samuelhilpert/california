/**
 * Alle schreibenden Operationen der Anwendung. Liest den aktuellen Stand aus dem Speicher, validiert
 * und schreibt per `commit()`. Standardmäßig wird der aktive (angemeldete) Speicher verwendet; Tests
 * übergeben einen eigenen.
 */
import type { Category, Expense, FuelFill, Payment, Person, SettlementSnapshot, Trip } from '../domain/types'
import { hasErrors, validateExpense, validateFuel, validatePayment, validateTrip, type ExpenseDraft, type FuelDraft, type PaymentDraft, type TripDraft } from '../domain/validation'
import { activeStore, activeUserEmail } from './active'
import { putOp, type DataStore, type TableName } from './types'

export class ValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Ungültige Eingabe')
  }
}

function newId(): string {
  return crypto.randomUUID()
}

function nowStamp(): string {
  return new Date().toISOString()
}

const clean = <T extends object>(o: T): T => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))) continue
    out[k] = typeof v === 'string' ? v.trim() : v
  }
  return out as T
}

const by = () => {
  const e = activeUserEmail()
  return e ? { updatedBy: e } : {}
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** Legt einen gelöschten Datensatz wieder an (für „Rückgängig“). */
export async function restoreRecord(table: TableName, value: { id: string }, store: DataStore = activeStore()): Promise<void> {
  await store.commit([putOp(table, value)])
}

// ---------- Personen ----------
export async function addPerson(name: string, store: DataStore = activeStore()): Promise<Person> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  if (n.length > 60) throw new ValidationError({ name: 'Der Name ist zu lang (max. 60 Zeichen).' })
  const existing = store.getData().persons.find((p) => p.name.toLowerCase() === n.toLowerCase())
  if (existing) {
    if (!existing.active) {
      const p = { ...existing, active: true, updatedAt: nowStamp() }
      await store.commit([{ type: 'put', table: 'persons', value: p }])
      return p
    }
    throw new ValidationError({ name: `„${n}“ ist bereits angelegt.` })
  }
  const now = nowStamp()
  const p: Person = { id: newId(), name: n, active: true, createdAt: now, updatedAt: now }
  await store.commit([{ type: 'put', table: 'persons', value: p }])
  return p
}

function getPerson(store: DataStore, id: string): Person {
  const p = store.getData().persons.find((x) => x.id === id)
  if (!p) throw new Error('Die Person existiert nicht mehr.')
  return p
}

/** Person zu einem Konto (E-Mail). */
export function findMemberPerson(persons: Person[], email: string): Person | undefined {
  const e = email.trim().toLowerCase()
  return e ? persons.find((p) => p.email?.toLowerCase() === e) : undefined
}

/**
 * Verknüpft ein Konto mit einer Person: vorhandene Verknüpfung → gleichnamige Person ohne Konto
 * (z. B. aus einem Backup) → sonst neu anlegen. Die ID neuer Personen hängt nur an der E-Mail,
 * damit zwei Geräte gleichzeitig keine doppelte Person anlegen.
 */
export async function linkMember(email: string, name: string, store: DataStore = activeStore()): Promise<Person> {
  const e = email.trim().toLowerCase()
  const persons = store.getData().persons
  const linked = findMemberPerson(persons, e)
  if (linked) {
    if (linked.active) return linked
    const p = { ...linked, active: true, updatedAt: nowStamp() }
    await store.commit([{ type: 'put', table: 'persons', value: p }])
    return p
  }
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte deinen Namen angeben.' })
  if (n.length > 60) throw new ValidationError({ name: 'Der Name ist zu lang (max. 60 Zeichen).' })
  const same = persons.find((p) => p.name.toLowerCase() === n.toLowerCase())
  if (same?.email) throw new ValidationError({ name: `„${n}“ gehört schon zu einem anderen Konto. Bitte einen anderen Namen wählen.` })
  const now = nowStamp()
  const p: Person = same
    ? { ...same, email: e, active: true, updatedAt: now }
    : { id: `m_${e.replace(/[^a-z0-9]/g, '_')}`, name: n, email: e, active: true, createdAt: now, updatedAt: now }
  await store.commit([{ type: 'put', table: 'persons', value: p }])
  return p
}

export async function renamePerson(id: string, name: string, store: DataStore = activeStore()): Promise<void> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  if (n.length > 60) throw new ValidationError({ name: 'Der Name ist zu lang (max. 60 Zeichen).' })
  const clash = store.getData().persons.find((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase())
  if (clash) throw new ValidationError({ name: `„${n}“ ist bereits vergeben.` })
  await store.commit([{ type: 'put', table: 'persons', value: { ...getPerson(store, id), name: n, updatedAt: nowStamp() } }])
}

export async function setPersonActive(id: string, active: boolean, store: DataStore = activeStore()): Promise<void> {
  await store.commit([{ type: 'put', table: 'persons', value: { ...getPerson(store, id), active, updatedAt: nowStamp() } }])
}

function personUsage(id: string, store: DataStore = activeStore()): { trips: number; expenses: number; payments: number } {
  const d = store.getData()
  return {
    trips: d.trips.filter((t) => t.personIds.includes(id)).length,
    expenses: d.expenses.filter((e) => e.directPersonIds?.includes(id) || e.paidBy === id).length,
    payments: d.payments.filter((p) => p.fromPersonId === id || p.toPersonId === id).length + d.fuel.filter((f) => f.personId === id).length,
  }
}

/** Löschen ist nur möglich, wenn die Person nirgends verwendet wird – sonst nur deaktivieren. */
export async function deletePerson(id: string, store: DataStore = activeStore()): Promise<Person> {
  const u = personUsage(id, store)
  if (u.trips + u.expenses + u.payments > 0) throw new Error('Diese Person wird in Fahrten, Kosten oder Zahlungen verwendet und kann nur deaktiviert werden.')
  const p = getPerson(store, id)
  await store.commit([{ type: 'delete', table: 'persons', id }])
  return p
}

// ---------- Fahrten ----------
export async function saveTrip(draft: TripDraft, id?: string, store: DataStore = activeStore()): Promise<Trip> {
  const d = clean(draft)
  if (d.stops) {
    d.stops = d.stops.map((s) => s.trim()).filter(Boolean)
    if (d.stops.length === 0) delete d.stops
  }
  const errors = validateTrip(d)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const now = nowStamp()
  let trip: Trip
  if (id) {
    const old = store.getData().trips.find((t) => t.id === id)
    if (!old) throw new Error('Die Fahrt existiert nicht mehr – sie wurde vermutlich von einer anderen Person gelöscht.')
    trip = { ...d, id, ...(old.importKey ? { importKey: old.importKey } : {}), createdAt: old.createdAt, updatedAt: now, ...by() }
  } else {
    trip = { ...d, id: newId(), createdAt: now, updatedAt: now, ...by() }
  }
  await store.commit([{ type: 'put', table: 'trips', value: trip }])
  return trip
}

export async function deleteTrip(id: string, store: DataStore = activeStore()): Promise<Trip | undefined> {
  const old = store.getData().trips.find((t) => t.id === id)
  await store.commit([{ type: 'delete', table: 'trips', id }])
  return old
}

// ---------- Kosten ----------
export async function saveExpense(draft: ExpenseDraft, id?: string, store: DataStore = activeStore()): Promise<Expense> {
  const d = clean(draft)
  if (d.allocation !== 'direct') delete d.directPersonIds
  if (d.recurrence) d.recurrence = clean(d.recurrence)
  if (!d.spreadMonths || d.spreadMonths <= 1) delete d.spreadMonths
  const errors = validateExpense(d)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const now = nowStamp()
  let e: Expense
  if (id) {
    const old = store.getData().expenses.find((x) => x.id === id)
    if (!old) throw new Error('Die Ausgabe existiert nicht mehr – sie wurde vermutlich von einer anderen Person gelöscht.')
    e = { ...d, id, ...(old.importKey ? { importKey: old.importKey } : {}), createdAt: old.createdAt, updatedAt: now, ...by() }
  } else {
    e = { ...d, id: newId(), createdAt: now, updatedAt: now, ...by() }
  }
  await store.commit([{ type: 'put', table: 'expenses', value: e }])
  return e
}

export async function deleteExpense(id: string, store: DataStore = activeStore()): Promise<Expense | undefined> {
  const old = store.getData().expenses.find((x) => x.id === id)
  await store.commit([{ type: 'delete', table: 'expenses', id }])
  return old
}

// ---------- Ausgleichszahlungen ----------
export async function savePayment(draft: PaymentDraft, id?: string, store: DataStore = activeStore()): Promise<Payment> {
  const d = clean(draft)
  const errors = validatePayment(d)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const now = nowStamp()
  const old = id ? store.getData().payments.find((p) => p.id === id) : undefined
  const p: Payment = { ...d, id: id ?? newId(), createdAt: old?.createdAt ?? now, updatedAt: now, ...by() }
  await store.commit([{ type: 'put', table: 'payments', value: p }])
  return p
}

export async function deletePayment(id: string, store: DataStore = activeStore()): Promise<Payment | undefined> {
  const old = store.getData().payments.find((p) => p.id === id)
  await store.commit([{ type: 'delete', table: 'payments', id }])
  return old
}

// ---------- Abgeschlossene Abrechnungen ----------
export async function saveSettlementSnapshot(snap: Omit<SettlementSnapshot, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>, store: DataStore = activeStore()): Promise<SettlementSnapshot> {
  if (!snap.title.trim()) throw new ValidationError({ title: 'Bitte einen Titel angeben.' })
  const now = nowStamp()
  const s: SettlementSnapshot = {
    ...snap,
    title: snap.title.trim(),
    // Über JSON normalisieren: entfernt undefined und macht das Ergebnis speicherbar
    result: JSON.parse(JSON.stringify(snap.result)),
    id: newId(),
    createdAt: now,
    updatedAt: now,
    ...(activeUserEmail() ? { createdBy: activeUserEmail() } : {}),
  }
  await store.commit([{ type: 'put', table: 'settlements', value: s }])
  return s
}

export async function deleteSettlementSnapshot(id: string, store: DataStore = activeStore()): Promise<void> {
  await store.commit([{ type: 'delete', table: 'settlements', id }])
}

// ---------- Kategorien ----------
const PALETTE = ['#0891b2', '#ca8a04', '#9333ea', '#e11d48', '#65a30d', '#0284c7', '#c2410c', '#4f46e5']

export async function addCategory(name: string, store: DataStore = activeStore()): Promise<Category> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  const all = store.getData().categories
  if (all.some((c) => c.name.toLowerCase() === n.toLowerCase())) throw new ValidationError({ name: `Die Kategorie „${n}“ gibt es bereits.` })
  const c: Category = { id: newId(), name: n, builtin: false, color: PALETTE[all.length % PALETTE.length], updatedAt: nowStamp() }
  await store.commit([{ type: 'put', table: 'categories', value: c }])
  return c
}

export async function renameCategory(id: string, name: string, store: DataStore = activeStore()): Promise<void> {
  const n = normalizeName(name)
  if (!n) throw new ValidationError({ name: 'Bitte einen Namen angeben.' })
  const all = store.getData().categories
  if (all.some((c) => c.id !== id && c.name.toLowerCase() === n.toLowerCase())) throw new ValidationError({ name: `Die Kategorie „${n}“ gibt es bereits.` })
  const c = all.find((x) => x.id === id)
  if (!c) throw new Error('Die Kategorie existiert nicht mehr.')
  await store.commit([{ type: 'put', table: 'categories', value: { ...c, name: n, updatedAt: nowStamp() } }])
}

export async function deleteCategory(id: string, store: DataStore = activeStore()): Promise<void> {
  const d = store.getData()
  const c = d.categories.find((x) => x.id === id)
  if (c?.builtin) throw new Error('Standardkategorien können nicht gelöscht werden.')
  const used = d.expenses.filter((e) => e.categoryId === id).length
  if (used > 0) throw new Error(`Die Kategorie wird von ${used} Ausgabe(n) verwendet und kann nicht gelöscht werden.`)
  await store.commit([{ type: 'delete', table: 'categories', id }])
}

// ---------- Einstellungen (gemeinsam für alle Mitglieder) ----------
// ---------- Tankbuch (Pro-Modus, nicht Teil der Abrechnung) ----------
export async function saveFuel(draft: FuelDraft, id?: string, store: DataStore = activeStore()): Promise<FuelFill> {
  const d = clean(draft)
  const errors = validateFuel(d)
  if (hasErrors(errors)) throw new ValidationError(errors)
  const now = nowStamp()
  const old = id ? store.getData().fuel.find((x) => x.id === id) : undefined
  if (id && !old) throw new Error('Die Tankfüllung existiert nicht mehr – sie wurde vermutlich von einer anderen Person gelöscht.')
  const f: FuelFill = { ...d, id: id ?? newId(), createdAt: old?.createdAt ?? now, updatedAt: now, ...by() }
  await store.commit([{ type: 'put', table: 'fuel', value: f }])
  return f
}

export async function deleteFuel(id: string, store: DataStore = activeStore()): Promise<FuelFill | undefined> {
  const old = store.getData().fuel.find((x) => x.id === id)
  await store.commit([{ type: 'delete', table: 'fuel', id }])
  return old
}

export async function setSetting(key: string, value: unknown, store: DataStore = activeStore()): Promise<void> {
  await store.commit([{ type: 'put', table: 'settings', value: { id: key, value } }])
}
