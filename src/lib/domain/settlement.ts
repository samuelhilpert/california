/**
 * Zentrale Kostenverteilung – reine Funktionen ohne Abhängigkeit zu UI oder Speicherung.
 *
 * Ablauf:
 *  1. Kostenbuchungen des Kostenzeitraums summieren (getrennt nach Verteilungsart).
 *  2. Kilometer aller gültigen Fahrten des Fahrtenzeitraums summieren (jede Fahrt genau einmal).
 *  3. Kilometerpreis = kilometerbezogene Kosten / Gesamtkilometer.
 *  4. Fahrtkosten = Kilometer der Fahrt × Kilometerpreis (centgenau per Restbetragsverfahren).
 *  5. Fahrtkosten zu gleichen Teilen auf die Beteiligten der Fahrt verteilen (ebenfalls centgenau).
 *  6. Direkt zugeordnete Kosten zu gleichen Teilen auf die ausdrücklich gewählten Personen verteilen.
 *  7. Anteile je Person summieren.
 */
import { allocateCents } from './allocate'
import { inRange, resolvePeriod, samePeriod, type DateRange, type PeriodSpec } from './period'
import { expandExpenses } from './recurrence'
import { maxDate } from './dates'
import { computeBalances, type BalanceResult } from './balance'
import { findOdometerIssues, type OdometerIssue } from './tripChecks'
import type { CostEntry, Expense, IsoDate, Payment, Person, Trip } from './types'
import { formatDate, formatEuro, formatKm } from '../format'

export type TripLike = Pick<Trip, 'id' | 'startDate' | 'km' | 'personIds'> &
  Partial<Pick<Trip, 'endDate' | 'odoStart' | 'odoEnd'>>

interface TripShare {
  personId: string
  km: number
  cents: number
}

interface TripResult {
  tripId: string
  km: number
  costCents: number
  shares: TripShare[]
}

interface DirectShare {
  costId: string
  personId: string
  cents: number
}

interface PersonResult {
  personId: string
  /** Anteilige Kilometer (Kilometer der Fahrt / Anzahl Beteiligte, summiert). */
  km: number
  tripCount: number
  perKmCents: number
  directCents: number
  totalCents: number
  tripIds: string[]
}

interface CategoryResult {
  categoryId: string
  totalCents: number
  perKmCents: number
  directCents: number
  entryCount: number
}

type InvalidReason = 'invalid-km' | 'no-persons' | 'duplicate-persons' | 'odometer'

interface InvalidTrip {
  tripId: string
  reason: InvalidReason
}

type DistributionStatus = 'ok' | 'no-trips' | 'zero-km' | 'no-costs'

export interface Distribution {
  status: DistributionStatus
  totalCostCents: number
  perKmCostCents: number
  directCostCents: number
  /** Kosten, die mangels Kilometern oder Personen nicht verteilt werden konnten. */
  undistributedCents: number
  /** Summe aller Personenanteile – entspricht immer totalCostCents - undistributedCents. */
  distributedCents: number
  totalKm: number
  tripCount: number
  /** Exakter Kilometerpreis in Euro (ungerundet); null, wenn keine Kilometer vorhanden. */
  pricePerKm: number | null
  trips: TripResult[]
  persons: PersonResult[]
  categories: CategoryResult[]
  directShares: DirectShare[]
  invalidTrips: InvalidTrip[]
  /** Direktkosten ohne zugeordnete Personen. */
  unassignedDirectCostIds: string[]
}

export function validateTripForCalc(t: TripLike): InvalidReason | null {
  if (typeof t.km !== 'number' || !Number.isFinite(t.km) || t.km < 0) return 'invalid-km'
  if (!t.personIds || t.personIds.length === 0) return 'no-persons'
  if (new Set(t.personIds).size !== t.personIds.length) return 'duplicate-persons'
  if (t.odoStart != null && t.odoEnd != null && t.odoEnd < t.odoStart) return 'odometer'
  return null
}

