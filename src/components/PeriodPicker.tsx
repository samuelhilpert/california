import { clsx } from 'clsx'
import { MONTH_NAMES, type PeriodSpec } from '../lib/domain/period'
import { todayIso } from '../lib/domain/dates'
import { Input, Select } from './ui'

const KINDS: [PeriodSpec['kind'], string][] = [
  ['all', 'Gesamt'],
  ['year', 'Jahr'],
  ['month', 'Monat'],
  ['range', 'Zeitraum'],
]

export function PeriodPicker({ value, onChange, years, idPrefix = 'p' }: { value: PeriodSpec; onChange: (p: PeriodSpec) => void; years: number[]; idPrefix?: string }) {
  const today = todayIso()
  const curYear = Number(today.slice(0, 4))
  const curMonth = Number(today.slice(5, 7))
  const year = 'year' in value ? value.year : years.at(-1) ?? curYear
  const setKind = (k: PeriodSpec['kind']) => {
    if (k === 'all') onChange({ kind: 'all' })
    if (k === 'year') onChange({ kind: 'year', year })
    if (k === 'month') onChange({ kind: 'month', year, month: value.kind === 'month' ? value.month : year === curYear ? curMonth : 1 })
    if (k === 'range') onChange({ kind: 'range', from: `${year}-01-01`, to: year === curYear ? today : `${year}-12-31` })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-slate-200 bg-surface p-0.5 shadow-sm" role="tablist" aria-label="Zeitraum">
        {KINDS.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={value.kind === k}
            onClick={() => setKind(k)}
            className={clsx('h-8 rounded-md px-3 text-sm font-medium transition-colors', value.kind === k ? 'bg-brand-700 text-on-brand' : 'text-slate-600 hover:bg-slate-100')}
          >
            {label}
          </button>
        ))}
      </div>
      {(value.kind === 'year' || value.kind === 'month') && (
        <Select aria-label="Jahr" className="h-9 w-auto" value={value.year} onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
      )}
      {value.kind === 'month' && (
        <Select aria-label="Monat" className="h-9 w-auto" value={value.month} onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}>
          {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </Select>
      )}
      {value.kind === 'range' && (
        <div className="flex items-center gap-2">
          <Input id={`${idPrefix}-from`} aria-label="Von" type="date" className="h-9 w-auto" value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          <span className="text-slate-500">–</span>
          <Input id={`${idPrefix}-to`} aria-label="Bis" type="date" className="h-9 w-auto" value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
        </div>
      )}
    </div>
  )
}
