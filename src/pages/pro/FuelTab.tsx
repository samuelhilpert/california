import { useMemo, useState } from 'react'
import { Fuel, Pencil, Plus, Trash2 } from 'lucide-react'
import { useAppData, useMyPerson } from '../../lib/store/context'
import type { FuelFill } from '../../lib/domain/types'
import { fuelLog } from '../../lib/domain/stats'
import { parseEuroInput, parseNumberInput } from '../../lib/domain/money'
import { todayIso } from '../../lib/domain/dates'
import { deleteFuel, restoreRecord, saveFuel, ValidationError } from '../../lib/store/repo'
import type { FieldErrors } from '../../lib/domain/validation'
import { centsToInput, formatDate, formatDecimal, formatEuro, formatInt, formatLiters, formatPer100km, formatPerLiter, numberToInput } from '../../lib/format'
import { Button, Card, CardTitle, EmptyState, Field, Input, Modal, Notice, Select, Stat } from '../../components/ui'
import { ColumnChart } from '../../components/charts'
import { errorMessage, useFeedback } from '../../components/feedback-context'

/**
 * Formular für eine Tankfüllung – oben auf der Seite zum schnellen Eintragen,
 * im Popup zum Bearbeiten. Speichert ins Tankbuch, nicht in die Ausgaben.
 */
function FuelForm({ fill, lastOdo, onDone }: { fill?: FuelFill; lastOdo?: number; onDone?: () => void }) {
  const data = useAppData()
  const me = useMyPerson()
  const { toast } = useFeedback()
  const [date, setDate] = useState(fill?.date ?? todayIso())
  const [amount, setAmount] = useState(centsToInput(fill?.amountCents))
  const [litersIn, setLitersIn] = useState(numberToInput(fill?.liters))
  const [odo, setOdo] = useState(numberToInput(fill?.odometer))
  const [full, setFull] = useState(fill?.fullTank ?? true)
  const [personId, setPersonId] = useState(fill ? (fill.personId ?? '') : (me?.id ?? ''))
  const [errors, setErrors] = useState<FieldErrors>({})

  const cents = parseEuroInput(amount)
  const l = litersIn.trim() ? parseNumberInput(litersIn) : undefined
  const o = odo.trim() ? parseNumberInput(odo) : undefined
  const id = fill?.id ?? 'neu'

  const submit = async () => {
    const e: FieldErrors = {}
    if (cents == null || cents <= 0) e.amountCents = 'Bitte den Betrag eingeben, z. B. 89,90.'
    if (l === null) e.liters = 'Bitte eine Zahl eingeben, z. B. 52,4.'
    if (o === null) e.odometer = 'Bitte eine Zahl eingeben.'
    setErrors(e)
    if (Object.keys(e).length) return
    try {
      await saveFuel({ date, amountCents: cents as number, liters: l ?? undefined, odometer: o ?? undefined, fullTank: full, personId: personId || undefined, ...(fill?.note ? { note: fill.note } : {}) }, fill?.id)
      toast(fill ? 'Tankfüllung aktualisiert.' : 'Tankfüllung gespeichert.')
      if (!fill) {
        setAmount('')
        setLitersIn('')
        setOdo('')
        setFull(true)
      }
      onDone?.()
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.fields)
      else toast(errorMessage(err), 'error')
    }
  }

  return (
    <form id={`fuel-${id}`} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(ev) => { ev.preventDefault(); void submit() }}>
      <Field label="Datum" htmlFor={`f-date-${id}`} error={errors.date}>
        <Input id={`f-date-${id}`} type="date" value={date} onChange={(ev) => setDate(ev.target.value)} required />
      </Field>
      <Field label="Betrag" htmlFor={`f-amount-${id}`} error={errors.amountCents}>
        <Input id={`f-amount-${id}`} inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="0,00" suffix="€" invalid={!!errors.amountCents} />
      </Field>
      <Field label="Liter" htmlFor={`f-liters-${id}`} error={errors.liters} hint={cents && l ? formatPerLiter(cents / 100 / l) : undefined}>
        <Input id={`f-liters-${id}`} inputMode="decimal" value={litersIn} onChange={(ev) => setLitersIn(ev.target.value)} placeholder="z. B. 52,4" suffix="l" invalid={!!errors.liters} />
      </Field>
      <Field label="Kilometerstand" htmlFor={`f-odo-${id}`} error={errors.odometer} hint={!fill && lastOdo != null ? `Letzte Tankfüllung: ${formatInt(lastOdo)} km` : undefined}>
        <Input id={`f-odo-${id}`} inputMode="decimal" value={odo} onChange={(ev) => setOdo(ev.target.value)} placeholder="z. B. 48250" suffix="km" invalid={!!errors.odometer} />
      </Field>
      <Field label="Wer hat getankt?" htmlFor={`f-person-${id}`}>
        <Select id={`f-person-${id}`} value={personId} onChange={(ev) => setPersonId(ev.target.value)}>
          <option value="">Keine Angabe</option>
          {data.persons.filter((p) => p.active || p.id === personId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <div className="flex flex-col justify-end gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={full} onChange={(ev) => setFull(ev.target.checked)} />
          Voll getankt
        </label>
        {!fill && <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />}>Tankfüllung speichern</Button>}
      </div>
    </form>
  )
}

