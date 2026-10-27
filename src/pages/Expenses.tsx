import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import { Pencil, Plus, Receipt, Repeat, Tags, Trash2, Users } from 'lucide-react'
import { useAppData } from '../lib/db/hooks'
import { addCategory, deleteCategory, deleteExpense, renameCategory } from '../lib/db/repo'
import { expandExpenses, describeRecurrence } from '../lib/domain/recurrence'
import { todayIso, maxDate } from '../lib/domain/dates'
import type { Category, Expense } from '../lib/domain/types'
import { formatDate, formatEuro } from '../lib/format'
import { Badge, Bar, Button, Card, CardTitle, EmptyState, Input, Modal, PageHeader, SearchInput, Select, Stat } from '../components/ui'
import { ExpenseFormModal } from '../components/ExpenseForm'
import { Loading } from '../components/Loading'
import { collectYears } from '../lib/years'
import { errorMessage, useFeedback } from '../components/feedback-context'

type View = 'expenses' | 'entries'

export function ExpensesPage() {
  const data = useAppData()
  const { confirm, toast } = useFeedback()
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('')
  const [year, setYear] = useState('')
  const [view, setView] = useState<View>('expenses')
  const [editing, setEditing] = useState<Expense | undefined>()
  const [formOpen, setFormOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const today = todayIso()

  const entries = useMemo(() => {
    if (!data) return []
    const horizon = data.trips.reduce((m, t) => maxDate(m, t.startDate), today)
    return expandExpenses(data.expenses, horizon)
  }, [data, today])

  const catMap = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c])), [data])
  const pName = useMemo(() => new Map((data?.persons ?? []).map((p) => [p.id, p.name])), [data])

  if (!data) return <Loading />

  const q = query.trim().toLowerCase()
  const matchText = (title: string, note?: string) => !q || `${title} ${note ?? ''}`.toLowerCase().includes(q)
  const filteredEntries = entries
    .filter((e) => (!cat || e.categoryId === cat) && (!year || e.date.startsWith(year)) && matchText(e.title, data.expenses.find((x) => x.id === e.expenseId)?.note))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const entrySumByExpense = new Map<string, { cents: number; n: number }>()
  for (const e of filteredEntries) {
    const s = entrySumByExpense.get(e.expenseId) ?? { cents: 0, n: 0 }
    s.cents += e.amountCents
    s.n += 1
    entrySumByExpense.set(e.expenseId, s)
  }
  const filteredExpenses = data.expenses
    .filter((e) => (!cat || e.categoryId === cat) && matchText(e.title, e.note) && (!year || entrySumByExpense.has(e.id)))
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  const totalCents = filteredEntries.reduce((s, e) => s + e.amountCents, 0)
  const dueCents = filteredEntries.filter((e) => e.date <= today).reduce((s, e) => s + e.amountCents, 0)
  const byCat = new Map<string, number>()
  for (const e of filteredEntries) byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amountCents)
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1])
  const years = collectYears(entries.map((e) => e.date))
  const hasFilter = Boolean(q || cat || year)

  const openNew = () => { setEditing(undefined); setFormOpen(true) }
  const openEdit = (e: Expense) => { setEditing(e); setFormOpen(true) }
  const remove = async (e: Expense) => {
    const ok = await confirm({
      title: 'Ausgabe löschen?',
      message: <>„<strong>{e.title}</strong>“ {e.recurrence ? 'inklusive aller Fälligkeiten ' : ''}wird endgültig gelöscht. Die Abrechnung wird neu berechnet.</>,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteExpense(e.id)
      toast('Ausgabe wurde gelöscht.')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Kosten"
        description="Alle Fahrzeugkosten – einmalig oder wiederkehrend."
        actions={
          <>
            <Button icon={<Tags className="h-4 w-4" />} onClick={() => setCatsOpen(true)}>Kategorien</Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNew}>Neue Ausgabe</Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-1 lg:grid-cols-1">
          <Stat label={year ? `Kosten ${year}` : 'Gesamtkosten'} value={formatEuro(totalCents)} sub={`${filteredEntries.length} Buchungen`} />
          <Stat label="Davon bis heute fällig" value={formatEuro(dueCents)} sub={totalCents !== dueCents ? `${formatEuro(totalCents - dueCents)} noch ausstehend` : 'keine ausstehenden Buchungen'} />
        </div>
        <Card className="lg:col-span-2">
          <CardTitle sub={hasFilter ? 'Gefilterte Buchungen' : 'Alle Buchungen'}>Kosten nach Kategorie</CardTitle>
          {catRows.length === 0 ? (
            <p className="text-sm text-slate-500">Keine Buchungen.</p>
          ) : (
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {catRows.map(([id, cents]) => {
                const c = catMap.get(id)
                return (
                  <li key={id}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <button className="flex items-center gap-2 text-left font-medium text-slate-700 hover:text-slate-900" onClick={() => setCat(cat === id ? '' : id)}>
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: c?.color ?? '#94a3b8' }} />
                        {c?.name ?? 'Unbekannt'}
                      </button>
                      <span className="tabular font-semibold">{formatEuro(cents)}</span>
                    </div>
                    <Bar value={cents} max={totalCents} color={c?.color} />
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-4" padded={false}>
        <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto]">
          <SearchInput value={query} onChange={setQuery} placeholder="Bezeichnung oder Notiz suchen …" />
          <Select aria-label="Kategorie" value={cat} onChange={(e) => setCat(e.target.value)} className="md:w-52">
            <option value="">Alle Kategorien</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select aria-label="Jahr" value={year} onChange={(e) => setYear(e.target.value)} className="md:w-36">
            <option value="">Alle Jahre</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist">
            {([['expenses', 'Ausgaben'], ['entries', 'Einzelbuchungen']] as const).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={clsx('h-8 rounded-md px-3 text-sm font-medium', view === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card padded={false}>
        {view === 'expenses' ? (
          filteredExpenses.length === 0 ? (
            <EmptyState icon={<Receipt className="h-6 w-6" />} title={hasFilter ? 'Keine Ausgaben für diese Filter' : 'Noch keine Kosten erfasst'}
              action={!hasFilter && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNew}>Erste Ausgabe erfassen</Button>}>
              {!hasFilter && 'Lege z. B. die Leasingrate als monatlich wiederkehrende Ausgabe an.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredExpenses.map((e) => {
                const c = catMap.get(e.categoryId)
                const sum = entrySumByExpense.get(e.id)
                return (
                  <li key={e.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{e.title}</span>
                        <Badge><span className="h-2 w-2 rounded-full" style={{ background: c?.color }} />{c?.name ?? 'Unbekannt'}</Badge>
                        {e.recurrence && <Badge tone="blue"><Repeat className="h-3 w-3" />{describeRecurrence(e)}</Badge>}
                        {e.allocation === 'direct' && <Badge tone="amber"><Users className="h-3 w-3" />direkt: {(e.directPersonIds ?? []).map((id) => pName.get(id) ?? '?').join(', ')}</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {e.recurrence ? `ab ${formatDate(e.date)}` : formatDate(e.date)}
                        {e.note && <> · {e.note}</>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="text-right">
                        <div className="tabular font-semibold text-slate-900">{formatEuro(e.amountCents)}{e.recurrence && <span className="text-xs font-normal text-slate-500"> / {e.recurrence.frequency === 'monthly' ? 'Monat' : 'Jahr'}</span>}</div>
                        {e.recurrence && sum && <div className="tabular text-xs text-slate-500">{sum.n}× = {formatEuro(sum.cents)}{year ? ` in ${year}` : ''}</div>}
                      </div>
                      <div className="flex">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(e)} aria-label="Ausgabe bearbeiten" title="Bearbeiten"><Pencil className="h-4 w-4" /></Button>
                        <Button variant="danger-ghost" size="icon" onClick={() => void remove(e)} aria-label="Ausgabe löschen" title="Löschen"><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )
        ) : filteredEntries.length === 0 ? (
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="Keine Buchungen" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Datum</th>
                  <th className="px-4 py-3">Bezeichnung</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Kategorie</th>
                  <th className="hidden px-4 py-3 md:table-cell">Periode</th>
                  <th className="px-4 py-3 text-right">Betrag</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((e) => (
                  <tr key={e.id} className={e.date > today ? 'text-slate-500' : undefined}>
                    <td className="whitespace-nowrap px-4 py-2.5">{formatDate(e.date)}{e.date > today && <Badge className="ml-2">geplant</Badge>}</td>
                    <td className="px-4 py-2.5">{e.title}</td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">{catMap.get(e.categoryId)?.name}</td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs md:table-cell">{e.period ?? '–'}</td>
                    <td className="tabular whitespace-nowrap px-4 py-2.5 text-right font-medium">{formatEuro(e.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td className="px-4 py-3 font-medium" colSpan={2}>Summe ({filteredEntries.length} Buchungen)</td>
                  <td className="hidden sm:table-cell" />
                  <td className="hidden md:table-cell" />
                  <td className="tabular px-4 py-3 text-right font-semibold">{formatEuro(totalCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <ExpenseFormModal open={formOpen} onClose={() => setFormOpen(false)} expense={editing} categories={data.categories} persons={data.persons} />
      <CategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} categories={data.categories} expenses={data.expenses} />
    </>
  )
}

function CategoriesModal({ open, onClose, categories, expenses }: { open: boolean; onClose: () => void; categories: Category[]; expenses: Expense[] }) {
  const { toast, confirm } = useFeedback()
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null)

  const add = async () => {
    try {
      await addCategory(name)
      setName('')
      toast('Kategorie angelegt.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const save = async () => {
    if (!edit) return
    try {
      await renameCategory(edit.id, edit.name)
      setEdit(null)
      toast('Kategorie umbenannt.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const remove = async (c: Category) => {
    if (!(await confirm({ title: 'Kategorie löschen?', message: `„${c.name}“ wird gelöscht.`, confirmLabel: 'Löschen', danger: true }))) return
    try {
      await deleteCategory(c.id)
      toast('Kategorie gelöscht.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Kategorien" description="Standardkategorien können umbenannt, eigene zusätzlich gelöscht werden.">
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Neue Kategorie, z. B. Maut" />
        <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!name.trim()}>Hinzufügen</Button>
      </form>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {categories.map((c) => {
          const used = expenses.filter((e) => e.categoryId === c.id).length
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color }} />
              {edit?.id === c.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void save() }}>
                  <Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="h-9"
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEdit(null) } }} />
                  <Button type="submit" size="sm" variant="primary">Speichern</Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm text-slate-800">{c.name}</span>
                  <span className="text-xs text-slate-400">{used} Ausgabe(n)</span>
                  <Button variant="ghost" size="icon" onClick={() => setEdit({ id: c.id, name: c.name })} aria-label={`${c.name} umbenennen`}><Pencil className="h-4 w-4" /></Button>
                  {!c.builtin && <Button variant="danger-ghost" size="icon" onClick={() => void remove(c)} disabled={used > 0} title={used > 0 ? 'Wird noch verwendet' : 'Löschen'} aria-label={`${c.name} löschen`}><Trash2 className="h-4 w-4" /></Button>}
                </>
              )}
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
