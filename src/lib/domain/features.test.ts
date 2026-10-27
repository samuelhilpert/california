import { describe, expect, it } from 'vitest'
import { computeBalances, suggestTransfers } from './balance'
import { expandExpense } from './recurrence'
import { buildSettlement, computeDistribution } from './settlement'
import { findOdometerIssues, findSimilarTrips } from './tripChecks'
import type { CostEntry, Expense, Payment, Person, Trip } from './types'

const now = '2026-01-01T00:00:00.000Z'
const T = (id: string, startDate: string, km: number, personIds: string[], odo?: [number, number]): Trip => ({
  id, startDate, km, personIds, createdAt: now, updatedAt: now, ...(odo ? { odoStart: odo[0], odoEnd: odo[1] } : {}),
})
const cost = (cents: number, paidBy?: string): CostEntry => ({
  id: `c${cents}${paidBy}`, expenseId: 'e', title: 'x', categoryId: 'fuel', date: '2026-01-05', amountCents: cents, allocation: 'perKm', directPersonIds: [], paidBy,
})
const pay = (from: string, to: string, cents: number, date = '2026-01-20'): Payment => ({ id: `${from}${to}${cents}`, date, fromPersonId: from, toPersonId: to, amountCents: cents, createdAt: now, updatedAt: now })

describe('Ausgleich: wer hat was bezahlt', () => {
  // 300 € auf 300 km: a fährt 100 km allein, b und c fahren 200 km zusammen → a 100, b 100, c 100
  const dist = computeDistribution([T('1', '2026-01-01', 100, ['a']), T('2', '2026-01-02', 200, ['b', 'c'])], [cost(30000, 'a')])

  it('Saldo = bezahlt − Anteil', () => {
    const r = computeBalances(dist, [cost(30000, 'a')], [])
    const by = Object.fromEntries(r.balances.map((b) => [b.personId, b.balanceCents]))
    expect(by).toEqual({ a: 20000, b: -10000, c: -10000 })
    expect(r.residualCents).toBe(0)
    expect(r.transfers).toEqual([
      { fromPersonId: 'b', toPersonId: 'a', amountCents: 10000 },
      { fromPersonId: 'c', toPersonId: 'a', amountCents: 10000 },
    ])
  })
  it('erfasste Ausgleichszahlungen gleichen Salden aus', () => {
    const r = computeBalances(dist, [cost(30000, 'a')], [pay('b', 'a', 10000)])
    const by = Object.fromEntries(r.balances.map((b) => [b.personId, b.balanceCents]))
    expect(by).toEqual({ a: 10000, b: 0, c: -10000 })
    expect(r.transfers).toEqual([{ fromPersonId: 'c', toPersonId: 'a', amountCents: 10000 }])
  })
  it('Kosten ohne Zahler werden ausgewiesen', () => {
    const r = computeBalances(dist, [cost(20000, 'a'), cost(10000)], [])
    expect(r.unpaidCostCents).toBe(10000)
    expect(r.residualCents).toBe(-10000)
  })
  it('mehrere Zahler, centgenau, höchstens n−1 Überweisungen', () => {
    const t = suggestTransfers([
      { personId: 'a', balanceCents: 3333 }, { personId: 'b', balanceCents: 1 }, { personId: 'c', balanceCents: -1667 }, { personId: 'd', balanceCents: -1667 },
    ])
    expect(t.length).toBeLessThanOrEqual(3)
    expect(t.reduce((s, x) => s + x.amountCents, 0)).toBe(3334)
  })
  it('buildSettlement berücksichtigt nur Zahlungen im Zeitraum', () => {
    const persons: Person[] = ['a', 'b'].map((id) => ({ id, name: id, active: true, createdAt: now }))
    const expenses: Expense[] = [{ id: 'e', title: 'Diesel', categoryId: 'fuel', amountCents: 10000, date: '2026-02-01', allocation: 'perKm', paidBy: 'a', createdAt: now, updatedAt: now }]
    const s = buildSettlement(
      { persons, expenses, trips: [T('1', '2026-02-02', 100, ['a', 'b'])], payments: [pay('b', 'a', 5000, '2026-02-10'), pay('b', 'a', 999, '2026-03-01')] },
      { period: { kind: 'month', year: 2026, month: 2 }, today: '2026-10-27' },
    )
    expect(s.payments).toHaveLength(1)
    expect(s.balance.balances.every((b) => b.balanceCents === 0)).toBe(true)
  })
})

