import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { DEFAULT_CATEGORIES } from '../store/defaults'
import { addPerson, saveExpense, saveTrip, setPersonActive } from '../store/repo'
import { analyzeWorkbook, readWorkbook, splitPersonNames, type ExistingData } from './excelImport'
import { applyImport, type ImportSelection } from './importApply'
import { buildDataWorkbook, buildSettlementWorkbook, workbookToArray } from './excelExport'
import { BackupError, createBackup, parseBackup, restoreBackup } from './backup'
import { buildSettlement } from '../domain/settlement'

const TODAY = '2026-10-27'
let db: MemoryStore

beforeEach(() => {
  db = new MemoryStore()
})

async function existing(): Promise<ExistingData> {
  return db.getData()
}

function selectAll(p: ReturnType<typeof analyzeWorkbook>): ImportSelection {
  return {
    tripRowIds: p.trips.filter((r) => r.selected).map((r) => r.rowId),
    expenseRowIds: p.expenses.filter((r) => r.selected).map((r) => r.rowId),
    expenseStartDates: Object.fromEntries(p.expenses.map((r) => [r.rowId, p.suggestedStartDate])),
  }
}

/** Baut eine Arbeitsmappe mit der Struktur der Original-Datei nach. */
function originalLikeWorkbook(opts: { cachedValues: boolean; extraRows?: unknown[][] }): XLSX.WorkBook {
  const v = (val: number) => (opts.cachedValues ? val : undefined)
  const fb: XLSX.WorkSheet = {
    A1: { t: 's', v: 'Fahrtenbuch und Kostenabrechnung VW California' },
    A3: { t: 's', v: 'Von ' }, B3: { t: 's', v: 'Bis' }, C3: { t: 's', v: 'Kilometerstand Anfang' }, D3: { t: 's', v: 'Kilometerstand Ende' },
    E3: { t: 's', v: 'gefahrene Kilometer' }, F3: { t: 's', v: 'Wer' }, G3: { t: 's', v: 'Kosten für Fahrt' },
    A4: { t: 'n', v: 46385, z: 'd-mmm' }, B4: { t: 'n', v: 46385, z: 'd-mmm' }, C4: { t: 'n', v: 20 }, D4: { t: 'n', v: 520 },
    E4: { t: opts.cachedValues ? 'n' : 'z', v: v(500), f: 'D4-C4' }, F4: { t: 's', v: 'Konrad, Dennis, Samuel' },
    E6: { t: opts.cachedValues ? 'n' : 'z', v: v(500), f: 'SUM(E4:E5)' },
    '!ref': 'A1:G6',
  }
  const kosten: XLSX.WorkSheet = {
    A1: { t: 's', v: 'Kosten' },
    A3: { t: 's', v: 'Leasingrate' }, B3: { t: 'n', v: 319.15 }, C3: { t: 'n', v: 24 }, D3: { t: opts.cachedValues ? 'n' : 'z', v: v(7659.6), f: 'B3*C3' },
    D5: { t: opts.cachedValues ? 'n' : 'z', v: v(7659.6), f: 'SUM(D3:D4)' },
    '!ref': 'A1:D5',
  }
  const kv: XLSX.WorkSheet = {
    A3: { t: 's', v: 'Gesamtkosten' }, B3: { t: 'n', v: 7659.6, f: 'Kosten!D5' },
    A5: { t: 's', v: 'Gesamt KM' }, B5: { t: 'n', v: 500 },
    A7: { t: 's', v: 'Kosten pro KM' }, B7: { t: 'n', v: 15.3192 },
    A10: { t: 's', v: 'Kostenverteilung nach Fahrer' },
    A11: { t: 's', v: 'Konrad' }, B11: { t: 'n', v: 2553.2 },
    A12: { t: 's', v: 'Dennis' }, B12: { t: 'n', v: 2553.2 },
    A13: { t: 's', v: 'Samuel' }, B13: { t: 'n', v: 2553.2 },
    '!ref': 'A3:B13',
  }
  if (opts.extraRows) {
    opts.extraRows.forEach((row, i) => {
      row.forEach((val, c) => {
        if (val == null) return
        const addr = XLSX.utils.encode_cell({ r: 4 + i, c })
        fb[addr] = typeof val === 'number' ? { t: 'n', v: val } : { t: 's', v: String(val) }
      })
    })
    fb['!ref'] = `A1:G${6 + opts.extraRows.length}`
    delete fb.E6
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, fb, 'Fahrtenbuch')
  XLSX.utils.book_append_sheet(wb, kv, 'Kostenverteilung')
  XLSX.utils.book_append_sheet(wb, kosten, 'Kosten')
  return readWorkbook(workbookToArray(wb))
}

