import type { IsoDate } from './domain/types'

const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
const kmFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })
const intFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })
const priceFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const dateShortFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', timeZone: 'UTC' })
const pctFmt = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 })

export const formatEuro = (cents: number) => eurFmt.format(cents / 100)
export const formatKm = (km: number) => `${kmFmt.format(km)} km`
export const formatNumber = (n: number) => kmFmt.format(n)
export const formatInt = (n: number) => intFmt.format(n)
export const formatPricePerKm = (eur: number | null) => (eur == null ? '–' : `${priceFmt.format(eur)}/km`)
export const formatPercent = (x: number) => pctFmt.format(x)

const toDate = (d: IsoDate) => new Date(`${d}T00:00:00Z`)
export const formatDate = (d?: IsoDate | null) => (d ? dateFmt.format(toDate(d)) : '–')
export const formatDateShort = (d: IsoDate) => dateShortFmt.format(toDate(d))
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
