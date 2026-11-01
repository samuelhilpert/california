import { clsx } from 'clsx'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { BarChart3, CalendarDays, Fuel, Gauge, Map as MapIcon, Moon, PartyPopper, Route as RouteIcon, Sparkles, Wallet } from 'lucide-react'
import { useAppData, useProMode } from '../../lib/store/context'
import { todayIso } from '../../lib/domain/dates'
import { availableYears, costStats, dueCosts, fuelLog, kmStats, personName, usageStats } from '../../lib/domain/stats'
import { formatDate, formatEuro, formatInt, formatKm, formatPercent, formatPricePerKm } from '../../lib/format'
import { Button, Card, CardTitle, EmptyState, Notice, PageHeader, Select, Stat } from '../../components/ui'
import { BarList, ColumnChart, YearCalendar } from '../../components/charts'
import { Loading } from '../../components/Loading'
import { ReviewTab } from './ReviewTab'
import { FuelTab } from './FuelTab'

const MapTab = lazy(() => import('./MapTab').then((m) => ({ default: m.MapTab })))

export type ProTab = 'statistik' | 'tanken' | 'karte' | 'rueckblick'

const TABS: { tab: ProTab; to: string; label: string; short: string; icon: typeof BarChart3 }[] = [
  { tab: 'statistik', to: '/pro', label: 'Statistik', short: 'Statistik', icon: BarChart3 },
  { tab: 'tanken', to: '/pro/tanken', label: 'Tankbuch', short: 'Tanken', icon: Fuel },
  { tab: 'karte', to: '/pro/karte', label: 'Karte & Länder', short: 'Karte', icon: MapIcon },
  { tab: 'rueckblick', to: '/pro/rueckblick', label: 'Jahresrückblick', short: 'Rückblick', icon: PartyPopper },
]

const compactKm = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : formatInt(v))
const compactEuro = (cents: number) => (cents >= 1_000_000 ? `${Math.round(cents / 100_000)}k €` : `${formatInt(Math.round(cents / 100))} €`)

