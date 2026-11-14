/**
 * Festpreis-Fahrten (Gäste): Die Fahrenden tragen den Festpreis; die ausgewählten Empfänger bekommen ihn
 * und tragen dafür die Fahrtkosten nach km – unterm Strich die Differenz, zu gleichen Teilen.
 * Kilometer werden nur dort angezeigt, wo tatsächlich gefahren wurde.
 * Grundlage der Beispiele: 6.500 € km-Kosten auf 10.000 km = 0,65 €/km.
 */
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { addPerson, deleteTrip, restoreTrip, saveExpense, saveTrip, ValidationError } from '../store/repo'
import { createBackup, parseBackup, restoreBackup } from '../io/backup'
import { buildDataWorkbook, buildSettlementWorkbook, workbookToArray } from '../io/excelExport'
import { balanceBreakdown } from './breakdown'
import { fixedPriceExplanation, fixedPriceSummary } from '../../components/fixedPriceText'
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
  it('die Fahrt kostet 260 €: Gast 100 €, Konrad und Dennis tragen je die Hälfte der Differenz (80 €)', () => {
    const t = d.trips.find((x) => x.tripId === '2')!
    expect(t.costCents).toBe(26000)
    expect(t.fixedPriceCents).toBe(10000)
    expect(t.shares).toEqual([
      { personId: 'gast', km: 400, cents: 10000, fixed: 'guest' },
      { personId: 'k', km: 0, cents: 8000, fixed: 'recipient' },
      { personId: 'd', km: 0, cents: 8000, fixed: 'recipient' },
    ])
  })
  it('Personensummen: km nur für tatsächlich Gefahrenes; Gast trägt genau den Festpreis', () => {
    expect(person(d, 'gast')).toMatchObject({ km: 400, perKmCents: 0, fixedCents: 10000, totalCents: 10000, tripCount: 1 })
    expect(person(d, 'd')).toMatchObject({ km: 0, perKmCents: 0, fixedCents: 8000, totalCents: 8000, tripCount: 0 })
    expect(person(d, 'k')).toMatchObject({ km: 9600, perKmCents: 624000, fixedCents: 8000, totalCents: 632000 })
    expect(d.persons.reduce((a, p) => a + p.km, 0)).toBe(10000)
    expect(d.distributedCents).toBe(650000)
  })
})

describe('Beispiel 2: Festpreis höher als die Fahrtkosten', () => {
  const d = computeDistribution([T('1', 9900, ['k']), T('2', 100, ['gast'], { cents: 10000, to: ['k'] })], costs())
  it('Konrad: 65 € Fahrtkosten − 100 € Festpreis = 35 € Überschuss', () => {
    const t = d.trips.find((x) => x.tripId === '2')!
    expect(t.shares.find((x) => x.personId === 'k')).toEqual({ personId: 'k', km: 0, cents: -3500, fixed: 'recipient' })
    expect(person(d, 'k').totalCents).toBe(650000 - 10000)
    expect(person(d, 'gast').totalCents).toBe(10000)
    expect(d.distributedCents).toBe(650000)
  })
})

describe('Beispiel 3: drei Empfänger, Cent-Rundung', () => {
  const d = computeDistribution([T('1', 9600, ['k']), T('2', 400, ['gast'], { cents: 15000, to: ['k', 'd', 's'] })], costs())
  it('Differenz 110 € wird centgenau gedrittelt, Summe bleibt exakt', () => {
    const t = d.trips.find((x) => x.tripId === '2')!
    const r = t.shares.filter((x) => x.fixed === 'recipient')
    expect(r.map((x) => x.cents).sort()).toEqual([3666, 3667, 3667])
    expect(t.shares.reduce((a, x) => a + x.cents, 0)).toBe(26000)
    expect(r.every((x) => x.km === 0)).toBe(true)
  })
})

