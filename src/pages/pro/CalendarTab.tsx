import { clsx } from 'clsx'
import { lazy, Suspense, useMemo, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight, Route as RouteIcon, Trash2 } from 'lucide-react'
import { useAppData, useMyPerson } from '../../lib/store/context'
import type { IsoDate, Person, Plan, Trip } from '../../lib/domain/types'
import { calendarEvents, monthWeeks, overlapping, type CalendarBar, type CalendarEvent } from '../../lib/domain/calendar'
import { daysInMonth, parseIso, toIso, todayIso } from '../../lib/domain/dates'
import type { FieldErrors } from '../../lib/domain/validation'
import { deletePlan, restoreRecord, savePlan, ValidationError } from '../../lib/store/repo'
import { formatDateLong, formatDateSpan, formatMonth } from '../../lib/format'
import { personColor, personSlot } from '../../lib/personColors'
import { Badge, Button, Card, Field, Input, Modal, Notice, Textarea } from '../../components/ui'
import { PersonChip } from '../../components/Person'
import { PersonMultiSelect } from '../../components/PersonMultiSelect'
import { TripFormModal } from '../../components/TripForm'
import { errorMessage, useFeedback } from '../../components/feedback-context'

const TripDetailModal = lazy(() => import('./TripDetail').then((m) => ({ default: m.TripDetailModal })))

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

const namesOf = (persons: Person[], ids: string[]) => ids.map((id) => persons.find((p) => p.id === id)?.name ?? 'Unbekannt').join(', ')
const eventTitle = (e: CalendarEvent) => e.label || (e.kind === 'trip' ? 'Fahrt' : 'Geplant')

