import type { Trip } from './types'

export interface OdometerIssue {
  type: 'gap' | 'overlap'
  prevTripId: string
  nextTripId: string
  /** Kilometerstand am Ende der vorherigen Fahrt. */
  fromKm: number
  /** Kilometerstand am Beginn der folgenden Fahrt. */
  toKm: number
  /** Größe der Lücke bzw. Überschneidung in km (immer positiv). */
  km: number
}

/**
 * Prüft aufeinanderfolgende Fahrten mit Kilometerständen. Endet eine Fahrt bei 1.020 km und die
 * nächste beginnt bei 1.400 km, sind 380 km nicht erfasst – diese würden sonst niemandem zugerechnet
 * und den Kilometerpreis für alle erhöhen. Überschneidungen deuten auf Tippfehler oder doppelte Fahrten hin.
 */
export function findOdometerIssues(trips: Trip[], toleranceKm = 0): OdometerIssue[] {
  const withOdo = trips
    .filter((t) => t.odoStart != null && t.odoEnd != null && Number.isFinite(t.odoStart) && Number.isFinite(t.odoEnd) && t.odoEnd! >= t.odoStart!)
    .sort((a, b) => a.odoStart! - b.odoStart! || a.odoEnd! - b.odoEnd! || a.startDate.localeCompare(b.startDate))
  const issues: OdometerIssue[] = []
  for (let i = 1; i < withOdo.length; i++) {
    const prev = withOdo[i - 1]
    const next = withOdo[i]
    const diff = Math.round((next.odoStart! - prev.odoEnd!) * 10) / 10
    if (diff > toleranceKm) issues.push({ type: 'gap', prevTripId: prev.id, nextTripId: next.id, fromKm: prev.odoEnd!, toKm: next.odoStart!, km: diff })
    else if (diff < -toleranceKm) issues.push({ type: 'overlap', prevTripId: prev.id, nextTripId: next.id, fromKm: prev.odoEnd!, toKm: next.odoStart!, km: -diff })
  }
  return issues
}

/**
 * Sucht bereits erfasste Fahrten, die vermutlich dieselbe Fahrt sind:
 * gleiches Startdatum und gleiche Kilometer, oder sich überschneidende Kilometerstände.
 */
export function findSimilarTrips(draft: Pick<Trip, 'startDate' | 'km'> & Partial<Pick<Trip, 'odoStart' | 'odoEnd'>>, trips: Trip[], excludeId?: string): Trip[] {
  return trips.filter((t) => {
    if (t.id === excludeId) return false
    if (t.startDate === draft.startDate && Math.abs(t.km - draft.km) < 0.05) return true
    if (draft.odoStart != null && draft.odoEnd != null && t.odoStart != null && t.odoEnd != null) {
      const overlap = Math.min(draft.odoEnd, t.odoEnd) - Math.max(draft.odoStart, t.odoStart)
      if (overlap > 0) return true
    }
    return false
  })
}
