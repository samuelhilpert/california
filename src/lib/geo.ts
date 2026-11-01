/**
 * Ortsnamen → Koordinaten und Land über OpenStreetMap (Nominatim).
 *
 * Kostenlos, aber mit Nutzungsregeln: höchstens eine Anfrage pro Sekunde und Ergebnisse
 * zwischenspeichern. Daher fragt jedes Gerät jeden Ort nur einmal ab und merkt sich das
 * Ergebnis im Browser. Nicht gefundene Orte werden ebenfalls gemerkt (eine Woche lang).
 */
import { useEffect, useMemo, useState } from 'react'

export interface Place {
  lat: number
  lon: number
  /** Ländername auf Deutsch, z. B. „Spanien“. */
  country?: string
  /** ISO-Code in Kleinbuchstaben, z. B. „es“. */
  countryCode?: string
}

type CacheEntry = { place: Place | null; at: number }

const CACHE_PREFIX = 'geo:v1:'
const NOT_FOUND_TTL = 7 * 86_400_000
const ENDPOINT = 'https://nominatim.openstreetmap.org/search'

export const placeKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

function readCache(key: string): CacheEntry | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return undefined
    const e = JSON.parse(raw) as CacheEntry
    if (e.place === null && Date.now() - e.at > NOT_FOUND_TTL) return undefined
    return e
  } catch {
    return undefined
  }
}

function writeCache(key: string, place: Place | null) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ place, at: Date.now() } satisfies CacheEntry))
  } catch {
    // Speicher voll oder gesperrt – dann eben beim nächsten Mal erneut abfragen
  }
}

// Eine gemeinsame Warteschlange für die ganze App: höchstens eine Anfrage pro Sekunde
let queue: Promise<unknown> = Promise.resolve()
const inflight = new Map<string, Promise<Place | null>>()

async function fetchPlace(name: string): Promise<Place | null> {
  const url = `${ENDPOINT}?format=jsonv2&limit=1&addressdetails=1&accept-language=de&q=${encodeURIComponent(name)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Ortssuche fehlgeschlagen (${res.status})`)
  const list = (await res.json()) as { lat: string; lon: string; address?: { country?: string; country_code?: string } }[]
  const hit = list[0]
  if (!hit) return null
  return { lat: Number(hit.lat), lon: Number(hit.lon), country: hit.address?.country, countryCode: hit.address?.country_code?.toLowerCase() }
}

/** Liefert den Ort aus dem Zwischenspeicher oder fragt ihn (gedrosselt) ab. */
export function geocode(name: string): Promise<Place | null> {
  const key = placeKey(name)
  const cached = readCache(key)
  if (cached) return Promise.resolve(cached.place)
  const running = inflight.get(key)
  if (running) return running
  const p = queue
    .then(() => fetchPlace(name))
    .then((place) => {
      writeCache(key, place)
      return place
    })
    .finally(() => inflight.delete(key))
  queue = p.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, 1100)))
  inflight.set(key, p)
  return p
}

export function cachedPlace(name: string): Place | null | undefined {
  return readCache(placeKey(name))?.place
}

/**
 * Löst alle Namen auf und aktualisiert die Ansicht nach und nach.
 * `places`: gefunden (Place), nicht gefunden (null); fehlende Schlüssel = noch offen.
 */
export function useGeocode(names: string[]): { places: Map<string, Place | null>; pending: number; failed: boolean } {
  const unique = [...new Set(names.map(placeKey).filter(Boolean))]
  const sig = unique.join('|')
  // Nur frisch abgefragte Orte liegen im State; Zwischengespeichertes wird direkt gelesen.
  const [fetched, setFetched] = useState(() => new Map<string, Place | null>())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    for (const key of sig ? sig.split('|') : []) {
      if (readCache(key)) continue
      geocode(key)
        .then((place) => alive && setFetched((m) => new Map(m).set(key, place)))
        .catch(() => alive && setFailed(true))
    }
    return () => { alive = false }
  }, [sig])

  // Stabil halten, solange sich nichts ändert – sonst zeichnen Karte und Listen bei jedem Rendern neu
  const places = useMemo(() => {
    const m = new Map<string, Place | null>()
    for (const key of sig ? sig.split('|') : []) {
      const c = readCache(key)
      if (c) m.set(key, c.place)
      else if (fetched.has(key)) m.set(key, fetched.get(key) ?? null)
    }
    return m
  }, [sig, fetched])
  return { places, pending: unique.length - places.size, failed }
}

/** Entfernung in km (Luftlinie). */
export function distanceKm(a: Place, b: Place): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Flaggen-Emoji aus dem Ländercode, z. B. „es“ → 🇪🇸. */
export function flag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '🏳️'
  return String.fromCodePoint(...[...countryCode.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}
