import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import { ArrowRight, Calculator } from 'lucide-react'
import type { Person, SettlementSnapshot, Trip } from '../lib/domain/types'
import { findSimilarTrips } from '../lib/domain/tripChecks'
import { inRange, resolvePeriod } from '../lib/domain/period'
import { parseEuroInput, parseNumberInput } from '../lib/domain/money'
import { resolveTripKm, validateTrip, hasErrors, type FieldErrors, type TripDraft } from '../lib/domain/validation'
import { registeredPersonIds, saveTrip, ValidationError } from '../lib/store/repo'
import { todayIso } from '../lib/domain/dates'
import { centsToInput, formatDate, formatEuro, formatInt, formatKm, numberToInput } from '../lib/format'
import { Button, Disclosure, Field, Input, Modal, Notice, Select, Textarea } from './ui'
import { PersonMultiSelect } from './PersonMultiSelect'
import { errorMessage, useFeedback } from './feedback-context'
import { useAppData, useMyPerson, useProMode } from '../lib/store/context'

interface Props {
  open: boolean
  onClose: () => void
  trip?: Trip
  persons: Person[]
  trips: Trip[]
  /** Abgeschlossene Abrechnungen – für den Hinweis bei Änderungen in einem abgeschlossenen Zeitraum. */
  settlements?: SettlementSnapshot[]
  /** Vorbelegung für eine neue Fahrt (z. B. beim Nachtragen einer Kilometerlücke). */
  prefill?: Partial<Trip>
  /** Wird nach erfolgreichem Speichern aufgerufen (z. B. um einen Kalenderplan zu entfernen). */
  onSaved?: (trip: Trip) => void
}

export function TripFormModal(props: Props) {
  // Neu mounten, wenn sich die bearbeitete Fahrt ändert – damit der Formularzustand frisch ist.
  if (!props.open) return null
  return <TripForm key={props.trip?.id ?? JSON.stringify(props.prefill ?? 'new')} {...props} />
}

