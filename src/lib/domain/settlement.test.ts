import { describe, expect, it } from 'vitest'
import { allocateCents } from './allocate'
import { buildSettlement, computeDistribution, type TripLike } from './settlement'
import type { CostEntry, Expense, Person, Trip } from './types'

const cost = (cents: number, extra: Partial<CostEntry> = {}): CostEntry => ({
  id: extra.id ?? `c${Math.random()}`,
  expenseId: 'e',
  title: 'Kosten',
  categoryId: 'leasing',
  date: '2026-01-01',
  amountCents: cents,
  allocation: 'perKm',
  directPersonIds: [],
  ...extra,
})
const trip = (id: string, km: number, personIds: string[], startDate = '2026-01-10'): TripLike => ({ id, km, personIds, startDate })
const share = (d: ReturnType<typeof computeDistribution>, pid: string) => d.persons.find((p) => p.personId === pid)?.totalCents ?? 0

describe('computeDistribution – Beispiel aus der Anforderung', () => {
  // 600 € auf 1.000 km → 0,60 €/km. Fahrt D (400 km, Anna) ergänzt das Beispiel auf 1.000 km.
  const d = computeDistribution(
    [trip('A', 100, ['anna']), trip('B', 200, ['ben', 'clara']), trip('C', 300, ['ben', 'clara', 'anna']), trip('D', 400, ['anna'])],
    [cost(60000)],
  )
  it('berechnet ben Kilometerpreis', () => {
    expect(d.totalKm).toBe(1000)
    expect(d.pricePerKm).toBeCloseTo(0.6, 10)
  })
  it('Fahrt mit einer Person: Person trägt alles', () => {
    const a = d.trips.find((t) => t.tripId === 'A')!
    expect(a.costCents).toBe(6000)
    expect(a.shares).toEqual([{ personId: 'anna', km: 100, cents: 6000 }])
  })
  it('Fahrt mit zwei Personen: hälftig', () => {
    const b = d.trips.find((t) => t.tripId === 'B')!
    expect(b.costCents).toBe(12000)
    expect(b.shares.map((s) => s.cents)).toEqual([6000, 6000])
    expect(b.shares.map((s) => s.km)).toEqual([100, 100])
  })
  it('Fahrt mit drei Personen: gedrittelt', () => {
    const c = d.trips.find((t) => t.tripId === 'C')!
    expect(c.costCents).toBe(18000)
    expect(c.shares.map((s) => s.cents)).toEqual([6000, 6000, 6000])
  })
  it('summiert die Anteile je Person', () => {
    expect(share(d, 'anna')).toBe(6000 + 6000 + 24000)
    expect(share(d, 'ben')).toBe(12000)
    expect(share(d, 'clara')).toBe(12000)
    expect(d.distributedCents).toBe(60000)
  })
  it('zählt die Kilometer einer Fahrt mit mehreren Personen nur einmal', () => {
    expect(d.totalKm).toBe(1000)
    const kmSum = d.persons.reduce((s, p) => s + p.km, 0)
    expect(kmSum).toBeCloseTo(1000, 6)
  })
})

describe('computeDistribution – Personenanzahl', () => {
  it('verteilt auf beliebig viele Personen (7) centgenau', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const d = computeDistribution([trip('T', 123, ids)], [cost(10000)])
    expect(d.persons).toHaveLength(7)
    const cents = d.persons.map((p) => p.totalCents)
    expect(cents.reduce((a, b) => a + b, 0)).toBe(10000)
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1)
  })
  it('berücksichtigt neu angelegte Personen automatisch (keine feste Namensliste)', () => {
    const d = computeDistribution([trip('T1', 50, ['neu-1']), trip('T2', 50, ['neu-2', 'neu-3'])], [cost(1000)])
    expect(share(d, 'neu-1')).toBe(500)
    expect(share(d, 'neu-2')).toBe(250)
    expect(share(d, 'neu-3')).toBe(250)
  })
  it('mehrere Fahrten mit unterschiedlichen Beteiligten', () => {
    const d = computeDistribution(
      [trip('1', 10, ['a']), trip('2', 30, ['a', 'b']), trip('3', 60, ['b', 'c', 'd'])],
      [cost(10000)], // 100 € / 100 km = 1 €/km
    )
    expect(share(d, 'a')).toBe(1000 + 1500)
    expect(share(d, 'b')).toBe(1500 + 2000)
    expect(share(d, 'c')).toBe(2000)
    expect(share(d, 'd')).toBe(2000)
    expect(d.persons.find((p) => p.personId === 'b')!.km).toBe(35)
    expect(d.persons.find((p) => p.personId === 'b')!.tripIds).toEqual(['2', '3'])
  })
})

