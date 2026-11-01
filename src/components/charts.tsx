import { clsx } from 'clsx'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Table2 } from 'lucide-react'

export interface Datum {
  key: string
  label: string
  value: number
}

/** Breite des Containers, damit das SVG in echten Pixeln zeichnet (keine verzerrte Schrift). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Saubere Achsenwerte: 0 und 3–4 runde Schritte bis über das Maximum. */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0]
  const raw = max / 3
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

/** Säule mit 4px abgerundetem Ende, eckig an der Grundlinie. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/** Umschalter für die Tabellenansicht – jeder Wert ist ohne Hover erreichbar. */
export function TableToggle({ rows, head }: { rows: [string, string][]; head: [string, string] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
        <Table2 className="h-3.5 w-3.5" />{open ? 'Tabelle ausblenden' : 'Als Tabelle'}
      </button>
      {open && (
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 font-medium">{head[0]}</th><th className="py-1 text-right font-medium">{head[1]}</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([a, b]) => <tr key={a}><td className="py-1 text-slate-700">{a}</td><td className="tabular py-1 text-right font-medium text-slate-900">{b}</td></tr>)}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * Säulendiagramm für eine Datenreihe (z. B. km je Monat). Werte erscheinen beim Überfahren
 * oder per Tastatur; der höchste Wert steht direkt an seiner Säule.
 */
export function ColumnChart({ data, format, formatAxis = format, label, height = 200 }: { data: Datum[]; format: (v: number) => string; formatAxis?: (v: number) => string; label: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(0, ...data.map((d) => d.value))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const padL = Math.max(28, ...ticks.map((t) => formatAxis(t).length * 6.5 + 8))
  const padT = 22
  const padB = 24
  const plotW = Math.max(0, width - padL)
  const plotH = height - padT - padB
  const band = data.length ? plotW / data.length : 0
  const barW = Math.max(2, Math.min(24, band - 2))
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const maxIdx = max > 0 ? data.findIndex((d) => d.value === max) : -1
  // Bei engen Säulen nur jede zweite Beschriftung zeigen
  const labelEvery = band < 26 ? 2 : 1

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="group" aria-label={label} className="overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={width} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-chart-axis' : 'stroke-chart-grid'} strokeWidth={1} />
                <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-slate-500 text-[11px]">{formatAxis(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = padL + i * band
              const h = (d.value / top) * plotH
              return (
                <g
                  key={d.key}
                  tabIndex={0}
                  role="img"
                  aria-label={`${d.label}: ${format(d.value)}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                >
                  <rect x={x} y={padT} width={band} height={plotH} fill="transparent" />
                  {h > 0 && <path d={columnPath(x + (band - barW) / 2, y(d.value), barW, h)} className={clsx('fill-chart-1 transition-opacity', active != null && active !== i && 'opacity-50')} />}
                  {(i % labelEvery === 0 || i === active) && (
                    <text x={x + band / 2} y={height - 6} textAnchor="middle" className={clsx('text-[11px]', i === active ? 'fill-slate-900 font-medium' : 'fill-slate-500')}>{d.label}</text>
                  )}
                  {i === maxIdx && active == null && (
                    <text x={x + band / 2} y={y(d.value) - 6} textAnchor="middle" className="tabular fill-slate-700 text-[11px] font-medium">{format(d.value)}</text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
        {active != null && width > 0 && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-surface px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(Math.max(padL + (active + 0.5) * band, 60), width - 60), top: Math.max(y(data[active].value) - 6, 40) }}
          >
            <div className="tabular font-semibold text-slate-900">{format(data[active].value)}</div>
            <div className="text-slate-500">{data[active].label}</div>
          </div>
        )}
      </div>
      <TableToggle head={['Zeitraum', 'Wert']} rows={data.map((d) => [d.label, format(d.value)])} />
    </div>
  )
}

/** Liste mit waagerechten Balken (eine Farbe oder Farbe je Kategorie), Werte stehen als Text daneben. */
export function BarList({ rows, format, max }: { rows: { key: string; label: ReactNode; value: number; sub?: ReactNode; color?: string }[]; format: (v: number) => string; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 font-medium text-slate-800">
              {r.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />}
              <span className="truncate">{r.label}</span>
            </span>
            <span className="tabular shrink-0 font-semibold text-slate-900">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className={clsx('h-2 rounded-full', !r.color && 'bg-chart-1')} style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / m) * 100)}%`, ...(r.color ? { background: r.color } : {}) }} />
          </div>
          {r.sub && <div className="mt-1 text-xs text-slate-500">{r.sub}</div>}
        </li>
      ))}
    </ul>
  )
}

// Ausgeschrieben, damit Tailwind die Klassen findet
const HEAT_FILL = ['fill-heat-0', 'fill-heat-1', 'fill-heat-2', 'fill-heat-3', 'fill-heat-4']
const HEAT_BG = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4']
const WEEKDAYS = ['Mo', '', 'Mi', '', 'Fr', '', 'So']
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/**
 * Jahreskalender: ein Kästchen pro Tag, Farbe nach gefahrenen Kilometern (einfarbige Stufen).
 * Ein Kästchen pro Tag ist zu viel für die Tastatur – daher Tooltip per <title> und eine
 * Monatstabelle als Alternative.
 */
export function YearCalendar({ year, kmPerDay, today }: { year: number; kmPerDay: Map<string, number>; today: string }) {
  const [ref, avail] = useWidth<HTMLDivElement>()
  const gap = 2
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const offset = (jan1.getUTCDay() + 6) % 7 // Montag = 0
  const days: { iso: string; col: number; row: number; month: number; day: number }[] = []
  for (let d = new Date(jan1); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const idx = Math.round((d.getTime() - jan1.getTime()) / 86_400_000) + offset
    days.push({ iso: d.toISOString().slice(0, 10), col: Math.floor(idx / 7), row: idx % 7, month: d.getUTCMonth(), day: d.getUTCDate() })
  }
  const values = [...kmPerDay.values()].filter((v) => v > 0).sort((a, b) => a - b)
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0
  const thresholds = [q(0.25), q(0.5), q(0.75)]
  const level = (km: number) => (km <= 0 ? 0 : km <= thresholds[0] ? 1 : km <= thresholds[1] ? 2 : km <= thresholds[2] ? 3 : 4)
  const cols = Math.max(...days.map((d) => d.col)) + 1
  const left = 22
  // Kästchengröße an die Breite anpassen: ganzes Jahr sichtbar, auf dem Handy notfalls scrollbar
  const cell = Math.max(8, Math.min(14, Math.floor((avail - left) / cols) - gap))
  const topPad = 16
  const width = left + cols * (cell + gap)
  const height = topPad + 7 * (cell + gap)
  const perMonth = MONTHS.map((m, i) => {
    const ds = days.filter((d) => d.month === i && (kmPerDay.get(d.iso) ?? 0) > 0)
    return [m, `${ds.length} Tag(e) · ${Math.round(ds.reduce((a, d) => a + (kmPerDay.get(d.iso) ?? 0), 0)).toLocaleString('de-DE')} km`] as [string, string]
  })

  return (
    <div>
      {/* Auf schmalen Bildschirmen scrollbar – per Tastatur erreichbar */}
      <div ref={ref} className="overflow-x-auto pb-1" tabIndex={0} role="region" aria-label={`Kalender ${year}, seitlich scrollbar`}>
        {avail > 0 && <svg width={width} height={height} role="img" aria-label={`Kalender ${year}: ${values.length} Tage unterwegs`}>
          {MONTHS.map((m, i) => {
            const first = days.find((d) => d.month === i && d.day === 1)
            return first ? <text key={m} x={left + first.col * (cell + gap)} y={10} className="fill-slate-500 text-[10px]">{m}</text> : null
          })}
          {WEEKDAYS.map((w, i) => w && <text key={w} x={0} y={topPad + i * (cell + gap) + cell - 2} className="fill-slate-500 text-[10px]">{w}</text>)}
          {days.map((d) => {
            const km = kmPerDay.get(d.iso) ?? 0
            const future = d.iso > today
            return (
              <rect key={d.iso} x={left + d.col * (cell + gap)} y={topPad + d.row * (cell + gap)} width={cell} height={cell} rx={2}
                className={clsx(HEAT_FILL[level(km)], future && 'opacity-40')}>
                <title>{`${d.day}. ${MONTHS[d.month]}: ${km > 0 ? `${Math.round(km).toLocaleString('de-DE')} km` : 'nicht unterwegs'}`}</title>
              </rect>
            )
          })}
        </svg>}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500" aria-hidden>
        weniger
        {[0, 1, 2, 3, 4].map((l) => <span key={l} className={clsx('inline-block h-3 w-3 rounded-sm', HEAT_BG[l])} />)}
        mehr km
      </div>
      <TableToggle head={['Monat', 'Unterwegs']} rows={perMonth} />
    </div>
  )
}
