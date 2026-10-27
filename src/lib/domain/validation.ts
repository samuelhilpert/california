import { isIsoDate } from './dates'
import type { Expense, Trip } from './types'

export type FieldErrors = Record<string, string>

export type TripDraft = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>
export type ExpenseDraft = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>

/**
 * Ermittelt die gefahrenen Kilometer: Sind beide Kilometerstände gesetzt, gilt deren Differenz,
 * sonst die direkt eingegebene Zahl.
 */
export function resolveTripKm(odoStart?: number, odoEnd?: number, manualKm?: number): number | undefined {
  if (odoStart != null && odoEnd != null && Number.isFinite(odoStart) && Number.isFinite(odoEnd)) {
    return Math.round((odoEnd - odoStart) * 10) / 10
  }
  return manualKm
}

export function validateTrip(d: Partial<TripDraft>): FieldErrors {
  const e: FieldErrors = {}
  if (!d.startDate || !isIsoDate(d.startDate)) e.startDate = 'Bitte ein gültiges Startdatum angeben.'
  if (d.endDate) {
    if (!isIsoDate(d.endDate)) e.endDate = 'Bitte ein gültiges Enddatum angeben.'
    else if (d.startDate && d.endDate < d.startDate) e.endDate = 'Das Enddatum darf nicht vor dem Startdatum liegen.'
  }
  const checkOdo = (v: number | undefined, key: string) => {
    if (v != null && (!Number.isFinite(v) || v < 0)) e[key] = 'Bitte einen gültigen, nicht-negativen Kilometerstand eingeben.'
  }
  checkOdo(d.odoStart, 'odoStart')
  checkOdo(d.odoEnd, 'odoEnd')
  if ((d.odoStart == null) !== (d.odoEnd == null) && !e.odoStart && !e.odoEnd) {
    // Nur ein Stand angegeben – erlaubt, dann zählen die direkt eingegebenen Kilometer.
  }
  if (d.odoStart != null && d.odoEnd != null && !e.odoStart && !e.odoEnd && d.odoEnd < d.odoStart) {
    e.odoEnd = 'Der Kilometerstand am Fahrtende muss mindestens so hoch sein wie zu Fahrtbeginn.'
  }
  if (d.km == null || !Number.isFinite(d.km)) e.km = 'Bitte die gefahrenen Kilometer angeben oder beide Kilometerstände ausfüllen.'
  else if (d.km < 0 && !e.odoEnd) e.km = 'Die gefahrenen Kilometer dürfen nicht negativ sein.'
  else if (d.km > 100000) e.km = 'Mehr als 100.000 km für eine Fahrt sind unplausibel.'
  else if (d.odoStart != null && d.odoEnd != null && !e.odoEnd && Math.abs(d.odoEnd - d.odoStart - d.km) > 0.05) {
    e.km = 'Die Kilometer stimmen nicht mit der Differenz der Kilometerstände überein.'
  }
  if (!d.personIds || d.personIds.length === 0) e.personIds = 'Bitte mindestens eine beteiligte Person auswählen.'
  else if (new Set(d.personIds).size !== d.personIds.length) e.personIds = 'Eine Person wurde doppelt ausgewählt.'
  return e
}

export function validateExpense(d: Partial<ExpenseDraft>): FieldErrors {
  const e: FieldErrors = {}
  if (!d.title || !d.title.trim()) e.title = 'Bitte eine Bezeichnung angeben.'
  else if (d.title.length > 200) e.title = 'Die Bezeichnung ist zu lang (max. 200 Zeichen).'
  if (!d.categoryId) e.categoryId = 'Bitte eine Kategorie wählen.'
  if (d.amountCents == null || !Number.isInteger(d.amountCents)) e.amountCents = 'Bitte einen gültigen Betrag eingeben, z. B. 319,15.'
  else if (d.amountCents === 0) e.amountCents = 'Der Betrag darf nicht 0 € sein.'
  else if (Math.abs(d.amountCents) > 100_000_000) e.amountCents = 'Der Betrag ist unplausibel hoch.'
  if (!d.date || !isIsoDate(d.date)) e.date = 'Bitte ein gültiges Datum angeben.'
  if (d.allocation === 'direct' && (!d.directPersonIds || d.directPersonIds.length === 0)) {
    e.directPersonIds = 'Bitte mindestens eine Person wählen, auf die diese Kosten verteilt werden.'
  }
  if (d.recurrence) {
    const r = d.recurrence
    if (r.count != null && (!Number.isInteger(r.count) || r.count < 1 || r.count > 1200)) e.recurrenceCount = 'Anzahl muss zwischen 1 und 1200 liegen.'
    if (r.until != null) {
      if (!isIsoDate(r.until)) e.recurrenceUntil = 'Bitte ein gültiges Enddatum angeben.'
      else if (d.date && r.until < d.date) e.recurrenceUntil = 'Das Enddatum liegt vor der ersten Fälligkeit.'
    }
  }
  return e
}

export function hasErrors(e: FieldErrors): boolean {
  return Object.keys(e).length > 0
}