describe('computeDistribution – Randfälle', () => {
  it('keine Fahrten: kein Kilometerpreis, Kosten bleiben unverteilt, keine Division durch null', () => {
    const d = computeDistribution([], [cost(50000)])
    expect(d.status).toBe('no-trips')
    expect(d.pricePerKm).toBeNull()
    expect(d.undistributedCents).toBe(50000)
    expect(d.distributedCents).toBe(0)
    expect(d.persons).toEqual([])
  })
  it('null Gesamtkilometer', () => {
    const d = computeDistribution([trip('T', 0, ['a'])], [cost(50000)])
    expect(d.status).toBe('zero-km')
    expect(d.pricePerKm).toBeNull()
    expect(d.undistributedCents).toBe(50000)
    expect(Number.isFinite(d.distributedCents)).toBe(true)
  })
  it('keine Kosten', () => {
    const d = computeDistribution([trip('T', 100, ['a'])], [])
    expect(d.status).toBe('no-costs')
    expect(d.pricePerKm).toBe(0)
    expect(share(d, 'a')).toBe(0)
  })
  it('fehlende oder ungültige Kilometer werden ausgeschlossen und gemeldet', () => {
    const d = computeDistribution(
      [
        trip('ok', 100, ['a']),
        { id: 'nan', startDate: '2026-01-01', km: Number.NaN, personIds: ['b'] },
        { id: 'neg', startDate: '2026-01-01', km: -5, personIds: ['b'] },
        { id: 'undef', startDate: '2026-01-01', km: undefined as unknown as number, personIds: ['b'] },
        { id: 'inf', startDate: '2026-01-01', km: Infinity, personIds: ['b'] },
        trip('nobody', 50, []),
        { id: 'odo', startDate: '2026-01-01', km: 10, personIds: ['b'], odoStart: 100, odoEnd: 90 },
      ],
      [cost(1000)],
    )
    expect(d.totalKm).toBe(100)
    expect(share(d, 'a')).toBe(1000)
    expect(share(d, 'b')).toBe(0)
    expect(d.invalidTrips.map((t) => t.reason)).toEqual(['invalid-km', 'invalid-km', 'invalid-km', 'invalid-km', 'no-persons', 'odometer'])
  })
})

