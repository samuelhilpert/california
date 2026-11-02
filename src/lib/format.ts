import type { IsoDate } from './domain/types'

const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const kmFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const intFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })
const priceFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const litersFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
const dateLongFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const pctFmt = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 })

export const formatEuro = (cents: number) => eurFmt.format(cents / 100)
export const formatKm = (km: number) => `${kmFmt.format(km)} km`
/** Zahl mit fester Anzahl Nachkommastellen, z. B. formatDecimal(7.36, 1) → „7,4“. */
export const formatDecimal = (n: number, digits: number) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
export const formatLiters = (l: number) => `${litersFmt.format(l)} l`
export const formatPer100km = (l: number) => `${formatDecimal(l, 1)} l/100 km`
export const formatPerLiter = (eur: number) => `${formatDecimal(eur, 3)} €/l`
export const formatInt = (n: number) => intFmt.format(n)
export const formatPricePerKm = (eur: number | null) => (eur == null ? '–' : `${priceFmt.format(eur)}/km`)
export const formatPercent = (x: number) => pctFmt.format(x)

const toDate = (d: IsoDate) => new Date(`${d}T00:00:00Z`)
export const formatDate = (d?: IsoDate | null) => (d ? dateFmt.format(toDate(d)) : '–')
/** Monat und Jahr, z. B. „November 2026“. */
export const formatMonth = (year: number, month: number) => monthFmt.format(new Date(Date.UTC(year, month - 1, 1)))
/** Ausgeschrieben, z. B. „1. November 2026“. */
export const formatDateLong = (d: IsoDate) => dateLongFmt.format(toDate(d))
export function formatDateSpan(from?: IsoDate | null, to?: IsoDate | null): string {
  if (!from && !to) return '–'
  if (from && to && from !== to) return `${formatDate(from)} – ${formatDate(to)}`
  return formatDate(from ?? to)
}
export const formatStamp = (iso: string) =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

/** Zahl für ein Eingabefeld (deutsch, ohne Tausenderpunkte). */
export const numberToInput = (n?: number) => (n == null ? '' : String(n).replace('.', ','))
export const centsToInput = (c?: number) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','))