export function ProPage({ tab }: { tab: ProTab }) {
  const data = useAppData()
  const [pro] = useProMode()
  const today = todayIso()
  const costs = useMemo(() => dueCosts(data.expenses, today), [data.expenses, today])
  const years = useMemo(() => availableYears(data.trips, costs, today), [data.trips, costs, today])
  const [yearSel, setYearSel] = useState<string>(String(years[0]))
  const year = yearSel === 'all' ? null : Number(yearSel)

  if (!pro) {
    return (
      <>
        <PageHeader title="Entdecken" />
        <Card>
          <EmptyState icon={<Sparkles className="h-6 w-6" />} title="Der Pro-Modus ist ausgeschaltet" action={<Link to="/einstellungen"><Button variant="primary">Zu den Einstellungen</Button></Link>}>
            Statistiken, Karte und Jahresrückblick schaltest du in den Einstellungen frei.
          </EmptyState>
        </Card>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Entdecken" description="Statistiken, Karte und Rückblick – nur zum Anschauen, die Abrechnung bleibt unverändert." />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <nav className="flex gap-1 rounded-xl bg-slate-100 p-1" aria-label="Bereiche">
          {TABS.map((t) => (
            <NavLink key={t.tab} to={t.to} end className={({ isActive }) => clsx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-surface text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
              <t.icon className="hidden h-4 w-4 min-[400px]:block" /><span className="hidden sm:inline">{t.label}</span><span className="sm:hidden">{t.short}</span>
            </NavLink>
          ))}
        </nav>
        <Select value={yearSel} onChange={(e) => setYearSel(e.target.value)} aria-label="Jahr" className="w-auto!">
          {tab !== 'rueckblick' && <option value="all">Alle Jahre</option>}
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      </div>

      {tab === 'statistik' && <StatsTab year={year} years={years} today={today} />}
      {tab === 'tanken' && <FuelTab year={year} />}
      {tab === 'karte' && <Suspense fallback={<Loading />}><MapTab year={year} /></Suspense>}
      {tab === 'rueckblick' && <ReviewTab year={year ?? years[0]} today={today} />}
    </>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">{icon}{title}</h2>
      {children}
    </section>
  )
}

function StatsTab({ year, years, today }: { year: number | null; years: number[]; today: string }) {
  const data = useAppData()
  const costs = useMemo(() => dueCosts(data.expenses, today), [data.expenses, today])
  const k = useMemo(() => kmStats(data.trips, year, years), [data.trips, year, years])
  const c = useMemo(() => costStats(data, costs, year, years), [data, costs, year, years])
  const usageYear = year ?? years[0]
  const u = useMemo(() => usageStats(data.trips, usageYear, today), [data.trips, usageYear, today])
  const allNights = useMemo(() => (year == null ? years.reduce((a, y) => a + usageStats(data.trips, y, today).nights, 0) : u.nights), [data.trips, year, years, today, u.nights])
  const f = useMemo(() => fuelLog(data.fuel, year), [data.fuel, year])
  const cat = new Map(data.categories.map((x) => [x.id, x]))
  const name = (id: string) => personName(data.persons, id)
  const periodWord = year == null ? 'Jahr' : 'Monat'

  if (k.trips === 0 && c.totalCents === 0) {
    return <Card><EmptyState icon={<BarChart3 className="h-6 w-6" />} title={year ? `Keine Daten für ${year}` : 'Noch keine Daten'}>Sobald Fahrten oder Kosten eingetragen sind, erscheinen hier die Auswertungen.</EmptyState></Card>
  }

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Kilometer" icon={<Gauge className="h-4 w-4" />} value={formatKm(k.km)} sub={`${formatInt(k.trips)} Fahrten · Ø ${formatKm(Math.round(k.avgKm))}`} />
        <Stat label="Nächte im Bus" icon={<Moon className="h-4 w-4" />} value={formatInt(allNights)} sub={year != null ? `${u.daysOnRoad} Tage unterwegs` : undefined} />
        <Stat label="Kosten (fällig)" icon={<Wallet className="h-4 w-4" />} value={formatEuro(c.totalCents)} />
        <Stat label="Kosten pro km" icon={<RouteIcon className="h-4 w-4" />} value={formatPricePerKm(k.km ? c.totalCents / 100 / k.km : null)} sub="fällige Kosten ÷ km" />
      </div>

      <Section title="Kilometer" icon={<Gauge className="h-5 w-5 text-brand-700" />}>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle sub={year ? String(year) : 'Alle Jahre'}>Kilometer je {periodWord}</CardTitle>
            <ColumnChart data={k.series} format={(v) => formatKm(Math.round(v))} formatAxis={compactKm} label={`Kilometer je ${periodWord}`} />
          </Card>
          <Card>
            <CardTitle sub="Anteilig: Fahrt-km ÷ Beteiligte">Je Person</CardTitle>
            <BarList rows={k.perPerson.map((p) => ({ key: p.personId, label: name(p.personId), value: p.km, sub: `${p.trips} Fahrt(en)` }))} format={(v) => formatKm(Math.round(v))} />
            {k.longest && (
              <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
                Längste Fahrt: <strong className="text-slate-900">{formatKm(k.longest.km)}</strong> am {formatDate(k.longest.startDate)}
                {k.longest.to && <> nach {k.longest.to}</>}
              </p>
            )}
          </Card>
        </div>
      </Section>

      <Section title="Kosten" icon={<Wallet className="h-5 w-5 text-brand-700" />}>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle sub="Bis heute fällig">Kosten je {periodWord}</CardTitle>
            <ColumnChart data={c.series} format={formatEuro} formatAxis={compactEuro} label={`Kosten je ${periodWord}`} />
          </Card>
          <Card>
            <CardTitle>Nach Kategorie</CardTitle>
            <BarList rows={c.byCategory.map((x) => ({ key: x.categoryId, label: cat.get(x.categoryId)?.name ?? 'Unbekannt', value: x.cents, color: cat.get(x.categoryId)?.color, sub: formatPercent(c.totalCents ? x.cents / c.totalCents : 0) }))} format={formatEuro} />
          </Card>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle sub="Laut „Bezahlt von“">Wer hat bezahlt?</CardTitle>
            {c.paidBy.length === 0 ? <p className="text-sm text-slate-500">Bei keiner Ausgabe ist „Bezahlt von“ eingetragen.</p> : (
              <BarList rows={c.paidBy.map((p) => ({ key: p.personId, label: name(p.personId), value: p.cents }))} format={formatEuro} />
            )}
            {c.unknownPayerCents > 0 && <p className="mt-3 text-xs text-slate-500">{formatEuro(c.unknownPayerCents)} ohne Angabe bzw. gemeinsames Konto.</p>}
          </Card>
          {c.pricePerKmByYear.length >= 2 && (
            <Card>
              <CardTitle sub="Fällige Kosten ÷ gefahrene km">Kosten pro km je Jahr</CardTitle>
              <ColumnChart data={c.pricePerKmByYear} format={(v) => formatPricePerKm(v)} formatAxis={(v) => `${v.toFixed(2).replace('.', ',')} €`} label="Kosten pro km je Jahr" height={180} />
            </Card>
          )}
        </div>
      </Section>

      <Section title={`Nutzung & Nächte ${usageYear}`} icon={<CalendarDays className="h-5 w-5 text-brand-700" />}>
        {year == null && <p className="-mt-2 text-sm text-slate-500">Der Kalender zeigt das Jahr {usageYear}. Für andere Jahre oben ein Jahr wählen.</p>}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle sub={`${u.daysOnRoad} von ${u.daysInPeriod} Tagen unterwegs · Auslastung ${formatPercent(u.utilization)}`}>Wann war der Bus unterwegs?</CardTitle>
            <YearCalendar year={usageYear} kmPerDay={u.kmPerDay} today={today} />
          </Card>
          <Card>
            <CardTitle sub={`${u.nights} Nächte insgesamt`}>Nächte je Person</CardTitle>
            {u.perPerson.length === 0 ? <p className="text-sm text-slate-500">Keine mehrtägigen Fahrten. Nächte zählen, wenn bei einer Fahrt ein Enddatum eingetragen ist.</p> : (
              <BarList rows={u.perPerson.map((p) => ({ key: p.personId, label: name(p.personId), value: p.nights, sub: `${p.days} Tag(e) unterwegs` }))} format={(v) => `${formatInt(v)} Nächte`} />
            )}
          </Card>
        </div>
      </Section>

      <Section title="Verbrauch" icon={<Fuel className="h-5 w-5 text-brand-700" />}>
        {f.entries.length === 0 ? (
          <Notice level="info" title="Noch keine Tankfüllungen">Tankfüllungen trägst du im <Link to="/pro/tanken" className="font-medium underline">Tankbuch</Link> ein – mit Kilometerstand berechnet die App den Verbrauch.</Notice>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Ø Verbrauch" value={f.avgPer100km != null ? `${f.avgPer100km.toFixed(1).replace('.', ',')} l` : '–'} sub="je 100 km" />
            <Stat label="Ø Spritpreis" value={f.avgPricePerLiter != null ? `${f.avgPricePerLiter.toFixed(2).replace('.', ',')} €` : '–'} sub="je Liter" />
            <Stat label="Getankt" value={`${formatInt(Math.round(f.liters))} l`} sub={`${f.entries.length} Tankfüllung(en)`} />
            <Card className="flex items-center justify-center"><Link to="/pro/tanken" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"><Fuel className="h-4 w-4" />Zum Tankbuch</Link></Card>
          </div>
        )}
      </Section>
    </div>
  )
}
