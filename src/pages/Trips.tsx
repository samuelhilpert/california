import { lazy, Suspense, useMemo, useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Download, MapPinned, Pencil, Plus, Route, Trash2, AlertTriangle } from 'lucide-react'
import { useAppData, useProMode } from '../lib/store/context'
import { deleteTrip, restoreRecord } from '../lib/store/repo'
import { findOdometerIssues } from '../lib/domain/tripChecks'
import { validateTripForCalc } from '../lib/domain/settlement'
import { buildTripsWorkbook, downloadWorkbook, invalidLabel } from '../lib/io/excelExport'
import type { Trip } from '../lib/domain/types'
import { formatDate, formatInt, formatKm } from '../lib/format'
import { Button, Card, EmptyState, Input, Notice, PageHeader, SearchInput, Select } from '../components/ui'
import { TripFormModal } from '../components/TripForm'
import { Loading } from '../components/Loading'
import { collectYears } from '../lib/years'
import { errorMessage, useFeedback } from '../components/feedback-context'
import { todayIso } from '../lib/domain/dates'
import { PersonChip } from '../components/Person'

// Pro-Modus: Detailansicht mit Karte (lädt die Kartenbibliothek erst bei Bedarf)
const TripDetailModal = lazy(() => import('./pro/TripDetail').then((m) => ({ default: m.TripDetailModal })))