describe('Excel-Import', () => {
  it('liest die Struktur der Original-Datei', async () => {
    const p = analyzeWorkbook(originalLikeWorkbook({ cachedValues: true }), 'VW California.xlsx', await existing(), TODAY)
    expect(p.trips).toHaveLength(1)
    const t = p.trips[0]
    expect(t.draft).toMatchObject({ startDate: '2026-12-29', odoStart: 20, odoEnd: 520, km: 500, personNames: ['Konrad', 'Dennis', 'Samuel'] })
    expect(t.draft!.endDate).toBeUndefined()
    expect(t.status).toBe('warning') // Jahr unsichtbar + Zukunftsdatum
    expect(t.messages.join(' ')).toMatch(/Jahr/)
    expect(p.expenses).toHaveLength(1)
    expect(p.expenses[0].draft).toMatchObject({ title: 'Leasingrate', categoryId: 'leasing', amountCents: 31915, frequency: 'monthly', count: 24 })
    expect(p.persons.map((x) => x.name)).toEqual(['Konrad', 'Dennis', 'Samuel'])
    expect(p.referenceCheck?.matches).toBe(true)
    expect(p.referenceCheck?.rows.every((r) => r.appCents === 255320)).toBe(true)
  })

  it('setzt keine berechneten Formelwerte voraus', async () => {
    const p = analyzeWorkbook(originalLikeWorkbook({ cachedValues: false }), 'x.xlsx', await existing(), TODAY)
    expect(p.trips[0].draft?.km).toBe(500)
    expect(p.expenses[0].draft?.amountCents).toBe(31915)
  })

  it('markiert fehlerhafte Zeilen verständlich', async () => {
    const wb = originalLikeWorkbook({
      cachedValues: true,
      extraRows: [
        ['kein datum', null, 100, 200, null, 'Samuel'],
        [46000, null, 300, 250, null, 'Dennis'],
        [46001, null, null, null, 40, ''],
        [46002, null, null, null, 'viel', 'Konrad'],
      ],
    })
    const p = analyzeWorkbook(wb, 'x.xlsx', await existing(), TODAY)
    const [, a, b, c, d] = p.trips
    expect(a.status).toBe('error')
    expect(a.messages.join()).toMatch(/Datum/)
    expect(b.status).toBe('error')
    expect(b.messages.join()).toMatch(/kleiner als am Anfang/)
    expect(c.messages.join()).toMatch(/Personen/)
    expect(d.status).toBe('error')
    expect(d.messages.join()).toMatch(/keine gültige Zahl/)
    expect(p.trips.filter((r) => r.selected)).toHaveLength(1)
  })

  it('erkennt Personennamen mit verschiedenen Trennzeichen', () => {
    expect(splitPersonNames('Konrad, Dennis und Samuel')).toEqual(['Konrad', 'Dennis', 'Samuel'])
    expect(splitPersonNames('Anna / Ben; anna')).toEqual(['Anna', 'Ben'])
  })

  it('importiert in die Datenbank und verhindert doppelten Import', async () => {
    const wb = originalLikeWorkbook({ cachedValues: true })
    const p1 = analyzeWorkbook(wb, 'x.xlsx', await existing(), TODAY)
    const r1 = await applyImport(p1, selectAll(p1), db)
    expect(r1).toMatchObject({ personsCreated: 3, tripsAdded: 1, expensesAdded: 1 })
    const persons = db.getData().persons
    const trip = (db.getData().trips)[0]
    expect(trip.personIds).toHaveLength(3)
    expect(trip.personIds.every((id) => persons.some((p) => p.id === id))).toBe(true)
    const exp = (db.getData().expenses)[0]
    expect(exp).toMatchObject({ amountCents: 31915, date: '2026-12-01', recurrence: { frequency: 'monthly', count: 24 } })

    // Zweiter Durchlauf: alles als Duplikat erkannt
    const p2 = analyzeWorkbook(wb, 'x.xlsx', await existing(), TODAY)
    expect(p2.trips[0].status).toBe('duplicate')
    expect(p2.expenses[0].status).toBe('duplicate')
    expect(p2.persons.every((x) => x.existingId)).toBe(true)
    const r2 = await applyImport(p2, selectAll(p2), db)
    expect(r2.tripsAdded + r2.expensesAdded + r2.personsCreated).toBe(0)

    // Selbst wenn man eine veraltete Vorschau erneut anwendet, entsteht kein Duplikat
    const r3 = await applyImport(p1, selectAll(p1), db)
    expect(r3.tripsAdded).toBe(0)
    expect(r3.expensesAdded).toBe(0)
    expect(r3.skippedDuplicates).toBe(2)
    expect(db.getData().trips.length).toBe(1)
    expect(db.getData().expenses.length).toBe(1)
    expect(db.getData().persons.length).toBe(3)
  })

  it('erkennt manuell erfasste gleiche Fahrten als Duplikat und nutzt vorhandene Personen (auch nach Umbenennung keine Doppelanlage)', async () => {
    const k = await addPerson('konrad', db)
    const d = await addPerson('Dennis', db)
    const s = await addPerson('Samuel', db)
    await saveTrip({ startDate: '2026-12-29', km: 500, personIds: [k.id, d.id, s.id] }, undefined, db)
    const p = analyzeWorkbook(originalLikeWorkbook({ cachedValues: true }), 'x.xlsx', await existing(), TODAY)
    expect(p.trips[0].status).toBe('duplicate')
    expect(p.trips[0].selected).toBe(false)
    expect(p.persons.find((x) => x.name === 'Konrad')?.existingId).toBe(k.id)
  })

  it('verlangt ein Startdatum für Kosten ohne Datum', async () => {
    const p = analyzeWorkbook(originalLikeWorkbook({ cachedValues: true }), 'x.xlsx', await existing(), TODAY)
    await expect(applyImport(p, { ...selectAll(p), expenseStartDates: {} }, db)).rejects.toThrow(/Startdatum/)
    expect(db.getData().trips.length).toBe(0) // nichts teilweise importiert
  })

  const realFile = resolve(__dirname, '../../../VW California.xlsx')
  it.skipIf(!existsSync(realFile))('liest die echte Datei „VW California.xlsx“', async () => {
    const wb = readWorkbook(readFileSync(realFile))
    const p = analyzeWorkbook(wb, 'VW California.xlsx', await existing(), TODAY)
    expect(p.issues).toEqual([])
    expect(p.trips.filter((t) => t.draft).length).toBeGreaterThan(0)
    expect(p.expenses.filter((e) => e.draft).length).toBeGreaterThan(0)
    expect(p.referenceCheck?.matches).toBe(true)
  })
})

