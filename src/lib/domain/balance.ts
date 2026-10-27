/**
 * Ausgleich zwischen den Personen: Wer hat mehr bezahlt, als sein Anteil beträgt?
 *
 * Saldo = bezahlte Kosten − Kostenanteil + geleistete Ausgleichszahlungen − erhaltene Ausgleichszahlungen
 *   > 0  → die Person bekommt Geld
 *   < 0  → die Person muss zahlen
 */
import type { CostEntry, Payment } from './types'
import type { Distribution } from './settlement'

export interface PersonBalance {
  personId: string
  paidCents: number
  shareCents: number
  sentCents: number
  receivedCents: number
  balanceCents: number
}

export interface Transfer {
  fromPersonId: string
  toPersonId: string
  amountCents: number
}

export interface BalanceResult {
  balances: PersonBalance[]
  /** Vorschlag: möglichst wenige Überweisungen, die alle Salden ausgleichen. */
  transfers: Transfer[]
  /** Kosten ohne angegebenen Zahler (z. B. gemeinsames Konto). */
  unpaidCostCents: number
  /** Summe aller Salden; 0, wenn alle Kosten einen Zahler haben und vollständig verteilt sind. */
  residualCents: number
}

export function computeBalances(dist: Pick<Distribution, 'persons'>, costs: CostEntry[], payments: Payment[]): BalanceResult {
  const map = new Map<string, PersonBalance>()
  const get = (id: string) => {
    let b = map.get(id)
    if (!b) {
      b = { personId: id, paidCents: 0, shareCents: 0, sentCents: 0, receivedCents: 0, balanceCents: 0 }
      map.set(id, b)
    }
    return b
  }
  for (const p of dist.persons) get(p.personId).shareCents += p.totalCents
  let unpaidCostCents = 0
  for (const c of costs) {
    if (c.paidBy) get(c.paidBy).paidCents += c.amountCents
    else unpaidCostCents += c.amountCents
  }
  for (const p of payments) {
    if (p.fromPersonId === p.toPersonId) continue
    get(p.fromPersonId).sentCents += p.amountCents
    get(p.toPersonId).receivedCents += p.amountCents
  }
  const balances = [...map.values()].map((b) => ({ ...b, balanceCents: b.paidCents - b.shareCents + b.sentCents - b.receivedCents }))
  const residualCents = balances.reduce((s, b) => s + b.balanceCents, 0)
  return { balances, transfers: suggestTransfers(balances), unpaidCostCents, residualCents }
}

/**
 * Greedy-Verfahren: größter Schuldner zahlt an größten Gläubiger. Ergibt höchstens n−1 Überweisungen.
 * Nur der ausgleichbare Teil wird vorgeschlagen (min. aus Summe der Guthaben und Summe der Schulden).
 */
export function suggestTransfers(balances: Pick<PersonBalance, 'personId' | 'balanceCents'>[]): Transfer[] {
  const debtors = balances.filter((b) => b.balanceCents < 0).map((b) => ({ id: b.personId, amt: -b.balanceCents }))
  const creditors = balances.filter((b) => b.balanceCents > 0).map((b) => ({ id: b.personId, amt: b.balanceCents }))
  const byAmt = (a: { id: string; amt: number }, b: { id: string; amt: number }) => b.amt - a.amt || a.id.localeCompare(b.id)
  debtors.sort(byAmt)
  creditors.sort(byAmt)
  const out: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].amt, creditors[j].amt)
    if (amt > 0) out.push({ fromPersonId: debtors[i].id, toPersonId: creditors[j].id, amountCents: amt })
    debtors[i].amt -= amt
    creditors[j].amt -= amt
    if (debtors[i].amt === 0) i++
    if (creditors[j].amt === 0) j++
  }
  return out
}