describe('Verteilung auf Monate', () => {
  const base: Expense = { id: 'v', title: 'Versicherung', categoryId: 'insurance', amountCents: 100000, date: '2026-03-15', allocation: 'perKm', createdAt: '', updatedAt: '' }
  it('Einmalbetrag auf 12 Monate, centgenau, eindeutige IDs', () => {
    const list = expandExpense({ ...base, spreadMonths: 12 }, '2026-01-01')
    expect(list).toHaveLength(12)
    expect(list.reduce((s, c) => s + c.amountCents, 0)).toBe(100000)
    expect(new Set(list.map((c) => c.id)).size).toBe(12)
    expect(list[0]).toMatchObject({ id: 'v@2026-03', date: '2026-03-15', spread: { index: 1, of: 12 } })
    expect(list[11]).toMatchObject({ id: 'v@2027-02', date: '2027-02-01' })
  })
  it('jährlich wiederkehrend und auf Monate verteilt: Monatsfilter erhält 1/12', () => {
    const e = { ...base, recurrence: { frequency: 'yearly' as const, count: 2 }, spreadMonths: 12, amountCents: 120000 }
    const list = expandExpense(e, '2026-01-01')
    expect(list).toHaveLength(24)
    expect(new Set(list.map((c) => c.id)).size).toBe(24)
    const s = buildSettlement(
      { persons: [], trips: [T('1', '2026-05-02', 10, ['a'])], expenses: [e] },
      { period: { kind: 'month', year: 2026, month: 5 }, today: '2026-10-27' },
    )
    expect(s.totalCostCents).toBe(10000)
  })
  it('Zahler bleibt bei verteilten Buchungen erhalten', () => {
    const list = expandExpense({ ...base, spreadMonths: 3, paidBy: 'a' }, '2026-01-01')
    expect(list.every((c) => c.paidBy === 'a')).toBe(true)
  })
})

describe('Kilometerstand-Prüfung', () => {
  it('findet Lücken und Überschneidungen', () => {
    const issues = findOdometerIssues([
      T('1', '2026-01-01', 100, ['a'], [1000, 1100]),
      T('2', '2026-01-05', 50, ['a'], [1100, 1150]),
      T('3', '2026-01-09', 30, ['a'], [1400, 1430]),
      T('4', '2026-01-10', 30, ['a'], [1420, 1450]),
      T('5', '2026-01-11', 30, ['a']),
    ])
    expect(issues).toEqual([
      { type: 'gap', prevTripId: '2', nextTripId: '3', fromKm: 1150, toKm: 1400, km: 250 },
      { type: 'overlap', prevTripId: '3', nextTripId: '4', fromKm: 1430, toKm: 1420, km: 10 },
    ])
  })
  it('meldet Lücken in der Abrechnung', () => {
    const s = buildSettlement(
      { persons: [], expenses: [], trips: [T('1', '2026-01-01', 100, ['a'], [0, 100]), T('2', '2026-02-01', 100, ['a'], [300, 400])] },
      { period: { kind: 'month', year: 2026, month: 2 }, today: '2026-10-27' },
    )
    expect(s.notices.find((n) => n.code === 'odometer-gaps')?.message).toMatch(/200 km/)
  })
  it('erkennt ähnliche Fahrten (Duplikat-Warnung)', () => {
    const trips = [T('1', '2026-01-01', 100, ['a'], [1000, 1100])]
    expect(findSimilarTrips({ startDate: '2026-01-01', km: 100 }, trips)).toHaveLength(1)
    expect(findSimilarTrips({ startDate: '2026-01-02', km: 20, odoStart: 1090, odoEnd: 1110 }, trips)).toHaveLength(1)
    expect(findSimilarTrips({ startDate: '2026-01-02', km: 20, odoStart: 1100, odoEnd: 1120 }, trips)).toHaveLength(0)
    expect(findSimilarTrips({ startDate: '2026-01-01', km: 100 }, trips, '1')).toHaveLength(0)
  })
})
