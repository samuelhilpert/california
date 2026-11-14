/**
 * Festpreis-Fahrten (Gäste): Die Fahrenden tragen den Festpreis, Kilometer und Fahrtkosten gehen an die
 * ausgewählten Empfänger, die dafür den Festpreis gutgeschrieben bekommen – beides zu gleichen Teilen.
 * Grundlage der Beispiele: 6.500 € km-Kosten auf 10.000 km = 0,65 €/km.
 */
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { addPerson, saveExpense, saveTrip, ValidationError } from '../store/repo'
import { createBackup, parseBackup, restoreBackup } from '../io/backup'
import { buildDataWorkbook, buildSettlementWorkbook, workbookToArray } from '../io/excelExport'
import { balanceBreakdown } from './breakdown'
import { buildSettlement, computeDistribution, type TripLike } from './settlement'
import { validateTrip } from './validation'
import type { CostEntry } from './types'

const costs = (cents = 650000): CostEntry[] => [{ id: 'c', expenseId: 'e', title: 'Leasing', categoryId: 'leasing', date: '2027-01-06', amountCents: cents, allocation: 'perKm', directPersonIds: [] }]
const T = (id: string, km: number, personIds: string[], fixed?: { cents: number; to: string[] }): TripLike => ({
  id, km, personIds, startDate: `2027-03-${id.padStart(2, '0').slice(-2)}`,
  ...(fixed ? { fixedPriceCents: fixed.cents, fixedPriceRecipientIds: fixed.to } : {}),
})
const person = (d: ReturnType<typeof computeDistribution>, id: string) => d.persons.find((p) => p.personId === id)!

describe('Beispiel 1: Gast zahlt weniger, als die Fahrt kostet', () => {
  // Konrad 9.600 km, Gast 400 km zum Festpreis 100 € → Konrad + Dennis
  const d = computeDistribution([T('1', 9600, ['k']), T('2', 400, ['gast'], { cents: 10000, to: ['k', 'd'] })], costs())

  it('Gast-km zählen beim Kilometerpreis mit', () => {
    expect(d.totalKm).toBe(10000)
    expect(d.pricePerKm).toBeCloseTo(0.65, 10)
  })
  it('die Fahrt kostet 260 €: Gast 100 €, Konrad und Dennis je 200 km und netto +80 €', () => {
    const t = d.trips.find((x) => x.tripId === '2')!
    expect(t.costCents).toBe(26000)
    expect(t.fixedPriceCents).toBe(10000)
    expect(t.shares).toEqual([
      { personId: 'gast', km: 0, cents: 10000, fixedCents: 10000 },
      { personId: 'k', km: 200, cents: 8000, fixedCents: -5000 },
      { personId: 'd', km: 200, cents: 8000, fixedCents: -5000 },
    ])
  })
  it('Personensummen: Gast trägt genau den Festpreis, Rest verteilt sich exakt', () => {
    expect(person(d, 'gast')).toMatchObject({ km: 0, perKmCents: 0, fixedCents: 10000, totalCents: 10000, tripCount: 1 })
    expect(person(d, 'd')).toMatchObject({ km: 200, perKmCents: 13000, fixedCents: -5000, totalCents: 8000, tripCount: 0 })
    expect(person(d, 'k')).toMatchObject({ km: 9800, perKmCents: 624000 + 13000, fixedCents: -5000, totalCents: 632000 })
    expect(d.distributedCents).toBe(650000)
  })
})

describe('Beispiel 2: Festpreis höher als die Fahrtkosten', () => {
  const d = computeDistribution([T('1', 9900, ['k']), T('2', 100, ['gast'], { cents: 10000, to: ['k'] })], costs())
  it('Konrad: +65 € Fahrtkosten −100 € Festpreis = 35 € Gewinn', () => {
    const t = d.trips.find((x) => x.tripId === '2')!
    expect(t.shares.find((x) => x.personId === 'k')).toEqual({ personId: 'k', km: 100, cents: 6500 - 10000, fixedCents: -10000 })
    expect(person(d, 'k').totalCents).toBe(650000 - 10000)
    expect(person(d, 'gast').totalCents).toBe(10000)
    expect(d.distributedCents).toBe(650000)
  })
})