describe('Excel-Export', () => {
  it('Daten-Export kann wieder importiert werden (ohne Duplikate)', async () => {
    const a = await addPerson('Anna', db)
    const b = await addPerson('Ben', db)
    await saveTrip({ startDate: '2026-03-01', endDate: '2026-03-04', from: 'München', to: 'Gardasee', odoStart: 1000, odoEnd: 1450, km: 450, personIds: [a.id, b.id], note: 'Ostern' }, undefined, db)
    await saveTrip({ startDate: '2026-04-11', km: 82.5, personIds: [a.id] }, undefined, db)
    await saveExpense({ title: 'Versicherung', categoryId: 'insurance', amountCents: 89900, date: '2026-01-01', allocation: 'perKm', recurrence: { frequency: 'yearly', count: 2 } }, undefined, db)
    const data = { trips: db.getData().trips, expenses: db.getData().expenses, persons: db.getData().persons, categories: db.getData().categories }
    const file = workbookToArray(buildDataWorkbook(data))

    const p = analyzeWorkbook(readWorkbook(file), 'export.xlsx', await existing(), TODAY)
    expect(p.trips).toHaveLength(2)
    expect(p.trips.every((t) => t.status === 'duplicate')).toBe(true)
    expect(p.trips[0].draft).toMatchObject({ startDate: '2026-03-01', endDate: '2026-03-04', from: 'München', to: 'Gardasee', km: 450, personNames: ['Anna', 'Ben'], note: 'Ostern' })
    expect(p.trips[1].draft?.km).toBe(82.5)
    expect(p.expenses[0].draft).toMatchObject({ title: 'Versicherung', categoryId: 'insurance', amountCents: 89900, frequency: 'yearly', count: 2, date: '2026-01-01' })
    expect(p.expenses[0].status).toBe('duplicate')

    // In eine leere Datenbank importierbar
    const empty = new MemoryStore()
    const ex2 = { persons: [], trips: [], expenses: [], categories: DEFAULT_CATEGORIES }
    const p2 = analyzeWorkbook(readWorkbook(file), 'export.xlsx', ex2, TODAY)
    const r = await applyImport(p2, selectAll(p2), empty)
    expect(r).toMatchObject({ personsCreated: 2, tripsAdded: 2, expensesAdded: 1 })
  })

  it('Abrechnungs-Export enthält alle Blätter mit korrekten Summen', async () => {
    const a = await addPerson('Anna', db)
    const b = await addPerson('Ben', db)
    await saveTrip({ startDate: '2026-03-01', km: 100, personIds: [a.id, b.id] }, undefined, db)
    await saveExpense({ title: 'Diesel', categoryId: 'fuel', amountCents: 10001, date: '2026-03-02', allocation: 'perKm' }, undefined, db)
    const data = { trips: db.getData().trips, expenses: db.getData().expenses, persons: db.getData().persons, categories: db.getData().categories }
    const s = buildSettlement(data, { period: { kind: 'all' }, today: TODAY })
    const wb = readWorkbook(workbookToArray(buildSettlementWorkbook(s, data, { trips: 'Gesamt', costs: 'Gesamt' })))
    expect(wb.SheetNames).toEqual(['Übersicht', 'Personenanteile', 'Ausgleich', 'Fahrten', 'Kosten', 'Berechnungsgrundlagen'])
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Personenanteile'], { header: 1 })
    const sumRow = rows.find((r) => r[0] === 'Summe')!
    expect(sumRow[6]).toBeCloseTo(100.01, 6)
    const shares = rows.slice(1, 3).map((r) => Math.round(Number(r[6]) * 100)).sort()
    expect(shares).toEqual([5000, 5001])
  })
})