/** Kern der Kostenverteilung für bereits gefilterte Fahrten und Kostenbuchungen. */
export function computeDistribution(trips: TripLike[], costs: CostEntry[]): Distribution {
  const invalidTrips: InvalidTrip[] = []
  const valid: TripLike[] = []
  for (const t of trips) {
    const reason = validateTripForCalc(t)
    if (reason) invalidTrips.push({ tripId: t.id, reason })
    else valid.push(t)
  }
  // Stabile Reihenfolge: nach Datum, dann ID – damit Restcents reproduzierbar landen.
  valid.sort((a, b) => (a.startDate === b.startDate ? (a.id < b.id ? -1 : 1) : a.startDate < b.startDate ? -1 : 1))

  const totalKm = round6(valid.reduce((s, t) => s + t.km, 0))
  const perKmCosts = costs.filter((c) => c.allocation === 'perKm')
  const directCosts = costs.filter((c) => c.allocation === 'direct')
  const perKmCostCents = sum(perKmCosts.map((c) => c.amountCents))
  const directCostCents = sum(directCosts.map((c) => c.amountCents))
  const totalCostCents = perKmCostCents + directCostCents

  const personMap = new Map<string, PersonResult>()
  const person = (id: string) => {
    let p = personMap.get(id)
    if (!p) {
      p = { personId: id, km: 0, tripCount: 0, perKmCents: 0, directCents: 0, totalCents: 0, tripIds: [] }
      personMap.set(id, p)
    }
    return p
  }

  // --- Kilometerbezogene Kosten ---
  const tripResults: TripResult[] = []
  let undistributedCents = 0
  const canDistributeKm = totalKm > 0
  const tripCents = canDistributeKm
    ? allocateCents(perKmCostCents, valid.map((t) => t.km))
    : valid.map(() => 0)
  if (!canDistributeKm) undistributedCents += perKmCostCents

  valid.forEach((t, idx) => {
    const n = t.personIds.length
    const shares = allocateCents(tripCents[idx], t.personIds.map(() => 1), idx)
    const result: TripResult = {
      tripId: t.id,
      km: t.km,
      costCents: tripCents[idx],
      shares: t.personIds.map((pid, i) => ({ personId: pid, km: t.km / n, cents: shares[i] })),
    }
    tripResults.push(result)
    for (const s of result.shares) {
      const p = person(s.personId)
      p.km += s.km
      p.perKmCents += s.cents
      p.tripCount += 1
      p.tripIds.push(t.id)
    }
  })

  // --- Direkt zugeordnete Kosten ---
  const directShares: DirectShare[] = []
  const unassignedDirectCostIds: string[] = []
  directCosts.forEach((c, idx) => {
    const ids = [...new Set(c.directPersonIds)]
    if (ids.length === 0) {
      undistributedCents += c.amountCents
      unassignedDirectCostIds.push(c.id)
      return
    }
    const parts = allocateCents(c.amountCents, ids.map(() => 1), idx)
    ids.forEach((pid, i) => {
      directShares.push({ costId: c.id, personId: pid, cents: parts[i] })
      person(pid).directCents += parts[i]
    })
  })

  const persons = [...personMap.values()].map((p) => ({
    ...p,
    km: round6(p.km),
    totalCents: p.perKmCents + p.directCents,
  }))

  // --- Kategorien ---
  const catMap = new Map<string, CategoryResult>()
  for (const c of costs) {
    let r = catMap.get(c.categoryId)
    if (!r) {
      r = { categoryId: c.categoryId, totalCents: 0, perKmCents: 0, directCents: 0, entryCount: 0 }
      catMap.set(c.categoryId, r)
    }
    r.totalCents += c.amountCents
    r.entryCount += 1
    if (c.allocation === 'perKm') r.perKmCents += c.amountCents
    else r.directCents += c.amountCents
  }
  const categories = [...catMap.values()].sort((a, b) => b.totalCents - a.totalCents)

  const distributedCents = sum(persons.map((p) => p.totalCents))

  let status: DistributionStatus = 'ok'
  if (valid.length === 0) status = 'no-trips'
  else if (totalKm === 0) status = 'zero-km'
  else if (costs.length === 0) status = 'no-costs'

  return {
    status,
    totalCostCents,
    perKmCostCents,
    directCostCents,
    undistributedCents,
    distributedCents,
    totalKm,
    tripCount: valid.length,
    pricePerKm: canDistributeKm ? perKmCostCents / 100 / totalKm : null,
    trips: tripResults,
    persons,
    categories,
    directShares,
    invalidTrips,
    unassignedDirectCostIds,
  }
}