describe('Beispiel 4: zwei Gäste fahren zusammen', () => {
  const d = computeDistribution([T('1', 9600, ['k']), T('2', 400, ['g1', 'g2'], { cents: 10000, to: ['s'] })], costs())
  it('Gäste je 50 € (je 200 km gefahren), Samuel trägt die Differenz 260 € − 100 € = 160 €', () => {
    expect(person(d, 'g1')).toMatchObject({ km: 200, totalCents: 5000 })
    expect(person(d, 'g2')).toMatchObject({ km: 200, totalCents: 5000 })
    expect(person(d, 's')).toMatchObject({ km: 0, perKmCents: 0, fixedCents: 16000, totalCents: 16000 })
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
    expect(person(d, 'gast')).toMatchObject({ km: 800, perKmCents: 26000, fixedCents: 10000, totalCents: 36000, tripCount: 2 })
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
    expect(g.lines).toEqual([{ type: 'fixed', role: 'guest', tripId: expect.any(String), date: '2027-03-01', to: 'Gardasee', km: 400, tripCostCents: 26000, fixedPriceCents: 10000, splitBy: 1, guestIds: [G], cents: -10000 }])
    // Dennis ist nicht gefahren: keine Kilometerzeile, nur sein Anteil an der Differenz
    const d = balanceBreakdown(s, D)
    expect(d.lines).toEqual([{ type: 'fixed', role: 'recipient', tripId: expect.any(String), date: '2027-03-01', to: 'Gardasee', km: 400, tripCostCents: 26000, fixedPriceCents: 10000, splitBy: 2, guestIds: [G], cents: -8000 }])
    const k = balanceBreakdown(s, K)
    expect(k.lines.map((l) => [l.type, l.cents])).toEqual([['paid', 650000], ['perKm', -624000], ['fixed', -8000]])
    expect(k.lines.find((l) => l.type === 'perKm')).toMatchObject({ km: 9600 })
    expect(k.totalCents).toBe(18000)
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
    expect(shares[0][6]).toMatch(/Festpreis-Fahrten/)
    expect(shares.find((r) => r[0] === 'Gast')!.slice(3)).toEqual([400, 0, 0, 100, 100])
    expect(shares.find((r) => r[0] === 'Dennis')!.slice(3)).toEqual([0, 0, 0, 80, 80])
    expect(shares.find((r) => r[0] === 'Summe')![6]).toBe(260)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb2.Sheets['Fahrten'], { header: 1 })
    expect(rows.find((r) => r[5] === 100)).toBeTruthy()
    // keine Fehlerzellen (#NUM! o. Ä.) in irgendeinem Blatt
    for (const wb of [wb1, wb2]) for (const name of wb.SheetNames) {
      expect(Object.entries(wb.Sheets[name]).filter(([a, c]) => !a.startsWith('!') && (c as XLSX.CellObject).t === 'e'), name).toEqual([])
    }
  })
})

describe('Erklärungstexte', () => {
  const nb = (x: string) => x.replace(/\s/g, ' ')
  it('Empfänger: Differenz statt angerechneter Kilometer', () => {
    expect(nb(fixedPriceExplanation({ role: 'recipient', km: 1000, tripCostCents: 58559, fixedPriceCents: 50000, splitBy: 3 })))
      .toBe('1.000 km nach km 585,59 € − Festpreis 500,00 € = 85,59 € Differenz, geteilt durch 3')
    expect(nb(fixedPriceExplanation({ role: 'recipient', km: 100, tripCostCents: 6500, fixedPriceCents: 10000, splitBy: 1 })))
      .toBe('100 km nach km 65,00 € − Festpreis 100,00 € = 35,00 € Überschuss')
  })
  it('Gast: Vergleich mit den Kosten nach km', () => {
    expect(nb(fixedPriceExplanation({ role: 'guest', km: 400, tripCostCents: 26000, fixedPriceCents: 10000, splitBy: 2 })))
      .toBe('Festpreis 100,00 €, geteilt durch 2 · nach km wären es 260,00 € gewesen')
  })
  it('Kurzfassung für die Fahrtaufschlüsselung (Einzahl/Mehrzahl, Überschuss)', () => {
    expect(nb(fixedPriceSummary({ tripCostCents: 26000, fixedPriceCents: 10000, recipientNames: ['Dennis'] }))).toBe('Festpreis 100,00 € · Differenz 160,00 € trägt Dennis')
    expect(nb(fixedPriceSummary({ tripCostCents: 26000, fixedPriceCents: 10000, recipientNames: ['Konrad', 'Dennis'] }))).toBe('Festpreis 100,00 € · Differenz 160,00 € tragen Konrad, Dennis')
    expect(nb(fixedPriceSummary({ tripCostCents: 6500, fixedPriceCents: 10000, recipientNames: ['Konrad'] }))).toBe('Festpreis 100,00 € · Überschuss 35,00 € geht an Konrad')
  })
})

