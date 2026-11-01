/**
 * Erfolge (Pro-Modus): Abzeichen für das Auto oder eine Person, berechnet aus den Fahrten.
 * Jedes Abzeichen merkt sich das Datum, an dem es erreicht wurde; offene zeigen den Fortschritt.
 */
import type { IsoDate, Trip } from './types'
import { tripNights, validTrips } from './stats'

export type BadgeIcon = 'flag' | 'gauge' | 'route' | 'moon' | 'tent' | 'globe' | 'map' | 'sun' | 'snow' | 'calendar'

export interface Badge {
  id: string
  title: string
  description: string
  icon: BadgeIcon
  /** Datum der Fahrt, mit der das Abzeichen erreicht wurde. */
  achievedAt?: IsoDate
  progress?: { value: number; target: number }
}

interface Ladder {
  key: string
  icon: BadgeIcon
  steps: { target: number; title: string; description: string }[]
}

const KM: Ladder = {
  key: 'km',
  icon: 'gauge',
  steps: [
    { target: 1_000, title: '1.000 km', description: 'Die ersten tausend Kilometer' },
    { target: 5_000, title: '5.000 km', description: 'Fünftausend Kilometer unterwegs' },
    { target: 10_000, title: '10.000 km', description: 'Zehntausend Kilometer – ein Viertel um die Erde' },
    { target: 25_000, title: '25.000 km', description: 'Einmal fast um die ganze Welt' },
    { target: 50_000, title: '50.000 km', description: 'Fünfzigtausend Kilometer' },
  ],
}
const NIGHTS: Ladder = {
  key: 'nights',
  icon: 'moon',
  steps: [
    { target: 1, title: 'Erste Nacht', description: 'Die erste Nacht im Bus' },
    { target: 10, title: '10 Nächte', description: 'Zehn Nächte im Bus geschlafen' },
    { target: 30, title: '30 Nächte', description: 'Ein ganzer Monat im Bus' },
    { target: 100, title: '100 Nächte', description: 'Hundert Nächte im Bus' },
  ],
}
const COUNTRIES: Ladder = {
  key: 'countries',
  icon: 'globe',
  steps: [
    { target: 2, title: 'Über die Grenze', description: 'Zwei Länder bereist' },
    { target: 5, title: 'Länder-Sammler', description: 'Fünf Länder bereist' },
    { target: 10, title: 'Weltenbummler', description: 'Zehn Länder bereist' },
  ],
}

const season = (d: IsoDate) => {
  const m = Number(d.slice(5, 7))
  return m === 12 || m <= 2 ? 0 : m <= 5 ? 1 : m <= 8 ? 2 : 3
}
const weekday = (d: IsoDate) => new Date(`${d}T12:00:00Z`).getUTCDay() // 0 = Sonntag

/**
 * @param personId  null = Auto (alle Fahrten), sonst nur Fahrten mit dieser Person
 * @param countriesOf  Länder einer Fahrt (aus der Ortssuche; leer, solange unbekannt)
 */
export function achievements(trips: Trip[], personId: string | null, countriesOf: (t: Trip) => string[]): Badge[] {
  const list = validTrips(trips)
    .filter((t) => personId == null || t.personIds.includes(personId))
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))

  const found = new Map<string, IsoDate>()
  const hit = (id: string, date: IsoDate) => { if (!found.has(id)) found.set(id, date) }
  let km = 0
  let nights = 0
  const countries = new Set<string>()
  const seasonsByYear = new Map<string, Set<number>>()
  let maxTrip = 0
  let maxNights = 0
  let maxCountriesInTrip = 0

  for (const t of list) {
    const date = t.endDate ?? t.startDate
    const n = tripNights(t)
    const cs = countriesOf(t)
    km += t.km
    nights += n
    cs.forEach((c) => countries.add(c))
    maxTrip = Math.max(maxTrip, t.km)
    maxNights = Math.max(maxNights, n)
    maxCountriesInTrip = Math.max(maxCountriesInTrip, new Set(cs).size)

    hit('first', t.startDate)
    for (const s of KM.steps) if (km >= s.target) hit(`km-${s.target}`, date)
    for (const s of NIGHTS.steps) if (nights >= s.target) hit(`nights-${s.target}`, date)
    for (const s of COUNTRIES.steps) if (countries.size >= s.target) hit(`countries-${s.target}`, date)
    if (t.km >= 1000) hit('long-1000', date)
    if (t.km >= 3000) hit('long-3000', date)
    if (n >= 7) hit('stay-7', date)
    if (n >= 14) hit('stay-14', date)
    if (new Set(cs).size >= 3) hit('hopping', date)
    // Wochenende: Start Freitag oder Samstag, 1–2 Nächte
    if ((weekday(t.startDate) === 5 || weekday(t.startDate) === 6) && n >= 1 && n <= 2) hit('weekend', date)
    // Winter: eine Nacht zwischen Dezember und Februar
    if (n >= 1 && season(t.startDate) === 0) hit('winter', date)
    const y = t.startDate.slice(0, 4)
    const ss = seasonsByYear.get(y) ?? new Set<number>()
    ss.add(season(t.startDate))
    seasonsByYear.set(y, ss)
    if (ss.size === 4) hit('seasons', date)
  }

  const bestSeasons = Math.max(0, ...[...seasonsByYear.values()].map((s) => s.size))
  const ladder = (l: Ladder, value: number): Badge[] =>
    l.steps.map((s) => ({ id: `${l.key}-${s.target}`, title: s.title, description: s.description, icon: l.icon, achievedAt: found.get(`${l.key}-${s.target}`), progress: { value: Math.min(value, s.target), target: s.target } }))
  const single = (id: string, title: string, description: string, icon: BadgeIcon, value: number, target: number): Badge => ({
    id, title, description, icon, achievedAt: found.get(id), progress: { value: Math.min(value, target), target },
  })

  return [
    single('first', 'Los geht’s', 'Die erste Fahrt', 'flag', list.length, 1),
    ...ladder(KM, km),
    single('long-1000', 'Langstrecke', 'Eine Fahrt mit mindestens 1.000 km', 'route', maxTrip, 1000),
    single('long-3000', 'Große Tour', 'Eine Fahrt mit mindestens 3.000 km', 'route', maxTrip, 3000),
    ...ladder(NIGHTS, nights),
    single('weekend', 'Wochenend-Ausflug', 'Freitag oder Samstag los, 1–2 Nächte', 'tent', 0, 1),
    single('stay-7', 'Eine Woche unterwegs', 'Mindestens 7 Nächte am Stück', 'calendar', maxNights, 7),
    single('stay-14', 'Zwei Wochen am Stück', 'Mindestens 14 Nächte am Stück', 'calendar', maxNights, 14),
    ...ladder(COUNTRIES, countries.size),
    single('hopping', 'Länder-Hopping', 'Drei Länder in einer Fahrt', 'map', maxCountriesInTrip, 3),
    single('winter', 'Wintercamper', 'Eine Nacht im Bus zwischen Dezember und Februar', 'snow', 0, 1),
    single('seasons', 'Ganzjahres-Camper', 'In allen vier Jahreszeiten eines Jahres unterwegs', 'sun', bestSeasons, 4),
  ].map((b) => (b.achievedAt ? { ...b, progress: undefined } : b))
}
