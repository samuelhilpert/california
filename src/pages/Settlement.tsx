import { clsx } from 'clsx'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, CalendarRange, Info } from 'lucide-react'
import { useAppData } from '../lib/store/context'
import { buildSettlement, personRows } from '../lib/domain/settlement'
import { periodLabel, type PeriodSpec } from '../lib/domain/period'
import { todayIso } from '../lib/domain/dates'
import { buildSettlementWorkbook, downloadWorkbook, invalidLabel } from '../lib/io/excelExport'
import { formatDate, formatDateSpan, formatEuro, formatKm, formatPricePerKm } from '../lib/format'
import { Badge, Bar, Button, Card, CardTitle, EmptyState, Notice, PageHeader, Stat } from '../components/ui'
import { PeriodPicker } from '../components/PeriodPicker'
import { collectYears } from '../lib/years'
import { Loading } from '../components/Loading'
import { BalancePanel } from '../components/BalancePanel'
import { CloseSettlementButton, SettlementSnapshotList } from '../components/SettlementSnapshots'
import { errorMessage, useFeedback } from '../components/feedback-context'

const STORAGE_KEY = 'settlement-period'

function loadPeriod(): { period: PeriodSpec; costPeriod: PeriodSpec | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      const ok = (p: unknown) => typeof p === 'object' && p != null && ['all', 'year', 'month', 'range'].includes((p as PeriodSpec).kind)
      if (ok(v?.period) && (v.costPeriod == null || ok(v.costPeriod))) return { period: v.period, costPeriod: v.costPeriod ?? null }
    }
  } catch {
    /* Browser-Speicher nicht verfügbar */
  }
  return { period: { kind: 'all' }, costPeriod: null }
}

