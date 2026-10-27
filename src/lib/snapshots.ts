import type { Category, Person, SettlementSnapshot } from './domain/types'
import { buildSettlement, type Settlement } from './domain/settlement'
import type { AppData } from './store/types'
import { formatEuro, formatKm } from './format'

export function snapshotPersons(snap: SettlementSnapshot): Person[] {
  return Object.entries(snap.personNames).map(([id, name]) => ({ id, name, active: true, createdAt: '' }))
}
export function snapshotCategories(snap: SettlementSnapshot): Category[] {
  return Object.entries(snap.categoryNames).map(([id, name]) => ({ id, name, builtin: false, color: '#94a3b8' }))
}

export interface Deviation {
  label: string
  before: string
  now: string
}

/** Vergleicht eine abgeschlossene Abrechnung mit einer Neuberechnung aus dem aktuellen Datenstand. */
export function compareWithCurrent(snap: SettlementSnapshot, data: AppData, today: string): Deviation[] {
  const old = snap.result as Settlement
  const cur = buildSettlement(data, { period: snap.period, costPeriod: snap.costPeriod, today })
  const out: Deviation[] = []
  if (old.totalCostCents !== cur.totalCostCents) out.push({ label: 'Gesamtkosten', before: formatEuro(old.totalCostCents), now: formatEuro(cur.totalCostCents) })
  if (Math.abs(old.totalKm - cur.totalKm) > 1e-6) out.push({ label: 'Gesamtkilometer', before: formatKm(old.totalKm), now: formatKm(cur.totalKm) })
  const ids = new Set([...old.persons.map((p) => p.personId), ...cur.persons.map((p) => p.personId)])
  for (const id of ids) {
    const a = old.persons.find((p) => p.personId === id)?.totalCents ?? 0
    const b = cur.persons.find((p) => p.personId === id)?.totalCents ?? 0
    if (a !== b) out.push({ label: `Anteil ${snap.personNames[id] ?? data.persons.find((p) => p.id === id)?.name ?? 'Unbekannt'}`, before: formatEuro(a), now: formatEuro(b) })
  }
  return out
}