export function CalendarTab() {
  const data = useAppData()
  const { toast } = useFeedback()
  const today = todayIso()
  const [{ year, month }, setMonth] = useState(() => parseIso(today))
  const [planEdit, setPlanEdit] = useState<{ plan?: Plan; date?: IsoDate } | null>(null)
  const [detail, setDetail] = useState<Trip | null>(null)
  const [tripFromPlan, setTripFromPlan] = useState<Plan | null>(null)

  const events = useMemo(() => calendarEvents(data.trips, data.plans), [data.trips, data.plans])
  const weeks = useMemo(() => monthWeeks(year, month, events), [year, month, events])
  const monthStart = toIso(year, month, 1)
  const monthEnd = toIso(year, month, daysInMonth(year, month))
  const inMonth = useMemo(() => overlapping(events, monthStart, monthEnd), [events, monthStart, monthEnd])

  const shift = (delta: number) => {
    const m = year * 12 + (month - 1) + delta
    setMonth({ year: Math.floor(m / 12), month: (m % 12) + 1, day: 1 })
  }
  const open = (e: CalendarEvent) => {
    if (e.kind === 'trip') setDetail(data.trips.find((t) => t.id === e.id) ?? null)
    else setPlanEdit({ plan: data.plans.find((p) => p.id === e.id) })
  }

  return (
    <div className="space-y-6">
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label="Vorheriger Monat"><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="min-w-36 text-center text-base font-semibold text-slate-900" aria-live="polite">{formatMonth(year, month)}</h2>
          <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label="Nächster Monat"><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => setMonth(parseIso(today))}>Heute</Button>
          <Button variant="primary" size="sm" className="ml-auto" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setPlanEdit({})}>Fahrt planen</Button>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-200 text-center text-xs font-medium text-slate-500" aria-hidden>
          {WEEKDAYS.map((d) => <div key={d} className="py-1.5">{d}</div>)}
        </div>
        {weeks.map((w) => (
          <div
            key={w.days[0]}
            className="grid min-h-16 grid-cols-7 sm:min-h-24 border-b border-slate-100 last:border-b-0"
            style={{ gridTemplateRows: `1.75rem repeat(${w.laneCount}, 1.5rem) minmax(0.5rem, 1fr)` }}
          >
            {w.days.map((d, i) => {
              const outside = d < monthStart || d > monthEnd
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPlanEdit({ date: d })}
                  style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                  className={clsx('flex flex-col items-start justify-start border-l border-slate-100 p-1 first:border-l-0 hover:bg-slate-50 focus-visible:relative', outside && 'bg-slate-50/60')}
                  aria-label={`${formatDateLong(d)} – Fahrt planen`}
                >
                  <span className={clsx('inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular', d === today ? 'bg-brand-700 font-semibold text-white' : outside ? 'text-slate-500' : 'text-slate-700')}>
                    {Number(d.slice(8))}
                  </span>
                </button>
              )
            })}
            {w.bars.map((b) => <EventBar key={`${b.event.kind}-${b.event.id}`} bar={b} persons={data.persons} onOpen={open} />)}
          </div>
        ))}
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Im {formatMonth(year, month)}</h3>
        {inMonth.length === 0 ? (
          <p className="text-sm text-slate-500">Keine Fahrten und nichts geplant. Tippe auf einen Tag, um eine Fahrt zu planen.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {inMonth.map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                <button type="button" onClick={() => open(e)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-left hover:bg-slate-50">
                  <Badge tone={e.kind === 'trip' ? 'brand' : 'amber'}>{e.kind === 'trip' ? 'Fahrt' : 'Geplant'}</Badge>
                  <span className="tabular text-sm text-slate-600">{formatDateSpan(e.start, e.end)}</span>
                  <span className="text-sm font-medium text-slate-900">{eventTitle(e)}</span>
                  <span className="flex flex-wrap gap-1">{e.personIds.map((id) => <PersonChip key={id} id={id} />)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">Geplante Fahrten sind nur Reservierungen – sie zählen nicht in Abrechnung und Statistik. Nach der Fahrt machst du daraus mit „Als Fahrt eintragen“ eine echte Fahrt.</p>
      </Card>

      {planEdit && (
        <PlanModal
          key={planEdit.plan?.id ?? planEdit.date ?? 'neu'}
          plan={planEdit.plan}
          date={planEdit.date}
          events={events}
          onClose={() => setPlanEdit(null)}
          onToTrip={(p) => { setPlanEdit(null); setTripFromPlan(p) }}
        />
      )}
      <TripFormModal
        open={tripFromPlan != null}
        onClose={() => setTripFromPlan(null)}
        prefill={tripFromPlan ? { startDate: tripFromPlan.startDate, endDate: tripFromPlan.endDate, personIds: tripFromPlan.personIds, to: tripFromPlan.title, note: tripFromPlan.note } : undefined}
        persons={data.persons}
        trips={data.trips}
        settlements={data.settlements}
        onSaved={() => {
          if (!tripFromPlan) return
          deletePlan(tripFromPlan.id).catch((err) => toast(errorMessage(err), 'error'))
        }}
      />
      {detail && <Suspense fallback={null}><TripDetailModal trip={detail} onClose={() => setDetail(null)} /></Suspense>}
    </div>
  )
}

/** Balken eines Eintrags: Fahrten gefüllt, geplante Fahrten gestrichelt – in der Farbe der ersten Person. */
function EventBar({ bar, persons, onOpen }: { bar: CalendarBar; persons: Person[]; onOpen: (e: CalendarEvent) => void }) {
  const e = bar.event
  const color = personColor(personSlot(persons, e.personIds[0] ?? ''))
  const names = namesOf(persons, e.personIds)
  const kind = e.kind === 'trip' ? 'Fahrt' : 'Geplant'
  return (
    <button
      type="button"
      onClick={() => onOpen(e)}
      style={{
        gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`,
        gridRow: bar.lane + 2,
        borderColor: color,
        background: e.kind === 'trip' ? `color-mix(in srgb, ${color} 22%, var(--color-surface))` : 'var(--color-surface)',
      }}
      className={clsx(
        'relative z-10 my-0.5 flex min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-xs leading-none text-slate-900',
        e.kind === 'trip' ? 'border-l-[3px]' : 'border border-dashed italic text-slate-700',
        bar.continuesBefore ? 'rounded-l-none' : 'ml-1',
        bar.continuesAfter ? 'rounded-r-none' : 'mr-1',
      )}
      title={`${kind}: ${eventTitle(e)} · ${names}`}
    >
      <span className="truncate">
        <span className="sr-only">{kind}: </span>
        <span className="hidden font-medium sm:inline">{names} · </span>{eventTitle(e)}
        <span className="sr-only">, {formatDateSpan(e.start, e.end)}</span>
      </span>
    </button>
  )
}

function PlanModal({ plan, date, events, onClose, onToTrip }: { plan?: Plan; date?: IsoDate; events: CalendarEvent[]; onClose: () => void; onToTrip: (p: Plan) => void }) {
  const data = useAppData()
  const me = useMyPerson()
  const { toast, confirm } = useFeedback()
  const [startDate, setStartDate] = useState(plan?.startDate ?? date ?? todayIso())
  const [endDate, setEndDate] = useState(plan?.endDate ?? '')
  const [personIds, setPersonIds] = useState<string[]>(plan?.personIds ?? (me ? [me.id] : []))
  const [title, setTitle] = useState(plan?.title ?? '')
  const [note, setNote] = useState(plan?.note ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const end = endDate && endDate >= startDate ? endDate : startDate
  const clashes = startDate ? overlapping(events, startDate, end, plan?.id) : []

  const submit = async () => {
    setSaving(true)
    try {
      await savePlan({ startDate, endDate: endDate || undefined, personIds, title, note }, plan?.id)
      toast(plan ? 'Plan aktualisiert.' : 'Fahrt geplant.')
      onClose()
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.fields)
      else toast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!plan) return
    const ok = await confirm({ title: 'Plan löschen?', message: `${plan.title || 'Geplante Fahrt'} am ${formatDateSpan(plan.startDate, plan.endDate)}.`, confirmLabel: 'Löschen', danger: true })
    if (!ok) return
    try {
      const old = await deletePlan(plan.id)
      onClose()
      toast('Plan gelöscht.', 'success', old ? { label: 'Rückgängig', onClick: async () => { await restoreRecord('plans', old) } } : undefined)
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={plan ? 'Geplante Fahrt' : 'Fahrt planen'}
      description="Eine Reservierung im Kalender – zählt nicht in die Abrechnung."
      footer={
        <>
          {plan && <Button variant="danger-ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => void remove()} className="sm:mr-auto">Löschen</Button>}
          {plan && plan.startDate <= todayIso() && <Button icon={<RouteIcon className="h-4 w-4" />} onClick={() => onToTrip(plan)}>Als Fahrt eintragen</Button>}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>{plan ? 'Änderungen speichern' : 'Planen'}</Button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(ev) => { ev.preventDefault(); void submit() }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Von" htmlFor="p-start" error={errors.startDate}>
            <Input id="p-start" type="date" value={startDate} onChange={(ev) => setStartDate(ev.target.value)} invalid={!!errors.startDate} required />
          </Field>
          <Field label="Bis" htmlFor="p-end" error={errors.endDate} optional hint="Leer lassen bei einer Tagesfahrt">
            <Input id="p-end" type="date" value={endDate} min={startDate} onChange={(ev) => setEndDate(ev.target.value)} invalid={!!errors.endDate} />
          </Field>
        </div>
        <Field label="Wer fährt?" error={errors.personIds}>
          <PersonMultiSelect persons={data.persons} value={personIds} onChange={setPersonIds} invalid={!!errors.personIds} />
        </Field>
        <Field label="Ziel oder Anlass" htmlFor="p-title" error={errors.title} optional>
          <Input id="p-title" value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="z. B. Gardasee" maxLength={80} invalid={!!errors.title} />
        </Field>
        <Field label="Notiz" htmlFor="p-note" optional>
          <Textarea id="p-note" value={note} onChange={(ev) => setNote(ev.target.value)} rows={2} />
        </Field>
        {clashes.length > 0 && (
          <Notice level="warning" title="Überschneidung">
            Der Bus ist in diesem Zeitraum schon eingetragen:
            <ul className="mt-1 list-disc pl-5">
              {clashes.map((c) => (
                <li key={`${c.kind}-${c.id}`}>{c.kind === 'trip' ? 'Fahrt' : 'Geplant'}: {namesOf(data.persons, c.personIds)} – {eventTitle(c)} ({formatDateSpan(c.start, c.end)})</li>
              ))}
            </ul>
          </Notice>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
