import { clsx } from 'clsx'
import { useState } from 'react'
import { CheckCircle2, Copy, AlertTriangle, XCircle, UserPlus, User } from 'lucide-react'
import type { Category } from '../lib/domain/types'
import type { ImportPreview, ImportRow, RowStatus } from '../lib/io/excelImport'
import { applyImport } from '../lib/io/importApply'
import { useSession } from '../lib/store/context'
import { isIsoDate } from '../lib/domain/dates'
import { formatDate, formatEuro, formatKm } from '../lib/format'
import { Badge, Button, Input, Modal, Notice } from './ui'
import { errorMessage, useFeedback } from './feedback-context'

const STATUS: Record<RowStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'slate'; icon: typeof CheckCircle2 }> = {
  ok: { label: 'Bereit', tone: 'green', icon: CheckCircle2 },
  warning: { label: 'Bitte prüfen', tone: 'amber', icon: AlertTriangle },
  error: { label: 'Fehler', tone: 'red', icon: XCircle },
  duplicate: { label: 'Duplikat', tone: 'slate', icon: Copy },
}

function StatusBadge({ status }: { status: RowStatus }) {
  const s = STATUS[status]
  return <Badge tone={s.tone}><s.icon className="h-3 w-3" />{s.label}</Badge>
}

function initialSelection<T>(rows: ImportRow<T>[]): Set<string> {
  return new Set(rows.filter((r) => r.selected).map((r) => r.rowId))
}

