import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useAppData, useMyPerson } from '../../lib/store/context'
import type { Trip } from '../../lib/domain/types'
import { tripPlaces, validTrips } from '../../lib/domain/stats'
import { flag, placeKey, useGeocode, type Place } from '../../lib/geo'
import { formatDate, formatInt, formatKm } from '../../lib/format'
import { Card, CardTitle, EmptyState, Notice, Select } from '../../components/ui'

interface Stop {
  key: string
  name: string
  place: Place
  visits: number
  /** Ziel oder Zwischenstation (nicht nur Startort). */
  destination: boolean
}

/** Liest eine Farbe aus den Design-Tokens, damit Karte und Diagramme zusammenpassen (hell/dunkel). */
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0d9488'

/**
 * Grundkarte von OpenStreetMap, per CSS in Grautönen (siehe .trip-map in index.css), damit die
 * selbst gezeichneten Ländergrenzen und die besuchten Länder hervortreten.
 * Ländergrenzen: Natural Earth 1:110 Mio. (gemeinfrei), verkleinert unter public/geo/laender.json.
 */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Grenzen: Natural Earth'
const isDark = () => document.documentElement.classList.contains('dark')

type Countries = GeoJSON.FeatureCollection<GeoJSON.Geometry, { code: string; name: string }>
let countriesPromise: Promise<Countries | null> | null = null
/** Ländergrenzen einmal laden (nur wenn die Karte geöffnet wird). */
function loadCountries(): Promise<Countries | null> {
  countriesPromise ??= fetch(`${import.meta.env.BASE_URL}geo/laender.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Countries>) : null))
    .catch(() => null)
  return countriesPromise
}

function TripMap({ stops, visited }: { stops: Stop[]; visited: Set<string> }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const [dark, setDark] = useState(isDark)
  const [countries, setCountries] = useState<Countries | null>(null)

  useEffect(() => {
    let alive = true
    void loadCountries().then((c) => alive && setCountries(c))
    return () => { alive = false }
  }, [])

  // Design-Wechsel (hell/dunkel) beobachten, damit Karte und Punkte mitwechseln
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { scrollWheelZoom: false, worldCopyJump: true }).setView([48.1, 11.6], 5)
    map.current = m
    layer.current = L.layerGroup().addTo(m)
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    const tiles = L.tileLayer(TILES, { maxZoom: 18, attribution: ATTRIBUTION }).addTo(m)
    return () => { tiles.remove() }
  }, [])

  // Ländergrenzen für alle Länder, besuchte Länder eingefärbt
  useEffect(() => {
    const m = map.current
    if (!m || !countries) return
    const color = token('--color-chart-1')
    const line = dark ? '#94a3b8' : '#475569'
    const g = L.geoJSON(countries, {
      interactive: false,
      style: (f) => {
        const on = !!f && visited.has(f.properties.code)
        return { color: line, weight: 1, opacity: 0.8, fillColor: color, fillOpacity: on ? 0.35 : 0 }
      },
    }).addTo(m)
    // Grenzen unter die Punkte legen
    g.bringToBack()
    return () => { g.remove() }
  }, [countries, visited, dark])

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const color = token('--color-chart-1')
    const ring = token('--color-surface')
    for (const s of stops) {
      const popup = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = s.name
      popup.append(title, document.createElement('br'), `${s.visits}× angefahren`)
      L.circleMarker([s.place.lat, s.place.lon], {
        radius: s.destination ? Math.min(10, 5 + s.visits) : 4,
        color: ring,
        weight: 2,
        fillColor: color,
        fillOpacity: s.destination ? 1 : 0.5,
      })
        .bindPopup(popup)
        .bindTooltip(s.name)
        .addTo(g)
    }
    // Punkte über den Ländergrenzen halten
    g.eachLayer((l) => (l as L.CircleMarker).bringToFront?.())
    const pts = stops.map((s) => [s.place.lat, s.place.lon] as [number, number])
    if (pts.length === 1) m.setView(pts[0], 8)
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 9 })
  }, [stops, dark, countries])

  return <div ref={el} className="trip-map h-[420px] w-full overflow-hidden rounded-lg sm:h-[520px]" role="region" aria-label="Karte der Fahrten" />
}

export function MapTab({ year }: { year: number | null }) {
  const data = useAppData()
  const me = useMyPerson()
  // Karte gehört zum Auto (alle Fahrten); auf Wunsch nur die eigenen oder die einer Person
  const [person, setPerson] = useState('')
  const trips = useMemo(
    () => validTrips(data.trips).filter((t) => (year == null || t.startDate.startsWith(String(year))) && (!person || t.personIds.includes(person))),
    [data.trips, year, person],
  )
  const withPlaces = trips.filter((t) => tripPlaces(t).length > 0)
  const names = useMemo(() => trips.flatMap(tripPlaces), [trips])
  const { places, pending, failed } = useGeocode(names)

  const { stops, countries, notFound } = useMemo(() => {
    const stopMap = new Map<string, Stop>()
    const countryMap = new Map<string, { name: string; code?: string; first: string; trips: Set<string> }>()
    const notFound = new Set<string>()
    const sorted = [...trips].sort((a: Trip, b: Trip) => (a.startDate < b.startDate ? -1 : 1))
    for (const t of sorted) {
      const names = tripPlaces(t)
      names.forEach((name, i) => {
        const key = placeKey(name)
        const p = places.get(key)
        if (p === null) notFound.add(name)
        if (!p) return
        const isDest = i > 0 || !t.from
        const s = stopMap.get(key) ?? { key, name, place: p, visits: 0, destination: false }
        s.visits++
        s.destination ||= isDest
        stopMap.set(key, s)
        if (p.country) {
          const ck = p.countryCode ?? p.country
          const c = countryMap.get(ck) ?? { name: p.country, code: p.countryCode, first: t.startDate, trips: new Set<string>() }
          c.trips.add(t.id)
          if (t.startDate < c.first) c.first = t.startDate
          countryMap.set(ck, c)
        }
      })
    }
    return {
      stops: [...stopMap.values()],
      countries: [...countryMap.values()].sort((a, b) => b.trips.size - a.trips.size),
      notFound: [...notFound],
    }
  }, [trips, places])

  const persons = data.persons.filter((p) => data.trips.some((t) => t.personIds.includes(p.id)))
  const visited = useMemo(() => new Set(countries.map((c) => c.code).filter((c): c is string => !!c)), [countries])
  const missing = trips.length - withPlaces.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Wessen Fahrten?" className="w-auto!">
          <option value="">Auto (alle Fahrten)</option>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me?.id ? ' (du)' : ''}</option>)}
        </Select>
        <span className="text-sm text-slate-500">
          {formatInt(withPlaces.length)} von {formatInt(trips.length)} Fahrten mit Ort · {formatKm(trips.reduce((a, t) => a + t.km, 0))}
          {pending > 0 && <> · {pending} Ort(e) werden gesucht …</>}
        </span>
      </div>

      {failed && <Notice level="warning">Die Ortssuche (OpenStreetMap) ist gerade nicht erreichbar. Bereits gefundene Orte werden angezeigt.</Notice>}

      {withPlaces.length === 0 ? (
        <Card>
          <EmptyState icon={<MapPin className="h-6 w-6" />} title="Noch keine Orte">
            Trage bei Fahrten unter „Weitere Angaben“ Start-, Ziel- oder Zwischenorte ein – dann erscheinen sie hier auf der Karte.
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false} className="p-2">
          <TripMap stops={stops} visited={visited} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1 pt-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm border border-slate-500 bg-chart-1/35" />besuchtes Land</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-chart-1" />Ziel oder Zwischenstation (größer = öfter)</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-chart-1/50" />Startort</span>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle sub={year ? String(year) : 'Alle Jahre'}>Besuchte Länder</CardTitle>
          {countries.length === 0 ? (
            <p className="text-sm text-slate-500">{pending > 0 ? 'Orte werden gesucht …' : 'Noch keine Länder – es fehlen Orte bei den Fahrten.'}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {countries.map((c) => (
                <li key={c.code ?? c.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2 font-medium text-slate-800"><span aria-hidden className="text-lg">{flag(c.code)}</span>{c.name}</span>
                  <span className="text-right text-xs text-slate-500">{c.trips.size} Fahrt(en) · erstmals {formatDate(c.first)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle sub="Wie oft angefahren (Ziel oder Zwischenstation)">Häufigste Ziele</CardTitle>
          <ul className="divide-y divide-slate-100">
            {stops.filter((s) => s.destination).sort((a, b) => b.visits - a.visits).slice(0, 8).map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2 text-slate-800"><span aria-hidden>{flag(s.place.countryCode)}</span>{s.name}</span>
                <span className="tabular font-medium text-slate-900">{s.visits}×</span>
              </li>
            ))}
          </ul>
          {(missing > 0 || notFound.length > 0) && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {missing > 0 && <>{missing} Fahrt(en) ohne Ortsangabe. </>}
              {notFound.length > 0 && <>Nicht gefunden: {notFound.join(', ')}. Ein genauerer Name hilft, z. B. „Gardasee, Italien“.</>}
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