describe('Beispiel 3: drei Empfänger, Cent-Rundung', () => {
  const d = computeDistribution([T('1', 9600, ['k']), T('2', 400, ['gast'], { cents: 15000, to: ['k', 'd', 's'] })], costs())
  it('260 € und 150 € werden centgenau gedrittelt, Summe bleibt exakt', () => {
    const t = d.trips.find((x) => x.tripId === '2')!
    const r = t.shares.filter((x) => x.personId !== 'gast')
    expect(r.map((x) => x.cents - x.fixedCents!).sort()).toEqual([8666, 8667, 8667])
    expect(r.map((x) => -x.fixedCents!)).toEqual([5000, 5000, 5000])
    expect(r.map((x) => x.cents).sort()).toEqual([3666, 3667, 3667])
    expect(t.shares.reduce((a, x) => a + x.cents, 0)).toBe(26000)
    expect(r.every((x) => Math.abs(x.km - 400 / 3) < 1e-9)).toBe(true)
  })
})

describe('Beispiel 4: zwei Gäste fahren zusammen', () => {
  const d = computeDistribution([T('1', 9600, ['k']), T('2', 400, ['g1', 'g2'], { cents: 10000, to: ['s'] })], costs())
  it('Gäste je 50 €, Samuel 400 km (+260 €) und 100 € Gutschrift = +160 €', () => {
    expect(person(d, 'g1').totalCents).toBe(5000)
    expect(person(d, 'g2').totalCents).toBe(5000)
    expect(person(d, 's')).toMatchObject({ km: 400, perKmCents: 26000, fixedCents: -10000, totalCents: 16000 })
  })
  it('ungerader Festpreis: Restcent wird verteilt, Summe stimmt', () => {
    const d2 = computeDistribution([T('1', 9600, ['k']), T('2', 400, ['g1', 'g2'], { cents: 10001, to: ['s'] })], costs())
    expect(person(d2, 'g1').totalCents + person(d2, 'g2').totalCents).toBe(10001)
    expect(d2.distributedCents).toBe(650000)
  })
})

describe('Sonderfälle', () => {
  it('Gast ohne Haken wird ganz normal nach km abgerechnet – beides ist möglich', () => {
    const d = computeDistribution([T('1', 9600, ['k']), T('2', 400, ['gast'])], costs())
    expect(person(d, 'gast')).toMatchObject({ km: 400, perKmCents: 26000, fixedCents: 0, totalCents: 26000 })
  })
  it('derselbe Gast mit einer Festpreis- und einer km-Fahrt', () => {
    const d = computeDistribution([T('1', 9200, ['k']), T('2', 400, ['gast'], { cents: 10000, to: ['k'] }), T('3', 400, ['gast'])], costs())
    expect(person(d, 'gast')).toMatchObject({ km: 400, perKmCents: 26000, fixedCents: 10000, totalCents: 36000, tripCount: 2 })
    expect(d.distributedCents).toBe(650000)
  })
  it('ohne km-Kosten: der Festpreis ist reine Einnahme der Empfänger', () => {
    const d = computeDistribution([T('2', 400, ['gast'], { cents: 10000, to: ['k', 'd'] })], [])
    expect(person(d, 'gast').totalCents).toBe(10000)
    expect(person(d, 'k').totalCents).toBe(-5000)
    expect(person(d, 'd').totalCents).toBe(-5000)
    expect(d.distributedCents).toBe(0)
  })
  it('nur Festpreis-Fahrten mit 0 km: Kosten bleiben unverteilt, Festpreis wird trotzdem verrechnet', () => {
    const d = computeDistribution([T('2', 0, ['gast'], { cents: 10000, to: ['k'] })], costs())
    expect(d.status).toBe('zero-km')
    expect(d.undistributedCents).toBe(650000)
    expect(person(d, 'gast').totalCents).toBe(10000)
    expect(person(d, 'k').totalCents).toBe(-10000)
  })
  it('ungültige Festpreise werden als ungültige Fahrt gemeldet und nicht verrechnet', () => {
    const d = computeDistribution([
      T('1', 9600, ['k']),
      T('2', 100, ['gast'], { cents: 10000, to: [] }),
      T('3', 100, ['gast'], { cents: 10000, to: ['gast'] }),
      T('4', 100, ['gast'], { cents: 0, to: ['k'] }),
      T('5', 100, ['gast'], { cents: 10000, to: ['k', 'k'] }),
    ], costs())
    expect(d.invalidTrips.map((x) => x.reason)).toEqual(['fixed-price', 'fixed-price', 'fixed-price', 'fixed-price'])
    expect(d.totalKm).toBe(9600)
  })
})