describe('Gast hat den Festpreis schon bezahlt', () => {
  let db: MemoryStore
  let K: string, D: string, G: string, G2: string
  beforeEach(async () => {
    db = new MemoryStore()
    K = (await addPerson('Konrad', db)).id
    D = (await addPerson('Dennis', db)).id
    G = (await addPerson('Gast', db)).id
    G2 = (await addPerson('Gast 2', db)).id
    await saveExpense({ title: 'Leasingrate', categoryId: 'leasing', amountCents: 650000, date: '2027-01-06', allocation: 'perKm', paidBy: K }, undefined, db)
    await saveTrip({ startDate: '2027-02-01', endDate: '2027-02-01', km: 9600, personIds: [K] }, undefined, db)
  })
  const guestTrip = (extra: Partial<Parameters<typeof saveTrip>[0]> = {}) => ({ startDate: '2027-03-01', endDate: '2027-03-02', km: 400, personIds: [G], fixedPriceCents: 10000, fixedPriceRecipientIds: [K, D], ...extra })
  const settle = () => buildSettlement(db.getData(), { period: { kind: 'all' }, today: '2027-12-31' })
  const saldo = (id: string) => settle().balance.balances.find((b) => b.personId === id)?.balanceCents ?? 0

  it('legt eine verknüpfte Ausgleichszahlung an – der Gast ist ausgeglichen und taucht in keiner Überweisung auf', async () => {
    const t = await saveTrip(guestTrip(), undefined, db, K)
    expect(db.getData().payments).toEqual([expect.objectContaining({ id: `fixed-${t.id}-${G}`, kind: 'settlement', tripId: t.id, date: '2027-03-01', fromPersonId: G, toPersonId: K, amountCents: 10000, note: 'Festpreis Fahrt 01.03.2027' })])
    expect(saldo(G)).toBe(0)
    // Konrad hat die 100 € bekommen: 6.500 − 6.320 − 100 = +80; Dennis trägt seine Hälfte der Differenz (80 €)
    expect(saldo(K)).toBe(8000)
    expect(saldo(D)).toBe(-8000)
    expect(settle().balance.transfers).toEqual([{ fromPersonId: D, toPersonId: K, amountCents: 8000 }])
  })

  it('Betrag oder Empfänger ändern aktualisiert dieselbe Zahlung (keine Doppelzahlung)', async () => {
    const t = await saveTrip(guestTrip(), undefined, db, K)
    await saveTrip(guestTrip({ fixedPriceCents: 12000 }), t.id, db, D)
    expect(db.getData().payments).toHaveLength(1)
    expect(db.getData().payments[0]).toMatchObject({ toPersonId: D, amountCents: 12000 })
    expect(saldo(G)).toBe(0)
  })

  it('unverändert lassen (undefined) behält die Zahlung', async () => {
    const t = await saveTrip(guestTrip(), undefined, db, K)
    await saveTrip(guestTrip({ note: 'nur Notiz' }), t.id, db)
    expect(db.getData().payments).toHaveLength(1)
  })

  it('Haken „bezahlt“ entfernen oder Festpreis ganz entfernen löscht die Zahlung', async () => {
    const t = await saveTrip(guestTrip(), undefined, db, K)
    await saveTrip(guestTrip(), t.id, db, null)
    expect(db.getData().payments).toHaveLength(0)
    await saveTrip(guestTrip(), t.id, db, K)
    await saveTrip({ startDate: '2027-03-01', endDate: '2027-03-02', km: 400, personIds: [G] }, t.id, db)
    expect(db.getData().payments).toHaveLength(0)
    expect(saldo(G)).toBe(-26000) // jetzt normal nach km
  })

  it('zwei Gäste: je eine Zahlung, centgenau passend zum Anteil – beide ausgeglichen', async () => {
    await saveTrip(guestTrip({ personIds: [G, G2], fixedPriceCents: 10001 }), undefined, db, K)
    const pays = db.getData().payments
    expect(pays).toHaveLength(2)
    expect(pays.reduce((a, p) => a + p.amountCents, 0)).toBe(10001)
    expect(saldo(G)).toBe(0)
    expect(saldo(G2)).toBe(0)
  })

  it('ein Gast weniger: dessen Zahlung verschwindet', async () => {
    const t = await saveTrip(guestTrip({ personIds: [G, G2] }), undefined, db, K)
    await saveTrip(guestTrip(), t.id, db, K)
    expect(db.getData().payments.map((p) => p.fromPersonId)).toEqual([G])
    expect(db.getData().payments[0].amountCents).toBe(10000)
  })

  it('Fahrt löschen entfernt die Zahlung; Rückgängig stellt beides wieder her', async () => {
    const t = await saveTrip(guestTrip(), undefined, db, K)
    const before = db.getData().payments
    const removed = await deleteTrip(t.id, db)
    expect(db.getData().payments).toHaveLength(0)
    await restoreTrip(removed!, db)
    expect(db.getData().trips.find((x) => x.id === t.id)).toEqual(t)
    expect(db.getData().payments).toEqual(before)
  })

  it('ein Gast kann nicht an sich selbst zahlen', async () => {
    await expect(saveTrip(guestTrip(), undefined, db, G)).rejects.toMatchObject({ fields: { guestPaidTo: expect.any(String) } })
  })

  it('Backup: Zahlung mit Verweis auf die Fahrt bleibt erhalten', async () => {
    await saveTrip(guestTrip(), undefined, db, K)
    const copy = new MemoryStore()
    await restoreBackup(parseBackup(JSON.stringify(createBackup(db))), copy)
    expect(copy.getData().payments).toEqual(db.getData().payments)
  })
})
