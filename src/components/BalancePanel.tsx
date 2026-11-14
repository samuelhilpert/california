import { clsx } from 'clsx'
import { useState } from 'react'
import { ArrowRight, CheckCheck, HandCoins, Pencil, Plus, Repeat, Trash2 } from 'lucide-react'
import type { Settlement } from '../lib/domain/settlement'
import type { Payment, PaymentEntry, PaymentKind, Person } from '../lib/domain/types'
import { deletePayment, restoreRecord, savePayment } from '../lib/store/repo'
import { todayIso } from '../lib/domain/dates'
import { describeRecurrence } from '../lib/domain/recurrence'
import { formatDate, formatEuro } from '../lib/format'
import { Button, Card, CardTitle, Notice } from './ui'
import { PaymentModal } from './PaymentModal'
import { errorMessage, useFeedback } from './feedback-context'

/** Einzelzahlungen im Zeitraum, je Zahlung bzw. Dauerauftrag zusammengefasst. */
function groupPayments(entries: PaymentEntry[], payments: Payment[], kind: PaymentKind) {
  const byId = new Map(payments.map((p) => [p.id, p]))
  const groups = new Map<string, { payment: Payment; entries: PaymentEntry[]; cents: number }>()
  for (const e of entries) {
    if (e.kind !== kind) continue
    const payment = byId.get(e.paymentId)
    if (!payment) continue
    const g = groups.get(e.paymentId) ?? { payment, entries: [], cents: 0 }
    g.entries.push(e)
    g.cents += e.amountCents
    groups.set(e.paymentId, g)
  }
  return [...groups.values()].sort((a, b) => b.entries.at(-1)!.date.localeCompare(a.entries.at(-1)!.date))
}

