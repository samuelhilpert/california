/**
 * Vorauszahlungen (Abschläge) und Daueraufträge – durchgespielt mit realistischen Daten:
 * Konrad zahlt Leasing und Versicherung, Dennis und Samuel überweisen ihm monatliche Abschläge.
 * Abgerechnet wird trotzdem nach gefahrenen Kilometern.
 */
import * as XLSX from 'xlsx'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from '../store/memoryStore'
import { addPerson, deletePayment, saveExpense, savePayment, saveSettlementSnapshot, saveTrip, ValidationError } from '../store/repo'
import { createBackup, parseBackup, restoreBackup } from '../io/backup'
import { buildSettlementWorkbook, workbookToArray } from '../io/excelExport'
import { computeBalances } from './balance'
import { balanceBreakdown } from './breakdown'
import { expandPayments } from './recurrence'
import { buildSettlement } from './settlement'
import { validatePayment } from './validation'
import { periodLabel, resolvePeriod, samePeriod, type PeriodSpec } from './period'
import type { CostEntry, Payment, PaymentEntry } from './types'

const TODAY = '2027-12-31'
const YEAR_2027: PeriodSpec = { kind: 'year', year: 2027 }
let db: MemoryStore
let K: string, D: string, S: string

const settle = (period: PeriodSpec = YEAR_2027, today = TODAY) => buildSettlement(db.getData(), { period, today })
const bal = (s: ReturnType<typeof settle>, id: string) => s.balance.balances.find((b) => b.personId === id)!
const saldo = (s: ReturnType<typeof settle>) => Object.fromEntries([K, D, S].map((id) => [id, bal(s, id)?.balanceCents ?? 0]))
const trip = (date: string, km: number, personIds: string[]) => saveTrip({ startDate: date, endDate: date, km, personIds }, undefined, db)

/** Leasing 500 €/Monat und Versicherung 1.200 €/Jahr (auf 12 Monate verteilt) zahlt Konrad; Steuer zahlt Dennis, Stellplatz Samuel. */
async function contractCosts() {
  await saveExpense({ title: 'Leasingrate', categoryId: 'leasing', amountCents: 50000, date: '2027-01-06', allocation: 'perKm', recurrence: { frequency: 'monthly', count: 24 }, paidBy: K }, undefined, db)
  await saveExpense({ title: 'Versicherung', categoryId: 'insurance', amountCents: 120000, date: '2027-01-06', allocation: 'perKm', recurrence: { frequency: 'yearly', count: 2 }, spreadMonths: 12, paidBy: K }, undefined, db)
  await saveExpense({ title: 'Kfz-Steuer', categoryId: 'tax', amountCents: 30000, date: '2027-02-01', allocation: 'perKm', paidBy: D }, undefined, db)
  await saveExpense({ title: 'Stellplatz Gardasee', categoryId: 'other', amountCents: 4500, date: '2027-05-10', allocation: 'direct', directPersonIds: [D, S], paidBy: S }, undefined, db)
}

/** Abschläge 40/40/20 auf Leasing (500 €) und Versicherung (100 €/Monat): Dennis 240 €, Samuel 120 € je Monat, 24×. */
async function advances() {
  await savePayment({ kind: 'advance', date: '2027-01-06', fromPersonId: D, toPersonId: K, amountCents: 24000, recurrence: { frequency: 'monthly', count: 24 }, note: 'Dauerauftrag' }, undefined, db)
  await savePayment({ kind: 'advance', date: '2027-01-06', fromPersonId: S, toPersonId: K, amountCents: 12000, recurrence: { frequency: 'monthly', count: 24 } }, undefined, db)
}

/** 2027: 10.000 km – Konrad fährt viel, Dennis mittel, Samuel fast gar nicht. */
async function trips2027() {
  await trip('2027-01-10', 1200, [K]) // Skiurlaub
  await trip('2027-03-15', 800, [D])
  await trip('2027-04-01', 2500, [K]) // Ostern Portugal
  await trip('2027-05-09', 400, [D, S]) // Gardasee (Stellplatz)
  await trip('2027-06-20', 1000, [K, D]) // gemeinsam
  await trip('2027-07-15', 2300, [K]) // Sommer Skandinavien
  await trip('2027-08-02', 1700, [D])
  await trip('2027-10-03', 100, [S]) // Samuel: ein kurzer Ausflug
}