export function SettlementPage() {
  const data = useAppData()
  const { toast } = useFeedback()
  const [{ period, costPeriod }, setPeriods] = useState(loadPeriod)
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const today = todayIso()

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ period, costPeriod })) } catch { /* ignorieren */ }
  }, [period, costPeriod])

  const s = useMemo(() => (data ? buildSettlement(data, { period, costPeriod: costPeriod ?? undefined, today }) : undefined), [data, period, costPeriod, today])

  if (!data || !s) return <Loading />

  const years = collectYears([...data.trips.map((t) => t.startDate), ...data.expenses.map((e) => e.date)])
  const rows = personRows(s, data.persons)
  const pName = new Map(data.persons.map((p) => [p.id, p.name]))
  const catMap = new Map(data.categories.map((c) => [c.id, c]))
  const tripMap = new Map(s.includedTrips.map((t) => [t.id, t]))
  const maxShare = Math.max(1, ...rows.map((r) => r.totalCents))
  const labels = { trips: periodLabel(period), costs: periodLabel(costPeriod ?? period) }

  const exportXlsx = () => {
    try {
      const name = labels.trips.replace(/[^\wäöüÄÖÜß-]+/g, '_')
      downloadWorkbook(buildSettlementWorkbook(s, data, labels), `Abrechnung_${name}_${today}.xlsx`)
      toast('Abrechnung wurde als Excel-Datei exportiert.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Abrechnung"
        description="Kosten werden über den Kilometerpreis fair auf die Beteiligten jeder Fahrt verteilt."
        actions={<>
          <CloseSettlementButton s={s} data={data} period={period} costPeriod={costPeriod ?? undefined} labels={labels} />
          <Button icon={<Download className="h-4 w-4" />} onClick={exportXlsx}>Excel-Export</Button>
        </>}
      />

      <Card className="mb-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm font-medium text-slate-700">Abrechnungszeitraum</div>
            <PeriodPicker value={period} onChange={(p) => setPeriods((x) => ({ ...x, period: p }))} years={years} idPrefix="trip" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-brand-700" checked={costPeriod != null}
              onChange={(e) => setPeriods((x) => ({ ...x, costPeriod: e.target.checked ? x.period : null }))} />
            Abweichenden Zeitraum für Kosten verwenden
          </label>
          {costPeriod && (
            <div className="flex flex-col gap-2 rounded-lg bg-amber-50 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm font-medium text-amber-900">Kostenzeitraum</div>
              <PeriodPicker value={costPeriod} onChange={(p) => setPeriods((x) => ({ ...x, costPeriod: p }))} years={years} idPrefix="cost" />
            </div>
          )}
          <div className="grid gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><strong className="font-medium text-slate-700">Fahrten ({labels.trips}):</strong> nach Startdatum · tatsächlich {formatDateSpan(s.actualTripSpan.from, s.actualTripSpan.to)}</span>
            </div>
            <div className="flex items-start gap-2">
              <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><strong className="font-medium text-slate-700">Kosten ({labels.costs}):</strong> nach Buchungs-/Fälligkeitsdatum · tatsächlich {formatDateSpan(s.actualCostSpan.from, s.actualCostSpan.to)}</span>
            </div>
          </div>
        </div>
      </Card>

      {s.notices.length > 0 && (
        <div className="mb-6 space-y-2">
          {s.notices.map((n) => <Notice key={n.code} level={n.level}>{n.message}</Notice>)}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Gesamtkosten" value={formatEuro(s.totalCostCents)} sub={s.directCostCents ? `${formatEuro(s.perKmCostCents)} km-bezogen · ${formatEuro(s.directCostCents)} direkt` : `${s.costs.length} Buchungen`} />
        <Stat label="Gesamtkilometer" value={formatKm(s.totalKm)} sub={`${s.tripCount} Fahrten`} />
        <Stat label="Kilometerpreis" value={formatPricePerKm(s.pricePerKm)} sub={s.pricePerKm != null ? `${formatEuro(s.perKmCostCents)} ÷ ${formatKm(s.totalKm)}` : 'keine Kilometer im Zeitraum'} />
        <Stat label="Verteilt" value={formatEuro(s.distributedCents)} sub={s.undistributedCents ? <span className="text-amber-700">{formatEuro(s.undistributedCents)} nicht verteilt</span> : 'centgenau aufgeteilt'} />
      </div>

      <Card padded={false} className="mb-6">
        <div className="p-5 pb-3">
          <CardTitle sub="Zeile anklicken, um die zugrunde liegenden Fahrten zu sehen.">Kostenanteile je Person</CardTitle>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Keine Anteile in diesem Zeitraum">Es gibt keine gültigen Fahrten oder direkt zugeordneten Kosten.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3 text-right">Anteilige Kilometer</th>
                  <th className="hidden px-4 py-3 text-right md:table-cell">Fahrten</th>
                  {s.directCostCents > 0 && <th className="hidden px-4 py-3 text-right md:table-cell">Kilometerkosten</th>}
                  {s.directCostCents > 0 && <th className="hidden px-4 py-3 text-right md:table-cell">Direktkosten</th>}
                  <th className="px-4 py-3 text-right">Kostenanteil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const open = openPerson === r.personId
                  const myTrips = s.trips.filter((t) => t.shares.some((x) => x.personId === r.personId))
                  const myDirect = s.directShares.filter((d) => d.personId === r.personId)
                  return (
                    <Fragment key={r.personId}>
                      <tr className={clsx('cursor-pointer hover:bg-slate-50', open && 'bg-slate-50')} onClick={() => setOpenPerson(open ? null : r.personId)}
>
                        <td className="px-4 py-3">
                          <button type="button" className="flex items-center gap-2 text-left font-medium text-slate-900" aria-expanded={open}
                            aria-label={`${r.name}: Fahrten ${open ? 'ausblenden' : 'anzeigen'}`}
                            onClick={(e) => { e.stopPropagation(); setOpenPerson(open ? null : r.personId) }}>
                            {open ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
                            {r.name}
                            {!r.active && <Badge>inaktiv</Badge>}
                          </button>
                          <div className="ml-6 mt-1.5 max-w-48"><Bar value={r.totalCents} max={maxShare} /></div>
                        </td>
                        <td className="tabular px-4 py-3 text-right">{formatKm(r.km)}</td>
                        <td className="tabular hidden px-4 py-3 text-right md:table-cell">{r.tripCount}</td>
                        {s.directCostCents > 0 && <td className="tabular hidden px-4 py-3 text-right md:table-cell">{formatEuro(r.perKmCents)}</td>}
                        {s.directCostCents > 0 && <td className="tabular hidden px-4 py-3 text-right md:table-cell">{formatEuro(r.directCents)}</td>}
                        <td className="tabular px-4 py-3 text-right text-base font-semibold text-slate-900">{formatEuro(r.totalCents)}</td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50">
                          <td colSpan={6} className="px-4 pb-4 pt-0">
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface">
                              <table className="w-full text-xs sm:text-sm">
                                <thead>
                                  <tr className="border-b border-slate-100 text-left text-slate-500">
                                    <th className="px-3 py-2 font-medium">Datum</th>
                                    <th className="px-3 py-2 font-medium">Strecke</th>
                                    <th className="px-3 py-2 text-right font-medium">Fahrt-km</th>
                                    <th className="px-3 py-2 text-right font-medium">Beteiligte</th>
                                    <th className="px-3 py-2 text-right font-medium">Anteil km</th>
                                    <th className="px-3 py-2 text-right font-medium">Anteil €</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {myTrips.map((t) => {
                                    const trip = tripMap.get(t.tripId)
                                    const sh = t.shares.find((x) => x.personId === r.personId)!
                                    return (
                                      <tr key={t.tripId}>
                                        <td className="whitespace-nowrap px-3 py-2">{formatDate(trip?.startDate)}</td>
                                        <td className="px-3 py-2 text-slate-600">{[trip?.from, trip?.to].filter(Boolean).join(' → ') || '–'}</td>
                                        <td className="tabular px-3 py-2 text-right">{formatKm(t.km)}</td>
                                        <td className="px-3 py-2 text-right" title={t.shares.map((x) => pName.get(x.personId)).join(', ')}>{t.shares.length}</td>
                                        <td className="tabular px-3 py-2 text-right">{formatKm(sh.km)}</td>
                                        <td className="tabular px-3 py-2 text-right font-medium">{formatEuro(sh.cents)}</td>
                                      </tr>
                                    )
                                  })}
                                  {myDirect.map((d) => {
                                    const c = s.costs.find((x) => x.id === d.costId)
                                    return (
                                      <tr key={d.costId} className="bg-amber-50/50">
                                        <td className="whitespace-nowrap px-3 py-2">{formatDate(c?.date)}</td>
                                        <td className="px-3 py-2 text-slate-600" colSpan={3}>Direktkosten: {c?.title} (geteilt durch {c?.directPersonIds.length})</td>
                                        <td className="px-3 py-2 text-right">–</td>
                                        <td className="tabular px-3 py-2 text-right font-medium">{formatEuro(d.cents)}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t border-slate-200 font-medium">
                                    <td className="px-3 py-2" colSpan={4}>Summe</td>
                                    <td className="tabular px-3 py-2 text-right">{formatKm(r.km)}</td>
                                    <td className="tabular px-3 py-2 text-right">{formatEuro(r.totalCents)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-medium">
                  <td className="px-4 py-3">Summe</td>
                  <td className="tabular px-4 py-3 text-right">{formatKm(s.totalKm)}</td>
                  <td className="tabular hidden px-4 py-3 text-right md:table-cell">{s.tripCount}</td>
                  {s.directCostCents > 0 && <td className="tabular hidden px-4 py-3 text-right md:table-cell">{formatEuro(rows.reduce((a, r) => a + r.perKmCents, 0))}</td>}
                  {s.directCostCents > 0 && <td className="tabular hidden px-4 py-3 text-right md:table-cell">{formatEuro(rows.reduce((a, r) => a + r.directCents, 0))}</td>}
                  <td className="tabular px-4 py-3 text-right font-semibold">{formatEuro(s.distributedCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-6">
        <BalancePanel s={s} persons={data.persons} periodLabel={labels.trips} />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card padded={false} className="lg:col-span-3">
          <div className="p-5 pb-3"><CardTitle sub="Kilometer × Kilometerpreis, aufgeteilt auf die Beteiligten">Aufschlüsselung nach Fahrten</CardTitle></div>
          {s.trips.length === 0 && s.invalidTrips.length === 0 ? (
            <EmptyState title="Keine Fahrten im Zeitraum" />
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-y border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5">Datum</th>
                    <th className="px-4 py-2.5 text-right">km</th>
                    <th className="px-4 py-2.5 text-right">Kosten</th>
                    <th className="px-4 py-2.5">Anteile</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {s.trips.map((t) => {
                    const trip = tripMap.get(t.tripId)
                    return (
                      <tr key={t.tripId} className="align-top">
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {formatDate(trip?.startDate)}
                          {(trip?.from || trip?.to) && <div className="text-xs text-slate-500">{[trip?.from, trip?.to].filter(Boolean).join(' → ')}</div>}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right">{formatKm(t.km)}</td>
                        <td className="tabular px-4 py-2.5 text-right font-medium">{formatEuro(t.costCents)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {t.shares.map((x) => <Badge key={x.personId}>{pName.get(x.personId) ?? '?'} <span className="tabular text-slate-600">{formatEuro(x.cents)}</span></Badge>)}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {s.invalidTrips.map((it) => {
                    const trip = tripMap.get(it.tripId)
                    return (
                      <tr key={it.tripId} className="bg-amber-50/60 text-amber-900">
                        <td className="px-4 py-2.5">{formatDate(trip?.startDate)}</td>
                        <td className="px-4 py-2.5 text-right">{trip ? formatKm(trip.km) : '–'}</td>
                        <td className="px-4 py-2.5 text-right">–</td>
                        <td className="px-4 py-2.5 text-xs">Nicht berücksichtigt: {invalidLabel(it.reason)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padded={false} className="lg:col-span-2">
          <div className="p-5 pb-3"><CardTitle>Aufschlüsselung nach Kategorien</CardTitle></div>
          {s.categories.length === 0 ? (
            <EmptyState title="Keine Kosten im Zeitraum" />
          ) : (
            <ul className="divide-y divide-slate-100 border-t border-slate-200">
              {s.categories.map((c) => {
                const cat = catMap.get(c.categoryId)
                return (
                  <li key={c.categoryId} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-medium text-slate-800">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: cat?.color ?? '#94a3b8' }} />{cat?.name ?? 'Unbekannt'}
                      </span>
                      <span className="tabular font-semibold">{formatEuro(c.totalCents)}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-slate-500">
                      <span>{c.entryCount} Buchung(en)</span>
                      {c.directCents > 0 && <span>davon direkt {formatEuro(c.directCents)}</span>}
                      {s.pricePerKm != null && s.perKmCostCents > 0 && c.perKmCents > 0 && (
                        <span className="tabular">{formatPricePerKm(c.perKmCents / 100 / s.totalKm)}</span>
                      )}
                    </div>
                  </li>
                )
              })}
              <li className="flex justify-between bg-slate-50 px-5 py-3 text-sm font-medium">
                <span>Summe</span>
                <span className="tabular font-semibold">{formatEuro(s.totalCostCents)}</span>
              </li>
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <SettlementSnapshotList data={data} />
      </div>

      <Card className="mt-6">
        <div className="flex gap-3 text-sm text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <div className="space-y-1">
            <p><strong className="font-medium text-slate-800">So wird gerechnet:</strong> Kilometerpreis = kilometerbezogene Kosten ÷ Gesamtkilometer. Jede Fahrt kostet ihre Kilometer × Kilometerpreis; diese Kosten werden zu gleichen Teilen auf die Beteiligten verteilt. Jede Fahrt zählt nur einmal, egal wie viele Personen dabei waren.</p>
            <p>Direkt zugeordnete Kosten fließen nicht in den Kilometerpreis ein, sondern werden zu gleichen Teilen auf die gewählten Personen verteilt. Alle Beträge werden centgenau gerundet, sodass die Summe der Anteile exakt den verteilten Kosten entspricht.</p>
          </div>
        </div>
      </Card>
    </>
  )
}
