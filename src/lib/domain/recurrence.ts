import { allocateCents } from './allocate'
import { addMonths, monthKey, parseIso, yearKey } from './dates'
import type { CostEntry, Expense, IsoDate } from './types'

/** Sicherheitsgrenze gegen Endlosschleifen bei fehlerhaften Daten (100 Jahre monatlich). */
const MAX_OCCURRENCES = 1200

/**
 * Erzeugt aus einer Ausgabe die konkreten Kostenbuchungen.
 *
 * Wiederkehrende Kosten werden NICHT als Einzeldatensätze gespeichert, sondern bei jeder
 * Berechnung deterministisch abgeleitet. Jede Fälligkeit erhält die stabile ID
 * `<expenseId>#<Periode>`; eine Periode kann je Ausgabe nur einmal vorkommen.
 * Dadurch sind Doppelbuchungen durch Neuladen oder Neuberechnen ausgeschlossen.
 *
 * @param horizon bis zu welchem Datum unbegrenzte Wiederholungen (ohne Anzahl und Enddatum) erzeugt werden
 */
export function expandExpense(expense: Expense, horizon: IsoDate): CostEntry[] {
  const base = {
    expenseId: expense.id,
    title: expense.title,
    categoryId: expense.categoryId,
    amountCents: expense.amountCents,
    allocation: expense.allocation,
    directPersonIds: expense.allocation === 'direct' ? [...(expense.directPersonIds ?? [])] : [],
    ...(expense.paidBy ? { paidBy: expense.paidBy } : {}),
  }
  const rec = expense.recurrence
  if (!rec) return spread([{ ...base, id: expense.id, date: expense.date }], expense.spreadMonths)

  const step = rec.frequency === 'monthly' ? 1 : 12
  const anchorDay = parseIso(expense.date).day
  const limit = rec.count && rec.count > 0 ? Math.min(rec.count, MAX_OCCURRENCES) : MAX_OCCURRENCES
  const bounded = Boolean(rec.count && rec.count > 0) || Boolean(rec.until)
  const out: CostEntry[] = []
  const seen = new Set<string>()
  for (let i = 0; i < limit; i++) {
    const date = addMonths(expense.date, i * step, anchorDay)
    if (rec.until && date > rec.until) break
    if (!bounded && date > horizon) break
    const period = rec.frequency === 'monthly' ? monthKey(date) : yearKey(date)
    if (seen.has(period)) continue
    seen.add(period)
    out.push({ ...base, id: `${expense.id}#${period}`, period, date })
  }
  return spread(out, expense.spreadMonths)
}

/**
 * Verteilt jede Buchung centgenau auf `months` aufeinanderfolgende Monate (ab dem Monat der Fälligkeit).
 * Die Teilbuchungen erhalten stabile IDs `<buchungs-id>@<JJJJ-MM>` und das Datum des jeweils
 * Ersten des Monats (im ersten Monat das Fälligkeitsdatum).
 */
function spread(entries: CostEntry[], months?: number): CostEntry[] {
  if (!months || months <= 1) return entries
  const n = Math.min(Math.floor(months), 120)
  return entries.flatMap((e) => {
    const parts = allocateCents(e.amountCents, Array(n).fill(1))
    const first = `${e.date.slice(0, 7)}-01`
    return parts.map((cents, i) => {
      const date = i === 0 ? e.date : addMonths(first, i)
      const period = monthKey(date)
      return { ...e, id: `${e.id}@${period}`, period, date, amountCents: cents, spread: { index: i + 1, of: n } }
    })
  })
}

export function expandExpenses(expenses: Expense[], horizon: IsoDate): CostEntry[] {
  return expenses.flatMap((e) => expandExpense(e, horizon))
}

/** Gesamtsumme einer Ausgabe über die volle Laufzeit (nur bei begrenzten Wiederholungen eindeutig). */
export function describeRecurrence(expense: Expense): string {
  const r = expense.recurrence
  const sp = expense.spreadMonths && expense.spreadMonths > 1 ? `, verteilt auf ${expense.spreadMonths} Monate` : ''
  if (!r) return `Einmalig${sp}`
  const f = r.frequency === 'monthly' ? 'monatlich' : 'jährlich'
  if (r.count) return `${f}, ${r.count}×${sp}`
  if (r.until) return `${f} bis ${r.until.split('-').reverse().join('.')}${sp}`
  return `${f}, unbefristet${sp}`
}
