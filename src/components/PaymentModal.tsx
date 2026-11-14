import { useState } from 'react'
import type { Frequency, Payment, PaymentKind, Person } from '../lib/domain/types'
import { parseEuroInput } from '../lib/domain/money'
import { hasErrors, validatePayment, type FieldErrors, type PaymentDraft } from '../lib/domain/validation'
import { expandPayments } from '../lib/domain/recurrence'
import { savePayment, ValidationError } from '../lib/store/repo'
import { todayIso } from '../lib/domain/dates'
import { centsToInput, formatDate, formatEuro } from '../lib/format'
import { Button, Field, Input, Modal, Select } from './ui'
import { errorMessage, useFeedback } from './feedback-context'

export function PaymentModal({ open, onClose, persons, initial }: { open: boolean; onClose: () => void; persons: Person[]; initial?: Partial<Payment> }) {
  if (!open) return null
  return <PaymentForm key={JSON.stringify(initial ?? {})} onClose={onClose} persons={persons} initial={initial} />
}

type RepeatMode = 'once' | Frequency
type EndMode = 'open' | 'count' | 'until'

function PaymentForm({ onClose, persons, initial }: { onClose: () => void; persons: Person[]; initial?: Partial<Payment> }) {
  const { toast } = useFeedback()
  const editing = Boolean(initial?.id)
  // Neue Zahlungen sind meist Abschläge; ältere Zahlungen ohne Art sind Ausgleichszahlungen.
  const [kind, setKind] = useState<PaymentKind>(initial?.kind ?? (editing ? 'settlement' : 'advance'))
  const [date, setDate] = useState(initial?.date ?? todayIso())
  const [from, setFrom] = useState(initial?.fromPersonId ?? '')
  const [to, setTo] = useState(initial?.toPersonId ?? '')
  const [amount, setAmount] = useState(centsToInput(initial?.amountCents))
  const [repeat, setRepeat] = useState<RepeatMode>(initial?.recurrence?.frequency ?? 'once')
  const [endMode, setEndMode] = useState<EndMode>(initial?.recurrence ? (initial.recurrence.count ? 'count' : initial.recurrence.until ? 'until' : 'open') : 'count')
  const [count, setCount] = useState(String(initial?.recurrence?.count ?? 24))
  const [until, setUntil] = useState(initial?.recurrence?.until ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const visible = persons.filter((p) => p.active || p.id === from || p.id === to)
  const recurring = kind === 'advance' && repeat !== 'once'

  const cents = parseEuroInput(amount)
  const draft: PaymentDraft = {
    kind,
    date,
    fromPersonId: from,
    toPersonId: to,
    amountCents: cents as number,
    recurrence: recurring
      ? { frequency: repeat, count: endMode === 'count' ? Number(count) : undefined, until: endMode === 'until' ? until || undefined : undefined }
      : undefined,
    note: note || undefined,
  }

  // Vorschau: wie viele Abschläge mit welcher Summe ergeben sich?
  const preview = (() => {
    if (!recurring || cents == null || cents <= 0 || !date) return null
    if (endMode === 'count' && !(Number(count) >= 1)) return null
    if (endMode === 'until' && !until) return null
    const list = expandPayments([{ ...draft, id: 'preview', createdAt: '', updatedAt: '' }], todayIso())
    return list.length ? { open: endMode === 'open', list } : null
  })()

  const submit = async () => {
    const parseErr: FieldErrors = {}
    if (amount.trim() && cents == null) parseErr.amountCents = 'Bitte einen gültigen Betrag eingeben, z. B. 200,00.'
    if (recurring && endMode === 'until' && !until) parseErr.recurrenceUntil = 'Bitte ein Enddatum wählen.'
    const e = { ...validatePayment(draft), ...parseErr }
    setErrors(e)
    if (hasErrors(e)) return
    try {
      await savePayment(draft, initial?.id)
      toast(kind === 'advance' ? (recurring ? 'Dauerauftrag wurde gespeichert.' : 'Vorauszahlung wurde gespeichert.') : 'Ausgleichszahlung wurde gespeichert.')
      onClose()
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.fields)
      else toast(errorMessage(err), 'error')
    }
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Zahlung bearbeiten' : 'Zahlung erfassen'}
      description="Geld, das eine Person einer anderen gibt – als Abschlag im Voraus oder zum Ausgleich nach einer Abrechnung. Beides wird im Saldo angerechnet."
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" onClick={() => void submit()}>Speichern</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Field label="Art" htmlFor="pay-kind" className="sm:col-span-2"
          hint={kind === 'advance' ? 'Fester Betrag vorab, z. B. monatlich an die Person, die die Leasingrate zahlt. Abgerechnet wird trotzdem nach Kilometern.' : 'Überweisung, mit der ein Saldo aus einer Abrechnung beglichen wird.'}>
          <Select id="pay-kind" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
            <option value="advance">Vorauszahlung (Abschlag)</option>
            <option value="settlement">Ausgleichszahlung</option>
          </Select>
        </Field>
        <Field label="Von (zahlt)" htmlFor="pay-from" error={errors.fromPersonId}>
          <Select id="pay-from" value={from} onChange={(e) => setFrom(e.target.value)} invalid={!!errors.fromPersonId}>
            <option value="">Bitte wählen</option>
            {visible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="An (erhält)" htmlFor="pay-to" error={errors.toPersonId}>
          <Select id="pay-to" value={to} onChange={(e) => setTo(e.target.value)} invalid={!!errors.toPersonId}>
            <option value="">Bitte wählen</option>
            {visible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label={recurring ? 'Betrag je Zahlung' : 'Betrag'} htmlFor="pay-amount" error={errors.amountCents}>
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="€" placeholder="0,00" invalid={!!errors.amountCents} />
        </Field>
        <Field label={recurring ? 'Erste Zahlung' : 'Datum'} htmlFor="pay-date" error={errors.date}>
          <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errors.date} />
        </Field>
        {kind === 'advance' && (
          <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:col-span-2">
            <Field label="Wiederholung" htmlFor="pay-repeat" className="sm:max-w-[50%]" error={errors.recurrence}>
              <Select id="pay-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatMode)}>
                <option value="once">Einmalig</option>
                <option value="monthly">Monatlich (Dauerauftrag)</option>
                <option value="yearly">Jährlich (Dauerauftrag)</option>
              </Select>
            </Field>
            {repeat !== 'once' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Laufzeit" htmlFor="pay-end">
                  <Select id="pay-end" value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)}>
                    <option value="count">Feste Anzahl</option>
                    <option value="until">Bis Datum</option>
                    <option value="open">Unbefristet</option>
                  </Select>
                </Field>
                {endMode === 'count' && (
                  <Field label="Anzahl Zahlungen" htmlFor="pay-count" error={errors.recurrenceCount}>
                    <Input id="pay-count" type="number" min={1} max={1200} value={count} onChange={(e) => setCount(e.target.value)} invalid={!!errors.recurrenceCount} />
                  </Field>
                )}
                {endMode === 'until' && (
                  <Field label="Letzte Zahlung spätestens" htmlFor="pay-until" error={errors.recurrenceUntil}>
                    <Input id="pay-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} invalid={!!errors.recurrenceUntil} />
                  </Field>
                )}
              </div>
            )}
            {preview && (
              <p className="text-sm text-slate-600">
                {preview.open
                  ? <>Bis heute {preview.list.length} Zahlung(en) · {formatEuro(preview.list.length * (cents ?? 0))}. Weitere zählen automatisch, sobald sie fällig sind.</>
                  : <>{preview.list.length} Zahlungen von {formatDate(preview.list[0].date)} bis {formatDate(preview.list.at(-1)!.date)} · gesamt <strong>{formatEuro(preview.list.length * (cents ?? 0))}</strong></>}
              </p>
            )}
          </div>
        )}
        <Field label="Notiz" htmlFor="pay-note" optional className="sm:col-span-2">
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="z. B. Dauerauftrag Leasing, PayPal, bar" />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
