/**
 * Leasing-Kilometer (Pro-Modus): Wie viel ist vom Kontingent verbraucht, wo landet man voraussichtlich
 * am Vertragsende und was würde das kosten? Reine Anzeige – ändert nichts an der Abrechnung.
 */
import type { FuelFill, IsoDate, Trip } from './types'
import { addMonths, parseIso } from './dates'
import { validTrips } from './stats'

export interface LeasingConfig {
  /** Vertragsbeginn (Übergabe). */
  start: IsoDate
  /** Laufzeit in Monaten. */
  months: number
  /** Vereinbarte Kilometer pro Jahr. */
  kmPerYear: number
  /** Kilometerstand bei Übergabe – damit zählt der echte Tacho statt der Summe der Fahrten. */
  startOdometer?: number
  /** Preis je Mehrkilometer in Cent. */
  extraKmCents?: number
  /** Vergütung je Minderkilometer in Cent. */
  lessKmCents?: number
  /**
   * Toleranz in km über die gesamte Laufzeit (z. B. 2.500): Abweichungen bis zu diesem Wert werden
   * nicht abgerechnet, darüber nur der Teil jenseits der Toleranz.
   */
  toleranceKm?: number
}

export const LEASING_SETTING = 'leasing'

export interface LeasingStatus {
  end: IsoDate
  limitKm: number
  daysTotal: number
  daysElapsed: number
  drivenKm: number
  /** Woher die gefahrenen km stammen: Tacho (letzter bekannter Kilometerstand) oder Summe der Fahrten. */
  source: 'odometer' | 'trips'
  lastReading?: { km: number; date: IsoDate }
  /** Anteiliges Kontingent bis heute. */
  expectedToDate: number
  prognosisKm: number
  /** Prognose − Kontingent (positiv = Mehrkilometer). */
  deltaKm: number
  /** Prognose liegt innerhalb der Toleranz – dann wird nichts abgerechnet. */
  withinTolerance: boolean
  /** Abzurechnende km nach Abzug der Toleranz (positiv = Mehr-, negativ = Minderkilometer). */
  billableKm: number
  /** Voraussichtliche Nachzahlung (positiv) bzw. Gutschrift (negativ) in Cent, falls Preise hinterlegt. */
  costCents: number | null
  /** Noch verfügbare km bis Vertragsende und je verbleibendem Monat. */
  remainingKm: number
  remainingPerMonth: number | null
  finished: boolean
}

const DAY = 86_400_000
const utc = (d: IsoDate) => {
  const { year, month, day } = parseIso(d)
  return Date.UTC(year, month - 1, day)
}

export function leasingStatus(cfg: LeasingConfig, trips: Trip[], fuel: FuelFill[], today: IsoDate): LeasingStatus {
  const end = addMonths(cfg.start, cfg.months)
  const limitKm = Math.round((cfg.kmPerYear * cfg.months) / 12)
  const daysTotal = Math.max(1, Math.round((utc(end) - utc(cfg.start)) / DAY))
  const finished = today >= end
  const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((utc(finished ? end : today) - utc(cfg.start)) / DAY)))

  // Letzter bekannter Tachostand seit Vertragsbeginn: aus Fahrten (Ende) oder Tankbuch
  const readings: { km: number; date: IsoDate }[] = [
    ...trips.filter((t) => t.odoEnd != null && (t.endDate ?? t.startDate) >= cfg.start).map((t) => ({ km: t.odoEnd as number, date: t.endDate ?? t.startDate })),
    ...fuel.filter((f) => f.odometer != null && f.date >= cfg.start).map((f) => ({ km: f.odometer as number, date: f.date })),
  ].filter((r) => r.date <= today)
  const lastReading = readings.sort((a, b) => b.km - a.km)[0]
  const tripKm = validTrips(trips).filter((t) => t.startDate >= cfg.start && t.startDate <= today).reduce((a, t) => a + t.km, 0)
  const useOdo = cfg.startOdometer != null && lastReading != null && lastReading.km >= cfg.startOdometer
  const drivenKm = useOdo ? lastReading.km - (cfg.startOdometer as number) : tripKm

  const expectedToDate = (limitKm * daysElapsed) / daysTotal
  const prognosisKm = finished || daysElapsed === 0 ? drivenKm : (drivenKm / daysElapsed) * daysTotal
  const deltaKm = Math.round(prognosisKm - limitKm)
  const tolerance = Math.max(0, cfg.toleranceKm ?? 0)
  const billableKm = Math.sign(deltaKm) * Math.max(0, Math.abs(deltaKm) - tolerance)
  const price = deltaKm > 0 ? cfg.extraKmCents : cfg.lessKmCents
  const remainingKm = Math.round(limitKm - drivenKm)
  const monthsLeft = (daysTotal - daysElapsed) / (365.25 / 12)
  return {
    end,
    limitKm,
    daysTotal,
    daysElapsed,
    drivenKm: Math.round(drivenKm),
    source: useOdo ? 'odometer' : 'trips',
    lastReading,
    expectedToDate: Math.round(expectedToDate),
    prognosisKm: Math.round(prognosisKm),
    deltaKm,
    withinTolerance: tolerance > 0 && billableKm === 0,
    billableKm,
    costCents: price != null && deltaKm !== 0 ? Math.round(billableKm * price) : null,
    remainingKm,
    remainingPerMonth: monthsLeft >= 0.5 ? Math.round(remainingKm / monthsLeft) : null,
    finished,
  }
}
