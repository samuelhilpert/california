import { describe, expect, it } from 'vitest'
import type { Expense, FuelFill, Person, Trip } from './types'
import { costStats, dueCosts, fuelLog, kmStats, tripDays, tripNights, tripPlaces, usageStats, yearReview } from './stats'

const at = '2026-01-01T00:00:00.000Z'
const trip = (id: string, startDate: string, km: number, personIds: string[], extra: Partial<Trip> = {}): Trip => ({ id, startDate, km, personIds, createdAt: at, updatedAt: at, ...extra })
const expense = (id: string, date: string, amountCents: number, extra: Partial<Expense> = {}): Expense => ({ id, title: id, categoryId: 'other', amountCents, date, allocation: 'perKm', createdAt: at, updatedAt: at, ...extra })
const persons: Person[] = ['a', 'b'].map((id) => ({ id, name: id.toUpperCase(), active: true, createdAt: at }))
const TODAY = '2026-12-31'

describe('Pro-Statistiken', () => {
  it('Tage und Nächte einer Fahrt, auch über den Monatswechsel', () => {
    expect(tripDays({ startDate: '2026-03-30', endDate: '2026-04-02' })).toEqual(['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02'])
    expect(tripNights({ startDate: '2026-03-30', endDate: '2026-04-02' })).toBe(3)
    expect(tripNights({ startDate: '2026-05-01' })).toBe(0)
  })

  it('Kilometer je Monat und anteilig je Person', () => {
    const trips = [trip('1', '2026-01-10', 100, ['a']), trip('2', '2026-01-20', 300, ['a', 'b']), trip('3', '2026-07-01', 50, ['b']), trip('4', '2025-12-01', 999, ['a'])]
    const k = kmStats(trips, 2026, [2026])
    expect(k).toMatchObject({ trips: 3, km: 450, avgKm: 150 })
    expect(k.longest?.id).toBe('2')
    expect(k.series[0].value).toBe(400)
    expect(k.series[6].value).toBe(50)
    expect(k.perPerson).toEqual([{ personId: 'a', km: 250, trips: 2 }, { personId: 'b', km: 200, trips: 2 }])
    // Ohne Jahr: je Jahr
    expect(kmStats(trips, null, [2025, 2026]).series.map((b) => [b.label, b.value])).toEqual([['2025', 999], ['2026', 450]])
  })

  it('Kosten je Monat, Kategorie und Zahler; künftige Raten zählen noch nicht', () => {
    const expenses = [
      expense('leasing', '2026-01-01', 30000, { categoryId: 'leasing', recurrence: { frequency: 'monthly', count: 24 }, paidBy: 'a' }),
      expense('diesel', '2026-02-10', 8000, { categoryId: 'fuel' }),
    ]
    const costs = dueCosts(expenses, '2026-03-15')
    expect(costs).toHaveLength(4) // 3 Raten + Diesel
    const c = costStats({ trips: [trip('1', '2026-01-10', 100, ['a'])], expenses, persons }, costs, 2026, [2026])
    expect(c.totalCents).toBe(98000)
    expect(c.series.slice(0, 3).map((b) => b.value)).toEqual([30000, 38000, 30000])
    expect(c.byCategory[0]).toEqual({ categoryId: 'leasing', cents: 90000 })
    expect(c.paidBy).toEqual([{ personId: 'a', cents: 90000 }])
    expect(c.unknownPayerCents).toBe(8000)
    expect(c.pricePerKmByYear).toEqual([{ key: '2026', label: '2026', value: 9.8 }])
  })

  it('Nutzung: Tage unterwegs, Nächte je Person, Auslastung', () => {
    const trips = [trip('1', '2026-07-01', 700, ['a', 'b'], { endDate: '2026-07-07' }), trip('2', '2026-08-01', 50, ['a'])]
    const u = usageStats(trips, 2026, TODAY)
    expect(u.daysOnRoad).toBe(8)
    expect(u.nights).toBe(6)
    expect(u.daysInPeriod).toBe(365)
    expect(u.utilization).toBeCloseTo(8 / 365)
    expect(u.kmPerDay.get('2026-07-03')).toBeCloseTo(100)
    expect(u.perPerson).toEqual([{ personId: 'a', days: 8, nights: 6 }, { personId: 'b', days: 7, nights: 6 }])
  })

  it('Orte einer Fahrt und Jahresrückblick', () => {
    expect(tripPlaces({ from: 'München', stops: ['Barcelona', ' '], to: 'Valencia' })).toEqual(['München', 'Barcelona', 'Valencia'])
    const trips = [
      trip('1', '2026-05-01', 3800, ['a', 'b'], { from: 'München', stops: ['Barcelona', 'Valencia'], to: 'Granada', endDate: '2026-05-21' }),
      trip('2', '2026-08-01', 200, ['a'], { from: 'München', to: 'Gardasee' }),
      trip('3', '2026-09-01', 220, ['a'], { from: 'München', to: 'gardasee' }),
    ]
    const expenses = [expense('x', '2026-05-01', 42000)]
    const r = yearReview({ trips, expenses, persons }, dueCosts(expenses, TODAY), 2026, TODAY)
    expect(r).toMatchObject({ year: 2026, km: 4220, trips: 3, nights: 20, costCents: 42000, topPlace: { name: 'Gardasee', count: 2 } })
    expect(r.longest?.id).toBe('1')
    expect(r.topPerson).toEqual({ personId: 'a', km: 2320 })
    expect(r.pricePerKm).toBeCloseTo(420 / 4220)
  })
})

