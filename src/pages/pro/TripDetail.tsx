import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { useAppData } from '../../lib/store/context'
import type { Trip } from '../../lib/domain/types'
import { buildSettlement } from '../../lib/domain/settlement'
import { tripNights, tripPlaces } from '../../lib/domain/stats'
import { todayIso } from '../../lib/domain/dates'
import { flag, placeKey, useGeocode, type Place } from '../../lib/geo'
import { formatDateSpan, formatEuro, formatInt, formatKm } from '../../lib/format'
import { Badge, Button, Modal } from '../../components/ui'

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0d9488'

/** Kleine Karte einer Fahrt: Start → Zwischenstationen → Ziel, nummeriert und verbunden. */
function RouteMap({ points }: { points: { name: string; place: Place }[] }) {
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!el.current || points.length === 0) return
    const m = L.map(el.current, { zoomSnap: 0.25, wheelPxPerZoomLevel: 90, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(m)
    const color = token('--color-chart-1')
    const ring = token('--color-surface')
    const latlngs = points.map((p) => [p.place.lat, p.place.lon] as [number, number])
    if (latlngs.length > 1) L.polyline(latlngs, { color, weight: 3, opacity: 0.8, dashArray: '6 6' }).addTo(m)
    points.forEach((p, i) => {
      const last = i === points.length - 1
      L.marker([p.place.lat, p.place.lon], {
        icon: L.divIcon({
          className: '',
          html: `<span style="display:flex;width:24px;height:24px;align-items:center;justify-content:center;border-radius:9999px;background:${color};color:#fff;border:2px solid ${ring};font:600 12px/1 system-ui,sans-serif">${i + 1}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        title: p.name,
        zIndexOffset: last ? 100 : 0,
      }).bindTooltip(p.name, { direction: 'top', offset: [0, -10] }).addTo(m)
    })
    if (latlngs.length === 1) m.setView(latlngs[0], 9)
    else m.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 10 })
    return () => { m.remove() }
  }, [points])
  return <div ref={el} className="trip-map h-64 w-full overflow-hidden rounded-lg sm:h-80" role="region" aria-label="Karte der Strecke" />
}

export function TripDetailModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const data = useAppData()
  const names = useMemo(() => tripPlaces(trip), [trip])
  const { places, pending } = useGeocode(names)
  const points = useMemo(
    () => names.flatMap((name) => { const p = places.get(placeKey(name)); return p ? [{ name, place: p }] : [] }),
    [names, places],
  )
  const countries = useMemo(() => {
    const m = new Map<string, { name: string; code?: string }>()
    for (const p of points) if (p.place.country) m.set(p.place.countryCode ?? p.place.country, { name: p.place.country, code: p.place.countryCode })
    return [...m.values()]
  }, [points])
  // Kosten der Fahrt wie in der Gesamtabrechnung
  const result = useMemo(() => buildSettlement(data, { period: { kind: 'all' }, today: todayIso() }).trips.find((x) => x.tripId === trip.id), [data, trip.id])
  const pName = new Map(data.persons.map((p) => [p.id, p.name]))
  const nights = tripNights(trip)

  const facts: [string, React.ReactNode][] = [
    ['Gefahren', formatKm(trip.km)],
    ['Nächte', formatInt(nights)],
    ...(trip.odoStart != null && trip.odoEnd != null ? [['Kilometerstand', `${formatInt(trip.odoStart)} → ${formatInt(trip.odoEnd)}`] as [string, string]] : []),
    ...(result ? [['Kosten der Fahrt', formatEuro(result.costCents)] as [string, string]] : []),
  ]

  return (
    <Modal open onClose={onClose} size="lg" title={[trip.from, trip.to].filter(Boolean).join(' → ') || 'Fahrt'} description={formatDateSpan(trip.startDate, trip.endDate)}
      footer={<Button variant="primary" onClick={onClose}>Schließen</Button>}>
      <div className="space-y-5">
        {names.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Für eine Karte Start-, Ziel- oder Zwischenorte bei der Fahrt eintragen.</p>
        ) : points.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">{pending > 0 ? 'Orte werden gesucht …' : 'Die Orte wurden nicht gefunden.'}</p>
        ) : (
          <>
            <RouteMap points={points} />
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-700">
              {points.map((p, i) => (
                <li key={`${p.name}-${i}`} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden className="text-slate-400">→</span>}
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-chart-1 text-[11px] font-semibold text-white">{i + 1}</span>
                  {p.name}
                </li>
              ))}
            </ol>
            <p className="text-xs text-slate-500">Gestrichelt: Luftlinie zwischen den Stationen, nicht die gefahrene Strecke.</p>
          </>
        )}

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 p-3">
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">{v}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-700">Dabei</h3>
          <ul className="flex flex-wrap gap-2">
            {trip.personIds.map((id) => {
              const share = result?.shares.find((x) => x.personId === id)
              return (
                <li key={id}><Badge tone="brand">{pName.get(id) ?? 'Unbekannt'}{share && ` · ${formatEuro(share.cents)}`}</Badge></li>
              )
            })}
          </ul>
        </div>

        {countries.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700">Länder</h3>
            <ul className="flex flex-wrap gap-2">
              {countries.map((c) => <li key={c.code ?? c.name} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800"><span aria-hidden>{flag(c.code)}</span>{c.name}</li>)}
            </ul>
          </div>
        )}

        {trip.note && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{trip.note}</p>}
      </div>
    </Modal>
  )
}