describe('Validierung beim Speichern', () => {
  const base = { startDate: '2027-03-01', endDate: '2027-03-02', km: 400, personIds: ['gast'] }
  const registered = new Set(['k', 'd', 's'])
  it('gültig: Gast mit Festpreis und Empfängern', () => {
    expect(validateTrip({ ...base, fixedPriceCents: 10000, fixedPriceRecipientIds: ['k', 'd'] }, registered)).toEqual({})
  })
  it('kein Festpreis, wenn ein registriertes Mitglied gefahren ist', () => {
    expect(validateTrip({ ...base, personIds: ['gast', 's'], fixedPriceCents: 10000, fixedPriceRecipientIds: ['k'] }, registered)).toHaveProperty('fixedPrice')
  })
  it('Betrag, Empfänger und Überschneidungen werden geprüft', () => {
    expect(validateTrip({ ...base, fixedPriceCents: 0, fixedPriceRecipientIds: ['k'] })).toHaveProperty('fixedPriceCents')
    expect(validateTrip({ ...base, fixedPriceCents: Number.NaN, fixedPriceRecipientIds: ['k'] })).toHaveProperty('fixedPriceCents')
    expect(validateTrip({ ...base, fixedPriceCents: 10000, fixedPriceRecipientIds: [] })).toHaveProperty('fixedPriceRecipientIds')
    expect(validateTrip({ ...base, fixedPriceCents: 10000, fixedPriceRecipientIds: ['gast'] })).toHaveProperty('fixedPriceRecipientIds')
    expect(validateTrip({ ...base, fixedPriceRecipientIds: ['k'] })).toHaveProperty('fixedPriceCents')
  })
})

