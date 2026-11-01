/**
 * Auswertungen für den Pro-Modus. Reine Funktionen ohne UI/DB – sie lesen nur und
 * verändern nichts an der Abrechnung.
 */
import type { CostEntry, Expense, IsoDate, Person, Trip } from './types'
import { validateTripForCalc, type SettlementInput } from './settlement'
import { expandExpenses } from './recurrence'
import { daysInMonth, parseIso, toIso } from './dates'

export const FUEL_CATEGORY = 'fuel'

/** Fahrten, die auch in der Abrechnung zählen. */
export function validTrips(trips: Trip[]): Trip[] {
  return trips.filter((t) => validateTripForCalc(t) == null)
}

const yearOf = (d: IsoDate) => Number(d.slice(0, 4))
const monthOf = (d: IsoDate) => Number(d.slice(5, 7))
const inYear = (d: IsoDate, year: number | null) => year == null || yearOf(d) === year

const DAY_MS = 86_400_000
const toUtc = (d: IsoDate) => {
  const { year, month, day } = parseIso(d)
  return Date.UTC(year, month - 1, day)
}
const fromUtc = (ms: number): IsoDate => {
  const x = new Date(ms)
  return toIso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate())
}

/** Alle Tage einer Fahrt (Start bis Ende, inklusive). */
export function tripDays(t: Pick<Trip, 'startDate' | 'endDate'>): IsoDate[] {
  const start = toUtc(t.startDate)
  const end = t.endDate && t.endDate > t.startDate ? toUtc(t.endDate) : start
  const days: IsoDate[] = []
  for (let ms = start; ms <= end && days.length < 400; ms += DAY_MS) days.push(fromUtc(ms))
  return days
}

/** Übernachtungen = Tage − 1 (eine Tagestour hat keine Nacht). */
export const tripNights = (t: Pick<Trip, 'startDate' | 'endDate'>) => tripDays(t).length - 1

/** Kostenbuchungen, die bis heute fällig sind (künftige Raten zählen in der Statistik noch nicht). */
export function dueCosts(expenses: Expense[], today: IsoDate): CostEntry[] {
  return expandExpenses(expenses, today).filter((c) => c.date <= today)
}

/** Jahre mit Fahrten oder fälligen Kosten, absteigend. */
export function availableYears(trips: Trip[], costs: CostEntry[], today: IsoDate): number[] {
  const ys = new Set<number>([yearOf(today)])
  for (const t of trips) ys.add(yearOf(t.startDate))
  for (const c of costs) ys.add(yearOf(c.date))
  return [...ys].sort((a, b) => b - a)
}

