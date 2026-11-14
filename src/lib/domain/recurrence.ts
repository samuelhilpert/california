import { allocateCents } from './allocate'
import { addMonths, monthKey, parseIso, yearKey } from './dates'
import { formatDate } from '../format'
import type { CostEntry, Expense, IsoDate, Payment, PaymentEntry, Recurrence } from './types'

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
  if (!expense.recurrence) return spread([{ ...base, id: expense.id, date: expense.date }], expense.spreadMonths)
  const out = occurrences(expense.date, expense.recurrence, horizon).map(({ date, period }) => ({ ...base, id: `${expense.id}#${period}`, period, date }))
  return spread(out, expense.spreadMonths)
}

/**
 * Erzeugt aus einer Zahlung die konkreten Einzelzahlungen – bei Daueraufträgen je Fälligkeit
 * mit der stabilen ID `<paymentId>#<Periode>` (wie bei wiederkehrenden Kosten).
 */
function expandPayment(payment: Payment, horizon: IsoDate): PaymentEntry[] {
  const base = {
    paymentId: payment.id,
    kind: payment.kind ?? 'settlement',
    fromPersonId: payment.fromPersonId,
    toPersonId: payment.toPersonId,
    amountCents: payment.amountCents,
    ...(payment.note ? { note: payment.note } : {}),
  }
  if (!payment.recurrence) return [{ ...base, id: payment.id, date: payment.date }]
  return occurrences(payment.date, payment.recurrence, horizon).map(({ date, period }) => ({ ...base, id: `${payment.id}#${period}`, period, date }))
}

export function expandPayments(payments: Payment[], horizon: IsoDate): PaymentEntry[] {
  return payments.flatMap((p) => expandPayment(p, horizon))
}

/** Fälligkeiten einer Wiederholung; je Periode (Monat bzw. Jahr) höchstens eine. */
function occurrences(start: IsoDate, rec: Recurrence, horizon: IsoDate): { date: IsoDate; period: string }[] {
  const step = rec.frequency === 'monthly' ? 1 : 12
  const anchorDay = parseIso(start).day
  const limit = rec.count && rec.count > 0 ? Math.min(rec.count, MAX_OCCURRENCES) : MAX_OCCURRENCES
  const bounded = Boolean(rec.count && rec.count > 0) || Boolean(rec.until)
  const out: { date: IsoDate; period: string }[] = []
  const seen = new Set<string>()
  for (let i = 0; i < limit; i++) {
    const date = addMonths(start, i * step, anchorDay)
    if (rec.until && date > rec.until) break
    if (!bounded && date > horizon) break
    const period = rec.frequency === 'monthly' ? monthKey(date) : yearKey(date)
    if (seen.has(period)) continue
    seen.add(period)
    out.push({ date, period })
  }
  return out
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

/** Kurzbeschreibung der Wiederholung einer Ausgabe oder Zahlung, z. B. „monatlich, 24×“. */
export function describeRecurrence(item: { recurrence?: Recurrence; spreadMonths?: number }): string {
  const r = item.recurrence
  const sp = item.spreadMonths && item.spreadMonths > 1 ? `, verteilt auf ${item.spreadMonths} Monate` : ''
  if (!r) return `Einmalig${sp}`
  const f = r.frequency === 'monthly' ? 'monatlich' : 'jährlich'
  if (r.count) return `${f}, ${r.count}×${sp}`
  if (r.until) return `${f} bis ${formatDate(r.until)}${sp}`
  return `${f}, unbefristet${sp}`
}
