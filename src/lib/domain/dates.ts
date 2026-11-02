import type { IsoDate } from './types'

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false
  const m = ISO_RE.exec(value)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= daysInMonth(y, mo)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function toIso(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseIso(date: IsoDate): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { year: y, month: m, day: d }
}

/** Heutiges Datum in lokaler Zeit als ISO-Datum. */
export function todayIso(now: Date = new Date()): IsoDate {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** Addiert Monate; der Tag wird auf das Monatsende begrenzt (31.01. + 1 Monat = 28./29.02.). */
export function addMonths(date: IsoDate, months: number, anchorDay?: number): IsoDate {
  const { year, month, day } = parseIso(date)
  const total = year * 12 + (month - 1) + months
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  const d = Math.min(anchorDay ?? day, daysInMonth(y, m))
  return toIso(y, m, d)
}

export function monthKey(date: IsoDate): string {
  return date.slice(0, 7)
}

export function yearKey(date: IsoDate): string {
  return date.slice(0, 4)
}

const DAY_MS = 86_400_000
const toUtc = (d: IsoDate) => {
  const { year, month, day } = parseIso(d)
  return Date.UTC(year, month - 1, day)
}

/** Datum um n Tage verschieben (n darf negativ sein). */
export function addDays(date: IsoDate, n: number): IsoDate {
  const x = new Date(toUtc(date) + n * DAY_MS)
  return toIso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate())
}

/** Anzahl Tage von a bis b (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS)
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b
}

/** Excel-Seriennummer → ISO-Datum (1900- oder 1904-Datumssystem). */
export function excelSerialToIso(serial: number, date1904 = false): IsoDate | null {
  if (!Number.isFinite(serial) || serial <= 0) return null
  const whole = Math.floor(serial)
  // 1900-System: Tag 1 = 1900-01-01, Excel kennt fälschlich den 29.02.1900 (Tag 60).
  let days: number
  let base: number
  if (date1904) {
    base = Date.UTC(1904, 0, 1)
    days = whole
  } else {
    base = Date.UTC(1899, 11, 31)
    days = whole > 59 ? whole - 1 : whole
  }
  const d = new Date(base + days * 86400000)
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Deutsche Datumsangabe ("29.12.2025", "29.12.25", "2025-12-29") → ISO. */
export function parseGermanDate(input: string): IsoDate | null {
  const s = input.trim()
  if (isIsoDate(s)) return s
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s)
  if (!m) return null
  let y = Number(m[3])
  if (m[3].length === 2) y += 2000
  const iso = toIso(y, Number(m[2]), Number(m[1]))
  return isIsoDate(iso) ? iso : null
}
