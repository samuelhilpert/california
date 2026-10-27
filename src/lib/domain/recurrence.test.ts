import { describe, expect, it } from 'vitest'
import { expandExpense, expandExpenses } from './recurrence'
import type { Expense } from './types'

const base: Expense = {
  id: 'x', title: 'Leasing', categoryId: 'leasing', amountCents: 31915, date: '2026-01-31', allocation: 'perKm',
  createdAt: '', updatedAt: '',
}

describe('Wiederkehrende Kosten', () => {
  it('einmalige Ausgabe ergibt genau eine Buchung mit der Ausgabe-ID', () => {
    expect(expandExpense(base, '2030-01-01')).toEqual([expect.objectContaining({ id: 'x', date: '2026-01-31' })])
  })
  it('monatlich mit Anzahl: genau 24 Buchungen mit eindeutigen Perioden-IDs', () => {
    const list = expandExpense({ ...base, recurrence: { frequency: 'monthly', count: 24 } }, '2026-01-01')
    expect(list).toHaveLength(24)
    expect(new Set(list.map((c) => c.id)).size).toBe(24)
    expect(list[0].id).toBe('x#2026-01')
    expect(list[1].date).toBe('2026-02-28') // Monatsende wird begrenzt
    expect(list[2].date).toBe('2026-03-31') // Ankertag bleibt erhalten
    expect(list[23].id).toBe('x#2027-12')
  })
  it('mehrfaches Erzeugen (Neuladen/Neuberechnen) liefert identische Buchungen – keine Doppelbuchung', () => {
    const e = { ...base, recurrence: { frequency: 'monthly' as const, count: 6 } }
    const a = expandExpenses([e], '2026-12-31')
    const b = expandExpenses([e], '2026-12-31')
    expect(a).toEqual(b)
    const all = [...a, ...b]
    const unique = new Map(all.map((c) => [c.id, c]))
    expect(unique.size).toBe(6)
  })
  it('unbefristet: bis zum Horizont', () => {
    const list = expandExpense({ ...base, date: '2026-01-15', recurrence: { frequency: 'monthly' } }, '2026-06-14')
    expect(list.map((c) => c.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'])
  })
  it('mit Enddatum', () => {
    const list = expandExpense({ ...base, date: '2026-01-15', recurrence: { frequency: 'monthly', until: '2026-03-15' } }, '2099-01-01')
    expect(list).toHaveLength(3)
  })
  it('jährlich', () => {
    const list = expandExpense({ ...base, date: '2024-02-29', recurrence: { frequency: 'yearly', count: 3 } }, '2020-01-01')
    expect(list.map((c) => [c.id, c.date])).toEqual([
      ['x#2024', '2024-02-29'], ['x#2025', '2025-02-28'], ['x#2026', '2026-02-28'],
    ])
  })
})