export function TripsPage() {
  const data = useAppData()
  const { confirm, toast } = useFeedback()
  const [pro] = useProMode()
  const [detail, setDetail] = useState<Trip | null>(null)
  const [query, setQuery] = useState('')
  const [personFilter, setPersonFilter] = useState('')
  const [year, setYear] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [desc, setDesc] = useState(true)
  const [editing, setEditing] = useState<Trip | undefined>()
  const [prefill, setPrefill] = useState<Partial<Trip> | undefined>()
  const [formOpen, setFormOpen] = useState(false)

  const pName = useMemo(() => new Map((data?.persons ?? []).map((p) => [p.id, p.name])), [data])
  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.trips
      .filter((t) => {
        if (personFilter && !t.personIds.includes(personFilter)) return false
        if (year && !t.startDate.startsWith(year)) return false
        if (from && t.startDate < from) return false
        if (to && t.startDate > to) return false
        if (q) {
          const hay = [t.from, t.to, t.note, formatDate(t.startDate), ...t.personIds.map((id) => pName.get(id))].join(' ').toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => {
        const c = a.startDate === b.startDate ? a.createdAt.localeCompare(b.createdAt) : a.startDate < b.startDate ? -1 : 1
        return desc ? -c : c
      })
  }, [data, query, personFilter, year, from, to, desc, pName])

  if (!data) return <Loading />

  const totalKm = filtered.reduce((s, t) => s + (Number.isFinite(t.km) ? t.km : 0), 0)
  const personKm = personFilter ? filtered.reduce((s, t) => s + t.km / t.personIds.length, 0) : null
  const years = collectYears(data.trips.map((t) => t.startDate))
  const hasFilter = Boolean(query || personFilter || year || from || to)

  const openNew = () => { setEditing(undefined); setPrefill(undefined); setFormOpen(true) }
  const openEdit = (t: Trip) => { setEditing(t); setPrefill(undefined); setFormOpen(true) }
  const issues = findOdometerIssues(data.trips)
  const tripById = new Map(data.trips.map((t) => [t.id, t]))
  const fillGap = (prevId: string, nextId: string, fromKm: number, toKm: number) => {
    const prev = tripById.get(prevId)
    const next = tripById.get(nextId)
    setEditing(undefined)
    setPrefill({ startDate: prev?.endDate ?? prev?.startDate ?? next?.startDate, odoStart: fromKm, odoEnd: toKm, note: 'Nachgetragen (Kilometerlücke)' })
    setFormOpen(true)
  }
  const remove = async (t: Trip) => {
    const ok = await confirm({
      title: 'Fahrt löschen?',
      message: <>Die Fahrt vom <strong>{formatDate(t.startDate)}</strong> über {formatKm(t.km)} wird endgültig gelöscht. Die Abrechnung wird neu berechnet.</>,
      confirmLabel: 'Löschen',
      danger: true,
    })
    if (!ok) return
    try {
      const removed = await deleteTrip(t.id)
      toast('Fahrt wurde gelöscht.', 'success', removed ? { label: 'Rückgängig', onClick: async () => { await restoreRecord('trips', removed); toast('Fahrt wurde wiederhergestellt.') } } : undefined)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const exportXlsx = () => {
    try {
      downloadWorkbook(buildTripsWorkbook(filtered, data.persons), `Fahrtenbuch_${todayIso()}.xlsx`)
      toast(`${filtered.length} Fahrten exportiert.`)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Fahrtenbuch"
        description="Alle Fahrten mit Kilometern und Beteiligten."
        actions={
          <>
            <Button icon={<Download className="h-4 w-4" />} onClick={exportXlsx} disabled={filtered.length === 0}>Excel-Export</Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNew}>Neue Fahrt</Button>
          </>
        }
      />

      {issues.length > 0 && (
        <div className="mb-4">
          <Notice level="warning" title={`Kilometerstände prüfen (${issues.length})`}>
            <p className="mb-2">Nicht erfasste Kilometer zahlt niemand – sie erhöhen den Kilometerpreis für alle. Überschneidungen deuten auf doppelte oder vertippte Fahrten hin.</p>
            <ul className="space-y-1.5">
              {issues.slice(0, 8).map((i) => {
                const prev = tripById.get(i.prevTripId)
                const next = tripById.get(i.nextTripId)
                return (
                  <li key={`${i.prevTripId}-${i.nextTripId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface/60 px-2 py-1.5">
                    <span>
                      {i.type === 'gap' ? <strong>Lücke von {formatKm(i.km)}</strong> : <strong>Überschneidung von {formatKm(i.km)}</strong>}
                      {' '}({formatInt(i.fromKm)} → {formatInt(i.toKm)}) zwischen den Fahrten vom {formatDate(prev?.startDate)} und {formatDate(next?.startDate)}
                    </span>
                    {i.type === 'gap'
                      ? <Button size="sm" onClick={() => fillGap(i.prevTripId, i.nextTripId, i.fromKm, i.toKm)}>Fahrt nachtragen</Button>
                      : next && <Button size="sm" onClick={() => openEdit(next)}>Fahrt prüfen</Button>}
                  </li>
                )
              })}
            </ul>
            {issues.length > 8 && <p className="mt-1 text-xs">… und {issues.length - 8} weitere</p>}
          </Notice>
        </div>
      )}

      <Card className="mb-4" padded={false}>
        <div className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] lg:grid-cols-[1fr_auto_auto_auto]">
          <SearchInput value={query} onChange={setQuery} placeholder="Ort, Notiz oder Person suchen …" />
          <Select aria-label="Nach Person filtern" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} className="md:w-48">
            <option value="">Alle Personen</option>
            {data.persons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inaktiv)'}</option>)}
          </Select>
          <Select aria-label="Nach Jahr filtern" value={year} onChange={(e) => setYear(e.target.value)} className="md:w-36">
            <option value="">Alle Jahre</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <div className="flex items-center gap-2 md:col-span-3 lg:col-span-1">
            <Input type="date" aria-label="Von Datum" value={from} onChange={(e) => setFrom(e.target.value)} className="lg:w-40" />
            <span className="text-slate-500">–</span>
            <Input type="date" aria-label="Bis Datum" value={to} onChange={(e) => setTo(e.target.value)} className="lg:w-40" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
            <span><strong className="tabular text-slate-900">{formatInt(filtered.length)}</strong> Fahrten</span>
            <span><strong className="tabular text-slate-900">{formatKm(totalKm)}</strong> gesamt</span>
            {personKm != null && <span><strong className="tabular text-slate-900">{formatKm(personKm)}</strong> anteilig für {pName.get(personFilter)}</span>}
            {hasFilter && (
              <button className="font-medium text-brand-700 hover:underline" onClick={() => { setQuery(''); setPersonFilter(''); setYear(''); setFrom(''); setTo('') }}>
                Filter zurücksetzen
              </button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setDesc(!desc)} icon={desc ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}>
            {desc ? 'Neueste zuerst' : 'Älteste zuerst'}
          </Button>
        </div>
      </Card>

      <Card padded={false}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Route className="h-6 w-6" />}
            illustration={!hasFilter}
            title={hasFilter ? 'Keine Fahrten für diese Filter' : 'Noch keine Fahrten erfasst'}
            action={!hasFilter && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={openNew}>Erste Fahrt erfassen</Button>}
          >
            {hasFilter ? 'Passe die Suche oder die Filter an.' : 'Erfasse Fahrten mit Kilometerständen oder gefahrenen Kilometern.'}
          </EmptyState>
        ) : (
          <>
            {/* Desktop-Tabelle */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Datum</th>
                    <th className="px-4 py-3">Strecke</th>
                    <th className="px-4 py-3 text-right">Kilometerstand</th>
                    <th className="px-4 py-3 text-right">Kilometer</th>
                    <th className="px-4 py-3">Beteiligte</th>
                    <th className="px-4 py-3"><span className="sr-only">Aktionen</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((t) => {
                    const invalid = validateTripForCalc(t)
                    return (
                      <tr key={t.id} className="group hover:bg-slate-50/60">
                        <td className="whitespace-nowrap px-4 py-3 align-top">
                          <div className="font-medium text-slate-900">{formatDate(t.startDate)}</div>
                          {t.endDate && <div className="text-xs text-slate-500">bis {formatDate(t.endDate)}</div>}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-slate-700">{[t.from, t.to].filter(Boolean).join(' → ') || <span className="text-slate-500">–</span>}</div>
                          {t.note && <div className="mt-0.5 line-clamp-2 max-w-xs text-xs text-slate-500">{t.note}</div>}
                        </td>
                        <td className="tabular whitespace-nowrap px-4 py-3 text-right align-top text-slate-500">
                          {t.odoStart != null && t.odoEnd != null ? `${formatInt(t.odoStart)} – ${formatInt(t.odoEnd)}` : '–'}
                        </td>
                        <td className="tabular whitespace-nowrap px-4 py-3 text-right align-top font-semibold text-slate-900">
                          {formatKm(t.km)}
                          {invalid && <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-normal text-amber-700"><AlertTriangle className="h-3 w-3" />{invalidLabel(invalid)}</div>}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-wrap gap-1">{t.personIds.map((id) => <PersonChip key={id} id={id} />)}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right align-top">
                          {pro && <Button variant="ghost" size="icon" onClick={() => setDetail(t)} aria-label="Fahrt-Details mit Karte" title="Details & Karte"><MapPinned className="h-4 w-4" /></Button>}
                          <Button variant="ghost" size="icon" onClick={() => openEdit(t)} aria-label="Fahrt bearbeiten" title="Bearbeiten"><Pencil className="h-4 w-4" /></Button>
                          <Button variant="danger-ghost" size="icon" onClick={() => void remove(t)} aria-label="Fahrt löschen" title="Löschen"><Trash2 className="h-4 w-4" /></Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 text-sm">
                    <td className="px-4 py-3 font-medium text-slate-700" colSpan={3}>Summe ({filtered.length} Fahrten)</td>
                    <td className="tabular px-4 py-3 text-right font-semibold text-slate-900">{formatKm(totalKm)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {/* Mobile Karten */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {filtered.map((t) => (
                <li key={t.id} className="flex gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-slate-900">{formatDate(t.startDate)}{t.endDate && <span className="font-normal text-slate-500"> – {formatDate(t.endDate)}</span>}</span>
                      <span className="tabular font-semibold text-slate-900">{formatKm(t.km)}</span>
                    </div>
                    {(t.from || t.to) && <div className="mt-0.5 text-sm text-slate-600">{[t.from, t.to].filter(Boolean).join(' → ')}</div>}
                    <div className="mt-2 flex flex-wrap gap-1">{t.personIds.map((id) => <PersonChip key={id} id={id} />)}</div>
                    {t.note && <div className="mt-1.5 text-xs text-slate-500">{t.note}</div>}
                  </div>
                  <div className="flex flex-col">
                    {pro && <Button variant="ghost" size="icon" onClick={() => setDetail(t)} aria-label="Fahrt-Details mit Karte"><MapPinned className="h-4 w-4" /></Button>}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)} aria-label="Fahrt bearbeiten"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="danger-ghost" size="icon" onClick={() => void remove(t)} aria-label="Fahrt löschen"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <TripFormModal open={formOpen} onClose={() => setFormOpen(false)} trip={editing} prefill={prefill} persons={data.persons} trips={data.trips} settlements={data.settlements} />
      {detail && <Suspense fallback={null}><TripDetailModal trip={detail} onClose={() => setDetail(null)} /></Suspense>}
    </>
  )
}