function TripForm({ onClose, trip, persons, trips, settlements = [], prefill, onSaved }: Props) {
  const { toast, confirm } = useFeedback()
  const init = trip ?? prefill
  const me = useMyPerson()
  const [pro] = useProMode()
  const lastOdo = useMemo(() => {
    const withOdo = trips.filter((t) => t.odoEnd != null && t.id !== trip?.id)
    withOdo.sort((a, b) => (a.startDate === b.startDate ? (a.odoEnd! - b.odoEnd!) : a.startDate < b.startDate ? -1 : 1))
    return withOdo.at(-1)?.odoEnd
  }, [trips, trip])

  const [startDate, setStartDate] = useState(init?.startDate ?? todayIso())
  // Ohne Angabe eine Tagesfahrt: Enddatum = Startdatum
  const [endDate, setEndDate] = useState(init?.endDate ?? init?.startDate ?? todayIso())
  const [from, setFrom] = useState(init?.from ?? '')
  const [to, setTo] = useState(init?.to ?? '')
  const [stops, setStops] = useState(init?.stops?.join(', ') ?? '')
  // Neue Fahrt: Startstand = Endstand der letzten Fahrt, damit meist nur noch der Endstand fehlt.
  const prefilledOdo = !init && lastOdo != null
  const [odoStart, setOdoStart] = useState(prefilledOdo ? numberToInput(lastOdo) : numberToInput(init?.odoStart))
  const [odoEnd, setOdoEnd] = useState(numberToInput(init?.odoEnd))
  const [kmInput, setKmInput] = useState(numberToInput(init?.km))
  // Zwei Wege: Kilometerstände (Standard) oder nur die gefahrenen Kilometer.
  const [kmOnly, setKmOnly] = useState(init != null && init.km != null && init.odoStart == null && init.odoEnd == null)
  // Neue Fahrt: Wer sie einträgt, ist meist auch gefahren.
  const [personIds, setPersonIds] = useState<string[]>(init?.personIds ?? (!init && me ? [me.id] : []))
  // Festpreis (nur Gäste): Die Empfänger bekommen den Festpreis und tragen dafür die Kosten der Fahrt nach km
  const [fixed, setFixed] = useState(init?.fixedPriceCents != null)
  const [fixedAmount, setFixedAmount] = useState(centsToInput(init?.fixedPriceCents))
  const [recipientIds, setRecipientIds] = useState<string[]>(init?.fixedPriceRecipientIds ?? [])
  // Gast hat den Festpreis direkt bezahlt → verknüpfte Ausgleichszahlung
  const { payments } = useAppData()
  const paidBefore = trip ? payments.find((p) => p.tripId === trip.id) : undefined
  const [guestPaid, setGuestPaid] = useState(paidBefore != null)
  const [guestPaidTo, setGuestPaidTo] = useState(paidBefore?.toPersonId ?? '')
  const [note, setNote] = useState(init?.note ?? '')
  const [moreOpen, setMoreOpen] = useState(!!(init?.from || init?.to || init?.note || init?.stops?.length))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const o1 = !kmOnly && odoStart.trim() ? parseNumberInput(odoStart) : undefined
  const o2 = !kmOnly && odoEnd.trim() ? parseNumberInput(odoEnd) : undefined
  const manual = kmOnly && kmInput.trim() ? parseNumberInput(kmInput) : undefined
  const autoKm = o1 != null && o2 != null
  const km = resolveTripKm(o1 ?? undefined, o2 ?? undefined, manual ?? undefined)

  const registered = registeredPersonIds()
  const memberDrove = personIds.some((id) => registered.has(id))
  const fixedCents = fixed ? parseEuroInput(fixedAmount) : undefined
  const recipientCandidates = persons.filter((p) => !personIds.includes(p.id))
  // Wer selbst gefahren ist, kann nicht Empfänger sein
  const recipients = recipientIds.filter((id) => !personIds.includes(id))
  // Ohne Auswahl: an den ersten Empfänger
  const paidTo = guestPaidTo || recipients[0] || ''

  const closedIn = settlements.filter((st) => st.period.kind !== 'all' && startDate && inRange(startDate, resolvePeriod(st.period)))

  const buildDraft = (): { draft: TripDraft; parseErrors: FieldErrors } => {
    const parseErrors: FieldErrors = {}
    if (fixed && !fixedAmount.trim()) parseErrors.fixedPriceCents = 'Bitte einen Festpreis eingeben, z. B. 100,00.'
    else if (fixed && fixedCents == null) parseErrors.fixedPriceCents = 'Bitte einen gültigen Betrag eingeben, z. B. 100,00.'
    if (fixed && recipients.length === 0) parseErrors.fixedPriceRecipientIds = 'Bitte mindestens eine Person wählen, die den Festpreis bekommt.'
    if (fixed && guestPaid && (!paidTo || personIds.includes(paidTo))) parseErrors.guestPaidTo = 'Bitte angeben, an wen der Gast bezahlt hat.'
    if (kmOnly) {
      if (manual === null) parseErrors.km = 'Bitte eine Zahl eingeben, z. B. 125 oder 12,5.'
    } else {
      if (o1 === null) parseErrors.odoStart = 'Bitte eine Zahl eingeben.'
      else if (o1 === undefined) parseErrors.odoStart = 'Bitte den Kilometerstand zu Beginn eingeben.'
      if (o2 === null) parseErrors.odoEnd = 'Bitte eine Zahl eingeben.'
      else if (o2 === undefined) parseErrors.odoEnd = 'Bitte den Kilometerstand am Ende eingeben.'
    }
    // Ältere Fahrten mit nur einem Kilometerstand behalten diesen beim Bearbeiten.
    const keepPartialOdo = kmOnly && init != null && (init.odoStart == null) !== (init.odoEnd == null)
    return {
      draft: {
        startDate,
        endDate,
        from: from || undefined,
        to: to || undefined,
        // Bleibt auch ohne Pro-Modus erhalten, wenn jemand anderes Stationen eingetragen hat
        stops: stops.split(',').map((s) => s.trim()).filter(Boolean),
        odoStart: keepPartialOdo ? init.odoStart : (o1 ?? undefined),
        odoEnd: keepPartialOdo ? init.odoEnd : (o2 ?? undefined),
        km: km as number,
        personIds,
        fixedPriceCents: fixed ? (fixedCents ?? NaN) : undefined,
        fixedPriceRecipientIds: fixed ? recipients : undefined,
        note: note || undefined,
      },
      parseErrors,
    }
  }

  const submit = async () => {
    const { draft, parseErrors } = buildDraft()
    const all = { ...validateTrip(draft, registered), ...parseErrors }
    // Fehlt ein Kilometerstand, steht der Hinweis schon am Feld – kein doppelter Kilometer-Fehler.
    if (!kmOnly && (all.odoStart || all.odoEnd)) delete all.km
    if (hasErrors(all) && (all.from || all.to || all.note || all.stops)) setMoreOpen(true)
    setErrors(all)
    if (hasErrors(all)) return
    const similar = findSimilarTrips(draft, trips, trip?.id)
    if (similar.length > 0) {
      const ok = await confirm({
        title: 'Ähnliche Fahrt bereits vorhanden',
        confirmLabel: 'Trotzdem speichern',
        message: (
          <div className="space-y-2">
            <p>Diese Fahrt wurde möglicherweise schon erfasst (gleiches Datum und gleiche Kilometer oder überschneidende Kilometerstände):</p>
            <ul className="list-disc pl-5">
              {similar.slice(0, 5).map((t) => (
                <li key={t.id}>{formatDate(t.startDate)} · {formatKm(t.km)}{t.odoStart != null && ` · ${formatInt(t.odoStart)}–${formatInt(t.odoEnd ?? 0)}`}{t.updatedBy && ` · erfasst von ${t.updatedBy}`}</li>
              ))}
            </ul>
          </div>
        ),
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const saved = await saveTrip(draft, trip?.id, undefined, fixed && guestPaid ? paidTo : null)
      onSaved?.(saved)
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
      {closedIn.length > 0 && (
        <div className="mb-5">
          <Notice level="warning" title="Zeitraum bereits abgerechnet">
            Das Datum liegt im Zeitraum der abgeschlossenen Abrechnung „{closedIn.map((c) => c.title).join('“, „')}“. Die abgeschlossene Abrechnung bleibt unverändert; dort wird anschließend eine Abweichung zum aktuellen Stand angezeigt.
          </Notice>
        </div>
      )}
      <form
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Startdatum" htmlFor="t-start" error={errors.startDate}>
            <Input
              id="t-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                const next = e.target.value
                // Tagesfahrt bleibt Tagesfahrt; ein Ende vor dem neuen Start rückt mit.
                if (endDate === startDate || (next && endDate < next)) setEndDate(next)
                setStartDate(next)
              }}
              invalid={!!errors.startDate}
              required
            />
          </Field>
          <Field label="Enddatum" htmlFor="t-end" error={errors.endDate}>
            <Input id="t-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} invalid={!!errors.endDate} required />
          </Field>
        </div>

        <div className="rounded-xl bg-slate-50 p-4">
          {kmOnly ? (
            <Field label="Gefahrene Kilometer" htmlFor="t-km" error={errors.km}>
              <Input id="t-km" inputMode="decimal" value={kmInput} onChange={(e) => setKmInput(e.target.value)} invalid={!!errors.km} suffix="km" data-autofocus={!trip || undefined} />
            </Field>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Kilometerstand Beginn"
                  htmlFor="t-o1"
                  error={errors.odoStart}
                  hint={prefilledOdo && odoStart === numberToInput(lastOdo) ? 'Von der letzten Fahrt übernommen' : undefined}
                >
                  <Input id="t-o1" inputMode="decimal" value={odoStart} onChange={(e) => setOdoStart(e.target.value)} invalid={!!errors.odoStart} suffix="km" />
                </Field>
                <Field label="Kilometerstand Ende" htmlFor="t-o2" error={errors.odoEnd}>
                  <Input id="t-o2" inputMode="decimal" value={odoEnd} onChange={(e) => setOdoEnd(e.target.value)} invalid={!!errors.odoEnd} suffix="km" data-autofocus={(!trip && prefilledOdo) || undefined} />
                </Field>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-600" aria-live="polite">
                <Calculator className="h-4 w-4 text-slate-500" />
                {autoKm && km != null && km >= 0 ? <>Gefahren: <strong className="tabular text-slate-900">{formatKm(km)}</strong></> : 'Die Kilometer werden aus den beiden Ständen berechnet.'}
              </p>
              {errors.km && <p className="mt-1 text-xs text-red-600" role="alert">{errors.km}</p>}
            </>
          )}
          <button type="button" className="mt-3 text-xs font-medium text-brand-700 hover:underline" onClick={() => { setKmOnly(!kmOnly); setErrors({}) }}>
            {kmOnly ? 'Stattdessen Kilometerstände eingeben' : 'Kein Kilometerstand? Nur gefahrene Kilometer eingeben'}
          </button>
        </div>

        <Field label="Wer ist gefahren?" error={errors.personIds} hint="Die Kosten der Fahrt werden gleichmäßig auf alle Ausgewählten verteilt.">
          <PersonMultiSelect persons={persons} value={personIds} onChange={setPersonIds} invalid={!!errors.personIds} />
        </Field>

        <div className="grid gap-4 rounded-xl border border-slate-200 p-4">
          <label className={clsx('flex items-start gap-2 text-sm', memberDrove && !fixed ? 'text-slate-500' : 'text-slate-800')}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-700" checked={fixed} disabled={memberDrove && !fixed} onChange={(e) => setFixed(e.target.checked)} />
            <span>
              <span className="font-medium">Festpreis statt Abrechnung nach km</span>
              <span className="block text-xs text-slate-500">
                {memberDrove && !fixed ? 'Nur möglich, wenn kein registriertes Mitglied gefahren ist (z. B. bei Gästen).' : 'Die Fahrenden zahlen einen festen Betrag. Die ausgewählten Personen bekommen ihn und tragen dafür die Kosten der Fahrt nach km – unterm Strich die Differenz.'}
              </span>
            </span>
          </label>
          {errors.fixedPrice && <p className="text-sm text-red-600" role="alert">{errors.fixedPrice}</p>}
          {fixed && (
            <>
              <Field label="Festpreis" htmlFor="t-fixed" error={errors.fixedPriceCents} className="sm:max-w-[50%]">
                <Input id="t-fixed" inputMode="decimal" value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} suffix="€" placeholder="0,00" invalid={!!errors.fixedPriceCents} />
              </Field>
              <Field label="Wer bekommt den Festpreis?" error={errors.fixedPriceRecipientIds} hint="Festpreis und Fahrtkosten werden zu gleichen Teilen verteilt. In der Abrechnung erscheint die Differenz zwischen Kosten nach km und Festpreis.">
                <PersonMultiSelect persons={recipientCandidates} value={recipients} onChange={setRecipientIds} invalid={!!errors.fixedPriceRecipientIds} label="Empfänger des Festpreises" />
              </Field>
              {fixedCents != null && fixedCents > 0 && recipients.length > 1 && (
                <p className="text-sm text-slate-600">Je ausgewählte Person {formatEuro(Math.floor(fixedCents / recipients.length))}{fixedCents % recipients.length ? ' (± 1 Cent)' : ''} vom Festpreis.</p>
              )}
              <div className="grid gap-3 rounded-lg bg-slate-50 p-3">
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={guestPaid} onChange={(e) => setGuestPaid(e.target.checked)} />
                  Festpreis wurde schon bezahlt (z. B. bar oder PayPal)
                </label>
                {guestPaid && (
                  <Field label="Bezahlt an" htmlFor="t-paid-to" error={errors.guestPaidTo} hint="Wird als Ausgleichszahlung erfasst – wer gefahren ist, ist damit ausgeglichen." className="sm:max-w-[50%]">
                    <Select id="t-paid-to" value={paidTo} onChange={(e) => setGuestPaidTo(e.target.value)} invalid={!!errors.guestPaidTo}>
                      <option value="">Bitte wählen</option>
                      {persons.filter((p) => !personIds.includes(p.id) && (p.active || p.id === paidTo)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
            </>
          )}
        </div>

        <Disclosure label="Weitere Angaben (Strecke, Notiz)" open={moreOpen} onToggle={setMoreOpen}>
          <div className="grid gap-4">
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
              <Field label="Startort" htmlFor="t-from" optional>
                <Input id="t-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="z. B. München" maxLength={120} />
              </Field>
              <ArrowRight className="mb-3 hidden h-4 w-4 text-slate-500 sm:block" />
              <Field label="Zielort" htmlFor="t-to" optional>
                <Input id="t-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="z. B. Gardasee" maxLength={120} />
              </Field>
            </div>
            {pro && (
              <Field label="Zwischenstationen" htmlFor="t-stops" optional error={errors.stops} hint="Mit Komma getrennt, z. B. Barcelona, Valencia. Nur für Karte und Länder – die Kilometer bleiben eine Zahl.">
                <Input id="t-stops" value={stops} onChange={(e) => setStops(e.target.value)} placeholder="z. B. Barcelona, Valencia, Granada" maxLength={1000} invalid={!!errors.stops} />
              </Field>
            )}
            <Field label="Notiz" htmlFor="t-note" optional>
              <Textarea id="t-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="z. B. Urlaub, Werkstattfahrt …" />
            </Field>
          </div>
        </Disclosure>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
