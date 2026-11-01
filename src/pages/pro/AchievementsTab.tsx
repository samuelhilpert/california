import { clsx } from 'clsx'
import { useMemo, useState } from 'react'
import { CalendarDays, Flag, Gauge, Globe2, Lock, Map as MapIcon, Moon, Route, Snowflake, Sun, Tent } from 'lucide-react'
import { useAppData, useMyPerson } from '../../lib/store/context'
import type { Trip } from '../../lib/domain/types'
import { achievements, type BadgeIcon } from '../../lib/domain/achievements'
import { tripPlaces, validTrips } from '../../lib/domain/stats'
import { placeKey, useGeocode } from '../../lib/geo'
import { formatDate, formatInt } from '../../lib/format'
import { Card, Select } from '../../components/ui'

const ICONS: Record<BadgeIcon, typeof Flag> = {
  flag: Flag, gauge: Gauge, route: Route, moon: Moon, tent: Tent, globe: Globe2, map: MapIcon, sun: Sun, snow: Snowflake, calendar: CalendarDays,
}

export function AchievementsTab() {
  const data = useAppData()
  const me = useMyPerson()
  // Erfolge fürs Auto oder für eine Person – standardmäßig die eigenen
  const [who, setWho] = useState(me?.id ?? '')
  const trips = useMemo(() => validTrips(data.trips), [data.trips])
  const names = useMemo(() => trips.flatMap(tripPlaces), [trips])
  const { places, pending } = useGeocode(names)

  const badges = useMemo(() => {
    const countriesOf = (t: Trip) => tripPlaces(t).map((n) => places.get(placeKey(n))?.countryCode).filter((c): c is string => !!c)
    return achievements(trips, who || null, countriesOf)
  }, [trips, who, places])
  const done = badges.filter((b) => b.achievedAt).sort((a, b) => ((a.achievedAt ?? '') < (b.achievedAt ?? '') ? 1 : -1))
  const open = badges.filter((b) => !b.achievedAt).sort((a, b) => (b.progress ? b.progress.value / b.progress.target : 0) - (a.progress ? a.progress.value / a.progress.target : 0))
  const persons = data.persons.filter((p) => data.trips.some((t) => t.personIds.includes(p.id)))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Erfolge von" className="w-auto!">
          <option value="">Auto (alle Fahrten)</option>
          {persons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me?.id ? ' (du)' : ''}</option>)}
        </Select>
        <span className="text-sm text-slate-500">
          <strong className="text-slate-900">{done.length}</strong> von {badges.length} erreicht
          {pending > 0 && <> · Länder werden noch gesucht …</>}
        </span>
      </div>

      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Erreicht</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {done.map((b) => {
              const Icon = ICONS[b.icon]
              return (
                <li key={b.id}>
                  <Card className="h-full border-brand-200 bg-brand-50/50">
                    <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-chart-1 text-white shadow-sm"><Icon className="h-5 w-5" /></span>
                    <div className="font-semibold text-slate-900">{b.title}</div>
                    <div className="mt-0.5 text-sm text-slate-600">{b.description}</div>
                    <div className="mt-2 text-xs font-medium text-brand-800">am {formatDate(b.achievedAt)}</div>
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {open.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Noch offen</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {open.map((b) => {
              const Icon = ICONS[b.icon]
              const p = b.progress
              const share = p ? p.value / p.target : 0
              return (
                <li key={b.id}>
                  <Card className="h-full">
                    <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Icon className="h-5 w-5" /></span>
                    <div className="flex items-center gap-1.5 font-semibold text-slate-700">{b.title}<Lock className="h-3.5 w-3.5 text-slate-400" aria-label="noch nicht erreicht" /></div>
                    <div className="mt-0.5 text-sm text-slate-500">{b.description}</div>
                    {p && p.target > 1 && (
                      <div className="mt-3">
                        <div className="h-1.5 rounded-full bg-slate-100"><div className={clsx('h-1.5 rounded-full bg-chart-1')} style={{ width: `${Math.max(share > 0 ? 3 : 0, share * 100)}%` }} /></div>
                        <div className="tabular mt-1 text-xs text-slate-500">{formatInt(Math.round(p.value))} / {formatInt(p.target)}</div>
                      </div>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
