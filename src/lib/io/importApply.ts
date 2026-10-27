import { newId, nowStamp, type CaliforniaDB } from '../db/db'
import type { Expense, Person, Trip } from '../domain/types'
import { draftToExpense, isValidStartDate, type ImportPreview } from './excelImport'

export interface ImportSelection {
  tripRowIds: string[]
  expenseRowIds: string[]
  /** Startdatum je Kostenzeile, falls die Datei keines enthält. */
  expenseStartDates: Record<string, string>
}

export interface ImportResult {
  personsCreated: number
  personsReactivated: number
  tripsAdded: number
  expensesAdded: number
  skippedDuplicates: number
}

/**
 * Übernimmt die ausgewählten Zeilen in die Datenbank – atomar in einer Transaktion.
 * Bereits vorhandene Importschlüssel werden erneut geprüft, sodass ein doppelter Import
 * auch dann ausgeschlossen ist, wenn die Vorschau veraltet ist. Bestehende Daten werden
 * nie überschrieben, nur ergänzt.
 */
export async function applyImport(preview: ImportPreview, selection: ImportSelection, database: CaliforniaDB): Promise<ImportResult> {
  const result: ImportResult = { personsCreated: 0, personsReactivated: 0, tripsAdded: 0, expensesAdded: 0, skippedDuplicates: 0 }
  const tripRows = preview.trips.filter((r) => selection.tripRowIds.includes(r.rowId) && r.draft && r.status !== 'error')
  const expenseRows = preview.expenses.filter((r) => selection.expenseRowIds.includes(r.rowId) && r.draft && r.status !== 'error')

  for (const r of expenseRows) {
    const d = r.draft!.date ?? selection.expenseStartDates[r.rowId]
    if (!isValidStartDate(d)) throw new Error(`Für „${r.draft!.title}“ (Zeile ${r.rowNumber}) fehlt ein gültiges Startdatum.`)
  }

  await database.transaction('rw', [database.persons, database.trips, database.expenses], async () => {
    const persons = await database.persons.toArray()
    const byName = new Map(persons.map((p) => [p.name.toLowerCase(), p]))
    const ensurePerson = async (name: string): Promise<string> => {
      const key = name.toLowerCase()
      const ex = byName.get(key)
      if (ex) {
        if (!ex.active) {
          await database.persons.update(ex.id, { active: true })
          ex.active = true
          result.personsReactivated++
        }
        return ex.id
      }
      const p: Person = { id: newId(), name, active: true, createdAt: nowStamp() }
      await database.persons.add(p)
      byName.set(key, p)
      result.personsCreated++
      return p.id
    }

    // Personen aus dem Blatt „Kostenverteilung“ auch ohne Fahrten übernehmen
    for (const p of preview.reference?.persons ?? []) await ensurePerson(p.name)

    const tripKeys = new Set((await database.trips.toArray()).map((t) => t.importKey).filter(Boolean))
    for (const r of tripRows) {
      const d = r.draft!
      if (r.importKey && tripKeys.has(r.importKey)) {
        result.skippedDuplicates++
        continue
      }
      const personIds: string[] = []
      for (const n of d.personNames) personIds.push(await ensurePerson(n))
      const now = nowStamp()
      const trip: Trip = {
        id: newId(),
        startDate: d.startDate,
        endDate: d.endDate,
        from: d.from,
        to: d.to,
        odoStart: d.odoStart,
        odoEnd: d.odoEnd,
        km: d.km,
        personIds,
        note: d.note,
        importKey: r.importKey,
        createdAt: now,
        updatedAt: now,
      }
      for (const k of Object.keys(trip) as (keyof Trip)[]) if (trip[k] === undefined) delete trip[k]
      await database.trips.add(trip)
      if (r.importKey) tripKeys.add(r.importKey)
      result.tripsAdded++
    }

    const expenseKeys = new Set((await database.expenses.toArray()).map((e) => e.importKey).filter(Boolean))
    for (const r of expenseRows) {
      const d = r.draft!
      const key = r.importKey
      if (key && expenseKeys.has(key)) {
        result.skippedDuplicates++
        continue
      }
      const date = d.date ?? selection.expenseStartDates[r.rowId]
      const e: Expense = draftToExpense(d, newId(), date)
      if (!e.recurrence) delete e.recurrence
      if (!e.note) delete e.note
      await database.expenses.add(e)
      if (key) expenseKeys.add(key)
      result.expensesAdded++
    }
  })
  return result
}