describe('Tankbuch (Volltank-Methode)', () => {
  const fill = (id: string, date: string, odometer: number, liters: number | undefined, fullTank: boolean, amountCents = 10000): FuelFill =>
    ({ id, date, odometer, liters, fullTank, amountCents, createdAt: at, updatedAt: at })

  it('Verbrauch je Volltankung, Teilfüllungen zählen zur nächsten', () => {
    const log = fuelLog([
      fill('a', '2026-01-01', 1000, 60, true),
      fill('b', '2026-01-10', 1400, 20, false),
      fill('c', '2026-01-20', 1800, 40, true),
      fill('d', '2026-02-01', 2300, 45, true, 8100),
    ])
    const by = new Map(log.entries.map((e) => [e.fill.id, e]))
    expect(by.get('a')?.per100km).toBeNull() // erste Volltankung: kein Bezug
    expect(by.get('b')?.per100km).toBeNull() // Teilfüllung
    expect(by.get('c')?.per100km).toBeCloseTo(7.5) // (20 + 40) / 800 km
    expect(by.get('d')?.per100km).toBeCloseTo(9) // 45 / 500 km
    expect(by.get('d')?.pricePerLiter).toBeCloseTo(1.8)
    expect(by.get('c')?.kmSincePrev).toBe(400)
    expect(log.avgPer100km).toBeCloseTo((105 / 1300) * 100) // 20+40+45 l auf 1.300 km
    expect(log.entries[0].fill.id).toBe('d') // neueste zuerst
  })

  it('fehlende Liter zwischen zwei Volltankungen → kein Verbrauch für diese Strecke', () => {
    const log = fuelLog([fill('a', '2026-01-01', 1000, 60, true), fill('b', '2026-01-10', 1400, undefined, false), fill('c', '2026-01-20', 1800, 40, true)])
    expect(log.entries.find((e) => e.fill.id === 'c')?.per100km).toBeNull()
    expect(log.avgPer100km).toBeNull()
    // Eine spätere vollständige Strecke zählt trotzdem – ohne die Lücke davor
    const more = fuelLog([fill('a', '2026-01-01', 1000, 60, true), fill('b', '2026-01-10', 1400, undefined, false), fill('c', '2026-01-20', 1800, 40, true), fill('d', '2026-02-01', 2300, 45, true)])
    expect(more.avgPer100km).toBeCloseTo(9)
  })

  it('Hinweis, solange zu wenig Volltankungen da sind', () => {
    expect(fuelLog([]).hint).toMatch(/Noch keine/)
    expect(fuelLog([fill('a', '2026-01-01', 1000, 60, true)]).hint).toMatch(/zwei Volltankungen/)
  })
})