// ---------------------------------------------------------------------------
// Abrechnung mit Zeitraumlogik
// ---------------------------------------------------------------------------

type NoticeLevel = 'info' | 'warning' | 'error'

export interface Notice {
  level: NoticeLevel
  code: string
  message: string
}

export interface SettlementInput {
  trips: Trip[]
  expenses: Expense[]
  persons: Person[]
  payments?: Payment[]
}

interface SettlementOptions {
  /** Zeitraum für Fahrten. */
  period: PeriodSpec
  /** Abweichender Zeitraum für Kosten. Standard: derselbe wie für Fahrten. */
  costPeriod?: PeriodSpec
  today: IsoDate
}

export interface Settlement extends Distribution {
  tripRange: DateRange
  costRange: DateRange
  separatePeriods: boolean
  /** Berücksichtigte Kostenbuchungen. */
  costs: CostEntry[]
  /** Berücksichtigte Fahrten (inkl. ungültiger, siehe invalidTrips). */
  includedTrips: Trip[]
  /** Tatsächlicher Datumsbereich der berücksichtigten Fahrten bzw. Kosten. */
  actualTripSpan: DateRange
  actualCostSpan: DateRange
  notices: Notice[]
  /** Ausgleich: bezahlte Kosten, Anteile, Ausgleichszahlungen (Zahlungen im Fahrtenzeitraum). */
  balance: BalanceResult
  /** Ausgleichszahlungen im Zeitraum. */
  payments: Payment[]
  /** Kilometerlücken/-überschneidungen, deren folgende Fahrt im Zeitraum liegt. */
  odometerIssues: OdometerIssue[]
}

/**
 * Periodenlogik (überall identisch):
 *  - Eine Fahrt gehört zu dem Zeitraum, in dem ihr Startdatum liegt.
 *  - Eine Kostenbuchung gehört zu dem Zeitraum, in dem ihr Buchungs-/Fälligkeitsdatum liegt.
 *  - Wiederkehrende Kosten werden je Fälligkeit gebucht (monatlich bzw. jährlich).
 *  - Unbefristete Wiederholungen werden bis zum Ende des Zeitraums erzeugt, höchstens jedoch bis
 *    heute bzw. bis zur letzten Fahrt (je nachdem, was später liegt).
 */