export interface Bucket {
  key: string
  label: string
  value: number
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** Werte je Monat eines Jahres oder – ohne Jahr – je Jahr. */
function bucketize<T>(items: T[], date: (x: T) => IsoDate, value: (x: T) => number, year: number | null, years: number[]): Bucket[] {
  if (year != null) {
    const out = MONTH_SHORT.map((label, i) => ({ key: `${year}-${String(i + 1).padStart(2, '0')}`, label, value: 0 }))
    for (const x of items) if (yearOf(date(x)) === year) out[monthOf(date(x)) - 1].value += value(x)
    return out
  }
  const sorted = [...years].sort((a, b) => a - b)
  const out = sorted.map((y) => ({ key: String(y), label: String(y), value: 0 }))
  for (const x of items) {
    const b = out.find((o) => o.key === String(yearOf(date(x))))
    if (b) b.value += value(x)
  }
  return out
}

export interface KmStats {
  trips: number
  km: number
  avgKm: number
  longest?: Trip
  /** Kilometer je Monat (mit Jahr) bzw. je Jahr (ohne Jahr). */
  series: Bucket[]
  /** Anteilige Kilometer je Person (Fahrt-km ÷ Anzahl Beteiligte) – wie in der Abrechnung. */
  perPerson: { personId: string; km: number; trips: number }[]
}

export function kmStats(trips: Trip[], year: number | null, years: number[]): KmStats {
  const list = validTrips(trips).filter((t) => inYear(t.startDate, year))
  const km = list.reduce((a, t) => a + t.km, 0)
  const per = new Map<string, { km: number; trips: number }>()
  for (const t of list) {
    for (const id of t.personIds) {
      const p = per.get(id) ?? { km: 0, trips: 0 }
      p.km += t.km / t.personIds.length
      p.trips++
      per.set(id, p)
    }
  }
  return {
    trips: list.length,
    km,
    avgKm: list.length ? km / list.length : 0,
    longest: list.reduce<Trip | undefined>((m, t) => (!m || t.km > m.km ? t : m), undefined),
    series: bucketize(list, (t) => t.startDate, (t) => t.km, year, years),
    perPerson: [...per].map(([personId, v]) => ({ personId, km: Math.round(v.km * 10) / 10, trips: v.trips })).sort((a, b) => b.km - a.km),
  }
}

export interface CostStats {
  totalCents: number
  series: Bucket[]
  byCategory: { categoryId: string; cents: number }[]
  /** Wer wie viel bezahlt hat (nur Kosten mit „Bezahlt von“). */
  paidBy: { personId: string; cents: number }[]
  unknownPayerCents: number
  /** Fällige Kosten ÷ gefahrene km je Jahr. */
  pricePerKmByYear: Bucket[]
}

export function costStats(input: SettlementInput, costs: CostEntry[], year: number | null, years: number[]): CostStats {
  const list = costs.filter((c) => inYear(c.date, year))
  const byCat = new Map<string, number>()
  const paid = new Map<string, number>()
  let unknownPayerCents = 0
  for (const c of list) {
    byCat.set(c.categoryId, (byCat.get(c.categoryId) ?? 0) + c.amountCents)
    if (c.paidBy) paid.set(c.paidBy, (paid.get(c.paidBy) ?? 0) + c.amountCents)
    else unknownPayerCents += c.amountCents
  }
  const trips = validTrips(input.trips)
  const pricePerKmByYear = [...years]
    .sort((a, b) => a - b)
    .map((y) => {
      const km = trips.filter((t) => yearOf(t.startDate) === y).reduce((a, t) => a + t.km, 0)
      const cents = costs.filter((c) => yearOf(c.date) === y).reduce((a, c) => a + c.amountCents, 0)
      return { key: String(y), label: String(y), value: km > 0 ? cents / 100 / km : 0 }
    })
    .filter((b) => b.value > 0)
  return {
    totalCents: list.reduce((a, c) => a + c.amountCents, 0),
    series: bucketize(list, (c) => c.date, (c) => c.amountCents, year, years),
    byCategory: [...byCat].map(([categoryId, cents]) => ({ categoryId, cents })).sort((a, b) => b.cents - a.cents),
    paidBy: [...paid].map(([personId, cents]) => ({ personId, cents })).sort((a, b) => b.cents - a.cents),
    unknownPayerCents,
    pricePerKmByYear,
  }
}

export interface UsageStats {
  /** Tage, an denen der Bus unterwegs war. */
  daysOnRoad: number
  nights: number
  /** Betrachtete Tage (ganzes Jahr bzw. bis heute im laufenden Jahr). */
  daysInPeriod: number
  utilization: number
  /** Kilometer je Tag (mehrtägige Fahrten gleichmäßig verteilt) – Grundlage des Kalenders. */
  kmPerDay: Map<IsoDate, number>
  perPerson: { personId: string; days: number; nights: number }[]
}

export function usageStats(trips: Trip[], year: number, today: IsoDate): UsageStats {
  const kmPerDay = new Map<IsoDate, number>()
  const per = new Map<string, { days: number; nights: number }>()
  let nights = 0
  for (const t of validTrips(trips)) {
    const days = tripDays(t)
    const inside = days.filter((d) => yearOf(d) === year)
    if (inside.length === 0) continue
    for (const d of inside) kmPerDay.set(d, (kmPerDay.get(d) ?? 0) + t.km / days.length)
    // Nächte zählen im Jahr, in dem die Nacht beginnt
    const n = days.slice(0, -1).filter((d) => yearOf(d) === year).length
    nights += n
    for (const id of t.personIds) {
      const p = per.get(id) ?? { days: 0, nights: 0 }
      p.days += inside.length
      p.nights += n
      per.set(id, p)
    }
  }
  const yearDays = Array.from({ length: 12 }, (_, i) => daysInMonth(year, i + 1)).reduce((a, b) => a + b, 0)
  const elapsed = yearOf(today) === year ? Math.round((toUtc(today) - Date.UTC(year, 0, 1)) / DAY_MS) + 1 : yearOf(today) < year ? 0 : yearDays
  const daysOnRoad = [...kmPerDay.keys()].filter((d) => yearOf(today) !== year || d <= today).length
  return {
    daysOnRoad,
    nights,
    daysInPeriod: elapsed,
    utilization: elapsed ? daysOnRoad / elapsed : 0,
    kmPerDay,
    perPerson: [...per].map(([personId, v]) => ({ personId, ...v })).sort((a, b) => b.days - a.days),
  }
}

export interface FuelStats {
  fillUps: number
  withLiters: number
  liters: number
  /** Kosten der Tankfüllungen mit Literangabe. */
  cents: number
  avgPricePerLiter: number | null
  /** Liter je 100 km über alle Fahrten des Zeitraums – nur sinnvoll, wenn (fast) alle Tankfüllungen Liter haben. */
  per100km: number | null
  /** Preis je Liter pro Tankfüllung, zeitlich sortiert. */
  prices: { date: IsoDate; pricePerLiter: number; liters: number }[]
}

export function fuelStats(expenses: Expense[], trips: Trip[], year: number | null): FuelStats {
  const fuel = expenses.filter((e) => e.categoryId === FUEL_CATEGORY && !e.recurrence && inYear(e.date, year))
  const withL = fuel.filter((e) => e.liters != null && e.liters > 0)
  const liters = withL.reduce((a, e) => a + (e.liters ?? 0), 0)
  const cents = withL.reduce((a, e) => a + e.amountCents, 0)
  const km = validTrips(trips).filter((t) => inYear(t.startDate, year)).reduce((a, t) => a + t.km, 0)
  return {
    fillUps: fuel.length,
    withLiters: withL.length,
    liters,
    cents,
    avgPricePerLiter: liters ? cents / 100 / liters : null,
    per100km: liters && km ? (liters / km) * 100 : null,
    prices: withL
      .map((e) => ({ date: e.date, pricePerLiter: e.amountCents / 100 / (e.liters ?? 1), liters: e.liters ?? 0 }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  }
}

/** Alle Orte einer Fahrt in Reihenfolge: Start, Zwischenstationen, Ziel. */
export function tripPlaces(t: Pick<Trip, 'from' | 'stops' | 'to'>): string[] {
  return [t.from, ...(t.stops ?? []), t.to].map((s) => s?.trim()).filter((s): s is string => !!s)
}

export interface YearReview {
  year: number
  km: number
  trips: number
  daysOnRoad: number
  nights: number
  longest?: Trip
  /** Häufigstes Ziel (Zielort oder Zwischenstation), nur wenn mindestens zweimal angefahren. */
  topPlace?: { name: string; count: number }
  /** Person mit den meisten anteiligen Kilometern. */
  topPerson?: { personId: string; km: number }
  costCents: number
  pricePerKm: number | null
}

export function yearReview(input: SettlementInput, costs: CostEntry[], year: number, today: IsoDate): YearReview {
  const k = kmStats(input.trips, year, [year])
  const u = usageStats(input.trips, year, today)
  const counts = new Map<string, { name: string; count: number }>()
  for (const t of validTrips(input.trips).filter((x) => yearOf(x.startDate) === year)) {
    // Startort zählt nicht als Ziel (meist der Heimatort)
    for (const name of new Set([...(t.stops ?? []), t.to].map((s) => s?.trim()).filter((s): s is string => !!s))) {
      const key = name.toLowerCase()
      const c = counts.get(key) ?? { name, count: 0 }
      c.count++
      counts.set(key, c)
    }
  }
  const best = [...counts.values()].sort((a, b) => b.count - a.count)[0]
  const topPlace = best && best.count >= 2 ? best : undefined
  const costCents = costs.filter((c) => yearOf(c.date) === year).reduce((a, c) => a + c.amountCents, 0)
  return {
    year,
    km: k.km,
    trips: k.trips,
    daysOnRoad: u.daysOnRoad,
    nights: u.nights,
    longest: k.longest,
    topPlace,
    topPerson: k.perPerson[0] ? { personId: k.perPerson[0].personId, km: k.perPerson[0].km } : undefined,
    costCents,
    // Wie in der Statistik: fällige Kosten ÷ km
    pricePerKm: k.km > 0 ? costCents / 100 / k.km : null,
  }
}

/** Name zu einer Personen-ID. */
export const personName = (persons: Person[], id: string) => persons.find((p) => p.id === id)?.name ?? 'Unbekannt'
