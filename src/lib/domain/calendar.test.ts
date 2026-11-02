import { describe, expect, it } from 'vitest'
import { calendarEvents, monthWeeks, overlapping, type CalendarEvent } from './calendar'
import { addDays, daysBetween } from './dates'
import type { Plan, Trip } from './types'

const trip = (id: string, startDate: string, endDate?: string): Trip =>
  ({ id, startDate, endDate, km: 100, personIds: ['a'], to: 'Gardasee', createdAt: '', updatedAt: '' })
const plan = (id: string, startDate: string, endDate?: string): Plan =>
  ({ id, startDate, endDate, personIds: ['b'], title: 'Ostsee', createdAt: '', updatedAt: '' })

describe('Datumsrechnung', () => {
  it('verschiebt über Monats- und Jahresgrenzen', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-10-26', '2026-11-02')).toBe(7)
  })
})

describe('Kalender', () => {
  const events = calendarEvents([trip('t1', '2026-11-06', '2026-11-10')], [plan('p1', '2026-11-08'), plan('p2', '2026-11-03')])

  it('deckt den Monat in Wochen von Montag bis Sonntag ab', () => {
    const weeks = monthWeeks(2026, 11, [])
    expect(weeks.map((w) => w.days[0])).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
    expect(weeks[5].days[6]).toBe('2026-12-06')
  })

  it('teilt mehrtägige Einträge an der Wochengrenze und legt Überschneidungen untereinander', () => {
    const [, w2, w3] = monthWeeks(2026, 11, events)
    const bar = (w: typeof w2, id: string) => w.bars.find((b) => b.event.id === id)!
    expect(bar(w2, 'p2')).toMatchObject({ startCol: 1, endCol: 1, lane: 0 })
    expect(bar(w2, 't1')).toMatchObject({ startCol: 4, endCol: 6, lane: 0, continuesBefore: false, continuesAfter: true })
    expect(bar(w2, 'p1')).toMatchObject({ startCol: 6, endCol: 6, lane: 1 })
    expect(w2.laneCount).toBe(2)
    expect(bar(w3, 't1')).toMatchObject({ startCol: 0, endCol: 1, continuesBefore: true, continuesAfter: false })
  })

  it('findet Überschneidungen mit einem geplanten Zeitraum', () => {
    expect(overlapping(events, '2026-11-08', '2026-11-12').map((e: CalendarEvent) => e.id)).toEqual(['t1', 'p1'])
    expect(overlapping(events, '2026-11-08', '2026-11-08', 'p1').map((e) => e.id)).toEqual(['t1'])
    expect(overlapping(events, '2026-11-11', '2026-11-20')).toEqual([])
  })

  it('behandelt ein Enddatum vor dem Start wie eine Tagesfahrt', () => {
    expect(calendarEvents([trip('x', '2026-05-02', '2026-05-01')], [])[0].end).toBe('2026-05-02')
  })
})
