import { newId, nowStamp } from '../store/repo'
import { activeUserEmail } from '../store/active'
import type { DataStore, WriteOp } from '../store/types'
import type { Expense, Person, Trip } from '../domain/types'
import { isIsoDate } from '../domain/dates'
import { draftToExpense, isValidStartDate, type ImportPreview } from './excelImport'

export interface ImportSelection {
  tripRowIds: string[]
  expenseRowIds: string[]
  /** Startdatum je Kostenzeile, falls die Datei keines enthält. */
  expenseStartDates: Record<string, string>
  /** In der Vorschau korrigierte Fahrtdaten (Startdatum) je Zeile. */
  tripDateOverrides?: Record<string, string>
}

export interface ImportResult {
  personsCreated: number
  personsReactivated: number
  tripsAdded: number
  expensesAdded: number
  skippedDuplicates: number
}

/** Stabile, kollisionsarme ID aus einem Schlüssel (2 × 53-Bit-Hash). */
export function stableId(prefix: string, key: string): string {
  const h = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0; i < key.length; i++) {
      const ch = key.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  return `${prefix}-${h(1)}${h(2)}`
}

/**
 * Übernimmt die ausgewählten Zeilen. Alle Änderungen werden in einem Commit geschrieben.
 * Importierte Datensätze erhalten eine aus dem Importschlüssel abgeleitete ID – ein wiederholter
 * Import (auch mit veralteter Vorschau oder parallel von einem anderen Gerät) erzeugt daher keine
 * Duplikate. Bestehende Daten werden nie überschrieben.
 */
export async function applyImport(preview: ImportPreview, selection: ImportSelection, store: DataStore): Promise<ImportResult> {
  const result: ImportResult = { personsCreated: 0, personsReactivated: 0, tripsAdded: 0, expensesAdded: 0, skippedDuplicates: 0 }
  const tripRows = preview.trips.filter((r) => selection.tripRowIds.includes(r.rowId) && r.draft && r.status !== 'error')
  const expenseRows = preview.expenses.filter((r) => selection.expenseRowIds.includes(r.rowId) && r.draft && r.status !== 'error')

  for (const r of expenseRows) {
    const d = r.draft!.date ?? selection.expenseStartDates[r.rowId]
    if (!isValidStartDate(d)) throw new Error(`Für „${r.draft!.title}“ (Zeile ${r.rowNumber}) fehlt ein gültiges Startdatum.`)
  }
  for (const r of tripRows) {
    const o = selection.tripDateOverrides?.[r.rowId]
    if (o != null && !isIsoDate(o)) throw new Error(`Das korrigierte Datum in Zeile ${r.rowNumber} ist ungültig.`)
    if (o && r.draft!.endDate && r.draft!.endDate < o) throw new Error(`In Zeile ${r.rowNumber} liegt das Enddatum vor dem korrigierten Startdatum.`)
  }

  const data = store.getData()
  const ops: WriteOp[] = []
  const byName = new Map(data.persons.map((p) => [p.name.toLowerCase(), { ...p }]))
  const by = activeUserEmail() ? { updatedBy: activeUserEmail() } : {}

  const ensurePerson = (name: string): string => {
    const key = name.toLowerCase()
    const ex = byName.get(key)
    if (ex) {
      if (!ex.active) {
        ex.active = true
        ops.push({ type: 'put', table: 'persons', value: { ...ex, updatedAt: nowStamp() } })
        result.personsReactivated++
      }
      return ex.id
    }
    const now = nowStamp()
    const p: Person = { id: newId(), name, active: true, createdAt: now, updatedAt: now }
    ops.push({ type: 'put', table: 'persons', value: p })
    byName.set(key, p)
    result.personsCreated++
    return p.id
  }

  for (const p of preview.reference?.persons ?? []) ensurePerson(p.name)

  const tripKeys = new Set(data.trips.map((t) => t.importKey).filter(Boolean))
  const tripIds = new Set(data.trips.map((t) => t.id))
  for (const r of tripRows) {
    const d = r.draft!
    const id = r.importKey ? stableId('imp', r.importKey) : newId()
    if ((r.importKey && tripKeys.has(r.importKey)) || tripIds.has(id)) {
      result.skippedDuplicates++
      continue
    }
    const now = nowStamp()
    const trip: Trip = {
      id,
      startDate: selection.tripDateOverrides?.[r.rowId] || d.startDate,
      endDate: d.endDate,
      from: d.from,
      to: d.to,
      odoStart: d.odoStart,
      odoEnd: d.odoEnd,
      km: d.km,
      personIds: d.personNames.map(ensurePerson),
      note: d.note,
      importKey: r.importKey,
      createdAt: now,
      updatedAt: now,
      ...by,
    }
    ops.push({ type: 'put', table: 'trips', value: trip })
    if (r.importKey) tripKeys.add(r.importKey)
    tripIds.add(id)
    result.tripsAdded++
  }

  const expenseKeys = new Set(data.expenses.map((e) => e.importKey).filter(Boolean))
  const expenseIds = new Set(data.expenses.map((e) => e.id))
  for (const r of expenseRows) {
    const d = r.draft!
    const id = r.importKey ? stableId('imp', r.importKey) : newId()
    if ((r.importKey && expenseKeys.has(r.importKey)) || expenseIds.has(id)) {
      result.skippedDuplicates++
      continue
    }
    const e: Expense = {
      ...draftToExpense(d, id, d.date ?? selection.expenseStartDates[r.rowId]),
      ...(d.paidByName ? { paidBy: ensurePerson(d.paidByName) } : {}),
      ...by,
    }
    ops.push({ type: 'put', table: 'expenses', value: e })
    if (r.importKey) expenseKeys.add(r.importKey)
    expenseIds.add(id)
    result.expensesAdded++
  }

  await store.commit(ops)
  return result
}
