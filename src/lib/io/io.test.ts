import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { DEFAULT_CATEGORIES } from '../store/defaults'
import { addPerson, saveExpense, saveTrip, setPersonActive } from '../store/repo'
import { buildDataWorkbook, buildSettlementWorkbook, workbookToArray } from './excelExport'
import { BackupError, createBackup, parseBackup, restoreBackup } from './backup'
import { buildSettlement } from '../domain/settlement'

const TODAY = '2026-10-27'
let db: MemoryStore

beforeEach(() => {
  db = new MemoryStore()
})

const readXlsx = (file: Uint8Array) => XLSX.read(file, { type: 'array' })

describe('Excel-Export', () => {
  it('Daten-Export enthält Fahrten, Kosten und Personen lesbar', async () => {
    const a = await addPerson('Anna', db)
    const b = await addPerson('Ben', db)
    await saveTrip({ startDate: '2026-03-01', endDate: '2026-03-04', from: 'München', to: 'Gardasee', odoStart: 1000, odoEnd: 1450, km: 450, personIds: [a.id, b.id], note: 'Ostern' }, undefined, db)
    await saveTrip({ startDate: '2026-04-11', endDate: '2026-04-11', km: 82.5, personIds: [a.id] }, undefined, db)
    await saveExpense({ title: 'Versicherung', categoryId: 'insurance', amountCents: 89900, date: '2026-01-01', allocation: 'perKm', recurrence: { frequency: 'yearly', count: 2 }, spreadMonths: 12, paidBy: a.id }, undefined, db)
    const wb = readXlsx(workbookToArray(buildDataWorkbook(db.getData())))
    expect(wb.SheetNames).toEqual(['Fahrtenbuch', 'Kosten', 'Personen'])

    const trips = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Fahrtenbuch'])
    expect(trips[0]).toMatchObject({ Startort: 'München', Zielort: 'Gardasee', 'gefahrene Kilometer': 450, Wer: 'Anna, Ben', Notiz: 'Ostern' })
    expect(trips[1]).toMatchObject({ 'gefahrene Kilometer': 82.5, Wer: 'Anna' })
    expect(trips.at(-1)).toMatchObject({ Von: 'Summe', 'gefahrene Kilometer': 532.5 })

    const costs = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Kosten'])
    expect(costs[0]).toMatchObject({ Bezeichnung: 'Versicherung', Kategorie: 'Versicherung', Betrag: 899, Anzahl: 2, Wiederholung: 'jährlich', 'Verteilt auf Monate': 12, 'Bezahlt von': 'Anna' })

    const persons = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Personen'])
    expect(persons.map((p) => p.Name)).toEqual(['Anna', 'Ben'])
  })

  it('Abrechnungs-Export enthält alle Blätter mit korrekten Summen', async () => {
    const a = await addPerson('Anna', db)
    const b = await addPerson('Ben', db)
    await saveTrip({ startDate: '2026-03-01', endDate: '2026-03-01', km: 100, personIds: [a.id, b.id] }, undefined, db)
    await saveExpense({ title: 'Diesel', categoryId: 'fuel', amountCents: 10001, date: '2026-03-02', allocation: 'perKm' }, undefined, db)
    const data = { trips: db.getData().trips, expenses: db.getData().expenses, persons: db.getData().persons, categories: db.getData().categories }
    const s = buildSettlement(data, { period: { kind: 'all' }, today: TODAY })
    const wb = readXlsx(workbookToArray(buildSettlementWorkbook(s, data, { trips: 'Gesamt', costs: 'Gesamt' })))
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
    await saveTrip({ startDate: '2026-03-01', endDate: '2026-03-01', km: 100, personIds: [a.id] }, undefined, db)
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

  it('Zusammenführen ergänzt fehlende Datensätze und löscht nichts', async () => {
    const a = await addPerson('Anna', db)
    await saveTrip({ startDate: '2026-03-01', endDate: '2026-03-01', km: 100, personIds: [a.id] }, undefined, db)
    const backup = parseBackup(JSON.stringify(createBackup(db)))

    const other = new MemoryStore()
    const c = await addPerson('Clara', other)
    await saveTrip({ startDate: '2026-05-01', endDate: '2026-05-01', km: 50, personIds: [c.id] }, undefined, other)
    await restoreBackup(backup, other, 'merge')
    expect(other.getData().trips.map((t) => t.km).sort()).toEqual([100, 50])
    expect(other.getData().persons.map((p) => p.name).sort()).toEqual(['Anna', 'Clara'])
  })
})