export function ImportPreviewModal({ preview, categories, onClose }: { preview: ImportPreview; categories: Category[]; onClose: () => void }) {
  const { toast } = useFeedback()
  const { store } = useSession()
  const [dateOverrides, setDateOverrides] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'trips' | 'expenses' | 'persons'>('trips')
  const [tripSel, setTripSel] = useState(() => initialSelection(preview.trips))
  const [expSel, setExpSel] = useState(() => initialSelection(preview.expenses))
  const [startDates, setStartDates] = useState<Record<string, string>>(() =>
    Object.fromEntries(preview.expenses.filter((r) => !r.draft?.date).map((r) => [r.rowId, preview.suggestedStartDate])),
  )
  const [busy, setBusy] = useState(false)
  const catName = new Map(categories.map((c) => [c.id, c.name]))

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  const selectedExpenses = preview.expenses.filter((r) => expSel.has(r.rowId))
  const missingDate = selectedExpenses.some((r) => !r.draft?.date && !isIsoDate(startDates[r.rowId] ?? ''))
  const badOverride = Object.entries(dateOverrides).some(([id, d]) => tripSel.has(id) && !isIsoDate(d))
  const selectedDupes = [...preview.trips, ...preview.expenses].filter((r) => r.status === 'duplicate' && (tripSel.has(r.rowId) || expSel.has(r.rowId))).length
  const newPersons = preview.persons.filter((p) => !p.existingId)
  const nothing = tripSel.size + expSel.size === 0 && newPersons.length === 0

  const runImport = async () => {
    setBusy(true)
    try {
      const r = await applyImport(preview, { tripRowIds: [...tripSel], expenseRowIds: [...expSel], expenseStartDates: startDates, tripDateOverrides: dateOverrides }, store)
      const parts = [
        `${r.tripsAdded} Fahrt(en)`,
        `${r.expensesAdded} Ausgabe(n)`,
        `${r.personsCreated} neue Person(en)`,
      ]
      toast(`Import abgeschlossen: ${parts.join(', ')}${r.skippedDuplicates ? ` · ${r.skippedDuplicates} bereits vorhandene übersprungen` : ''}.`)
      onClose()
    } catch (e) {
      toast(`Import fehlgeschlagen – es wurde nichts übernommen. ${errorMessage(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const tabs = [
    ['trips', `Fahrten (${preview.trips.length})`],
    ['expenses', `Kosten (${preview.expenses.length})`],
    ['persons', `Personen (${preview.persons.length})`],
  ] as const

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Import-Vorschau"
      description={<>Datei „{preview.fileName}“ · Blätter: {preview.sheetNames.join(', ')}</>}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-slate-500">
            {tripSel.size} Fahrt(en), {expSel.size} Ausgabe(n) ausgewählt{newPersons.length > 0 && ` · ${newPersons.length} neue Person(en)`}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={() => void runImport()} disabled={busy || missingDate || badOverride || nothing}>
            {busy ? 'Importiere …' : 'Auswahl importieren'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {preview.issues.map((i) => <Notice key={i} level="warning">{i}</Notice>)}
        {preview.referenceCheck && (
          preview.referenceCheck.matches ? (
            <Notice level="success" title="Gegenprobe mit der Excel-Berechnung bestanden">
              Die App berechnet für die Daten dieser Datei dieselben Kostenanteile wie das Blatt „Kostenverteilung“:{' '}
              {preview.referenceCheck.rows.map((r) => `${r.name} ${formatEuro(r.appCents)}`).join(' · ')}
            </Notice>
          ) : (
            <Notice level="warning" title="Abweichung zur Excel-Berechnung">
              {preview.referenceCheck.rows.map((r) => `${r.name}: Excel ${r.excelCents != null ? formatEuro(r.excelCents) : '–'}, App ${formatEuro(r.appCents)}`).join(' · ')}
            </Notice>
          )
        )}
        {selectedDupes > 0 && <Notice level="warning">{selectedDupes} als Duplikat erkannte Zeile(n) sind ausgewählt. Bereits importierte Datensätze werden trotzdem nicht doppelt angelegt.</Notice>}

        <div className="flex gap-1 border-b border-slate-200" role="tablist">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={clsx('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800')}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'trips' && (
          preview.trips.length === 0 ? <p className="text-sm text-slate-500">Keine Fahrten gefunden.</p> : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-2"><span className="sr-only">Auswahl</span></th>
                    <th className="px-3 py-2">Zeile</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Datum</th>
                    <th className="px-3 py-2 text-right">km</th>
                    <th className="px-3 py-2">Personen</th>
                    <th className="px-3 py-2">Hinweise</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.trips.map((r) => (
                    <tr key={r.rowId} className={clsx('align-top', r.status === 'error' && 'bg-red-50/40', r.status === 'duplicate' && 'text-slate-500')}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" className="h-4 w-4 accent-brand-700" aria-label={`Zeile ${r.rowNumber} importieren`} checked={tripSel.has(r.rowId)}
                          disabled={r.status === 'error'} onChange={() => toggle(tripSel, setTripSel, r.rowId)} />
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">{r.rowNumber}</td>
                      <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {r.draft && r.status !== 'duplicate' ? (
                          <>
                            <Input type="date" aria-label={`Datum Zeile ${r.rowNumber}`} className="h-9 w-40" value={dateOverrides[r.rowId] ?? r.draft.startDate}
                              invalid={dateOverrides[r.rowId] != null && !isIsoDate(dateOverrides[r.rowId])}
                              onChange={(e) => setDateOverrides({ ...dateOverrides, [r.rowId]: e.target.value })} />
                            {dateOverrides[r.rowId] && dateOverrides[r.rowId] !== r.draft.startDate && <div className="mt-0.5 text-xs text-brand-700">korrigiert (Excel: {formatDate(r.draft.startDate)})</div>}
                            {r.draft.endDate && <div className="mt-0.5 text-xs text-slate-500">bis {formatDate(r.draft.endDate)}</div>}
                          </>
                        ) : r.draft ? formatDate(r.draft.startDate) : <span className="text-slate-500">{Object.values(r.raw)[0] || '–'}</span>}
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">
                        {r.draft ? formatKm(r.draft.km) : '–'}
                        {r.draft?.odoStart != null && <div className="text-xs text-slate-500">{r.draft.odoStart} → {r.draft.odoEnd}</div>}
                      </td>
                      <td className="px-3 py-2.5">{r.draft?.personNames.join(', ') || '–'}</td>
                      <td className="max-w-md px-3 py-2.5 text-xs">
                        {r.messages.length === 0 ? <span className="text-slate-500">–</span> : <ul className="list-disc space-y-0.5 pl-4">{r.messages.map((m) => <li key={m}>{m}</li>)}</ul>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === 'expenses' && (
          preview.expenses.length === 0 ? <p className="text-sm text-slate-500">Keine Kosten gefunden.</p> : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 px-3 py-2"><span className="sr-only">Auswahl</span></th>
                    <th className="px-3 py-2">Zeile</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Bezeichnung</th>
                    <th className="px-3 py-2 text-right">Betrag</th>
                    <th className="px-3 py-2">Wiederholung</th>
                    <th className="px-3 py-2">Datum / Beginn</th>
                    <th className="px-3 py-2">Hinweise</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.expenses.map((r) => {
                    const d = r.draft
                    return (
                      <tr key={r.rowId} className={clsx('align-top', r.status === 'error' && 'bg-red-50/40', r.status === 'duplicate' && 'text-slate-500')}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" className="h-4 w-4 accent-brand-700" aria-label={`Zeile ${r.rowNumber} importieren`} checked={expSel.has(r.rowId)}
                            disabled={r.status === 'error'} onChange={() => toggle(expSel, setExpSel, r.rowId)} />
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{r.rowNumber}</td>
                        <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{d?.title ?? r.raw.Bezeichnung}</div>
                          {d && <div className="text-xs text-slate-500">{catName.get(d.categoryId)}{d.paidByName && ` · bezahlt von ${d.paidByName}`}{d.spreadMonths && ` · auf ${d.spreadMonths} Monate verteilt`}</div>}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">
                          {d ? formatEuro(d.amountCents) : '–'}
                          {d?.count && <div className="text-xs text-slate-500">gesamt {formatEuro(d.amountCents * d.count)}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5">{d?.frequency ? `${d.frequency === 'monthly' ? 'monatlich' : 'jährlich'}${d.count ? `, ${d.count}×` : ''}` : 'einmalig'}</td>
                        <td className="px-3 py-2.5">
                          {d?.date ? formatDate(d.date) : d ? (
                            <Input type="date" aria-label="Startdatum" className="h-9 w-40" value={startDates[r.rowId] ?? ''}
                              invalid={expSel.has(r.rowId) && !isIsoDate(startDates[r.rowId] ?? '')}
                              onChange={(e) => setStartDates({ ...startDates, [r.rowId]: e.target.value })} />
                          ) : '–'}
                        </td>
                        <td className="max-w-sm px-3 py-2.5 text-xs">
                          {r.messages.length === 0 ? <span className="text-slate-500">–</span> : <ul className="list-disc space-y-0.5 pl-4">{r.messages.map((m) => <li key={m}>{m}</li>)}</ul>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === 'persons' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Personen werden anhand des Namens (ohne Groß-/Kleinschreibung) mit bereits angelegten Personen abgeglichen. Neue Personen werden angelegt und erhalten eine feste ID.</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {preview.persons.map((p) => (
                <li key={p.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    {p.existingId ? <User className="h-4 w-4 text-slate-500" /> : <UserPlus className="h-4 w-4 text-brand-700" />}
                    {p.name}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{p.usedInRows} Fahrt(en)</span>
                    {p.existingId ? <Badge>{p.existingInactive ? 'vorhanden, wird reaktiviert' : 'bereits vorhanden'}</Badge> : <Badge tone="brand">wird angelegt</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