export function FuelTab({ year }: { year: number | null }) {
  const data = useAppData()
  const { toast, confirm } = useFeedback()
  const log = useMemo(() => fuelLog(data.fuel, year), [data.fuel, year])
  const all = useMemo(() => fuelLog(data.fuel), [data.fuel])
  const [editing, setEditing] = useState<FuelFill | null>(null)
  const pName = new Map(data.persons.map((p) => [p.id, p.name]))
  const lastOdo = data.fuel.map((f) => f.odometer).filter((o): o is number => o != null).sort((a, b) => b - a)[0]
  const withConsumption = [...log.entries].reverse().filter((e) => e.per100km != null)
  const total = log.entries.reduce((a, e) => a + e.fill.amountCents, 0)

  const remove = async (f: FuelFill) => {
    const ok = await confirm({ title: 'Tankfüllung löschen?', message: `Tankfüllung vom ${formatDate(f.date)} über ${formatEuro(f.amountCents)}.`, confirmLabel: 'Löschen', danger: true })
    if (!ok) return
    try {
      const old = await deleteFuel(f.id)
      setEditing(null)
      toast('Tankfüllung gelöscht.', 'success', old ? { label: 'Rückgängig', onClick: async () => { await restoreRecord('fuel', old) } } : undefined)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="space-y-6">
      <Notice level="info">Das Tankbuch ist getrennt von den Kosten: Tankfüllungen fließen <strong>nicht</strong> in Abrechnung und Ausgleich ein – Sprit zahlt jeder selbst.</Notice>

      <Card>
        <CardTitle sub="Mit Kilometerstand und „voll getankt“ berechnet die App den Verbrauch">Tankfüllung eintragen</CardTitle>
        <FuelForm lastOdo={lastOdo} />
      </Card>

      {log.entries.length === 0 ? (
        <Card><EmptyState icon={<Fuel className="h-6 w-6" />} title={year ? `Keine Tankfüllungen in ${year}` : 'Noch keine Tankfüllungen'}>Trage oben die erste Tankfüllung ein.</EmptyState></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Ø Verbrauch" value={all.avgPer100km != null ? `${formatDecimal(all.avgPer100km, 1)} l` : '–'} sub="je 100 km, zwischen Volltankungen" />
            <Stat label="Ø Spritpreis" value={log.avgPricePerLiter != null ? `${formatDecimal(log.avgPricePerLiter, 2)} €` : '–'} sub="je Liter" />
            <Stat label="Getankt" value={formatLiters(Math.round(log.liters))} sub={`${log.entries.length} Tankfüllung(en)`} />
            <Stat label="Spritkosten" value={formatEuro(total)} sub={year ? String(year) : 'gesamt'} />
          </div>
          {all.hint && <Notice level="info">{all.hint}</Notice>}

          {withConsumption.length >= 2 && (
            <Card>
              <CardTitle sub="Je Volltankung">Verbrauch im Verlauf</CardTitle>
              <ColumnChart data={withConsumption.map((e) => ({ key: e.fill.id, label: formatDate(e.fill.date).slice(0, 6), value: e.per100km ?? 0 }))} format={formatPer100km} formatAxis={formatInt} label="Verbrauch je Volltankung" height={180} />
            </Card>
          )}

          <Card padded={false}>
            <div className="p-5 pb-2"><CardTitle sub="Neueste zuerst">Tankbuch</CardTitle></div>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tankbuch-Tabelle">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                    <th className="px-5 py-2 font-medium">Datum</th>
                    <th className="px-3 py-2 text-right font-medium">Kilometerstand</th>
                    <th className="px-3 py-2 text-right font-medium">Liter</th>
                    <th className="px-3 py-2 text-right font-medium">Betrag</th>
                    <th className="px-3 py-2 text-right font-medium">Preis</th>
                    <th className="px-3 py-2 text-right font-medium">Verbrauch</th>
                    <th className="px-5 py-2"><span className="sr-only">Bearbeiten</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {log.entries.map(({ fill: f, pricePerLiter, kmSincePrev, per100km }) => (
                    <tr key={f.id}>
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-slate-900">{formatDate(f.date)}</div>
                        <div className="text-xs text-slate-500">{f.personId ? pName.get(f.personId) ?? 'Unbekannt' : 'ohne Angabe'}{!f.fullTank && ' · Teilfüllung'}</div>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-700">
                        {f.odometer != null ? `${formatInt(f.odometer)} km` : '–'}
                        {kmSincePrev != null && <div className="text-xs text-slate-500">+{formatInt(kmSincePrev)} km</div>}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-700">{f.liters ? formatLiters(f.liters) : '–'}</td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-900">{formatEuro(f.amountCents)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-slate-700">{pricePerLiter != null ? formatPerLiter(pricePerLiter) : '–'}</td>
                      <td className="tabular px-3 py-2.5 text-right font-medium text-slate-900">{per100km != null ? formatPer100km(per100km) : <span className="font-normal text-slate-400">–</span>}</td>
                      <td className="px-5 py-2.5 text-right">
                        <Button variant="ghost" size="icon" onClick={() => setEditing(f)} aria-label={`Tankfüllung vom ${formatDate(f.date)} bearbeiten`}><Pencil className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-xs text-slate-500">
              Verbrauch nach der Volltank-Methode: alle seit der letzten Volltankung getankten Liter ÷ gefahrene Kilometer. Dafür braucht es Kilometerstand und „voll getankt“ bei dieser und der vorigen Volltankung.
            </p>
          </Card>
        </>
      )}

      <Modal
        open={editing != null}
        onClose={() => setEditing(null)}
        title="Tankfüllung bearbeiten"
        size="lg"
        footer={editing && (
          <>
            <Button variant="danger-ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => void remove(editing)} className="sm:mr-auto">Löschen</Button>
            <Button onClick={() => setEditing(null)}>Abbrechen</Button>
            <Button variant="primary" type="submit" form={`fuel-${editing.id}`}>Änderungen speichern</Button>
          </>
        )}
      >
        {editing && <FuelForm key={editing.id} fill={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  )
}
