/**
 * Verteilt einen ganzzahligen Centbetrag proportional zu Gewichten nach dem
 * Restbetragsverfahren (Hare-Niemeyer). Die Summe des Ergebnisses entspricht
 * immer exakt `totalCents`. Rechnet mit BigInt, damit keine Gleitkommafehler
 * entstehen.
 *
 * @param weights nicht-negative Gewichte; werden auf `scale` Nachkommastellen genau berücksichtigt
 * @param tieOffset verschiebt bei gleichen Resten die Reihenfolge, damit Restcents
 *                  nicht immer bei derselben Position landen
 */
export function allocateCents(totalCents: number, weights: number[], tieOffset = 0, scale = 1000): number[] {
  if (!Number.isInteger(totalCents)) throw new Error('totalCents muss ganzzahlig sein')
  const n = weights.length
  if (n === 0) return []
  const w = weights.map((x) => {
    if (!Number.isFinite(x) || x < 0) throw new Error('Gewichte müssen endliche, nicht-negative Zahlen sein')
    return BigInt(Math.round(x * scale))
  })
  const sum = w.reduce((a, b) => a + b, 0n)
  if (sum === 0n) throw new Error('Summe der Gewichte ist null – Verteilung nicht möglich')

  const negative = totalCents < 0
  const total = BigInt(Math.abs(totalCents))
  const base = w.map((wi) => (total * wi) / sum)
  const rem = w.map((wi) => (total * wi) % sum)
  let left = Number(total - base.reduce((a, b) => a + b, 0n))

  const order = [...Array(n).keys()].sort((a, b) => {
    if (rem[a] !== rem[b]) return rem[b] > rem[a] ? 1 : -1
    const ra = (a - tieOffset + n * 1000) % n
    const rb = (b - tieOffset + n * 1000) % n
    return ra - rb
  })
  const result = base.map(Number)
  for (const i of order) {
    if (left <= 0) break
    if (w[i] === 0n) continue
    result[i] += 1
    left -= 1
  }
  return negative ? result.map((x) => -x) : result
}
