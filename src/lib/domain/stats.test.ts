import { describe, expect, it } from 'vitest'
import type { Expense, Person, Trip } from './types'
import { costStats, dueCosts, fuelStats, kmStats, tripDays, tripNights, tripPlaces, usageStats, yearReview } from './stats'

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

  it('Verbrauch nur aus Tankfüllungen mit Litern', () => {
    const expenses = [
      expense('t1', '2026-01-05', 9000, { categoryId: 'fuel', liters: 50 }),
      expense('t2', '2026-02-05', 7000, { categoryId: 'fuel', liters: 40 }),
      expense('t3', '2026-03-05', 5000, { categoryId: 'fuel' }),
    ]
    const f = fuelStats(expenses, [trip('1', '2026-01-10', 1000, ['a'])], 2026)
    expect(f).toMatchObject({ fillUps: 3, withLiters: 2, liters: 90, cents: 16000 })
    expect(f.per100km).toBeCloseTo(9)
    expect(f.avgPricePerLiter).toBeCloseTo(1.7778, 3)
    expect(f.prices.map((p) => p.pricePerLiter)).toEqual([1.8, 1.75])
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
