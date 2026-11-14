/**
 * Rechenweg zum Saldo einer Person: Woraus setzen sich bezahlte Kosten, Kostenanteil,
 * Vorauszahlungen und Ausgleichszahlungen zusammen? Die Zeilen ergeben exakt den Saldo.
 */
import type { Settlement } from './settlement'
import type { IsoDate } from './types'

type BreakdownLine =
  /** Bezahlte Kosten einer Ausgabe (bei wiederkehrenden Kosten alle Fälligkeiten im Zeitraum). */
  | { type: 'paid'; expenseId: string; title: string; count: number; cents: number }
  /** Anteil an den Kilometerkosten (negativ). */
  | { type: 'perKm'; km: number; pricePerKm: number | null; cents: number }
  /** Festpreis-Fahrt: als Gast getragen (negativ) oder als Empfänger gutgeschrieben (positiv). */
  | { type: 'fixed'; tripId: string; date: IsoDate; to?: string; guest: boolean; guestIds: string[]; cents: number }
  /** Anteil an direkt zugeordneten Kosten einer Ausgabe (negativ). */
  | { type: 'direct'; expenseId: string; title: string; count: number; sharedBy: number; cents: number }
  /** Vorauszahlungen eines Dauerauftrags bzw. einer Einzelzahlung: an jemanden (+) oder von jemandem (−). */
  | { type: 'advance'; paymentId: string; otherPersonId: string; sent: boolean; count: number; cents: number }
  /** Ausgleichszahlung: an jemanden (+) oder von jemandem (−). */
  | { type: 'settlement'; paymentId: string; otherPersonId: string; sent: boolean; date: IsoDate; cents: number }

export interface BalanceBreakdown {
  lines: BreakdownLine[]
  /** Summe der Zeilen = Saldo der Person. */
  totalCents: number
}

export function balanceBreakdown(s: Settlement, personId: string): BalanceBreakdown {
  const lines: BreakdownLine[] = []

  // Bezahlte Kosten, je Ausgabe zusammengefasst
  const paid = new Map<string, Extract<BreakdownLine, { type: 'paid' }>>()
  for (const c of s.costs) {
    if (c.paidBy !== personId) continue
    const l = paid.get(c.expenseId) ?? { type: 'paid', expenseId: c.expenseId, title: c.title, count: 0, cents: 0 }
    l.count++
    l.cents += c.amountCents
    paid.set(c.expenseId, l)
  }
  lines.push(...paid.values())

  // Kostenanteil: Kilometerkosten und Direktkosten
  const p = s.persons.find((x) => x.personId === personId)
  if (p && (p.perKmCents !== 0 || p.km > 0)) lines.push({ type: 'perKm', km: p.km, pricePerKm: s.pricePerKm, cents: -p.perKmCents })
  const tripById = new Map(s.includedTrips.map((t) => [t.id, t]))
  for (const t of s.trips) {
    const sh = t.shares.find((x) => x.personId === personId && x.fixedCents)
    const trip = tripById.get(t.tripId)
    if (!sh || !trip) continue
    lines.push({ type: 'fixed', tripId: t.tripId, date: trip.startDate, ...(trip.to ? { to: trip.to } : {}), guest: trip.personIds.includes(personId), guestIds: trip.personIds, cents: -sh.fixedCents! })
  }
  const costById = new Map(s.costs.map((c) => [c.id, c]))
  const direct = new Map<string, Extract<BreakdownLine, { type: 'direct' }>>()
  for (const d of s.directShares) {
    if (d.personId !== personId) continue
    const c = costById.get(d.costId)
    if (!c) continue
    const l = direct.get(c.expenseId) ?? { type: 'direct', expenseId: c.expenseId, title: c.title, count: 0, sharedBy: c.directPersonIds.length, cents: 0 }
    l.count++
    l.cents -= d.cents
    direct.set(c.expenseId, l)
  }
  lines.push(...direct.values())

  // Zahlungen: Vorauszahlungen je Dauerauftrag und Richtung, Ausgleichszahlungen einzeln
  const advances = new Map<string, Extract<BreakdownLine, { type: 'advance' }>>()
  const settlements: BreakdownLine[] = []
  for (const e of s.payments) {
    if (e.fromPersonId === e.toPersonId) continue
    const sent = e.fromPersonId === personId
    if (!sent && e.toPersonId !== personId) continue
    const signed = sent ? e.amountCents : -e.amountCents
    const otherPersonId = sent ? e.toPersonId : e.fromPersonId
    if (e.kind === 'advance') {
      const key = `${e.paymentId}|${sent}`
      const l = advances.get(key) ?? { type: 'advance', paymentId: e.paymentId, otherPersonId, sent, count: 0, cents: 0 }
      l.count++
      l.cents += signed
      advances.set(key, l)
    } else {
      settlements.push({ type: 'settlement', paymentId: e.paymentId, otherPersonId, sent, date: e.date, cents: signed })
    }
  }
  lines.push(...advances.values(), ...settlements)
  return { lines, totalCents: lines.reduce((a, l) => a + l.cents, 0) }
}
