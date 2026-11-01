import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Car, CheckCircle2, Coins, DatabaseBackup, Gauge, Plus, Receipt, Route, Users } from 'lucide-react'
import { useAppData, useMyPerson, useSetting } from '../lib/store/context'
import { buildSettlement, personRows } from '../lib/domain/settlement'
import { todayIso } from '../lib/domain/dates'
import { formatDate, formatEuro, formatKm, formatPricePerKm, formatStamp, formatInt, formatPercent } from '../lib/format'
import { Badge, Bar, Button, Card, CardTitle, Disclosure, EmptyState, Notice, PageHeader, Stat } from '../components/ui'
import { TripFormModal } from '../components/TripForm'
import { ExpenseFormModal } from '../components/ExpenseForm'
import { Loading } from '../components/Loading'

const DETAILS_KEY = 'dashboard.detailsOpen'

/** Ob die Details aufgeklappt sind, merkt sich jedes Gerät für sich. */
function readDetailsOpen(): boolean {
  try {
    return localStorage.getItem(DETAILS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDetailsOpen(open: boolean) {
  try {
    localStorage.setItem(DETAILS_KEY, open ? '1' : '0')
  } catch {
    // z. B. privater Modus – dann eben nicht merken
  }
}

export function DashboardPage() {
  const data = useAppData()
  const me = useMyPerson()
  const lastBackup = useSetting<string>('lastBackupAt')
  const [tripOpen, setTripOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(readDetailsOpen)
  const [nowMs] = useState(() => Date.now())
  const today = todayIso()

  const s = useMemo(() => (data ? buildSettlement(data, { period: { kind: 'all' }, today }) : undefined), [data, today])
  if (!data || !s) return <Loading />

  const toggleDetails = (open: boolean) => {
    setDetailsOpen(open)
    writeDetailsOpen(open)
  }

  const allIssues = s.odometerIssues
  const gapKm = allIssues.filter((i) => i.type === 'gap').reduce((a, i) => a + i.km, 0)
  // Backup-Erinnerung: noch nie, oder älter als 30 Tage und seitdem geändert
  const lastChange = [...data.trips, ...data.expenses, ...data.payments].reduce((m, x) => (x.updatedAt > m ? x.updatedAt : m), '')
  const backupAgeDays = lastBackup ? (nowMs - new Date(lastBackup).getTime()) / 86400000 : Infinity
  const backupDue = !lastBackup || (backupAgeDays > 30 && lastChange > lastBackup)
  // Überweisungen, die mich betreffen, zuerst
  const openTransfers = [...s.balance.transfers].sort((a, b) => Number(b.fromPersonId === me?.id || b.toPersonId === me?.id) - Number(a.fromPersonId === me?.id || a.toPersonId === me?.id))

  const rows = personRows(s, data.persons)
  const catName = new Map(data.categories.map((c) => [c.id, c]))
  const recent = [...data.trips].sort((a, b) => (a.startDate === b.startDate ? b.createdAt.localeCompare(a.createdAt) : a.startDate < b.startDate ? 1 : -1)).slice(0, 5)
  const pName = new Map(data.persons.map((p) => [p.id, p.name]))
  const who = (id: string) => (id === me?.id ? 'Du' : pName.get(id) ?? '?')
  const dueCents = s.costs.filter((c) => c.date <= today).reduce((a, c) => a + c.amountCents, 0)
  const activePersons = data.persons.filter((p) => p.active).length
  const isEmpty = data.trips.length === 0 && data.expenses.length === 0
  const maxShare = Math.max(1, ...rows.map((r) => r.totalCents))

  return (
    <>
      <PageHeader title="Übersicht" />

      {isEmpty ? (
        <Card>
          <EmptyState
            icon={<Car className="h-6 w-6" />}
            title="Willkommen! Noch keine Daten vorhanden."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {activePersons === 0 ? (
                  <Link to="/personen"><Button variant="primary" icon={<Users className="h-4 w-4" />}>Personen anlegen</Button></Link>
                ) : (
                  <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setTripOpen(true)}>Erste Fahrt eintragen</Button>
                )}
                <Link to="/daten"><Button icon={<DatabaseBackup className="h-4 w-4" />}>Backup einspielen</Button></Link>
              </div>
            }
          >
            {activePersons === 0
              ? 'Lege zuerst an, wer das Auto nutzt. Danach kannst du Fahrten und Kosten eintragen.'
              : 'Trage die erste Fahrt oder Ausgabe ein.'}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <Button variant="primary" className="h-14 text-base" icon={<Plus className="h-5 w-5" />} onClick={() => setTripOpen(true)}>Fahrt eintragen</Button>
            <Button className="h-14 text-base" icon={<Receipt className="h-5 w-5" />} onClick={() => setExpenseOpen(true)}>Ausgabe eintragen</Button>
          </div>

          {backupDue && (
            <Notice level="info" title={lastBackup ? `Letztes Backup vor ${Math.floor(backupAgeDays)} Tagen` : 'Noch kein Backup erstellt'}>
              Die Daten sind in der Cloud gespeichert. Ein zusätzliches Backup schützt vor versehentlichem Löschen oder Überschreiben.{' '}
              <Link to="/daten" className="font-medium underline">Backup herunterladen</Link>
            </Notice>
          )}
          {gapKm > 0 && (
            <Notice level="warning" title={`${formatKm(gapKm)} nicht im Fahrtenbuch erfasst`}>
              Zwischen den Kilometerständen gibt es Lücken. Diese Kilometer zahlt niemand – sie erhöhen den Kilometerpreis für alle.{' '}
              <Link to="/fahrten" className="font-medium underline">Lücken ansehen und nachtragen</Link>
            </Notice>
          )}
          {s.notices.filter((n) => n.level !== 'info' && !n.code.startsWith('odometer')).map((n) => (
            <Notice key={n.code} level={n.level}>{n.message}</Notice>
          ))}

          <Card>
            <CardTitle action={<Link to="/abrechnung" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Abrechnung <ArrowRight className="h-3.5 w-3.5" /></Link>}>
              Wer schuldet wem?
            </CardTitle>
            {openTransfers.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-slate-600"><CheckCircle2 className="h-4 w-4 text-green-600" />Alles ausgeglichen.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {openTransfers.map((t) => (
                  <li key={`${t.fromPersonId}-${t.toPersonId}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span><strong>{who(t.fromPersonId)}</strong> → <strong>{who(t.toPersonId)}</strong></span>
                    <span className="tabular font-semibold">{formatEuro(t.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500 tabular">
              {formatPricePerKm(s.pricePerKm)} · {formatKm(s.totalKm)} · {formatEuro(s.totalCostCents)} Kosten insgesamt
            </p>
          </Card>

          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardTitle action={<Link to="/fahrten" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Alle Fahrten <ArrowRight className="h-3.5 w-3.5" /></Link>}>
                Letzte Fahrten
              </CardTitle>
            </div>
            {recent.length === 0 ? (
              <EmptyState title="Noch keine Fahrten" action={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setTripOpen(true)}>Fahrt eintragen</Button>} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((t) => {
                  const tr = s.trips.find((x) => x.tripId === t.id)
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900">
                          {formatDate(t.startDate)}
                          {(t.from || t.to) && <span className="ml-2 font-normal text-slate-500">{[t.from, t.to].filter(Boolean).join(' → ')}</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.personIds.map((id) => <Badge key={id}>{pName.get(id) ?? 'Unbekannt'}</Badge>)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-sm font-semibold text-slate-900">{formatKm(t.km)}</div>
                        {tr && <div className="tabular text-xs text-slate-500">{formatEuro(tr.costCents)}</div>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Disclosure label={detailsOpen ? 'Details ausblenden' : 'Details anzeigen (Kennzahlen, Anteile, Kategorien)'} open={detailsOpen} onToggle={toggleDetails}>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                <Stat label="Gesamtkosten" icon={<Coins className="h-4 w-4" />} value={formatEuro(s.totalCostCents)} sub={dueCents !== s.totalCostCents ? `davon bis heute fällig: ${formatEuro(dueCents)}` : `${s.costs.length} Buchungen`} />
                <Stat label="Gesamtkilometer" icon={<Gauge className="h-4 w-4" />} value={formatKm(s.totalKm)} />
                <Stat label="Kosten pro km" icon={<Route className="h-4 w-4" />} value={formatPricePerKm(s.pricePerKm)} sub={s.directCostCents ? `ohne ${formatEuro(s.directCostCents)} Direktkosten` : 'Ø über alle Fahrten'} />
                <Stat label="Fahrten" icon={<Car className="h-4 w-4" />} value={formatInt(data.trips.length)} sub={s.invalidTrips.length ? `${s.invalidTrips.length} unvollständig` : undefined} />
                <Stat label="Personen" icon={<Users className="h-4 w-4" />} value={formatInt(activePersons)} sub={data.persons.length !== activePersons ? `+ ${data.persons.length - activePersons} deaktiviert` : 'aktiv'} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardTitle sub="Gesamter Zeitraum">Kostenanteile je Person</CardTitle>
                  {rows.length === 0 ? (
                    <p className="text-sm text-slate-500">Noch keine Anteile – es fehlen Fahrten mit Kilometern.</p>
                  ) : (
                    <ul className="space-y-4">
                      {rows.map((r) => (
                        <li key={r.personId}>
                          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                            <span className="font-medium text-slate-800">{r.name}{!r.active && <span className="ml-1.5 text-xs font-normal text-slate-500">(inaktiv)</span>}</span>
                            <span className="tabular font-semibold text-slate-900">{formatEuro(r.totalCents)}</span>
                          </div>
                          <Bar value={r.totalCents} max={maxShare} />
                          <div className="mt-1 text-xs text-slate-500 tabular">{formatKm(r.km)} anteilig · {r.tripCount} Fahrt(en){s.distributedCents > 0 && ` · ${formatPercent(r.totalCents / s.distributedCents)}`}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.undistributedCents > 0 && <p className="mt-4 text-xs text-amber-700">{formatEuro(s.undistributedCents)} konnten noch nicht verteilt werden.</p>}
                </Card>

                <Card>
                  <CardTitle sub="Gesamter Zeitraum">Kosten nach Kategorie</CardTitle>
                  {s.categories.length === 0 ? (
                    <p className="text-sm text-slate-500">Noch keine Kosten erfasst.</p>
                  ) : (
                    <ul className="space-y-4">
                      {s.categories.map((c) => {
                        const cat = catName.get(c.categoryId)
                        return (
                          <li key={c.categoryId}>
                            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                              <span className="flex items-center gap-2 font-medium text-slate-800">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: cat?.color ?? '#94a3b8' }} />
                                {cat?.name ?? 'Unbekannte Kategorie'}
                              </span>
                              <span className="tabular font-semibold text-slate-900">{formatEuro(c.totalCents)}</span>
                            </div>
                            <Bar value={c.totalCents} max={s.totalCostCents} color={cat?.color} />
                            <div className="mt-1 text-xs text-slate-500">{c.entryCount} Buchung(en) · {formatPercent(s.totalCostCents ? c.totalCents / s.totalCostCents : 0)}</div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </Card>
              </div>
              {lastBackup && <p className="text-xs text-slate-500">Letztes Backup: {formatStamp(lastBackup)}</p>}
            </div>
          </Disclosure>
        </div>
      )}

      <TripFormModal open={tripOpen} onClose={() => setTripOpen(false)} persons={data.persons} trips={data.trips} settlements={data.settlements} />
      <ExpenseFormModal open={expenseOpen} onClose={() => setExpenseOpen(false)} categories={data.categories} persons={data.persons} />
    </>
  )
}
