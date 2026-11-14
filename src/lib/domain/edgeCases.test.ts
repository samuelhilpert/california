/**
 * Randfälle und Fehler, die bei der Prüfung der Vorauszahlungen, „Bis heute“, des Rechenwegs
 * und der Festpreise aufgefallen sind.
 */
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { addPerson, deletePerson, saveExpense, savePayment, saveTrip } from '../store/repo'
import { createBackup, parseBackup } from '../io/backup'
import { buildSettlementWorkbook, workbookToArray } from '../io/excelExport'
import { balanceBreakdown } from './breakdown'
import { describeRecurrence } from './recurrence'
import { buildSettlement, type Settlement } from './settlement'
import { validatePayment } from './validation'

let db: MemoryStore
let K: string, D: string, G: string
beforeEach(async () => {
  db = new MemoryStore()
  K = (await addPerson('Konrad', db)).id
  D = (await addPerson('Dennis', db)).id
  G = (await addPerson('Gast', db)).id
})
const settle = (period: Parameters<typeof buildSettlement>[1]['period'] = { kind: 'all' }, today = '2027-12-31', costPeriod?: Parameters<typeof buildSettlement>[1]['period']) =>
  buildSettlement(db.getData(), { period, costPeriod, today })

describe('Fehler 1: Empfänger eines Festpreises kann nicht gelöscht werden', () => {
  it('Löschen wird abgelehnt (sonst Verweis auf gelöschte Person, Backup wäre unlesbar)', async () => {
    const H = (await addPerson('Helena', db)).id
    await saveTrip({ startDate: '2027-03-01', endDate: '2027-03-01', km: 100, personIds: [G], fixedPriceCents: 5000, fixedPriceRecipientIds: [H] }, undefined, db)
    await expect(deletePerson(H, db)).rejects.toThrow(/nur deaktiviert werden/)
    // Backup bleibt einlesbar
    expect(() => parseBackup(JSON.stringify(createBackup(db)))).not.toThrow()
  })
  it('eine unbenutzte Person kann weiterhin gelöscht werden', async () => {
    const X = (await addPerson('Niemand', db)).id
    await expect(deletePerson(X, db)).resolves.toMatchObject({ name: 'Niemand' })
  })
})

describe('Fehler 2: Excel-Export einer älteren abgeschlossenen Abrechnung', () => {
  it('fehlende Felder (Festpreise, Vorauszahlungen) werden als 0 exportiert, nicht als Fehlerzelle #NUM!', async () => {
    await saveExpense({ title: 'Leasing', categoryId: 'leasing', amountCents: 10000, date: '2027-01-06', allocation: 'perKm', paidBy: K }, undefined, db)
    await saveTrip({ startDate: '2027-02-01', endDate: '2027-02-01', km: 100, personIds: [K, D] }, undefined, db)
    await savePayment({ date: '2027-03-01', fromPersonId: D, toPersonId: K, amountCents: 5000 }, undefined, db)
    const s = settle()
    // So sah ein gespeichertes Ergebnis vor dieser Version aus
    const old = JSON.parse(JSON.stringify(s)) as Settlement
    for (const p of old.persons) delete (p as Partial<typeof p>).fixedCents
    for (const b of old.balance.balances) {
      delete (b as Partial<typeof b>).advanceSentCents
      delete (b as Partial<typeof b>).advanceReceivedCents
    }
    const wb = XLSX.read(workbookToArray(buildSettlementWorkbook(old, db.getData(), { trips: 'Gesamt', costs: 'Gesamt' })), { type: 'array' })
    for (const name of wb.SheetNames) {
      const errorCells = Object.entries(wb.Sheets[name]).filter(([addr, c]) => !addr.startsWith('!') && (c as XLSX.CellObject).t === 'e')
      expect(errorCells.map(([addr]) => addr), name).toEqual([])
    }
    const shares = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Personenanteile'], { header: 1 })
    expect(shares.find((r) => r[0] === 'Konrad')![6]).toBe(0)
  })
})

