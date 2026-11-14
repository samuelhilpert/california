import { formatEuro, formatKm } from '../lib/format'

/**
 * Erklärt eine Festpreis-Fahrt ohne „angerechnete“ Kilometer:
 * Gast → Festpreis im Vergleich zu den Kosten nach km;
 * Empfänger → Differenz zwischen Kosten nach km und Festpreis, geteilt durch die Empfänger.
 */
export function fixedPriceExplanation(o: { role: 'guest' | 'recipient'; km: number; tripCostCents: number; fixedPriceCents: number; splitBy: number }): string {
  const split = o.splitBy > 1 ? `, geteilt durch ${o.splitBy}` : ''
  if (o.role === 'guest') return `Festpreis ${formatEuro(o.fixedPriceCents)}${split} · nach km wären es ${formatEuro(o.tripCostCents)} gewesen`
  const diff = o.tripCostCents - o.fixedPriceCents
  return `${formatKm(o.km)} nach km ${formatEuro(o.tripCostCents)} − Festpreis ${formatEuro(o.fixedPriceCents)} = ${formatEuro(Math.abs(diff))} ${diff >= 0 ? 'Differenz' : 'Überschuss'}${split}`
}

/** Kurzfassung für die Fahrtaufschlüsselung: wer die Differenz trägt bzw. den Überschuss bekommt. */
export function fixedPriceSummary(o: { tripCostCents: number; fixedPriceCents: number; recipientNames: string[] }): string {
  const diff = o.tripCostCents - o.fixedPriceCents
  const who = o.recipientNames.join(', ')
  return `Festpreis ${formatEuro(o.fixedPriceCents)} · ${diff >= 0 ? `Differenz ${formatEuro(diff)} ${o.recipientNames.length === 1 ? 'trägt' : 'tragen'} ${who}` : `Überschuss ${formatEuro(-diff)} geht an ${who}`}`
}
