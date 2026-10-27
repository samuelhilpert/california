import { daysInMonth, toIso } from './dates'
import type { IsoDate } from './types'

export type PeriodSpec =
  | { kind: 'all' }
  | { kind: 'year'; year: number }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'range'; from: IsoDate; to: IsoDate }

/** Geschlossener Datumsbereich [from, to]; null = offen. */
export interface DateRange {
  from: IsoDate | null
  to: IsoDate | null
}

export const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

export function resolvePeriod(spec: PeriodSpec): DateRange {
  switch (spec.kind) {
    case 'all':
      return { from: null, to: null }
    case 'year':
      return { from: toIso(spec.year, 1, 1), to: toIso(spec.year, 12, 31) }
    case 'month':
      return { from: toIso(spec.year, spec.month, 1), to: toIso(spec.year, spec.month, daysInMonth(spec.year, spec.month)) }
    case 'range':
      return spec.from <= spec.to ? { from: spec.from, to: spec.to } : { from: spec.to, to: spec.from }
  }
}

export function inRange(date: IsoDate, range: DateRange): boolean {
  if (range.from && date < range.from) return false
  if (range.to && date > range.to) return false
  return true
}

const de = (d: IsoDate) => d.split('-').reverse().join('.')

export function periodLabel(spec: PeriodSpec): string {
  switch (spec.kind) {
    case 'all':
      return 'Gesamter Zeitraum'
    case 'year':
      return `Jahr ${spec.year}`
    case 'month':
      return `${MONTH_NAMES[spec.month - 1]} ${spec.year}`
    case 'range': {
      const r = resolvePeriod(spec)
      return `${de(r.from!)} – ${de(r.to!)}`
    }
  }
}

export function samePeriod(a: PeriodSpec, b: PeriodSpec): boolean {
  const ra = resolvePeriod(a), rb = resolvePeriod(b)
  return ra.from === rb.from && ra.to === rb.to
}
