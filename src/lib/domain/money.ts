/** Euro (Zahl) → Cent (Ganzzahl), kaufmännisch gerundet. */
export function euroToCents(euro: number): number {
  // Korrektur gegen Gleitkommafehler wie 319.15 * 100 = 31914.999…
  return Math.round(Number((euro * 100).toFixed(6)))
}

export function centsToEuro(cents: number): number {
  return cents / 100
}

/**
 * Eingabe aus einem Formularfeld ("1.234,56", "1234.56", "12,5 €") → Cent.
 * Gibt null zurück, wenn die Eingabe nicht eindeutig interpretierbar ist.
 */
export function parseEuroInput(input: string): number | null {
  let s = input.replace(/€|\s|\u00a0/g, '')
  if (s === '') return null
  const negative = s.startsWith('-')
  if (negative) s = s.slice(1)
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d+(,\d{1,2})?$/.test(s)) {
    s = s.replace(',', '.')
  } else if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return null
  }
  const cents = euroToCents(Number(s))
  return negative ? -cents : cents
}

/** Kilometer-Eingabe ("1.234", "12,5") → Zahl oder null. */
export function parseNumberInput(input: string): number | null {
  let s = input.replace(/\s|\u00a0|km/gi, '')
  if (s === '') return null
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d+(,\d+)?$/.test(s)) s = s.replace(',', '.')
  else if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