describe('Zeiträume', () => {
  it('„Bis heute“ begrenzt auch unbefristete Kosten und Abschläge auf das Datum', async () => {
    await saveExpense({ title: 'Stellplatz', categoryId: 'other', amountCents: 3000, date: '2027-01-01', allocation: 'perKm', recurrence: { frequency: 'monthly' }, paidBy: K }, undefined, db)
    await savePayment({ kind: 'advance', date: '2027-01-15', fromPersonId: D, toPersonId: K, amountCents: 1000, recurrence: { frequency: 'monthly' } }, undefined, db)
    await saveTrip({ startDate: '2027-01-10', endDate: '2027-01-10', km: 100, personIds: [D] }, undefined, db)
    const s = settle({ kind: 'until', to: '2027-04-20' }, '2027-12-31')
    expect(s.costs).toHaveLength(4) // Jan–Apr
    expect(s.payments).toHaveLength(4) // 15.01.–15.04.
    expect(s.balance.residualCents).toBe(0)
  })
  it('Festpreis-Fahrt nach dem Stichtag zählt bei „Bis heute“ nicht', async () => {
    await saveTrip({ startDate: '2027-06-01', endDate: '2027-06-01', km: 100, personIds: [G], fixedPriceCents: 5000, fixedPriceRecipientIds: [K] }, undefined, db)
    expect(settle({ kind: 'until', to: '2027-05-31' }).trips).toHaveLength(0)
    expect(settle({ kind: 'until', to: '2027-06-01' }).trips).toHaveLength(1)
  })
  it('Zahlungen richten sich nach dem Fahrtenzeitraum, auch bei abweichendem Kostenzeitraum', async () => {
    await savePayment({ kind: 'advance', date: '2027-01-15', fromPersonId: D, toPersonId: K, amountCents: 1000, recurrence: { frequency: 'monthly', count: 24 } }, undefined, db)
    const s = settle({ kind: 'year', year: 2027 }, '2027-12-31', { kind: 'year', year: 2028 })
    expect(s.payments).toHaveLength(12)
    expect(s.payments.every((p) => p.date.startsWith('2027'))).toBe(true)
  })
  it('jährlicher Abschlag in der Monatsansicht nur im Fälligkeitsmonat', async () => {
    await savePayment({ kind: 'advance', date: '2027-03-10', fromPersonId: D, toPersonId: K, amountCents: 50000, recurrence: { frequency: 'yearly', count: 2 } }, undefined, db)
    expect(settle({ kind: 'month', year: 2027, month: 3 }).payments).toHaveLength(1)
    expect(settle({ kind: 'month', year: 2027, month: 4 }).payments).toHaveLength(0)
    expect(settle({ kind: 'month', year: 2028, month: 3 }).payments).toHaveLength(1)
  })
})

describe('Rechenweg – weitere Fälle', () => {
  it('wiederkehrende Direktkosten werden zusammengefasst (Anzahl und „geteilt durch“)', async () => {
    await saveExpense({ title: 'Garage', categoryId: 'other', amountCents: 3000, date: '2027-01-01', allocation: 'direct', directPersonIds: [K, D], recurrence: { frequency: 'monthly', count: 3 }, paidBy: K }, undefined, db)
    const s = settle()
    const line = balanceBreakdown(s, D).lines.find((l) => l.type === 'direct')
    expect(line).toMatchObject({ title: 'Garage', count: 3, sharedBy: 2, cents: -4500 })
    expect(balanceBreakdown(s, K).totalCents).toBe(9000 - 4500)
  })
  it('Person, die nur Geld bekommen hat (Ausgleich), hat einen nachvollziehbaren Rechenweg', async () => {
    await savePayment({ date: '2027-03-01', fromPersonId: D, toPersonId: G, amountCents: 1234 }, undefined, db)
    const r = balanceBreakdown(settle(), G)
    expect(r.lines).toEqual([{ type: 'settlement', paymentId: expect.any(String), otherPersonId: D, sent: false, date: '2027-03-01', cents: -1234 }])
  })
  it('Person ohne jede Beteiligung: leerer Rechenweg, Saldo 0', () => {
    expect(balanceBreakdown(settle(), G)).toEqual({ lines: [], totalCents: 0 })
  })
})

describe('Zahlungen – Validierung und Beschreibung', () => {
  it('ältere Zahlung ohne Art kann kein Dauerauftrag werden', () => {
    expect(validatePayment({ date: '2027-01-01', fromPersonId: 'a', toPersonId: 'b', amountCents: 100, recurrence: { frequency: 'monthly', count: 2 } })).toHaveProperty('recurrence')
  })
  it('Beschreibung eines Dauerauftrags', () => {
    expect(describeRecurrence({ recurrence: { frequency: 'monthly', count: 24 } })).toBe('monatlich, 24×')
    expect(describeRecurrence({ recurrence: { frequency: 'monthly', until: '2028-12-31' } })).toBe('monatlich bis 31.12.2028')
    expect(describeRecurrence({ recurrence: { frequency: 'yearly' } })).toBe('jährlich, unbefristet')
    expect(describeRecurrence({})).toBe('Einmalig')
  })
})

describe('Festpreis – weitere Fälle', () => {
  it('ungültige Festpreis-Fahrt erscheint als Hinweis und zählt nicht', async () => {
    // Kann nur über Altdaten/Import entstehen – Speichern prüft das vorher
    const t = await saveTrip({ startDate: '2027-03-01', endDate: '2027-03-01', km: 100, personIds: [G] }, undefined, db)
    await db.commit([{ type: 'put', table: 'trips', value: { ...t, fixedPriceCents: 5000, fixedPriceRecipientIds: [] } }])
    const s = settle()
    expect(s.invalidTrips).toEqual([{ tripId: t.id, reason: 'fixed-price' }])
    expect(s.notices.map((n) => n.code)).toContain('invalid-trips')
  })
  it('Gast wird später Mitglied: bestehende Festpreis-Fahrt rechnet weiter, Bearbeiten verlangt eine Entscheidung', async () => {
    await saveTrip({ startDate: '2027-03-01', endDate: '2027-03-01', km: 100, personIds: [G], fixedPriceCents: 5000, fixedPriceRecipientIds: [K] }, undefined, db)
    const g = db.getData().persons.find((p) => p.id === G)!
    await db.commit([{ type: 'put', table: 'persons', value: { ...g, email: 'gast@x.test' } }])
    expect(settle().persons.find((p) => p.personId === G)?.totalCents).toBe(5000)
    const trip = db.getData().trips[0]
    await expect(saveTrip({ ...trip, note: 'geändert' }, trip.id, db)).rejects.toMatchObject({ fields: { fixedPrice: expect.any(String) } })
  })
})