export function buildSettlement(input: SettlementInput, options: SettlementOptions): Settlement {
  const costSpec = options.costPeriod ?? options.period
  const tripRange = resolvePeriod(options.period)
  const costRange = resolvePeriod(costSpec)
  const separatePeriods = options.costPeriod != null && !samePeriod(options.period, options.costPeriod)

  const latestTrip = input.trips.reduce<IsoDate>((m, t) => maxDate(m, t.startDate), options.today)
  const horizon = costRange.to ?? maxDate(options.today, latestTrip)
  const allCosts = expandExpenses(input.expenses, horizon)
  const costs = allCosts.filter((c) => inRange(c.date, costRange)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const includedTrips = input.trips.filter((t) => inRange(t.startDate, tripRange))

  const dist = computeDistribution(includedTrips, costs)

  const span = (dates: IsoDate[]): DateRange =>
    dates.length === 0 ? { from: null, to: null } : { from: dates.reduce((a, b) => (a < b ? a : b)), to: dates.reduce((a, b) => (a > b ? a : b)) }
  const actualTripSpan = span(includedTrips.map((t) => t.startDate))
  const actualCostSpan = span(costs.map((c) => c.date))

  const notices: Notice[] = []

  if (separatePeriods) {
    notices.push({
      level: 'warning',
      code: 'separate-periods',
      message: 'Kosten und Fahrten stammen aus unterschiedlichen Zeiträumen. Die Kosten des Kostenzeitraums werden auf die Fahrten des Fahrtenzeitraums verteilt.',
    })
  }
  if (dist.status === 'no-trips' && dist.perKmCostCents > 0) {
    notices.push({
      level: 'error',
      code: 'no-trips',
      message: `Im gewählten Zeitraum gibt es keine gültigen Fahrten. Kilometerbezogene Kosten von ${formatEuro(dist.perKmCostCents)} können nicht verteilt werden.`,
    })
  } else if (dist.status === 'no-trips') {
    notices.push({ level: 'info', code: 'no-trips', message: 'Im gewählten Zeitraum gibt es keine Fahrten.' })
  } else if (dist.status === 'zero-km') {
    notices.push({
      level: 'error',
      code: 'zero-km',
      message: `Die Fahrten im Zeitraum haben zusammen 0 km. Ein Kilometerpreis kann nicht berechnet werden; ${formatEuro(dist.perKmCostCents)} bleiben unverteilt.`,
    })
  } else if (dist.status === 'no-costs') {
    notices.push({ level: 'info', code: 'no-costs', message: 'Im Kostenzeitraum sind keine Kosten erfasst.' })
  }
  if (dist.invalidTrips.length > 0) {
    notices.push({
      level: 'warning',
      code: 'invalid-trips',
      message: `${dist.invalidTrips.length} Fahrt(en) wurden wegen fehlender oder ungültiger Angaben (Kilometer, Personen, Kilometerstand) nicht berücksichtigt.`,
    })
  }
  if (dist.unassignedDirectCostIds.length > 0) {
    notices.push({
      level: 'warning',
      code: 'unassigned-direct',
      message: `${dist.unassignedDirectCostIds.length} direkt zuzuordnende Kostenbuchung(en) haben keine Personen und bleiben unverteilt.`,
    })
  }
  const future = costs.filter((c) => c.date > options.today)
  if (future.length > 0) {
    notices.push({
      level: 'info',
      code: 'future-costs',
      message: `${future.length} Kostenbuchung(en) über ${formatEuro(sum(future.map((c) => c.amountCents)))} liegen in der Zukunft (z. B. noch ausstehende Leasingraten) und sind enthalten.`,
    })
  }
  if (tripRange.to) {
    const crossing = includedTrips.filter((t) => t.endDate && t.endDate > tripRange.to!)
    if (crossing.length > 0) {
      notices.push({
        level: 'info',
        code: 'crossing-trips',
        message: `${crossing.length} Fahrt(en) enden nach dem ${formatDate(tripRange.to)}. Sie werden vollständig dem Zeitraum ihres Startdatums zugeordnet.`,
      })
    }
  }

  const odometerIssues = findOdometerIssues(input.trips).filter((i) => {
    const next = input.trips.find((t) => t.id === i.nextTripId)
    return next ? inRange(next.startDate, tripRange) : false
  })
  const gaps = odometerIssues.filter((i) => i.type === 'gap')
  if (gaps.length > 0) {
    const km = gaps.reduce((a, g) => a + g.km, 0)
    notices.push({
      level: 'warning',
      code: 'odometer-gaps',
      message: `Zwischen den Kilometerständen fehlen ${formatKm(km)} (${gaps.length} Lücke(n)). Nicht erfasste Kilometer zahlt niemand – sie erhöhen den Kilometerpreis für alle. Bitte die fehlenden Fahrten im Fahrtenbuch nachtragen.`,
    })
  }
  const overlaps = odometerIssues.filter((i) => i.type === 'overlap')
  if (overlaps.length > 0) {
    notices.push({
      level: 'warning',
      code: 'odometer-overlaps',
      message: `${overlaps.length} Fahrt(en) überschneiden sich bei den Kilometerständen – möglicherweise doppelt erfasst oder vertippt.`,
    })
  }

  const payments = (input.payments ?? []).filter((p) => inRange(p.date, tripRange))
  const balance = computeBalances(dist, costs, payments)

  return {
    ...dist,
    tripRange,
    costRange,
    separatePeriods,
    costs,
    includedTrips,
    actualTripSpan,
    actualCostSpan,
    notices,
    balance,
    payments,
    odometerIssues,
  }
}

/** Nimmt die Personen aus der Abrechnung und ergänzt Personen ohne Anteil (für vollständige Tabellen). */
export function personRows(settlement: Distribution, persons: Person[]): (PersonResult & { name: string; active: boolean; known: boolean })[] {
  const byId = new Map(persons.map((p) => [p.id, p]))
  const rows = settlement.persons.map((r) => {
    const p = byId.get(r.personId)
    return { ...r, name: p?.name ?? 'Unbekannte Person', active: p?.active ?? false, known: Boolean(p) }
  })
  return rows.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name, 'de'))
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}