export function BalancePanel({ s, persons, payments, periodLabel }: { s: Settlement; persons: Person[]; payments: Payment[]; periodLabel: string }) {
  const { toast, confirm } = useFeedback()
  const [payOpen, setPayOpen] = useState(false)
  const [payInit, setPayInit] = useState<Partial<Payment> | undefined>()
  const name = (id: string) => persons.find((p) => p.id === id)?.name ?? 'Unbekannt'
  const b = s.balance
  const rows = [...b.balances].sort((x, y) => y.balanceCents - x.balanceCents)
  const anyPaid = rows.some((r) => r.paidCents > 0) || s.payments.length > 0
  const anyAdvance = rows.some((r) => r.advanceSentCents > 0 || r.advanceReceivedCents > 0)
  const advanceGroups = groupPayments(s.payments, payments, 'advance')
  const settlementGroups = groupPayments(s.payments, payments, 'settlement')
  const edit = (p: Payment) => { setPayInit(p); setPayOpen(true) }

  const book = async (from: string, to: string, cents: number) => {
    const ok = await confirm({
      title: 'Zahlung als erledigt erfassen?',
      confirmLabel: 'Erfassen',
      message: <>{name(from)} zahlt <strong>{formatEuro(cents)}</strong> an {name(to)}. Die Zahlung wird mit heutigem Datum gespeichert.</>,
    })
    if (!ok) return
    try {
      const today = todayIso()
      const inPeriod = (!s.tripRange.from || today >= s.tripRange.from) && (!s.tripRange.to || today <= s.tripRange.to)
      // Liegt heute außerhalb des Abrechnungszeitraums, wird die Zahlung auf dessen Ende datiert, damit sie hier zählt.
      const date = inPeriod ? today : (s.tripRange.to ?? today)
      await savePayment({ kind: 'settlement', date, fromPersonId: from, toPersonId: to, amountCents: cents, note: `Ausgleich ${periodLabel}` })
      toast('Ausgleichszahlung wurde erfasst.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const remove = async (p: Payment) => {
    if (p.recurrence) {
      const ok = await confirm({
        title: 'Dauerauftrag löschen?',
        confirmLabel: 'Löschen',
        danger: true,
        message: <>Alle Zahlungen dieses Dauerauftrags ({name(p.fromPersonId)} → {name(p.toPersonId)}, {describeRecurrence(p)}) werden entfernt – auch die außerhalb des gewählten Zeitraums. Soll er nur enden, stattdessen beim Bearbeiten ein Enddatum setzen.</>,
      })
      if (!ok) return
    }
    try {
      const removed = await deletePayment(p.id)
      toast('Zahlung wurde gelöscht.', 'success', removed ? { label: 'Rückgängig', onClick: async () => { await restoreRecord('payments', removed); toast('Zahlung wurde wiederhergestellt.') } } : undefined)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Card padded={false}>
      <div className="p-5 pb-3">
        <CardTitle
          sub="Wer hat mehr bezahlt, als sein Anteil beträgt? Saldo = bezahlt − Anteil ± Vorauszahlungen ± Ausgleichszahlungen."
          action={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setPayInit(undefined); setPayOpen(true) }}>Zahlung erfassen</Button>}
        >
          <span className="flex items-center gap-2"><HandCoins className="h-5 w-5 text-brand-700" />Ausgleich</span>
        </CardTitle>
        {!anyPaid && (
          <Notice level="info">Bei den Kosten ist noch nicht hinterlegt, wer sie bezahlt hat. Trage bei den Ausgaben „Bezahlt von“ ein, dann berechnet die App, wer wem wie viel schuldet.</Notice>
        )}
      </div>
      {anyPaid && (
        <>
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Salden je Person">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Person</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Bezahlt</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Anteil</th>
                  {anyAdvance && <th className="hidden px-4 py-3 text-right sm:table-cell">Vorausgezahlt</th>}
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Ausgleich</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const net = r.sentCents - r.receivedCents
                  const adv = r.advanceSentCents - r.advanceReceivedCents
                  return (
                    <tr key={r.personId}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {name(r.personId)}
                        {/* Schmale Bildschirme: Details unter dem Namen statt eigener Spalten */}
                        <div className="tabular text-xs font-normal text-slate-500 sm:hidden">
                          bezahlt {formatEuro(r.paidCents)} · Anteil {formatEuro(r.shareCents)}
                          {adv !== 0 && <> · {adv > 0 ? 'vorausgezahlt' : 'Abschläge erhalten'} {formatEuro(Math.abs(adv))}</>}
                          {net !== 0 && <> · Ausgleich {net > 0 ? 'gezahlt' : 'erhalten'} {formatEuro(Math.abs(net))}</>}
                        </div>
                      </td>
                      <td className="tabular hidden px-4 py-3 text-right sm:table-cell">{formatEuro(r.paidCents)}</td>
                      <td className="tabular hidden px-4 py-3 text-right sm:table-cell">{formatEuro(r.shareCents)}</td>
                      {anyAdvance && <td className="tabular hidden px-4 py-3 text-right text-slate-500 sm:table-cell">{adv === 0 ? '–' : `${adv > 0 ? 'gezahlt' : 'erhalten'} ${formatEuro(Math.abs(adv))}`}</td>}
                      <td className="tabular hidden px-4 py-3 text-right text-slate-500 sm:table-cell">{net === 0 ? '–' : `${net > 0 ? 'gezahlt' : 'erhalten'} ${formatEuro(Math.abs(net))}`}</td>
                      <td className={clsx('tabular px-4 py-3 text-right font-semibold', r.balanceCents > 0 ? 'text-emerald-700' : r.balanceCents < 0 ? 'text-red-700' : 'text-slate-500')}>
                        {r.balanceCents > 0 ? '+' : r.balanceCents < 0 ? '−' : ''}{formatEuro(Math.abs(r.balanceCents))}
                        <div className="text-xs font-normal text-slate-500">{r.balanceCents > 0 ? 'bekommt' : r.balanceCents < 0 ? 'zahlt' : 'ausgeglichen'}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 p-5">
            {b.transfers.length === 0 ? (
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700"><CheckCheck className="h-4 w-4" />Alle Salden sind ausgeglichen.</div>
            ) : (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-800">Vorschlag zum Ausgleich ({b.transfers.length} Überweisung{b.transfers.length > 1 ? 'en' : ''})</div>
                <ul className="space-y-2">
                  {b.transfers.map((t) => (
                    <li key={`${t.fromPersonId}-${t.toPersonId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <span className="flex items-center gap-2 text-sm">
                        <strong>{name(t.fromPersonId)}</strong><ArrowRight className="h-4 w-4 text-slate-500" /><strong>{name(t.toPersonId)}</strong>
                        <span className="tabular font-semibold">{formatEuro(t.amountCents)}</span>
                      </span>
                      <Button size="sm" onClick={() => void book(t.fromPersonId, t.toPersonId, t.amountCents)}>Als bezahlt erfassen</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {b.unpaidCostCents > 0 && (
              <p className="text-xs text-slate-500">{formatEuro(b.unpaidCostCents)} Kosten haben keinen Zahler (z. B. gemeinsames Konto) und sind im Ausgleich nicht berücksichtigt.</p>
            )}
            {s.undistributedCents > 0 && (
              <p className="text-xs text-amber-700">{formatEuro(s.undistributedCents)} Kosten wurden nicht verteilt. Die Salden gehen daher nicht vollständig auf.</p>
            )}
          </div>
        </>
      )}
      {advanceGroups.length > 0 && <PaymentList title="Vorauszahlungen im Zeitraum" groups={advanceGroups} name={name} onEdit={edit} onRemove={(p) => void remove(p)} />}
      {settlementGroups.length > 0 && <PaymentList title="Ausgleichszahlungen im Zeitraum" groups={settlementGroups} name={name} onEdit={edit} onRemove={(p) => void remove(p)} />}
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} persons={persons} initial={payInit} />
    </Card>
  )
}

function PaymentList({ title, groups, name, onEdit, onRemove }: {
  title: string
  groups: ReturnType<typeof groupPayments>
  name: (id: string) => string
  onEdit: (p: Payment) => void
  onRemove: (p: Payment) => void
}) {
  return (
    <div className="border-t border-slate-100 px-5 py-4">
      <div className="mb-2 text-sm font-medium text-slate-800">{title}</div>
      <ul className="divide-y divide-slate-100 text-sm">
        {groups.map(({ payment: p, entries, cents }) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block">
                {p.recurrence && <Repeat className="mr-1.5 inline h-3.5 w-3.5 align-[-2px] text-slate-500" aria-label="Dauerauftrag" />}
                {p.recurrence ? `ab ${formatDate(p.date)}` : formatDate(p.date)} · {name(p.fromPersonId)} → {name(p.toPersonId)}
                {p.note && <span className="text-slate-500"> · {p.note}</span>}
              </span>
              {p.recurrence && <span className="block text-xs text-slate-500">{formatEuro(p.amountCents)} {describeRecurrence(p)} · im Zeitraum {entries.length}×</span>}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <span className="tabular font-medium">{formatEuro(cents)}</span>
              <Button variant="ghost" size="icon" onClick={() => onEdit(p)} aria-label="Zahlung bearbeiten" title="Bearbeiten"><Pencil className="h-4 w-4" /></Button>
              <Button variant="danger-ghost" size="icon" onClick={() => onRemove(p)} aria-label={p.recurrence ? 'Dauerauftrag löschen' : 'Zahlung löschen'}><Trash2 className="h-4 w-4" /></Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
