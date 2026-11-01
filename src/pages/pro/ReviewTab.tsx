import { useMemo } from 'react'
import { Share2 } from 'lucide-react'
import { useAppData } from '../../lib/store/context'
import { dueCosts, personName, tripPlaces, validTrips, yearReview } from '../../lib/domain/stats'
import { flag, placeKey, useGeocode } from '../../lib/geo'
import { formatDate, formatEuro, formatInt, formatKm, formatPricePerKm } from '../../lib/format'
import { Button, Card, EmptyState } from '../../components/ui'
import { useFeedback } from '../../components/feedback-context'

export function ReviewTab({ year, today }: { year: number; today: string }) {
  const data = useAppData()
  const { toast } = useFeedback()
  const costs = useMemo(() => dueCosts(data.expenses, today), [data.expenses, today])
  const r = useMemo(() => yearReview(data, costs, year, today), [data, costs, year, today])
  const tripsOfYear = useMemo(() => validTrips(data.trips).filter((t) => t.startDate.startsWith(String(year))), [data.trips, year])
  const names = useMemo(() => tripsOfYear.flatMap(tripPlaces), [tripsOfYear])
  const { places, pending } = useGeocode(names)
  const countries = useMemo(() => {
    const m = new Map<string, { name: string; code?: string }>()
    for (const n of names) {
      const p = places.get(placeKey(n))
      if (p?.country) m.set(p.countryCode ?? p.country, { name: p.country, code: p.countryCode })
    }
    return [...m.values()]
  }, [names, places])

  if (r.trips === 0) {
    return <Card><EmptyState illustration title={`Noch keine Fahrten in ${year}`}>Sobald Fahrten eingetragen sind, entsteht hier der Rückblick.</EmptyState></Card>
  }

  const top = r.topPerson ? personName(data.persons, r.topPerson.personId) : undefined
  const facts: [string, string][] = [
    ['Fahrten', formatInt(r.trips)],
    ['Tage unterwegs', formatInt(r.daysOnRoad)],
    ['Nächte im Bus', formatInt(r.nights)],
    ...(r.longest ? [['Längste Fahrt', `${formatKm(r.longest.km)}${r.longest.to ? ` nach ${r.longest.to}` : ''}`] as [string, string]] : []),
    ...(r.topPlace ? [['Lieblingsziel', `${r.topPlace.name} (${r.topPlace.count}×)`] as [string, string]] : []),
    ...(top && r.topPerson ? [['Am meisten unterwegs', `${top} (${formatKm(Math.round(r.topPerson.km))})`] as [string, string]] : []),
    ['Kosten', formatEuro(r.costCents)],
    ['Kosten pro km', formatPricePerKm(r.pricePerKm)],
  ]

  const share = async () => {
    const text = [
      `🚐 VW California – Rückblick ${year}`,
      `${formatKm(r.km)} in ${r.trips} Fahrten, ${r.nights} Nächte im Bus`,
      ...(countries.length ? [`Länder: ${countries.map((c) => `${flag(c.code)} ${c.name}`).join(', ')}`] : []),
      ...(r.topPlace ? [`Lieblingsziel: ${r.topPlace.name}`] : []),
      ...(r.longest ? [`Längste Fahrt: ${formatKm(r.longest.km)}${r.longest.to ? ` nach ${r.longest.to}` : ''} (${formatDate(r.longest.startDate)})`] : []),
    ].join('\n')
    try {
      if (navigator.share) await navigator.share({ text })
      else {
        await navigator.clipboard.writeText(text)
        toast('Rückblick in die Zwischenablage kopiert.')
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Teilen ist auf diesem Gerät nicht möglich.', 'error')
    }
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-brand-50 to-surface">
        <p className="text-sm font-medium text-brand-800">Euer Jahr {year}</p>
        <p className="mt-2 text-5xl font-semibold tracking-tight text-slate-900">{formatKm(r.km)}</p>
        <p className="mt-1 text-sm text-slate-600">mit dem California unterwegs</p>
        <div className="mt-4"><Button icon={<Share2 className="h-4 w-4" />} onClick={() => void share()}>Teilen</Button></div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <dl className="divide-y divide-slate-100">
            {facts.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-right font-semibold text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold text-slate-900">Länder {year}</h3>
          {countries.length === 0 ? (
            <p className="text-sm text-slate-500">{pending > 0 ? 'Orte werden gesucht …' : 'Keine Orte eingetragen. Start-, Ziel- und Zwischenorte bei den Fahrten ergänzen.'}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {countries.map((c) => (
                <li key={c.code ?? c.name} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800">
                  <span aria-hidden>{flag(c.code)}</span>{c.name}
                </li>
              ))}
            </ul>
          )}
          {pending > 0 && countries.length > 0 && <p className="mt-2 text-xs text-slate-500">Noch {pending} Ort(e) werden gesucht …</p>}
        </Card>
      </div>
    </div>
  )
}