beforeEach(async () => {
  db = new MemoryStore()
  K = (await addPerson('Konrad', db)).id
  D = (await addPerson('Dennis', db)).id
  S = (await addPerson('Samuel', db)).id
})

describe('Vorauszahlungen: ein Jahr mit sehr ungleicher Nutzung', () => {
  beforeEach(async () => {
    await contractCosts()
    await advances()
    await trips2027()
  })

  it('verteilt die Kosten nach km: 7.500 € auf 10.000 km = 0,75 €/km', () => {
    const s = settle()
    expect(s.totalKm).toBe(10000)
    expect(s.perKmCostCents).toBe(750000) // 12 × 500 + 1.200 + 300
    expect(s.pricePerKm).toBeCloseTo(0.75, 10)
    expect(bal(s, K).shareCents).toBe(487500) // 6.500 km
    expect(bal(s, D).shareCents).toBe(240000 + 2250) // 3.200 km + halber Stellplatz
    expect(bal(s, S).shareCents).toBe(22500 + 2250) // 300 km + halber Stellplatz
  })

  it('weist Vorauszahlungen getrennt von Ausgleichszahlungen aus', () => {
    const s = settle()
    expect(bal(s, D)).toMatchObject({ advanceSentCents: 288000, advanceReceivedCents: 0, sentCents: 0, receivedCents: 0 })
    expect(bal(s, S)).toMatchObject({ advanceSentCents: 144000, advanceReceivedCents: 0, sentCents: 0, receivedCents: 0 })
    expect(bal(s, K)).toMatchObject({ advanceSentCents: 0, advanceReceivedCents: 432000, sentCents: 0, receivedCents: 0 })
    expect(s.payments).toHaveLength(24) // 2 Daueraufträge × 12 Monate
    expect(s.payments.every((p) => p.kind === 'advance')).toBe(true)
  })

  it('rechnet die Abschläge an: Samuel hat zu viel, Konrad zu wenig gezahlt', () => {
    const s = settle()
    // Konrad: 7.200 bezahlt − 4.875 Anteil − 4.320 erhalten = −1.995
    // Dennis:   300 bezahlt − 2.422,50 Anteil + 2.880 vorausgezahlt = +757,50
    // Samuel:    45 bezahlt −   247,50 Anteil + 1.440 vorausgezahlt = +1.237,50
    expect(saldo(s)).toEqual({ [K]: -199500, [D]: 75750, [S]: 123750 })
    expect(s.balance.residualCents).toBe(0)
    expect(s.balance.transfers).toEqual([
      { fromPersonId: K, toPersonId: S, amountCents: 123750 },
      { fromPersonId: K, toPersonId: D, amountCents: 75750 },
    ])
  })

  it('nach den vorgeschlagenen Ausgleichszahlungen ist alles ausgeglichen', async () => {
    for (const t of settle().balance.transfers) {
      await savePayment({ kind: 'settlement', date: '2027-12-31', fromPersonId: t.fromPersonId, toPersonId: t.toPersonId, amountCents: t.amountCents }, undefined, db)
    }
    const s = settle()
    expect(Object.values(saldo(s))).toEqual([0, 0, 0])
    expect(s.balance.transfers).toEqual([])
    expect(bal(s, K)).toMatchObject({ sentCents: 199500, advanceReceivedCents: 432000 })
  })

  it('Samuel fährt gar nicht: bekommt seine Abschläge bis auf den Stellplatz-Anteil zurück', async () => {
    const t = db.getData().trips.find((x) => x.personIds.length === 1 && x.personIds[0] === S)!
    await db.commit([{ type: 'delete', table: 'trips', id: t.id }])
    const s = settle()
    // Nur noch die Gardasee-Fahrt (400 km mit Dennis): Samuel trägt die Hälfte davon plus den halben Stellplatz.
    const gardasee = s.trips.find((x) => x.km === 400)!
    expect(bal(s, S).shareCents).toBe(gardasee.shares.find((x) => x.personId === S)!.cents + 2250)
    expect(bal(s, S).balanceCents).toBeGreaterThan(123750)
    expect(s.balance.residualCents).toBe(0)
  })

  it('Samuel ohne jede Fahrt: Anteil nur der Stellplatz, Rest der Abschläge kommt zurück', async () => {
    const withS = db.getData().trips.filter((x) => x.personIds.includes(S))
    for (const t of withS) await db.commit([{ type: 'delete', table: 'trips', id: t.id }])
    const s = settle()
    expect(bal(s, S).shareCents).toBe(2250)
    expect(bal(s, S).balanceCents).toBe(4500 - 2250 + 144000)
    expect(s.balance.residualCents).toBe(0)
  })

  it('Monatsabrechnung: je Dauerauftrag genau eine Zahlung im Monat', () => {
    const s = settle({ kind: 'month', year: 2027, month: 3 })
    expect(s.payments.map((p) => [p.fromPersonId, p.amountCents, p.date])).toEqual([
      [D, 24000, '2027-03-06'],
      [S, 12000, '2027-03-06'],
    ])
    expect(s.payments.map((p) => p.id)).toEqual(expect.arrayContaining([expect.stringMatching(/#2027-03$/)]))
  })

  it('Monat ohne Fahrten: Kosten bleiben unverteilt, Abschläge zählen trotzdem', () => {
    const s = settle({ kind: 'month', year: 2027, month: 2 })
    expect(s.notices.map((n) => n.code)).toContain('no-trips')
    expect(bal(s, D).advanceSentCents).toBe(24000)
  })

  it('ganze Laufzeit: künftige Raten und künftige Abschläge sind enthalten und werden angezeigt', () => {
    const s = settle({ kind: 'all' }, '2027-06-30')
    expect(s.payments).toHaveLength(48)
    const notice = s.notices.find((n) => n.code === 'future-advances')
    expect(notice?.message).toMatch(/^36 Vorauszahlung\(en\) über 6\.480,00\s€/u)
    expect(s.balance.residualCents).toBe(0)
  })

  it('„Bis heute“: nur bis heute fällige Raten und Abschläge – ehrlicher Zwischenstand', () => {
    // 30.06.2027: 6 Leasingraten, 6 Versicherungsmonate, Steuer; Abschläge Jan–Jun; Fahrten bis Juni (6.900 km)
    const s = settle({ kind: 'until', to: '2027-06-30' }, '2027-06-30')
    expect(s.payments).toHaveLength(12)
    expect(s.costs.every((c) => c.date <= '2027-06-30')).toBe(true)
    expect(s.perKmCostCents).toBe(6 * 50000 + 6 * 10000 + 30000)
    expect(s.totalKm).toBe(1200 + 800 + 2500 + 400 + 1000)
    expect(bal(s, D).advanceSentCents).toBe(6 * 24000)
    expect(s.notices.map((n) => n.code)).not.toContain('future-advances')
    expect(s.notices.map((n) => n.code)).not.toContain('future-costs')
    expect(s.balance.residualCents).toBe(0)
    // „Gesamt“ am selben Tag zählt dagegen alle 24 Raten und alle 48 Abschläge
    expect(settle({ kind: 'all' }, '2027-06-30').payments).toHaveLength(48)
  })

  it('„Bis heute“ am Jahresende entspricht dem Jahr 2027 (alles liegt im Jahr)', () => {
    expect(saldo(settle({ kind: 'until', to: '2027-12-31' }))).toEqual(saldo(settle()))
  })

  it('keine Hinweis-Meldung, wenn alle Abschläge in der Vergangenheit liegen', () => {
    expect(settle().notices.map((n) => n.code)).not.toContain('future-advances')
  })

  it('Rechenweg: Konrad – bezahlt, km-Anteil, erhaltene Abschläge ergeben den Saldo', () => {
    const s = settle()
    const r = balanceBreakdown(s, K)
    expect(r.lines).toEqual([
      { type: 'paid', expenseId: expect.any(String), title: 'Leasingrate', count: 12, cents: 600000 },
      { type: 'paid', expenseId: expect.any(String), title: 'Versicherung', count: 12, cents: 120000 },
      { type: 'perKm', km: 6500, pricePerKm: 0.75, cents: -487500 },
      { type: 'advance', paymentId: expect.any(String), otherPersonId: D, sent: false, count: 12, cents: -288000 },
      { type: 'advance', paymentId: expect.any(String), otherPersonId: S, sent: false, count: 12, cents: -144000 },
    ])
    expect(r.totalCents).toBe(-199500)
  })

  it('Rechenweg: Samuel – Stellplatz bezahlt, km- und Direktanteil, Abschläge und Ausgleich', async () => {
    await savePayment({ kind: 'settlement', date: '2027-12-31', fromPersonId: K, toPersonId: S, amountCents: 100000 }, undefined, db)
    const r = balanceBreakdown(settle(), S)
    expect(r.lines.map((l) => [l.type, l.cents])).toEqual([
      ['paid', 4500],
      ['perKm', -22500],
      ['direct', -2250],
      ['advance', 144000],
      ['settlement', -100000],
    ])
    expect(r.lines.find((l) => l.type === 'direct')).toMatchObject({ title: 'Stellplatz Gardasee', sharedBy: 2, count: 1 })
    expect(r.lines.find((l) => l.type === 'settlement')).toMatchObject({ otherPersonId: K, sent: false, date: '2027-12-31' })
    expect(r.totalCents).toBe(123750 - 100000)
  })

  it('Excel-Export enthält Vorauszahlungen in der Ausgleichstabelle und in der Zahlungsliste', () => {
    const s = settle()
    const data = db.getData()
    const wb = XLSX.read(workbookToArray(buildSettlementWorkbook(s, data, { trips: '2027', costs: '2027' })), { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Ausgleich'], { header: 1 })
    expect(rows[0]).toEqual(['Person', 'Bezahlt', 'Kostenanteil', 'Vorauszahlung gezahlt', 'Vorauszahlung erhalten', 'Ausgleich gezahlt', 'Ausgleich erhalten', 'Saldo (+ bekommt / − zahlt)'])
    const samuel = rows.find((r) => r[0] === 'Samuel')!
    expect(samuel[3]).toBeCloseTo(1440, 6)
    expect(samuel[7]).toBeCloseTo(1237.5, 6)
    expect(rows.filter((r) => r[1] === 'Vorauszahlung')).toHaveLength(24)
  })
})

describe('Daueraufträge', () => {
  it('Betrag ändert sich: alter Auftrag endet, neuer beginnt – keine Lücke, keine Doppelzahlung', async () => {
    await savePayment({ kind: 'advance', date: '2027-01-06', fromPersonId: D, toPersonId: K, amountCents: 20000, recurrence: { frequency: 'monthly', until: '2027-06-30' } }, undefined, db)
    await savePayment({ kind: 'advance', date: '2027-07-06', fromPersonId: D, toPersonId: K, amountCents: 25000, recurrence: { frequency: 'monthly', count: 18 } }, undefined, db)
    const s = settle()
    expect(s.payments.map((p) => p.date.slice(0, 7))).toEqual(['2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12'])
    expect(bal(s, D).advanceSentCents).toBe(6 * 20000 + 6 * 25000)
  })

  it('unbefristet: zählt bis heute bzw. bis zum Ende des Zeitraums', async () => {
    await savePayment({ kind: 'advance', date: '2027-01-01', fromPersonId: S, toPersonId: K, amountCents: 10000, recurrence: { frequency: 'monthly' } }, undefined, db)
    expect(settle({ kind: 'all' }, '2027-04-15').payments).toHaveLength(4) // Jan–Apr
    expect(settle(YEAR_2027, '2027-04-15').payments).toHaveLength(12) // ganzes Jahr gewählt
    expect(settle({ kind: 'year', year: 2028 }, '2027-04-15').payments).toHaveLength(12)
  })

  it('jährlich am Monatsende: Ankertag bleibt erhalten, Schaltjahr wird begrenzt', () => {
    const p: Payment = { id: 'p', kind: 'advance', date: '2028-02-29', fromPersonId: 'd', toPersonId: 'k', amountCents: 100, recurrence: { frequency: 'yearly', count: 3 }, createdAt: '', updatedAt: '' }
    expect(expandPayments([p], '2030-12-31').map((e) => e.date)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28'])
  })

  it('erzeugt stabile IDs – mehrfaches Berechnen gibt nie doppelte Zahlungen', () => {
    const p: Payment = { id: 'p', kind: 'advance', date: '2027-01-31', fromPersonId: 'd', toPersonId: 'k', amountCents: 100, recurrence: { frequency: 'monthly', count: 24 }, createdAt: '', updatedAt: '' }
    const a = expandPayments([p], '2027-01-01')
    expect(a).toEqual(expandPayments([p], '2027-01-01'))
    expect(new Set(a.map((e) => e.id)).size).toBe(24)
    expect(a[1]).toMatchObject({ id: 'p#2027-02', date: '2027-02-28', paymentId: 'p', kind: 'advance' })
  })

  it('Löschen entfernt den ganzen Dauerauftrag', async () => {
    const p = await savePayment({ kind: 'advance', date: '2027-01-06', fromPersonId: D, toPersonId: K, amountCents: 24000, recurrence: { frequency: 'monthly', count: 24 } }, undefined, db)
    expect(settle().payments).toHaveLength(12)
    await deletePayment(p.id, db)
    expect(settle().payments).toHaveLength(0)
  })

  it('Bearbeiten (z. B. Anzahl verkürzen) wirkt auf alle Fälligkeiten', async () => {
    const p = await savePayment({ kind: 'advance', date: '2027-01-06', fromPersonId: D, toPersonId: K, amountCents: 24000, recurrence: { frequency: 'monthly', count: 24 } }, undefined, db)
    await savePayment({ kind: 'advance', date: '2027-01-06', fromPersonId: D, toPersonId: K, amountCents: 30000, recurrence: { frequency: 'monthly', count: 3 } }, p.id, db)
    expect(db.getData().payments).toHaveLength(1)
    expect(bal(settle(), D).advanceSentCents).toBe(90000)
  })

  it('alte Zahlungen ohne Art zählen als Ausgleichszahlung', () => {
    const old: Payment = { id: 'alt', date: '2027-03-01', fromPersonId: 'd', toPersonId: 'k', amountCents: 5000, createdAt: '', updatedAt: '' }
    const [e] = expandPayments([old], TODAY)
    expect(e.kind).toBe('settlement')
    const r = computeBalances({ persons: [] }, [], [e])
    expect(r.balances.find((b) => b.personId === 'd')).toMatchObject({ sentCents: 5000, advanceSentCents: 0, balanceCents: 5000 })
  })
})

describe('Validierung von Zahlungen', () => {
  const base = { kind: 'advance' as const, date: '2027-01-06', fromPersonId: 'd', toPersonId: 'k', amountCents: 24000 }
  it('akzeptiert Daueraufträge mit Anzahl, Enddatum oder unbefristet', () => {
    expect(validatePayment({ ...base, recurrence: { frequency: 'monthly', count: 24 } })).toEqual({})
    expect(validatePayment({ ...base, recurrence: { frequency: 'monthly', until: '2028-12-31' } })).toEqual({})
    expect(validatePayment({ ...base, recurrence: { frequency: 'yearly' } })).toEqual({})
  })
  it('lehnt ungültige Wiederholungen ab', () => {
    expect(validatePayment({ ...base, recurrence: { frequency: 'monthly', count: 0 } })).toHaveProperty('recurrenceCount')
    expect(validatePayment({ ...base, recurrence: { frequency: 'monthly', count: 1.5 } })).toHaveProperty('recurrenceCount')
    expect(validatePayment({ ...base, recurrence: { frequency: 'monthly', until: '2026-12-31' } })).toHaveProperty('recurrenceUntil')
  })
  it('Ausgleichszahlungen können kein Dauerauftrag sein', () => {
    expect(validatePayment({ ...base, kind: 'settlement', recurrence: { frequency: 'monthly', count: 2 } })).toHaveProperty('recurrence')
  })
  it('weist bekannte Fehler weiterhin ab (gleiche Person, Betrag ≤ 0)', async () => {
    expect(validatePayment({ ...base, toPersonId: 'd' })).toHaveProperty('toPersonId')
    expect(validatePayment({ ...base, amountCents: 0 })).toHaveProperty('amountCents')
    await expect(savePayment({ ...base, fromPersonId: D, toPersonId: D }, undefined, db)).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('Backup mit Vorauszahlungen', () => {
  it('sichert Art und Dauerauftrag und stellt sie identisch wieder her', async () => {
    await advances()
    await savePayment({ kind: 'settlement', date: '2027-12-31', fromPersonId: K, toPersonId: S, amountCents: 123750 }, undefined, db)
    const other = new MemoryStore()
    await restoreBackup(parseBackup(JSON.stringify(createBackup(db))), other)
    expect(other.getData().payments).toEqual(db.getData().payments)
  })

  it('liest Sicherungen von vor den Vorauszahlungen (Zahlung ohne Art)', async () => {
    const b = createBackup(db)
    const legacy = { ...b, data: { ...b.data, payments: [{ id: 'x', date: '2026-05-01', fromPersonId: D, toPersonId: K, amountCents: 100, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' }] } }
    expect(parseBackup(JSON.stringify(legacy)).data.payments[0].kind).toBeUndefined()
  })

  it('lehnt unbekannte Zahlungsarten ab', () => {
    const b = createBackup(db)
    const bad = { ...b, data: { ...b.data, payments: [{ id: 'x', kind: 'geschenk', date: '2026-05-01', fromPersonId: D, toPersonId: K, amountCents: 100, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' }] } }
    expect(() => parseBackup(JSON.stringify(bad))).toThrow()
  })

  it('Zusammenführen ordnet Daueraufträge gleichnamigen Personen zu', async () => {
    await advances()
    const backup = parseBackup(JSON.stringify(createBackup(db)))
    const other = new MemoryStore()
    const k2 = await addPerson('Konrad', other)
    const d2 = await addPerson('Dennis', other)
    const s2 = await addPerson('Samuel', other)
    await restoreBackup(backup, other, 'merge')
    const pays = other.getData().payments
    expect(pays).toHaveLength(2)
    expect(pays.every((p) => p.toPersonId === k2.id && [d2.id, s2.id].includes(p.fromPersonId) && p.recurrence?.count === 24)).toBe(true)
  })
})

/** Deterministischer Zufall, damit Fehler reproduzierbar sind. */
function rng(seed: number) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

describe('Zufällige Szenarien (300 Durchläufe)', () => {
  it('Salden gehen immer exakt auf, Vorschläge gleichen alles aus, Abschläge verschieben nur zwischen Personen', () => {
    const people = ['k', 'd', 's', 'gast']
    for (let run = 0; run < 300; run++) {
      const r = rng(run + 1)
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
      const day = () => `2027-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`
      // Fahrten: Gewichtung sorgt für sehr ungleiche Nutzung (k oft, s selten)
      const weighted = ['k', 'k', 'k', 'k', 'd', 'd', 's', 'gast']
      const trips = Array.from({ length: Math.floor(r() * 25) }, (_, i) => {
        const ps = [...new Set(Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(weighted)))]
        return { id: `t${i}`, startDate: day(), endDate: '2027-12-31', km: Math.round(r() * 300000) / 100, personIds: ps, createdAt: '', updatedAt: '' }
      })
      const expenses = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => {
        const direct = r() < 0.25
        const rec = r() < 0.5 ? { frequency: pick(['monthly', 'yearly'] as const), count: 1 + Math.floor(r() * 24) } : undefined
        return {
          id: `e${i}`, title: 'x', categoryId: 'other', amountCents: 1 + Math.floor(r() * 200000), date: day(),
          allocation: direct ? ('direct' as const) : ('perKm' as const),
          ...(direct ? { directPersonIds: [...new Set([pick(people), pick(people)])] } : {}),
          ...(rec ? { recurrence: rec } : {}),
          ...(r() < 0.3 ? { spreadMonths: 1 + Math.floor(r() * 12) } : {}),
          paidBy: pick(people), createdAt: '', updatedAt: '',
        }
      })
      const payments: Payment[] = Array.from({ length: Math.floor(r() * 5) }, (_, i) => {
        const from = pick(people)
        const to = pick(people.filter((p) => p !== from))
        const advance = r() < 0.7
        return {
          id: `p${i}`, kind: advance ? 'advance' : 'settlement', date: day(), fromPersonId: from, toPersonId: to, amountCents: 1 + Math.floor(r() * 50000),
          ...(advance && r() < 0.6 ? { recurrence: { frequency: 'monthly' as const, ...(r() < 0.5 ? { count: 1 + Math.floor(r() * 24) } : {}) } } : {}),
          createdAt: '', updatedAt: '',
        }
      })
      const persons = people.map((id) => ({ id, name: id, active: true, createdAt: '' }))
      const s = buildSettlement({ trips, expenses, persons, payments }, { period: YEAR_2027, today: '2027-12-31' })
      const b = s.balance

      // Summe aller Salden = bezahlte Kosten − verteilte Kosten (Zahlungen heben sich auf)
      const paid = s.costs.reduce((a, c: CostEntry) => a + c.amountCents, 0)
      const total = (k: 'balanceCents' | 'advanceSentCents' | 'advanceReceivedCents' | 'sentCents' | 'receivedCents') => b.balances.reduce((a, x) => a + x[k], 0)
      expect(total('balanceCents'), `Lauf ${run}`).toBe(paid - s.distributedCents)
      expect(total('advanceSentCents')).toBe(total('advanceReceivedCents'))
      expect(total('sentCents')).toBe(total('receivedCents'))
      for (const x of b.balances) expect(x.balanceCents).toBe(x.paidCents - x.shareCents + x.advanceSentCents - x.advanceReceivedCents + x.sentCents - x.receivedCents)
      // Der Rechenweg ergibt für jede Person exakt ihren Saldo
      for (const x of b.balances) expect(balanceBreakdown(s, x.personId).totalCents, `Lauf ${run}`).toBe(x.balanceCents)

      // Ohne die Zahlungen ändern sich die Salden genau um die Zahlungen – Anteile bleiben gleich.
      const without = buildSettlement({ trips, expenses, persons, payments: [] }, { period: YEAR_2027, today: '2027-12-31' })
      for (const x of b.balances) {
        const y = without.balance.balances.find((z) => z.personId === x.personId)
        expect(x.shareCents).toBe(y?.shareCents ?? 0)
      }

      // Werden die vorgeschlagenen Überweisungen ausgeführt, ist (bei voll verteilten Kosten) alles ausgeglichen.
      if (s.undistributedCents === 0) {
        const done: PaymentEntry[] = b.transfers.map((t, i) => ({ id: `x${i}`, paymentId: `x${i}`, kind: 'settlement', date: '2027-12-31', ...t }))
        const after = computeBalances(s, s.costs, [...s.payments, ...done])
        expect(after.balances.every((x) => x.balanceCents === 0), `Lauf ${run}`).toBe(true)
        expect(b.transfers.length).toBeLessThanOrEqual(people.length - 1)
      }
    }
  })
})

describe('Zeitraum „Bis heute“', () => {
  it('reicht vom Anfang bis einschließlich des Datums und hat eine lesbare Bezeichnung', () => {
    expect(resolvePeriod({ kind: 'until', to: '2027-06-30' })).toEqual({ from: null, to: '2027-06-30' })
    expect(periodLabel({ kind: 'until', to: '2027-06-30' })).toBe('Bis 30.06.2027')
    expect(periodLabel({ kind: 'range', from: '2027-02-01', to: '2027-01-01' })).toBe('01.01.2027 – 01.02.2027')
    expect(samePeriod({ kind: 'until', to: '2027-06-30' }, { kind: 'all' })).toBe(false)
  })

  it('abgeschlossene Abrechnung „bis heute“ übersteht Backup und Wiederherstellung', async () => {
    await saveSettlementSnapshot({ title: 'Stand Juni', period: { kind: 'until', to: '2027-06-30' }, personNames: {}, categoryNames: {}, result: {} }, db)
    const restored = parseBackup(JSON.stringify(createBackup(db)))
    expect(restored.data.settlements[0].period).toEqual({ kind: 'until', to: '2027-06-30' })
  })
})
