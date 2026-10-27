import { clsx } from 'clsx'
import { useState } from 'react'
import { ArrowRight, CheckCheck, HandCoins, Plus, Trash2 } from 'lucide-react'
import type { Settlement } from '../lib/domain/settlement'
import type { Payment, Person } from '../lib/domain/types'
import { deletePayment, restoreRecord, savePayment } from '../lib/store/repo'
import { todayIso } from '../lib/domain/dates'
import { formatDate, formatEuro } from '../lib/format'
import { Button, Card, CardTitle, Notice } from './ui'
import { PaymentModal } from './PaymentModal'
import { errorMessage, useFeedback } from './feedback-context'

export function BalancePanel({ s, persons, periodLabel }: { s: Settlement; persons: Person[]; periodLabel: string }) {
  const { toast, confirm } = useFeedback()
  const [payOpen, setPayOpen] = useState(false)
  const [payInit, setPayInit] = useState<Partial<Payment> | undefined>()
  const name = (id: string) => persons.find((p) => p.id === id)?.name ?? 'Unbekannt'
  const b = s.balance
  const rows = [...b.balances].sort((x, y) => y.balanceCents - x.balanceCents)
  const anyPaid = rows.some((r) => r.paidCents > 0) || s.payments.length > 0

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
      await savePayment({ date, fromPersonId: from, toPersonId: to, amountCents: cents, note: `Ausgleich ${periodLabel}` })
      toast('Ausgleichszahlung wurde erfasst.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const remove = async (p: Payment) => {
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
          sub="Wer hat mehr bezahlt, als sein Anteil beträgt? Saldo = bezahlt − Anteil ± Ausgleichszahlungen."
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3 text-right">Bezahlt</th>
                  <th className="px-4 py-3 text-right">Anteil</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Ausgleich</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const net = r.sentCents - r.receivedCents
                  return (
                    <tr key={r.personId}>
                      <td className="px-4 py-3 font-medium text-slate-900">{name(r.personId)}</td>
                      <td className="tabular px-4 py-3 text-right">{formatEuro(r.paidCents)}</td>
                      <td className="tabular px-4 py-3 text-right">{formatEuro(r.shareCents)}</td>
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
      {s.payments.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="mb-2 text-sm font-medium text-slate-800">Ausgleichszahlungen im Zeitraum</div>
          <ul className="divide-y divide-slate-100 text-sm">
            {[...s.payments].sort((x, y) => y.date.localeCompare(x.date)).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span>{formatDate(p.date)} · {name(p.fromPersonId)} → {name(p.toPersonId)}{p.note && <span className="text-slate-500"> · {p.note}</span>}</span>
                <span className="flex items-center gap-1">
                  <span className="tabular font-medium">{formatEuro(p.amountCents)}</span>
                  <Button variant="danger-ghost" size="icon" onClick={() => void remove(p)} aria-label="Zahlung löschen"><Trash2 className="h-4 w-4" /></Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} persons={persons} initial={payInit} />
    </Card>
  )
}
