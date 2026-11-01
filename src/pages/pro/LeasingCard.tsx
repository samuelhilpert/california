import { clsx } from 'clsx'
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FileSignature, Pencil } from 'lucide-react'
import { useAppData, useSetting } from '../../lib/store/context'
import { LEASING_SETTING, leasingStatus, type LeasingConfig } from '../../lib/domain/leasing'
import { parseNumberInput } from '../../lib/domain/money'
import { setSetting } from '../../lib/store/repo'
import { formatDate, formatEuro, formatInt, numberToInput } from '../../lib/format'
import { Button, Card, CardTitle, Field, Input, Modal } from '../../components/ui'
import { errorMessage, useFeedback } from '../../components/feedback-context'

const km = (v: number) => `${formatInt(Math.round(v))} km`

function LeasingForm({ initial, onClose }: { initial?: LeasingConfig; onClose: () => void }) {
  const { toast } = useFeedback()
  const [start, setStart] = useState(initial?.start ?? '')
  const [months, setMonths] = useState(String(initial?.months ?? 48))
  const [kmPerYear, setKmPerYear] = useState(numberToInput(initial?.kmPerYear ?? 10000))
  const [startOdo, setStartOdo] = useState(numberToInput(initial?.startOdometer))
  const [extra, setExtra] = useState(numberToInput(initial?.extraKmCents))
  const [less, setLess] = useState(numberToInput(initial?.lessKmCents))
  const [tolerance, setTolerance] = useState(numberToInput(initial?.toleranceKm))
  const [error, setError] = useState<string>()

  const save = async () => {
    const m = Number(months)
    const k = parseNumberInput(kmPerYear)
    const o = startOdo.trim() ? parseNumberInput(startOdo) : undefined
    const e = extra.trim() ? parseNumberInput(extra) : undefined
    const l = less.trim() ? parseNumberInput(less) : undefined
    const t = tolerance.trim() ? parseNumberInput(tolerance) : undefined
    if (!start) return setError('Bitte den Vertragsbeginn angeben.')
    if (!Number.isInteger(m) || m < 1 || m > 120) return setError('Bitte eine Laufzeit zwischen 1 und 120 Monaten angeben.')
    if (k == null || k <= 0) return setError('Bitte die vereinbarten Kilometer pro Jahr angeben.')
    if (o === null || e === null || l === null || t === null || (t != null && t < 0)) return setError('Bitte nur Zahlen eingeben.')
    const cfg: LeasingConfig = { start, months: m, kmPerYear: k, ...(o != null ? { startOdometer: o } : {}), ...(e != null ? { extraKmCents: e } : {}), ...(l != null ? { lessKmCents: l } : {}), ...(t != null && t > 0 ? { toleranceKm: t } : {}) }
    try {
      await setSetting(LEASING_SETTING, cfg)
      toast('Leasingvertrag gespeichert.')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Modal open onClose={onClose} title="Leasingvertrag" description="Gilt für das Auto, also für alle Mitglieder. Ändert nichts an der Abrechnung." size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" onClick={() => void save()}>Speichern</Button></>}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => { ev.preventDefault(); void save() }}>
        {error && <p className="text-sm text-red-600 sm:col-span-2" role="alert">{error}</p>}
        <Field label="Vertragsbeginn (Übergabe)" htmlFor="l-start"><Input id="l-start" type="date" value={start} onChange={(ev) => setStart(ev.target.value)} required /></Field>
        <Field label="Laufzeit" htmlFor="l-months"><Input id="l-months" type="number" min={1} max={120} value={months} onChange={(ev) => setMonths(ev.target.value)} suffix="Monate" /></Field>
        <Field label="Kilometer pro Jahr" htmlFor="l-km"><Input id="l-km" inputMode="decimal" value={kmPerYear} onChange={(ev) => setKmPerYear(ev.target.value)} suffix="km" /></Field>
        <Field label="Kilometerstand bei Übergabe" htmlFor="l-odo" optional hint="Dann zählt der echte Tachostand (aus Fahrten oder Tankbuch) statt der Summe der Fahrten.">
          <Input id="l-odo" inputMode="decimal" value={startOdo} onChange={(ev) => setStartOdo(ev.target.value)} suffix="km" />
        </Field>
        <Field label="Preis je Mehrkilometer" htmlFor="l-extra" optional hint="Laut Vertrag, z. B. 8 Cent"><Input id="l-extra" inputMode="decimal" value={extra} onChange={(ev) => setExtra(ev.target.value)} suffix="Cent" /></Field>
        <Field label="Vergütung je Minderkilometer" htmlFor="l-less" optional hint="Laut Vertrag, oft etwas weniger"><Input id="l-less" inputMode="decimal" value={less} onChange={(ev) => setLess(ev.target.value)} suffix="Cent" /></Field>
        <Field label="Toleranz" htmlFor="l-tol" optional hint="Über die ganze Laufzeit, z. B. 2.500 km. Abweichungen bis dahin kosten nichts, darüber zählt nur der Teil jenseits der Toleranz.">
          <Input id="l-tol" inputMode="decimal" value={tolerance} onChange={(ev) => setTolerance(ev.target.value)} suffix="km" />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

export function LeasingCard({ today }: { today: string }) {
  const data = useAppData()
  const cfg = useSetting<LeasingConfig>(LEASING_SETTING)
  const [editing, setEditing] = useState(false)

  if (!cfg) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-slate-900"><FileSignature className="h-5 w-5 text-brand-700" />Leasing-Kilometer</h2>
            <p className="mt-1 text-sm text-slate-500">Trag euren Leasingvertrag ein – dann zeigt die App, ob ihr im Kilometer-Kontingent bleibt und was Mehrkilometer kosten würden.</p>
          </div>
          <Button variant="primary" onClick={() => setEditing(true)}>Vertrag eintragen</Button>
        </div>
        {editing && <LeasingForm onClose={() => setEditing(false)} />}
      </Card>
    )
  }

  const s = leasingStatus(cfg, data.trips, data.fuel, today)
  const over = s.deltaKm > 0
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / s.limitKm) * 100))}%`

  return (
    <Card>
      <CardTitle
        sub={`${formatDate(cfg.start)} bis ${formatDate(s.end)} · ${km(cfg.kmPerYear)} pro Jahr · Kontingent ${km(s.limitKm)}${cfg.toleranceKm ? ` · Toleranz ± ${km(cfg.toleranceKm)}` : ''}`}
        action={<Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Vertrag</Button>}
      >
        <span className="flex items-center gap-2"><FileSignature className="h-5 w-5 text-brand-700" />Leasing-Kilometer</span>
      </CardTitle>

      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-600">Gefahren <strong className="text-slate-900">{km(s.drivenKm)}</strong> von {km(s.limitKm)}</span>
        <span className="tabular text-slate-500">{Math.round((s.drivenKm / s.limitKm) * 100)} %</span>
      </div>
      {/* Balken: gefahren; Strich: anteiliges Kontingent bis heute */}
      <div className="relative h-3 rounded-full bg-slate-100" role="img" aria-label={`${km(s.drivenKm)} gefahren, bis heute anteilig ${km(s.expectedToDate)} vorgesehen`}>
        <div className={clsx('h-3 rounded-full', s.drivenKm > s.expectedToDate ? 'bg-amber-500' : 'bg-chart-1')} style={{ width: pct(s.drivenKm) }} />
        {!s.finished && <div className="absolute -top-1 h-5 w-0.5 rounded bg-slate-700" style={{ left: pct(s.expectedToDate) }} />}
      </div>
      {!s.finished && <p className="mt-1.5 text-xs text-slate-500">Strich = bis heute anteilig vorgesehen ({km(s.expectedToDate)})</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">{s.finished ? 'Am Vertragsende' : 'Prognose Vertragsende'}</div>
          <div className="text-lg font-semibold text-slate-900">{km(s.prognosisKm)}</div>
          <div className={clsx('mt-0.5 flex items-center gap-1 text-xs font-medium', over && !s.withinTolerance ? 'text-amber-700' : 'text-emerald-700')}>
            {over && !s.withinTolerance ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {over ? `${km(s.deltaKm)} über dem Kontingent` : `${km(-s.deltaKm)} unter dem Kontingent`}
          </div>
          {cfg.toleranceKm ? (
            <div className="mt-0.5 text-xs text-slate-500">
              {s.withinTolerance ? 'innerhalb der Toleranz' : `${km(Math.abs(s.billableKm))} jenseits der Toleranz`}
            </div>
          ) : null}
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">{s.withinTolerance ? 'Voraussichtlich' : over ? 'Voraussichtliche Nachzahlung' : 'Voraussichtliche Gutschrift'}</div>
          <div className="text-lg font-semibold text-slate-900">{s.withinTolerance ? 'nichts abzurechnen' : s.costCents != null ? formatEuro(Math.abs(s.costCents)) : '–'}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {s.withinTolerance ? `Abweichung liegt in der Toleranz von ± ${km(cfg.toleranceKm ?? 0)}` : s.costCents != null ? (cfg.toleranceKm ? 'laut Vertrag, nach Abzug der Toleranz' : 'laut Preis im Vertrag') : 'Preis je km im Vertrag eintragen'}
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Noch verfügbar</div>
          <div className="text-lg font-semibold text-slate-900">{km(Math.max(0, s.remainingKm))}</div>
          <div className="mt-0.5 text-xs text-slate-500">{s.remainingPerMonth != null ? `≈ ${km(Math.max(0, s.remainingPerMonth))} pro Monat` : s.finished ? 'Vertrag beendet' : '–'}</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {s.source === 'odometer' && s.lastReading
          ? `Grundlage: Tachostand ${km(s.lastReading.km)} vom ${formatDate(s.lastReading.date)} minus Übergabe-Stand.`
          : 'Grundlage: Summe der eingetragenen Fahrten seit Vertragsbeginn – mit dem Kilometerstand bei Übergabe wird es genauer.'}
        {' '}Die Prognose rechnet das bisherige Tempo gleichmäßig hoch.
      </p>
      {editing && <LeasingForm initial={cfg} onClose={() => setEditing(false)} />}
    </Card>
  )
}