describe('Backup', () => {
  it('vollständige Sicherung und Wiederherstellung auf einem „anderen Gerät“', async () => {
    const a = await addPerson('Anna', db)
    await setPersonActive(a.id, false, db)
    await db.commit([{ type: 'put', table: 'categories', value: { id: 'eigene', name: 'Fähre', builtin: false, color: '#000' } }])
    await saveTrip({ startDate: '2026-03-01', km: 100, personIds: [a.id] }, undefined, db)
    await saveExpense({ title: 'Fähre', categoryId: 'eigene', amountCents: 5000, date: '2026-03-01', allocation: 'direct', directPersonIds: [a.id] }, undefined, db)
    const json = JSON.stringify(createBackup(db))

    const other = new MemoryStore()
    await addPerson('Wird überschrieben', other)
    await restoreBackup(parseBackup(json), other)
    expect(other.getData().persons).toEqual(db.getData().persons)
    expect(other.getData().trips).toEqual(db.getData().trips)
    expect(other.getData().expenses).toEqual(db.getData().expenses)
    expect((other.getData().categories).length).toBe(DEFAULT_CATEGORIES.length + 1)
  })

  it('weist ungültige oder fremde Dateien ab, ohne Daten zu verändern', async () => {
    expect(() => parseBackup('kein json')).toThrow(BackupError)
    expect(() => parseBackup('{"app":"andere-app"}')).toThrow(/keine Sicherung/)
    const b = createBackup(db)
    const broken = { ...b, data: { ...b.data, trips: [{ id: 't', startDate: '2026-01-01', km: 5, personIds: ['fehlt'], createdAt: '', updatedAt: '' }] } }
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/unbekannte Person/)
    const badKm = { ...b, data: { ...b.data, trips: [{ id: 't', startDate: '2026-01-01', km: -1, personIds: ['x'], createdAt: '', updatedAt: '' }] } }
    expect(() => parseBackup(JSON.stringify(badKm))).toThrow(BackupError)
  })
})