describe('Rundung', () => {
  it('100 € auf drei Personen ergibt 33,34 + 33,33 + 33,33', () => {
    const d = computeDistribution([trip('T', 1, ['a', 'b', 'c'])], [cost(10000)])
    expect(d.persons.map((p) => p.totalCents).sort()).toEqual([3333, 3333, 3334])
    expect(d.distributedCents).toBe(10000)
  })
  it('Summe geht bei krummen Werten über viele Fahrten centgenau auf', () => {
    const trips: TripLike[] = []
    const people = ['a', 'b', 'c', 'd', 'e']
    for (let i = 0; i < 97; i++) {
      const n = (i % 5) + 1
      trips.push(trip(`t${i}`, 13.7 + (i * 7.3) % 41, people.slice(0, n), `2026-01-${String((i % 28) + 1).padStart(2, '0')}`))
    }
    const total = 765960 + 12345 + 1
    const d = computeDistribution(trips, [cost(765960), cost(12345), cost(1)])
    expect(d.distributedCents).toBe(total)
    expect(d.trips.reduce((s, t) => s + t.costCents, 0)).toBe(total)
    for (const t of d.trips) expect(t.shares.reduce((s, x) => s + x.cents, 0)).toBe(t.costCents)
  })
  it('Restcents wandern nicht immer zur selben Person', () => {
    const trips = [trip('1', 1, ['a', 'b', 'c']), trip('2', 1, ['a', 'b', 'c']), trip('3', 1, ['a', 'b', 'c'])]
    const d = computeDistribution(trips, [cost(300 + 3)]) // je Fahrt 101 ct → je 1 Restcent
    expect(d.persons.map((p) => p.totalCents).sort()).toEqual([101, 101, 101])
  })
  it('allocateCents ist exakt und robust', () => {
    expect(allocateCents(1, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(1)
    expect(allocateCents(-100, [1, 2])).toEqual([-33, -67])
    expect(allocateCents(100, [0, 1])).toEqual([0, 100])
    expect(() => allocateCents(100, [0, 0])).toThrow()
    expect(allocateCents(0, [1, 2])).toEqual([0, 0])
  })
})

describe('Direkt zugeordnete Kosten (nicht über Kilometerpreis)', () => {
  it('fließen nicht in ben Kilometerpreis ein und werden nicht doppelt verrechnet', () => {
    const d = computeDistribution(
      [trip('T', 100, ['a', 'b'])],
      [cost(10000), cost(3001, { allocation: 'direct', directPersonIds: ['a', 'c'] })],
    )
    expect(d.pricePerKm).toBeCloseTo(1, 10)
    expect(d.perKmCostCents).toBe(10000)
    expect(d.directCostCents).toBe(3001)
    expect(d.totalCostCents).toBe(13001)
    expect(d.distributedCents).toBe(13001)
    const a = d.persons.find((p) => p.personId === 'a')!
    const c = d.persons.find((p) => p.personId === 'c')!
    expect(a.perKmCents).toBe(5000)
    expect(a.directCents + c.directCents).toBe(3001)
    expect(c.perKmCents).toBe(0)
  })
  it('Direktkosten ohne Personen bleiben sichtbar unverteilt', () => {
    const d = computeDistribution([trip('T', 100, ['a'])], [cost(500, { allocation: 'direct', directPersonIds: [] })])
    expect(d.undistributedCents).toBe(500)
    expect(d.unassignedDirectCostIds).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('buildSettlement – Zeiträume', () => {
  const now = '2026-01-01T00:00:00.000Z'
  const persons: Person[] = ['a', 'b'].map((id) => ({ id, name: id.toUpperCase(), active: true, createdAt: now }))
  const T = (id: string, startDate: string, km: number, personIds: string[], endDate?: string): Trip => ({ id, startDate, endDate, km, personIds, createdAt: now, updatedAt: now })
  const E = (id: string, date: string, cents: number, recurrence?: Expense['recurrence']): Expense => ({
    id, title: id, categoryId: 'leasing', amountCents: cents, date, allocation: 'perKm', recurrence, createdAt: now, updatedAt: now,
  })
  const trips = [T('jan', '2026-01-15', 100, ['a']), T('feb', '2026-02-10', 300, ['b'], '2026-03-02'), T('y25', '2025-07-01', 50, ['a', 'b'])]
  const expenses = [E('leasing', '2026-01-01', 31915, { frequency: 'monthly', count: 24 }), E('reifen', '2026-02-20', 40000)]

  it('Monat: nur Kosten und Fahrten des Monats', () => {
    const s = buildSettlement({ trips, expenses, persons }, { period: { kind: 'month', year: 2026, month: 2 }, today: '2026-10-27' })
    expect(s.costs.map((c) => c.id).sort()).toEqual(['leasing#2026-02', 'reifen'])
    expect(s.totalCostCents).toBe(31915 + 40000)
    expect(s.totalKm).toBe(300)
    expect(share(s, 'b')).toBe(71915)
    expect(s.separatePeriods).toBe(false)
    expect(s.notices.some((n) => n.code === 'crossing-trips')).toBe(true)
  })
  it('Jahr: 12 Leasingraten, Fahrten des Jahres', () => {
    const s = buildSettlement({ trips, expenses, persons }, { period: { kind: 'year', year: 2026 }, today: '2026-10-27' })
    expect(s.costs.filter((c) => c.expenseId === 'leasing')).toHaveLength(12)
    expect(s.totalKm).toBe(400)
    expect(s.distributedCents).toBe(s.totalCostCents)
  })
  it('Gesamter Zeitraum: alle 24 vertraglich festen Raten (wie in der Excel-Datei), Hinweis auf zukünftige Buchungen', () => {
    const s = buildSettlement({ trips, expenses, persons }, { period: { kind: 'all' }, today: '2026-10-27' })
    expect(s.costs.filter((c) => c.expenseId === 'leasing')).toHaveLength(24)
    expect(s.totalCostCents).toBe(31915 * 24 + 40000)
    expect(s.totalKm).toBe(450)
    expect(s.notices.some((n) => n.code === 'future-costs')).toBe(true)
  })
  it('Freier Zeitraum mit unterschiedlichem Kostenzeitraum wird gekennzeichnet', () => {
    const s = buildSettlement(
      { trips, expenses, persons },
      { period: { kind: 'range', from: '2026-01-01', to: '2026-01-31' }, costPeriod: { kind: 'month', year: 2026, month: 2 }, today: '2026-10-27' },
    )
    expect(s.separatePeriods).toBe(true)
    expect(s.notices[0].code).toBe('separate-periods')
    expect(s.totalKm).toBe(100)
    expect(s.totalCostCents).toBe(71915)
    expect(share(s, 'a')).toBe(71915)
  })
  it('Zeitraum ohne Fahrten meldet einen verständlichen Fehler', () => {
    const s = buildSettlement({ trips, expenses, persons }, { period: { kind: 'month', year: 2026, month: 5 }, today: '2026-10-27' })
    expect(s.status).toBe('no-trips')
    expect(s.notices.find((n) => n.code === 'no-trips')?.level).toBe('error')
    expect(s.undistributedCents).toBe(31915)
  })
})
