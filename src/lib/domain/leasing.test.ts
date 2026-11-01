import { describe, expect, it } from 'vitest'
import type { FuelFill, Trip } from './types'
import { leasingStatus } from './leasing'
import { achievements } from './achievements'

const at = '2026-01-01T00:00:00.000Z'
const trip = (id: string, startDate: string, km: number, personIds: string[], extra: Partial<Trip> = {}): Trip => ({ id, startDate, km, personIds, createdAt: at, updatedAt: at, ...extra })

describe('Leasing-Kilometer', () => {
  const cfg = { start: '2026-01-01', months: 24, kmPerYear: 10_000, extraKmCents: 10, lessKmCents: 5 }

  it('Prognose aus der Summe der Fahrten, Mehrkilometer mit Kosten', () => {
    // Nach einem Viertel der Laufzeit schon 6.000 km → Prognose 24.000 km bei 20.000 km Kontingent
    const s = leasingStatus(cfg, [trip('1', '2026-02-01', 6000, ['a'])], [], '2026-07-02')
    expect(s.end).toBe('2028-01-01')
    expect(s.limitKm).toBe(20_000)
    expect(s.source).toBe('trips')
    expect(s.drivenKm).toBe(6000)
    expect(s.prognosisKm).toBeGreaterThan(23_800)
    expect(s.prognosisKm).toBeLessThan(24_200)
    expect(s.deltaKm).toBeGreaterThan(3_800)
    expect(s.costCents).toBe(s.deltaKm * 10)
    expect(s.remainingKm).toBe(14_000)
    expect(s.remainingPerMonth).toBeGreaterThan(700)
  })

  it('nutzt den Tachostand, wenn der Übergabe-Stand bekannt ist (auch aus dem Tankbuch)', () => {
    const fuel: FuelFill[] = [{ id: 'f', date: '2026-06-01', odometer: 13_000, fullTank: true, amountCents: 9000, createdAt: at, updatedAt: at }]
    const s = leasingStatus({ ...cfg, startOdometer: 10_000 }, [trip('1', '2026-02-01', 500, ['a'], { odoStart: 10_000, odoEnd: 10_500 })], fuel, '2026-07-01')
    expect(s.source).toBe('odometer')
    expect(s.drivenKm).toBe(3000)
    expect(s.lastReading).toEqual({ km: 13_000, date: '2026-06-01' })
  })

  it('weniger gefahren → Gutschrift; nach Vertragsende keine Hochrechnung mehr', () => {
    const s = leasingStatus(cfg, [trip('1', '2026-02-01', 15_000, ['a'])], [], '2028-03-01')
    expect(s.finished).toBe(true)
    expect(s.prognosisKm).toBe(15_000)
    expect(s.deltaKm).toBe(-5000)
    expect(s.costCents).toBe(-25_000)
    expect(s.remainingPerMonth).toBeNull()
  })
})

describe('Leasing-Toleranz', () => {
  const cfg = { start: '2026-01-01', months: 12, kmPerYear: 10_000, extraKmCents: 10, lessKmCents: 5, toleranceKm: 2500, startOdometer: 0 }
  const fuelAt = (km: number): FuelFill[] => [{ id: 'f', date: '2026-12-31', odometer: km, fullTank: true, amountCents: 1, createdAt: at, updatedAt: at }]
  it('innerhalb der Toleranz: nichts abzurechnen', () => {
    const s = leasingStatus(cfg, [], fuelAt(12_000), '2027-02-01')
    expect(s).toMatchObject({ deltaKm: 2000, withinTolerance: true, billableKm: 0, costCents: 0 })
  })
  it('darüber: nur der Teil jenseits der Toleranz', () => {
    const s = leasingStatus(cfg, [], fuelAt(13_000), '2027-02-01')
    expect(s).toMatchObject({ deltaKm: 3000, withinTolerance: false, billableKm: 500, costCents: 5000 })
    const less = leasingStatus(cfg, [], fuelAt(6_000), '2027-02-01')
    expect(less).toMatchObject({ deltaKm: -4000, billableKm: -1500, costCents: -7500 })
  })
})

describe('Erfolge', () => {
  const trips = [
    trip('1', '2026-01-09', 300, ['a'], { endDate: '2026-01-11' }), // Fr, 2 Nächte, Winter
    trip('2', '2026-05-01', 1200, ['a', 'b'], { endDate: '2026-05-09' }), // 8 Nächte
    trip('3', '2026-07-01', 3500, ['b'], { endDate: '2026-07-20' }), // 19 Nächte
    trip('4', '2026-10-01', 100, ['a']),
  ]
  const countries: Record<string, string[]> = { '2': ['de', 'at', 'it'], '3': ['de', 'fr', 'es'] }
  const get = (personId: string | null) => new Map(achievements(trips, personId, (t) => countries[t.id] ?? ['de']).map((b) => [b.id, b]))

  it('Auto: Datum des Erreichens und Fortschritt', () => {
    const b = get(null)
    expect(b.get('first')?.achievedAt).toBe('2026-01-09')
    expect(b.get('km-1000')?.achievedAt).toBe('2026-05-09')
    expect(b.get('km-5000')?.achievedAt).toBe('2026-07-20')
    expect(b.get('km-10000')?.progress).toEqual({ value: 5100, target: 10_000 })
    expect(b.get('long-3000')?.achievedAt).toBe('2026-07-20')
    expect(b.get('weekend')?.achievedAt).toBe('2026-01-11')
    expect(b.get('winter')?.achievedAt).toBe('2026-01-11')
    expect(b.get('stay-14')?.achievedAt).toBe('2026-07-20')
    expect(b.get('hopping')?.achievedAt).toBe('2026-05-09')
    expect(b.get('countries-5')?.achievedAt).toBe('2026-07-20') // de, at, it, fr, es
    expect(b.get('seasons')?.achievedAt).toBe('2026-10-01')
  })

  it('Person: nur ihre Fahrten', () => {
    const a = get('a')
    expect(a.get('long-3000')?.achievedAt).toBeUndefined()
    expect(a.get('long-3000')?.progress).toEqual({ value: 1200, target: 3000 })
    expect(a.get('stay-7')?.achievedAt).toBe('2026-05-09')
    expect(a.get('countries-2')?.achievedAt).toBe('2026-05-09')
  })
})