describe('Import – Erweiterungen', () => {
  it('übernimmt in der Vorschau korrigierte Daten, ohne die Duplikaterkennung zu verlieren', async () => {
    const wb = originalLikeWorkbook({ cachedValues: true })
    const p = analyzeWorkbook(wb, 'x.xlsx', await existing(), TODAY)
    const sel = { ...selectAll(p), tripDateOverrides: { [p.trips[0].rowId]: '2025-12-29' } }
    await applyImport(p, sel, db)
    expect(db.getData().trips[0].startDate).toBe('2025-12-29')
    const p2 = analyzeWorkbook(wb, 'x.xlsx', await existing(), TODAY)
    expect(p2.trips[0].status).toBe('duplicate')
  })
  it('gleiche Importe auf zwei Geräten erzeugen dieselben IDs (kein Duplikat bei paralleler Nutzung)', async () => {
    const wb = originalLikeWorkbook({ cachedValues: true })
    const other = new MemoryStore()
    const p1 = analyzeWorkbook(wb, 'x.xlsx', await existing(), TODAY)
    const p2 = analyzeWorkbook(wb, 'x.xlsx', other.getData(), TODAY)
    await applyImport(p1, selectAll(p1), db)
    await applyImport(p2, selectAll(p2), other)
    expect(db.getData().trips[0].id).toBe(other.getData().trips[0].id)
    expect(db.getData().expenses[0].id).toBe(other.getData().expenses[0].id)
  })
  it('Export → Import erhält „Bezahlt von“ und „Verteilt auf Monate“', async () => {
    const a = await addPerson('Anna', db)
    await saveExpense({ title: 'Versicherung', categoryId: 'insurance', amountCents: 60000, date: '2026-01-01', allocation: 'perKm', spreadMonths: 12, paidBy: a.id }, undefined, db)
    const d = db.getData()
    const file = workbookToArray(buildDataWorkbook(d))
    const fresh = new MemoryStore()
    const p = analyzeWorkbook(readWorkbook(file), 'e.xlsx', fresh.getData(), TODAY)
    expect(p.expenses[0].draft).toMatchObject({ spreadMonths: 12, paidByName: 'Anna' })
    await applyImport(p, selectAll(p), fresh)
    const e = fresh.getData().expenses[0]
    expect(e.spreadMonths).toBe(12)
    expect(fresh.getData().persons.find((x) => x.id === e.paidBy)?.name).toBe('Anna')
  })
})
