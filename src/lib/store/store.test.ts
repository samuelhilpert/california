import { describe, expect, it } from 'vitest'
import { MemoryStore } from './memoryStore'
import { addPerson, deleteTrip, restoreRecord, saveExpense, savePayment, saveSettlementSnapshot, saveTrip, ValidationError } from './repo'
import { createBackup, parseBackup, planMerge, restoreBackup, BACKUP_APP_ID } from '../io/backup'
import { buildSettlement } from '../domain/settlement'

describe('Repository', () => {
  it('Löschen und Rückgängig stellt die Fahrt unverändert wieder her', async () => {
    const db = new MemoryStore()
    const a = await addPerson('Anna', db)
    const t = await saveTrip({ startDate: '2026-01-01', km: 10, personIds: [a.id] }, undefined, db)
    const removed = await deleteTrip(t.id, db)
    expect(db.getData().trips).toHaveLength(0)
    await restoreRecord('trips', removed!, db)
    expect(db.getData().trips).toEqual([t])
  })
  it('validiert Ausgleichszahlungen', async () => {
    const db = new MemoryStore()
    const a = await addPerson('Anna', db)
    await expect(savePayment({ date: '2026-01-01', fromPersonId: a.id, toPersonId: a.id, amountCents: 100 }, undefined, db)).rejects.toBeInstanceOf(ValidationError)
    await expect(savePayment({ date: '2026-01-01', fromPersonId: a.id, toPersonId: 'x', amountCents: 0 }, undefined, db)).rejects.toThrow(/positiven Betrag/)
  })
  it('speichert eine abgeschlossene Abrechnung als JSON-taugliche Momentaufnahme', async () => {
    const db = new MemoryStore()
    const a = await addPerson('Anna', db)
    await saveTrip({ startDate: '2026-01-01', km: 10, personIds: [a.id] }, undefined, db)
    await saveExpense({ title: 'Diesel', categoryId: 'fuel', amountCents: 1000, date: '2026-01-01', allocation: 'perKm', paidBy: a.id }, undefined, db)
    const s = buildSettlement(db.getData(), { period: { kind: 'all' }, today: '2026-10-27' })
    const snap = await saveSettlementSnapshot({ title: 'Januar', period: { kind: 'all' }, personNames: { [a.id]: 'Anna' }, categoryNames: {}, result: s }, db)
    expect(db.getData().settlements).toHaveLength(1)
    expect((snap.result as { distributedCents: number }).distributedCents).toBe(1000)
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
  it('atomarer Commit: bei Fehler bleibt der Stand unverändert', async () => {
    const db = new MemoryStore()
    db.failNextCommit = new Error('offline')
    await expect(addPerson('Anna', db)).rejects.toThrow('offline')
    expect(db.getData().persons).toHaveLength(0)
  })
})

describe('Backup zusammenführen', () => {
  it('ergänzt neue Datensätze, behält neuere Fassungen, legt gleichnamige Personen zusammen, löscht nichts', async () => {
    const shared = new MemoryStore()
    const a = await addPerson('Anna', shared)
    const t1 = await saveTrip({ startDate: '2026-01-01', km: 10, personIds: [a.id] }, undefined, shared)

    // „Anderes Gerät“: eigener Stand mit Anna (andere ID!) und eigener Fahrt
    const phone = new MemoryStore()
    const a2 = await addPerson('anna', phone)
    const b = await addPerson('Ben', phone)
    await saveTrip({ startDate: '2026-02-01', km: 20, personIds: [a2.id, b.id] }, undefined, phone)
    const phoneBackup = createBackup(phone)

    // Auf dem gemeinsamen Stand inzwischen neuere Änderung an t1
    await saveTrip({ startDate: '2026-01-01', km: 15, personIds: [a.id] }, t1.id, shared)

    const plan = planMerge(shared.getData(), phoneBackup)
    expect(plan.removed).toBe(0)
    await restoreBackup(phoneBackup, shared, 'merge')
    const d = shared.getData()
    expect(d.persons.map((p) => p.name).sort()).toEqual(['Anna', 'Ben'])
    expect(d.trips).toHaveLength(2)
    expect(d.trips.find((t) => t.id === t1.id)!.km).toBe(15)
    const imported = d.trips.find((t) => t.id !== t1.id)!
    expect(imported.personIds).toEqual([a.id, b.id]) // auf vorhandene Anna umgeschlüsselt
    // zweites Zusammenführen ändert nichts
    const again = planMerge(shared.getData(), phoneBackup)
    expect(again.added + again.updated).toBe(0)
  })
  it('liest Sicherungen der lokalen Version (Schema 1)', () => {
    const v1 = { app: BACKUP_APP_ID, schemaVersion: 1, exportedAt: 'x', data: { persons: [], trips: [], expenses: [], categories: [], settings: [{ key: 'theme', value: 'dark' }] } }
    const b = parseBackup(JSON.stringify(v1))
    expect(b.data.settings).toEqual([{ id: 'theme', value: 'dark' }])
    expect(b.data.payments).toEqual([])
  })
  it('Ersetzen entfernt Datensätze, die nicht in der Sicherung sind', async () => {
    const db = new MemoryStore()
    await addPerson('Weg', db)
    const empty = createBackup(new MemoryStore())
    const plan = await restoreBackup(empty, db, 'replace')
    expect(plan.removed).toBe(1)
    expect(db.getData().persons).toHaveLength(0)
    expect(db.getData().categories.length).toBeGreaterThan(0)
  })
})
