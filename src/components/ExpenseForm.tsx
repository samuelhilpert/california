import { clsx } from 'clsx'
import { Plus, Route, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Allocation, Category, Expense, Frequency, Person } from '../lib/domain/types'
import { parseEuroInput } from '../lib/domain/money'
import { validateExpense, hasErrors, type ExpenseDraft, type FieldErrors } from '../lib/domain/validation'
import { addCategory, saveExpense, ValidationError } from '../lib/store/repo'
import { todayIso } from '../lib/domain/dates'
import { expandExpense } from '../lib/domain/recurrence'
import { centsToInput, formatDate, formatEuro } from '../lib/format'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import { PersonMultiSelect } from './PersonMultiSelect'
import { errorMessage, useFeedback } from './feedback-context'

interface Props {
  open: boolean
  onClose: () => void
  expense?: Expense
  categories: Category[]
  persons: Person[]
}

export function ExpenseFormModal(props: Props) {
  if (!props.open) return null
  return <ExpenseForm key={props.expense?.id ?? 'new'} {...props} />
}

type RepeatMode = 'once' | Frequency
type EndMode = 'open' | 'count' | 'until'

function ExpenseForm({ onClose, expense, categories, persons }: Props) {
  const { toast } = useFeedback()
  const [title, setTitle] = useState(expense?.title ?? '')
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? categories[0]?.id ?? '')
  const [amount, setAmount] = useState(centsToInput(expense?.amountCents))
  const [date, setDate] = useState(expense?.date ?? todayIso())
  const [repeat, setRepeat] = useState<RepeatMode>(expense?.recurrence?.frequency ?? 'once')
  const [endMode, setEndMode] = useState<EndMode>(expense?.recurrence?.count ? 'count' : expense?.recurrence?.until ? 'until' : 'open')
  const [count, setCount] = useState(String(expense?.recurrence?.count ?? 12))
  const [until, setUntil] = useState(expense?.recurrence?.until ?? '')
  const [allocation, setAllocation] = useState<Allocation>(expense?.allocation ?? 'perKm')
  const [directIds, setDirectIds] = useState<string[]>(expense?.directPersonIds ?? [])
  const [note, setNote] = useState(expense?.note ?? '')
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? '')
  const [spread, setSpread] = useState(Boolean(expense?.spreadMonths && expense.spreadMonths > 1))
  const [spreadMonths, setSpreadMonths] = useState(String(expense?.spreadMonths ?? 12))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [newCat, setNewCat] = useState<string | null>(null)

  const amountCents = parseEuroInput(amount)

  const draft: ExpenseDraft = {
    title,
    categoryId,
    amountCents: amountCents as number,
    date,
    allocation,
    directPersonIds: allocation === 'direct' ? directIds : undefined,
    recurrence:
      repeat === 'once'
        ? undefined
        : {
            frequency: repeat,
            count: endMode === 'count' ? Number(count) : undefined,
            until: endMode === 'until' ? until || undefined : undefined,
          },
    spreadMonths: spread ? Number(spreadMonths) : undefined,
    paidBy: paidBy || undefined,
    note: note || undefined,
  }

  const preview = useMemo(() => {
    if (repeat === 'once' || amountCents == null || !date) return null
    const e = { ...draft, spreadMonths: undefined, id: 'preview', createdAt: '', updatedAt: '' } as Expense
    if (endMode === 'open') return { open: true as const, list: expandExpense(e, todayIso()) }
    if (endMode === 'count' && !(Number(count) >= 1)) return null
    if (endMode === 'until' && !until) return null
    return { open: false as const, list: expandExpense(e, todayIso()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat, amountCents, date, endMode, count, until])

  const submit = async () => {
    const parseErr: FieldErrors = {}
    if (amount.trim() && amountCents == null) parseErr.amountCents = 'Bitte einen gültigen Betrag eingeben, z. B. 319,15.'
    if (repeat !== 'once' && endMode === 'until' && !until) parseErr.recurrenceUntil = 'Bitte ein Enddatum wählen.'
    const all = { ...validateExpense(draft), ...parseErr }
    setErrors(all)
    if (hasErrors(all)) return
    try {
      await saveExpense(draft, expense?.id)
      toast(expense ? 'Ausgabe wurde aktualisiert.' : 'Ausgabe wurde gespeichert.')
      onClose()
    } catch (e) {
      if (e instanceof ValidationError) setErrors(e.fields)
      else toast(errorMessage(e), 'error')
    }
  }

  const createCategory = async () => {
    try {
      const c = await addCategory(newCat ?? '')
      setCategoryId(c.id)
      setNewCat(null)
      toast(`Kategorie „${c.name}“ angelegt.`)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={expense ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void submit()}>{expense ? 'Änderungen speichern' : 'Ausgabe speichern'}</Button>
        </>
      }
    >
      <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bezeichnung" htmlFor="e-title" error={errors.title} className="sm:col-span-2">
            <Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Leasingrate, Tankfüllung, Inspektion" invalid={!!errors.title} maxLength={200} />
          </Field>
          <Field label="Kategorie" htmlFor="e-cat" error={errors.categoryId}>
            {newCat == null ? (
              <div className="flex gap-2">
                <Select id="e-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} invalid={!!errors.categoryId}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button size="icon" className="h-10 w-10 shrink-0" onClick={() => setNewCat('')} aria-label="Neue Kategorie" title="Neue Kategorie">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input autoFocus value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Neue Kategorie"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createCategory() } if (e.key === 'Escape') { e.stopPropagation(); setNewCat(null) } }} />
                <Button variant="primary" onClick={() => void createCategory()} disabled={!newCat.trim()}>OK</Button>
              </div>
            )}
          </Field>
          <Field label={repeat === 'once' ? 'Betrag' : 'Betrag je Fälligkeit'} htmlFor="e-amount" error={errors.amountCents}>
            <Input id="e-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" suffix="€" invalid={!!errors.amountCents} />
          </Field>
          <Field label="Bezahlt von" htmlFor="e-paid" className="sm:col-span-2" hint="Für den Ausgleich: Wer hat das Geld vorgestreckt? Leer lassen bei gemeinsamem Konto.">
            <Select id="e-paid" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              <option value="">Unbekannt / gemeinsames Konto</option>
              {persons.filter((p) => p.active || p.id === paidBy).map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inaktiv)'}</option>)}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 rounded-xl bg-slate-50 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Wiederholung" htmlFor="e-repeat">
              <Select id="e-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatMode)}>
                <option value="once">Einmalig</option>
                <option value="monthly">Monatlich</option>
                <option value="yearly">Jährlich</option>
              </Select>
            </Field>
            <Field label={repeat === 'once' ? 'Datum' : 'Erste Fälligkeit'} htmlFor="e-date" error={errors.date}>
              <Input id="e-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errors.date} />
            </Field>
          </div>
          {repeat !== 'once' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Laufzeit" htmlFor="e-end">
                <Select id="e-end" value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)}>
                  <option value="count">Feste Anzahl</option>
                  <option value="until">Bis Datum</option>
                  <option value="open">Unbefristet</option>
                </Select>
              </Field>
              {endMode === 'count' && (
                <Field label="Anzahl Fälligkeiten" htmlFor="e-count" error={errors.recurrenceCount}>
                  <Input id="e-count" type="number" min={1} max={1200} value={count} onChange={(e) => setCount(e.target.value)} invalid={!!errors.recurrenceCount} />
                </Field>
              )}
              {endMode === 'until' && (
                <Field label="Letzte Fälligkeit spätestens" htmlFor="e-until" error={errors.recurrenceUntil}>
                  <Input id="e-until" type="date" value={until} min={date} onChange={(e) => setUntil(e.target.value)} invalid={!!errors.recurrenceUntil} />
                </Field>
              )}
            </div>
          )}
          {preview && preview.list.length > 0 && (
            <p className="text-sm text-slate-600">
              {preview.open
                ? <>Bis heute {preview.list.length} Fälligkeit(en) · {formatEuro(preview.list.length * (amountCents ?? 0))}. Weitere werden automatisch je Periode berücksichtigt.</>
                : <>{preview.list.length} Fälligkeiten von {formatDate(preview.list[0].date)} bis {formatDate(preview.list.at(-1)!.date)} · gesamt <strong>{formatEuro(preview.list.length * (amountCents ?? 0))}</strong></>}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={spread} onChange={(e) => setSpread(e.target.checked)} />
              {repeat === 'once' ? 'Betrag auf Monate verteilen' : 'Jede Fälligkeit auf Monate verteilen'}
            </label>
            {spread && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Input type="number" min={2} max={120} value={spreadMonths} onChange={(e) => setSpreadMonths(e.target.value)} className="h-9 w-20" aria-label="Anzahl Monate" invalid={!!errors.spreadMonths} />
                Monate
              </div>
            )}
          </div>
          {spread && (
            <p className="text-xs text-slate-500">
              Z. B. Jahresversicherung: Der Betrag zählt in der Abrechnung zu gleichen Teilen in jedem Monat (centgenau) statt komplett im Fälligkeitsmonat. Wichtig für Monatsabrechnungen.
              {errors.spreadMonths && <span className="block text-red-600">{errors.spreadMonths}</span>}
            </p>
          )}
          {repeat !== 'once' && (
            <p className="text-xs text-slate-500">Wiederkehrende Kosten werden nicht als Kopien gespeichert, sondern je Monat bzw. Jahr genau einmal berücksichtigt – Doppelbuchungen sind ausgeschlossen.</p>
          )}
        </div>

        <Field label="Verteilung" error={errors.directPersonIds}>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              ['perKm', Route, 'Über den Kilometerpreis', 'Fließt in den Kilometerpreis ein und wird nach gefahrenen Kilometern verteilt (Standard).'],
              ['direct', Users, 'Direkt auf Personen', 'Wird nicht über Kilometer verteilt, sondern zu gleichen Teilen auf die gewählten Personen.'],
            ] as const).map(([val, Icon, label, desc]) => (
              <button type="button" key={val} onClick={() => setAllocation(val)} aria-pressed={allocation === val}
                className={clsx('flex gap-3 rounded-xl border p-3 text-left transition-colors', allocation === val ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600' : 'border-slate-200 hover:bg-slate-50')}>
                <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', allocation === val ? 'text-brand-700' : 'text-slate-500')} />
                <span>
                  <span className="block text-sm font-medium text-slate-900">{label}</span>
                  <span className="block text-xs text-slate-500">{desc}</span>
                </span>
              </button>
            ))}
          </div>
        </Field>
        {allocation === 'direct' && (
          <Field label="Verteilen auf" error={errors.directPersonIds}>
            <PersonMultiSelect persons={persons} value={directIds} onChange={setDirectIds} invalid={!!errors.directPersonIds} />
          </Field>
        )}

        <Field label="Notiz" htmlFor="e-note" optional>
          <Textarea id="e-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
