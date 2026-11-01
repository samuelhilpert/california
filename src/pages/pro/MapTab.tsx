import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#b5843f'
const isDark = () => document.documentElement.classList.contains('dark')

/**
 * Eigene, ruhige Kartengrundlage: Meer, Land und Grenzen aus Natural Earth (1:50 Mio., gemeinfrei,
 * verkleinert unter public/geo/laender.json). Erst beim Hineinzoomen blendet OpenStreetMap mit
 * Straßen und Orten ein (in Grautönen, siehe .trip-map in index.css).
 */
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const DETAIL_ZOOM = 6
const ATTRIBUTION = 'Grenzen: Natural Earth · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

type CountryProps = { code: string; name: string }
type CountryFeature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, CountryProps>
type Countries = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, CountryProps>
let countriesPromise: Promise<Countries | null> | null = null
/** Ländergrenzen einmal laden (nur wenn die Karte geöffnet wird). */
function loadCountries(): Promise<Countries | null> {
  countriesPromise ??= fetch(`${import.meta.env.BASE_URL}geo/laender.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Countries>) : null))
    .catch(() => null)
  return countriesPromise
}

type Ring = GeoJSON.Position[]
const polygonsOf = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon): Ring[][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
const ringBounds = (r: Ring) => L.latLngBounds(r.map(([lon, lat]) => [lat, lon] as [number, number]))

/**
 * Ausschnitt eines Landes: nur die Teilflächen, in denen Ziele liegen – sonst würde z. B. Frankreich
 * wegen Französisch-Guayana bis nach Südamerika reichen. Ohne Ziel: die größte Teilfläche.
 */
function countryBounds(f: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, CountryProps>, points: L.LatLng[]): L.LatLngBounds {
  const parts = polygonsOf(f.geometry).map((p) => ringBounds(p[0]))
  const hit = parts.filter((b) => points.some((pt) => b.contains(pt)))
  if (hit.length) return hit.reduce((acc, b) => acc.extend(b), L.latLngBounds(hit[0].getSouthWest(), hit[0].getNorthEast()))
  const area = (b: L.LatLngBounds) => (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest())
  return parts.sort((x, y) => area(y) - area(x))[0]
}

export type MapFocus = { kind: 'all' } | { kind: 'country'; code: string } | { kind: 'place'; lat: number; lon: number }

function TripMap({ stops, visited, focus }: { stops: Stop[]; visited: Set<string>; focus: { target: MapFocus; n: number } }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef<L.LayerGroup | null>(null)
  const countryLayer = useRef<L.GeoJSON<CountryProps> | null>(null)
  const [dark, setDark] = useState(isDark)
  const [countries, setCountries] = useState<Countries | null>(null)
  const [zoom, setZoom] = useState(4)

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

  // Ausschnitt mit allen besuchten Ländern (bzw. allen Zielen)
  const fitAll = useRef<() => void>(() => {})
  // Immer mit den aktuellen Daten (Knopf und Effekte rufen die Ref auf)
  useLayoutEffect(() => {
    fitAll.current = () => {
      const m = map.current
      if (!m) return
      const pts = stops.map((s) => L.latLng(s.place.lat, s.place.lon))
      let b: L.LatLngBounds | null = pts.length ? L.latLngBounds(pts) : null
      for (const f of countries?.features ?? []) {
        if (!visited.has(f.properties.code)) continue
        const cb = countryBounds(f, pts)
        b = b ? b.extend(cb) : cb
      }
      if (b) m.flyToBounds(b, { padding: [24, 24], maxZoom: 8, duration: 0.6 })
    }
  })

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, {
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      minZoom: 2,
      maxZoom: 16,
      worldCopyJump: true,
      attributionControl: true,
    }).setView([47, 10], 4)
    m.createPane('countries').style.zIndex = '250' // über den Kacheln, unter den Punkten
    L.tileLayer(TILES, { minZoom: DETAIL_ZOOM, maxZoom: 18, attribution: ATTRIBUTION }).addTo(m)
    markers.current = L.layerGroup().addTo(m)
    m.on('zoomend', () => setZoom(m.getZoom()))
    // Knopf „Alles anzeigen“ unter +/−
    const Fit = L.Control.extend({
      onAdd: () => {
        const b = L.DomUtil.create('button', 'leaflet-bar trip-map-fit')
        b.type = 'button'
        b.title = 'Alles anzeigen'
        b.setAttribute('aria-label', 'Alles anzeigen')
        b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>'
        L.DomEvent.disableClickPropagation(b)
        L.DomEvent.on(b, 'click', () => fitAll.current())
        return b
      },
    })
    new Fit({ position: 'topleft' }).addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  // Länder: Fläche, Grenzen, besuchte eingefärbt; Hinweis mit Namen; Klick zoomt hin
  useEffect(() => {
    const m = map.current
    if (!m || !countries) return
    const pts = stops.map((s) => L.latLng(s.place.lat, s.place.lon))
    const g = L.geoJSON(countries, {
      pane: 'countries',
      onEachFeature: (f, layer) => {
        const tip = document.createElement('span')
        tip.textContent = f.properties.name + (visited.has(f.properties.code) ? ' · besucht' : '')
        layer.bindTooltip(tip, { sticky: true, direction: 'top', opacity: 0.95 })
        layer.on('click', () => m.flyToBounds(countryBounds(f as CountryFeature, pts), { padding: [24, 24], maxZoom: 8, duration: 0.6 }))
      },
    }).addTo(m)
    countryLayer.current = g
    return () => {
      g.remove()
      countryLayer.current = null
    }
  }, [countries, visited, stops])

  // Stil je nach Zoom: weit draußen eigene Karte, hineingezoomt scheint OpenStreetMap durch
  useEffect(() => {
    const g = countryLayer.current
    if (!g) return
    const detail = zoom >= DETAIL_ZOOM
    const color = token('--color-chart-1')
    const land = token('--color-map-land')
    const border = token('--color-map-border')
    g.setStyle((f) => {
      const on = !!f && visited.has(f.properties.code)
      return {
        color: on ? color : border,
        weight: on ? 1.5 : 1,
        opacity: detail ? 0.6 : 1,
        fillColor: on ? color : land,
        fillOpacity: on ? (detail ? 0.18 : 0.55) : detail ? 0 : 1,
      }
    })
  }, [zoom, visited, dark, countries, stops])

  // Ziele als Punkte
  useEffect(() => {
    const g = markers.current
    if (!g) return
    g.clearLayers()
    const color = token('--color-chart-1')
    const ring = token('--color-surface')
    for (const s of stops) {
      const popup = document.createElement('div')
      const title = document.createElement('strong')
      title.textContent = s.name
      popup.append(title, document.createElement('br'), `${s.visits}× angefahren`)
      L.circleMarker([s.place.lat, s.place.lon], {
        radius: s.destination ? Math.min(9, 4 + s.visits) : 3.5,
        color: ring,
        weight: 2,
        fillColor: color,
        fillOpacity: s.destination ? 1 : 0.6,
      })
        .bindPopup(popup)
        .bindTooltip(s.name, { direction: 'top' })
        .addTo(g)
    }
  }, [stops, dark])

  // Startausschnitt bzw. nach Filterwechsel: alles zeigen – kurz verzögert, damit die Karte
  // nicht bei jedem nachträglich gefundenen Ort springt
  useEffect(() => {
    if (!countries) return
    const t = setTimeout(() => fitAll.current(), 400)
    return () => clearTimeout(t)
  }, [countries, stops, visited])

  // Fokus von außen (Klick in Länder- oder Zielliste)
  useEffect(() => {
    const m = map.current
    if (!m || focus.n === 0) return
    const t = focus.target
    if (t.kind === 'all') fitAll.current()
    else if (t.kind === 'place') m.flyTo([t.lat, t.lon], Math.max(m.getZoom(), 9), { duration: 0.6 })
    else {
      const f = countries?.features.find((x) => x.properties.code === t.code)
      if (f) m.flyToBounds(countryBounds(f, stops.map((s) => L.latLng(s.place.lat, s.place.lon))), { padding: [24, 24], maxZoom: 8, duration: 0.6 })
    }
    el.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focus, countries, stops])

  return <div ref={el} className="trip-map h-[440px] w-full overflow-hidden rounded-lg sm:h-[560px]" role="region" aria-label="Karte der Fahrten" />
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
  const [focus, setFocus] = useState<{ target: MapFocus; n: number }>({ target: { kind: 'all' }, n: 0 })
  const focusOn = (target: MapFocus) => setFocus((f) => ({ target, n: f.n + 1 }))
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
          <TripMap stops={stops} visited={visited} focus={focus} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-1 pt-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm border border-chart-1 bg-chart-1/55" />besuchtes Land</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-chart-1" />Ziel oder Zwischenstation (größer = öfter)</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-chart-1/60" />Startort</span>
            <span>Zoomen mit Mausrad, zwei Fingern oder +/−. Klick auf ein Land zoomt hin.</span>
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
                <li key={c.code ?? c.name}>
                  <button type="button" onClick={() => c.code && focusOn({ kind: 'country', code: c.code })} className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="flex items-center gap-2 font-medium text-slate-800"><span aria-hidden className="text-lg">{flag(c.code)}</span>{c.name}</span>
                    <span className="text-right text-xs text-slate-500">{c.trips.size} Fahrt(en) · erstmals {formatDate(c.first)}<span className="sr-only"> – auf der Karte zeigen</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle sub="Wie oft angefahren (Ziel oder Zwischenstation)">Häufigste Ziele</CardTitle>
          <ul className="divide-y divide-slate-100">
            {stops.filter((s) => s.destination).sort((a, b) => b.visits - a.visits).slice(0, 8).map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => focusOn({ kind: 'place', lat: s.place.lat, lon: s.place.lon })} className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="flex items-center gap-2 text-slate-800"><span aria-hidden>{flag(s.place.countryCode)}</span>{s.name}</span>
                  <span className="tabular font-medium text-slate-900">{s.visits}×<span className="sr-only"> – auf der Karte zeigen</span></span>
                </button>
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
