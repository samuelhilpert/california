/**
 * Kalender (Pro-Modus): Fahrten und geplante Nutzung als Monatsansicht. Reine Funktionen ohne UI.
 */
import type { IsoDate, Plan, Trip } from './types'
import { addDays, daysBetween, daysInMonth, toIso } from './dates'

export interface CalendarEvent {
  kind: 'trip' | 'plan'
  id: string
  start: IsoDate
  /** Letzter Tag (inklusive); bei Tagesfahrten = start. */
  end: IsoDate
  personIds: string[]
  /** Ziel bzw. Anlass – leer, wenn nichts eingetragen ist. */
  label: string
}

export interface CalendarBar {
  event: CalendarEvent
  /** Spalte 0 (Montag) bis 6 (Sonntag). */
  startCol: number
  endCol: number
  /** Zeile innerhalb der Woche – überlappende Einträge liegen untereinander. */
  lane: number
  continuesBefore: boolean
  continuesAfter: boolean
}

interface CalendarWeek {
  days: IsoDate[]
  bars: CalendarBar[]
  laneCount: number
}

export function calendarEvents(trips: Trip[], plans: Plan[]): CalendarEvent[] {
  const span = (start: IsoDate, end?: IsoDate) => ({ start, end: end && end > start ? end : start })
  return [
    ...trips.map((t): CalendarEvent => ({ kind: 'trip', id: t.id, ...span(t.startDate, t.endDate), personIds: t.personIds, label: t.to || t.from || '' })),
    ...plans.map((p): CalendarEvent => ({ kind: 'plan', id: p.id, ...span(p.startDate, p.endDate), personIds: p.personIds, label: p.title ?? '' })),
  ]
}

/** Früher zuerst, bei gleichem Start die längeren zuerst, Fahrten vor Plänen. */
const byStart = (a: CalendarEvent, b: CalendarEvent) =>
  a.start !== b.start ? (a.start < b.start ? -1 : 1) : a.end !== b.end ? (a.end > b.end ? -1 : 1) : a.kind === b.kind ? 0 : a.kind === 'trip' ? -1 : 1

/** Wochen (Montag bis Sonntag), die den Monat abdecken, mit einem Balken je Eintrag. */
export function monthWeeks(year: number, month: number, events: CalendarEvent[]): CalendarWeek[] {
  const weekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  const last = toIso(year, month, daysInMonth(year, month))
  const sorted = [...events].sort(byStart)
  const weeks: CalendarWeek[] = []
  for (let weekStart = addDays(toIso(year, month, 1), -weekday); weekStart <= last; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6)
    const laneEnds: IsoDate[] = []
    const bars = sorted
      .filter((e) => e.start <= weekEnd && e.end >= weekStart)
      .map((event): CalendarBar => {
        const from = event.start < weekStart ? weekStart : event.start
        const to = event.end > weekEnd ? weekEnd : event.end
        let lane = laneEnds.findIndex((end) => end < from)
        if (lane < 0) lane = laneEnds.push(to) - 1
        else laneEnds[lane] = to
        return {
          event,
          startCol: daysBetween(weekStart, from),
          endCol: daysBetween(weekStart, to),
          lane,
          continuesBefore: event.start < weekStart,
          continuesAfter: event.end > weekEnd,
        }
      })
    weeks.push({ days: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), bars, laneCount: laneEnds.length })
  }
  return weeks
}

/** Einträge, die mindestens einen Tag mit dem Zeitraum gemeinsam haben. */
export function overlapping(events: CalendarEvent[], start: IsoDate, end: IsoDate, excludeId?: string): CalendarEvent[] {
  return events.filter((e) => e.id !== excludeId && e.start <= end && e.end >= start).sort(byStart)
}