describe('mit gespeicherten Daten: Ausgleich, Rechenweg, Backup, Excel', () => {
  let db: MemoryStore
  let K: string, D: string, G: string
  beforeEach(async () => {
    db = new MemoryStore()
    K = (await addPerson('Konrad', db)).id
    D = (await addPerson('Dennis', db)).id
    G = (await addPerson('Gast', db)).id
    // Konrad und Dennis sind registrierte Mitglieder
    for (const [id, email] of [[K, 'konrad@x.test'], [D, 'dennis@x.test']]) {
      const p = db.getData().persons.find((x) => x.id === id)!
      await db.commit([{ type: 'put', table: 'persons', value: { ...p, email } }])
    }
    await saveExpense({ title: 'Leasingrate', categoryId: 'leasing', amountCents: 650000, date: '2027-01-06', allocation: 'perKm', paidBy: K }, undefined, db)
    await saveTrip({ startDate: '2027-02-01', endDate: '2027-02-01', km: 9600, personIds: [K] }, undefined, db)
    await saveTrip({ startDate: '2027-03-01', endDate: '2027-03-02', to: 'Gardasee', km: 400, personIds: [G], fixedPriceCents: 10000, fixedPriceRecipientIds: [K, D] }, undefined, db)
  })
  const settle = () => buildSettlement(db.getData(), { period: { kind: 'all' }, today: '2027-12-31' })

  it('Speichern lehnt Festpreis mit registriertem Mitglied ab', async () => {
    await expect(saveTrip({ startDate: '2027-04-01', endDate: '2027-04-01', km: 50, personIds: [G, D], fixedPriceCents: 1000, fixedPriceRecipientIds: [K] }, undefined, db)).rejects.toBeInstanceOf(ValidationError)
  })

  it('Ausgleich: Gast schuldet genau den Festpreis', () => {
    const s = settle()
    const by = Object.fromEntries(s.balance.balances.map((b) => [b.personId, b.balanceCents]))
    // Konrad: 6.500 € bezahlt − (9.600 km × 0,65 + 200 km × 0,65 − 50 € Gutschrift = 6.320 €) = +180 €
    expect(by).toEqual({ [K]: 18000, [D]: -8000, [G]: -10000 })
    expect(s.balance.transfers).toEqual([
      { fromPersonId: G, toPersonId: K, amountCents: 10000 },
      { fromPersonId: D, toPersonId: K, amountCents: 8000 },
    ])
  })

  it('Rechenweg: Gast und Empfänger, die Zeilen ergeben den Saldo', () => {
    const s = settle()
    const g = balanceBreakdown(s, G)
    expect(g.lines).toEqual([{ type: 'fixed', tripId: expect.any(String), date: '2027-03-01', to: 'Gardasee', guest: true, guestIds: [G], cents: -10000 }])
    const d = balanceBreakdown(s, D)
    expect(d.lines.map((l) => [l.type, l.cents])).toEqual([['perKm', -13000], ['fixed', 5000]])
    expect(d.totalCents).toBe(-8000)
    expect(balanceBreakdown(s, K).totalCents).toBe(18000)
  })

  it('Backup sichert Festpreis und Empfänger; Zusammenführen ordnet Empfänger gleichnamigen Personen zu', async () => {
    const backup = parseBackup(JSON.stringify(createBackup(db)))
    const copy = new MemoryStore()
    await restoreBackup(backup, copy)
    expect(copy.getData().trips).toEqual(db.getData().trips)

    const other = new MemoryStore()
    const k2 = await addPerson('Konrad', other)
    const d2 = await addPerson('Dennis', other)
    await restoreBackup(backup, other, 'merge')
    const t = other.getData().trips.find((x) => x.fixedPriceCents)!
    expect(t.fixedPriceRecipientIds).toEqual([k2.id, d2.id])
  })

  it('Backup mit unbekanntem Empfänger wird abgelehnt', () => {
    const b = createBackup(db)
    const bad = { ...b, data: { ...b.data, trips: b.data.trips.map((t) => (t.fixedPriceCents ? { ...t, fixedPriceRecipientIds: ['fehlt'] } : t)) } }
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/unbekannte Person/)
  })

  it('Excel: Festpreis im Fahrtenbuch, in den Personenanteilen und in der Fahrtenaufstellung', () => {
    const data = db.getData()
    const wb1 = XLSX.read(workbookToArray(buildDataWorkbook(data)), { type: 'array' })
    const trips = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb1.Sheets['Fahrtenbuch'])
    expect(trips.find((r) => r.Festpreis)).toMatchObject({ Festpreis: 100, 'Festpreis an': 'Konrad, Dennis', Wer: 'Gast' })

    const wb2 = XLSX.read(workbookToArray(buildSettlementWorkbook(settle(), data, { trips: 'Gesamt', costs: 'Gesamt' })), { type: 'array' })
    const shares = XLSX.utils.sheet_to_json<unknown[]>(wb2.Sheets['Personenanteile'], { header: 1 })
    expect(shares[0][6]).toMatch(/Festpreise/)
    expect(shares.find((r) => r[0] === 'Gast')!.slice(3)).toEqual([0, 0, 0, 100, 100])
    expect(shares.find((r) => r[0] === 'Summe')![6]).toBe(0)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb2.Sheets['Fahrten'], { header: 1 })
    expect(rows.find((r) => r[5] === 100)).toBeTruthy()
  })
})
