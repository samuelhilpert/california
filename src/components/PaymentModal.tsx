import { useState } from 'react'
import type { Payment, Person } from '../lib/domain/types'
import { parseEuroInput } from '../lib/domain/money'
import { hasErrors, validatePayment, type FieldErrors, type PaymentDraft } from '../lib/domain/validation'
import { savePayment, ValidationError } from '../lib/store/repo'
import { todayIso } from '../lib/domain/dates'
import { centsToInput } from '../lib/format'
import { Button, Field, Input, Modal, Select } from './ui'
import { errorMessage, useFeedback } from './feedback-context'

export function PaymentModal({ open, onClose, persons, initial }: { open: boolean; onClose: () => void; persons: Person[]; initial?: Partial<Payment> }) {
  if (!open) return null
  return <PaymentForm key={JSON.stringify(initial ?? {})} onClose={onClose} persons={persons} initial={initial} />
}

function PaymentForm({ onClose, persons, initial }: { onClose: () => void; persons: Person[]; initial?: Partial<Payment> }) {
  const { toast } = useFeedback()
  const [date, setDate] = useState(initial?.date ?? todayIso())
  const [from, setFrom] = useState(initial?.fromPersonId ?? '')
  const [to, setTo] = useState(initial?.toPersonId ?? '')
  const [amount, setAmount] = useState(centsToInput(initial?.amountCents))
  const [note, setNote] = useState(initial?.note ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const visible = persons.filter((p) => p.active || p.id === from || p.id === to)

  const submit = async () => {
    const cents = parseEuroInput(amount)
    const draft: PaymentDraft = { date, fromPersonId: from, toPersonId: to, amountCents: cents as number, note: note || undefined }
    const e = validatePayment(draft)
    setErrors(e)
    if (hasErrors(e)) return
    try {
      await savePayment(draft, initial?.id)
      toast('Ausgleichszahlung wurde erfasst.')
      onClose()
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.fields)
      else toast(errorMessage(err), 'error')
    }
  }

  return (
    <Modal open onClose={onClose} title={initial?.id ? 'Zahlung bearbeiten' : 'Ausgleichszahlung erfassen'} description="Geld, das eine Person einer anderen zum Ausgleich überwiesen oder bar gegeben hat."
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" onClick={() => void submit()}>Speichern</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void submit() }}>
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
        <Field label="Betrag" htmlFor="pay-amount" error={errors.amountCents}>
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="€" placeholder="0,00" invalid={!!errors.amountCents} />
        </Field>
        <Field label="Datum" htmlFor="pay-date" error={errors.date}>
          <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errors.date} />
        </Field>
        <Field label="Notiz" htmlFor="pay-note" optional className="sm:col-span-2">
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="z. B. PayPal, bar" />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
