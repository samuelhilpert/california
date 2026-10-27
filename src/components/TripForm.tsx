import { useMemo, useState } from 'react'
import { ArrowRight, Calculator } from 'lucide-react'
import type { Person, Trip } from '../lib/domain/types'
import { parseNumberInput } from '../lib/domain/money'
import { resolveTripKm, validateTrip, hasErrors, type FieldErrors, type TripDraft } from '../lib/domain/validation'
import { saveTrip, ValidationError } from '../lib/db/repo'
import { todayIso } from '../lib/domain/dates'
import { formatInt, numberToInput } from '../lib/format'
import { Button, Field, Input, Modal, Textarea } from './ui'
import { PersonMultiSelect } from './PersonMultiSelect'
import { errorMessage, useFeedback } from './feedback-context'

interface Props {
  open: boolean
  onClose: () => void
  trip?: Trip
  persons: Person[]
  trips: Trip[]
}

export function TripFormModal(props: Props) {
  // Neu mounten, wenn sich die bearbeitete Fahrt ändert – damit der Formularzustand frisch ist.
  if (!props.open) return null
  return <TripForm key={props.trip?.id ?? 'new'} {...props} />
}

function TripForm({ onClose, trip, persons, trips }: Props) {
  const { toast } = useFeedback()
  const lastOdo = useMemo(() => {
    const withOdo = trips.filter((t) => t.odoEnd != null && t.id !== trip?.id)
    withOdo.sort((a, b) => (a.startDate === b.startDate ? (a.odoEnd! - b.odoEnd!) : a.startDate < b.startDate ? -1 : 1))
    return withOdo.at(-1)?.odoEnd
  }, [trips, trip])

  const [startDate, setStartDate] = useState(trip?.startDate ?? todayIso())
  const [endDate, setEndDate] = useState(trip?.endDate ?? '')
  const [from, setFrom] = useState(trip?.from ?? '')
  const [to, setTo] = useState(trip?.to ?? '')
  const [odoStart, setOdoStart] = useState(numberToInput(trip?.odoStart))
  const [odoEnd, setOdoEnd] = useState(numberToInput(trip?.odoEnd))
  const [kmInput, setKmInput] = useState(numberToInput(trip?.km))
  const [personIds, setPersonIds] = useState<string[]>(trip?.personIds ?? [])
  const [note, setNote] = useState(trip?.note ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const o1 = odoStart.trim() ? parseNumberInput(odoStart) : undefined
  const o2 = odoEnd.trim() ? parseNumberInput(odoEnd) : undefined
  const manual = kmInput.trim() ? parseNumberInput(kmInput) : undefined
  const autoKm = o1 != null && o2 != null
  const km = resolveTripKm(o1 ?? undefined, o2 ?? undefined, manual ?? undefined)

  const buildDraft = (): { draft: TripDraft; parseErrors: FieldErrors } => {
    const parseErrors: FieldErrors = {}
    if (o1 === null) parseErrors.odoStart = 'Bitte eine Zahl eingeben.'
    if (o2 === null) parseErrors.odoEnd = 'Bitte eine Zahl eingeben.'
    if (!autoKm && manual === null) parseErrors.km = 'Bitte eine Zahl eingeben, z. B. 125 oder 12,5.'
    return {
      draft: {
        startDate,
        endDate: endDate || undefined,
        from: from || undefined,
        to: to || undefined,
        odoStart: o1 ?? undefined,
        odoEnd: o2 ?? undefined,
        km: km as number,
        personIds,
        note: note || undefined,
      },
      parseErrors,
    }
  }

  const submit = async () => {
    const { draft, parseErrors } = buildDraft()
    const all = { ...validateTrip(draft), ...parseErrors }
    setErrors(all)
    if (hasErrors(all)) return
    setSaving(true)
    try {
      await saveTrip(draft, trip?.id)
      toast(trip ? 'Fahrt wurde aktualisiert.' : 'Fahrt wurde gespeichert.')
      onClose()
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields)
      else toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={trip ? 'Fahrt bearbeiten' : 'Neue Fahrt'}
      description="Jede Fahrt zählt einmal mit ihren Kilometern – egal wie viele Personen beteiligt sind."
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {trip ? 'Änderungen speichern' : 'Fahrt speichern'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Startdatum" htmlFor="t-start" error={errors.startDate}>
            <Input id="t-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} invalid={!!errors.startDate} required />
          </Field>
          <Field label="Enddatum" htmlFor="t-end" optional error={errors.endDate} hint="Bei mehrtägigen Fahrten">
            <Input id="t-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} invalid={!!errors.endDate} />
          </Field>
        </div>

        <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="Startort" htmlFor="t-from" optional>
            <Input id="t-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="z. B. München" maxLength={120} />
          </Field>
          <ArrowRight className="mb-3 hidden h-4 w-4 text-slate-400 sm:block" />
          <Field label="Zielort" htmlFor="t-to" optional>
            <Input id="t-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="z. B. Gardasee" maxLength={120} />
          </Field>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Kilometerstand Beginn"
              htmlFor="t-o1"
              optional
              error={errors.odoStart}
              hint={
                lastOdo != null && !odoStart ? (
                  <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setOdoStart(String(lastOdo))}>
                    Letzten Stand übernehmen ({formatInt(lastOdo)})
                  </button>
                ) : undefined
              }
            >
              <Input id="t-o1" inputMode="decimal" value={odoStart} onChange={(e) => setOdoStart(e.target.value)} invalid={!!errors.odoStart} suffix="km" />
            </Field>
            <Field label="Kilometerstand Ende" htmlFor="t-o2" optional error={errors.odoEnd}>
              <Input id="t-o2" inputMode="decimal" value={odoEnd} onChange={(e) => setOdoEnd(e.target.value)} invalid={!!errors.odoEnd} suffix="km" />
            </Field>
            <Field
              label="Gefahrene Kilometer"
              htmlFor="t-km"
              error={errors.km}
              hint={autoKm ? <span className="inline-flex items-center gap-1"><Calculator className="h-3 w-3" /> aus Kilometerständen berechnet</span> : 'Direkt eingeben oder beide Stände ausfüllen'}
            >
              <Input
                id="t-km"
                inputMode="decimal"
                value={autoKm ? numberToInput(km) : kmInput}
                onChange={(e) => setKmInput(e.target.value)}
                readOnly={autoKm}
                className={autoKm ? 'bg-slate-100 font-medium' : undefined}
                invalid={!!errors.km}
                suffix="km"
              />
            </Field>
          </div>
        </div>

        <Field label="Beteiligte Personen" error={errors.personIds} hint="Die Fahrtkosten werden zu gleichen Teilen auf alle Beteiligten verteilt.">
          <PersonMultiSelect persons={persons} value={personIds} onChange={setPersonIds} invalid={!!errors.personIds} />
        </Field>

        <Field label="Notiz" htmlFor="t-note" optional>
          <Textarea id="t-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="z. B. Urlaub, Werkstattfahrt …" />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
