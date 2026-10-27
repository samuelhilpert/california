import { useMemo, useState } from 'react'
import { Archive, Download, Eye, Lock, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { SettlementSnapshot } from '../lib/domain/types'
import type { Settlement } from '../lib/domain/settlement'
import { compareWithCurrent, snapshotCategories, snapshotPersons } from '../lib/snapshots'
import { periodLabel } from '../lib/domain/period'
import { todayIso } from '../lib/domain/dates'
import { deleteSettlementSnapshot, saveSettlementSnapshot } from '../lib/store/repo'
import type { AppData } from '../lib/store/types'
import { buildSettlementWorkbook, downloadWorkbook } from '../lib/io/excelExport'
import { formatEuro, formatKm, formatPricePerKm, formatStamp } from '../lib/format'
import { Button, Card, CardTitle, Field, Input, Modal, Notice } from './ui'
import { errorMessage, useFeedback } from './feedback-context'

export function CloseSettlementButton({ s, data, period, costPeriod, labels }: {
  s: Settlement
  data: AppData
  period: SettlementSnapshot['period']
  costPeriod?: SettlementSnapshot['costPeriod']
  labels: { trips: string; costs: string }
}) {
  const { toast } = useFeedback()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const save = async () => {
    try {
      await saveSettlementSnapshot({
        title: title || `Abrechnung ${labels.trips}`,
        period,
        ...(costPeriod ? { costPeriod } : {}),
        personNames: Object.fromEntries(data.persons.map((p) => [p.id, p.name])),
        categoryNames: Object.fromEntries(data.categories.map((c) => [c.id, c.name])),
        result: s,
      })
      toast('Abrechnung wurde abgeschlossen und gespeichert.')
      setOpen(false)
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  return (
    <>
      <Button icon={<Lock className="h-4 w-4" />} onClick={() => { setTitle(`Abrechnung ${labels.trips}`); setOpen(true) }}>Abschließen</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Abrechnung abschließen"
        description="Speichert das aktuelle Ergebnis als festen Stand. Spätere Änderungen an Fahrten oder Kosten verändern ihn nicht – Abweichungen werden angezeigt."
        footer={<><Button onClick={() => setOpen(false)}>Abbrechen</Button><Button variant="primary" onClick={() => void save()}>Abschließen</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void save() }} className="space-y-4">
          <Field label="Titel" htmlFor="snap-title"><Input id="snap-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
          <dl className="grid grid-cols-2 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <dt className="text-slate-500">Zeitraum</dt><dd className="text-right">{labels.trips}{labels.costs !== labels.trips && ` (Kosten: ${labels.costs})`}</dd>
            <dt className="text-slate-500">Gesamtkosten</dt><dd className="tabular text-right">{formatEuro(s.totalCostCents)}</dd>
            <dt className="text-slate-500">Gesamtkilometer</dt><dd className="tabular text-right">{formatKm(s.totalKm)}</dd>
            <dt className="text-slate-500">Verteilt</dt><dd className="tabular text-right">{formatEuro(s.distributedCents)}</dd>
          </dl>
          {s.notices.some((n) => n.level !== 'info') && <Notice level="warning">Die Abrechnung enthält Hinweise (siehe oben). Bitte vor dem Abschließen prüfen.</Notice>}
        </form>
      </Modal>
    </>
  )
}

export function SettlementSnapshotList({ data }: { data: AppData }) {
  const { toast, confirm } = useFeedback()
  const [viewing, setViewing] = useState<SettlementSnapshot | null>(null)
  const today = todayIso()
  const list = [...data.settlements].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const deviations = useMemo(() => new Map(list.map((sn) => [sn.id, compareWithCurrent(sn, data, today)])), [list, data, today])

  const remove = async (sn: SettlementSnapshot) => {
    const ok = await confirm({ title: 'Abgeschlossene Abrechnung löschen?', danger: true, confirmLabel: 'Löschen', message: `„${sn.title}“ wird endgültig gelöscht. Fahrten und Kosten bleiben unverändert.` })
    if (!ok) return
    try {
      await deleteSettlementSnapshot(sn.id)
      setViewing(null)
      toast('Abgeschlossene Abrechnung gelöscht.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const exportSnap = (sn: SettlementSnapshot) => {
    try {
      const r = sn.result as Settlement
      downloadWorkbook(
        buildSettlementWorkbook(r, { persons: snapshotPersons(sn), categories: snapshotCategories(sn), expenses: data.expenses }, { trips: periodLabel(sn.period), costs: periodLabel(sn.costPeriod ?? sn.period) }),
        `${sn.title.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.xlsx`,
      )
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Card padded={false}>
      <div className="p-5 pb-3"><CardTitle sub="Fest gespeicherte Ergebnisse – z. B. nach erfolgtem Ausgleich."><span className="flex items-center gap-2"><Archive className="h-5 w-5 text-brand-700" />Abgeschlossene Abrechnungen</span></CardTitle></div>
      {list.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-500">Noch keine. Über „Abschließen“ oben wird der aktuelle Stand festgeschrieben.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-200">
          {list.map((sn) => {
            const r = sn.result as Settlement
            const dev = deviations.get(sn.id) ?? []
            return (
              <li key={sn.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">{sn.title}</div>
                  <div className="text-xs text-slate-500">{formatStamp(sn.createdAt)}{sn.createdBy && ` · ${sn.createdBy}`} · {formatEuro(r.totalCostCents)} · {formatKm(r.totalKm)}</div>
                  {dev.length > 0
                    ? <div className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="h-3 w-3" />Aktuelle Daten weichen ab ({dev.length})</div>
                    : <div className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" />Entspricht dem aktuellen Stand</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => setViewing(sn)}>Ansehen</Button>
                  <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => exportSnap(sn)}>Excel</Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {viewing && (() => {
        const r = viewing.result as Settlement
        const dev = deviations.get(viewing.id) ?? []
        const nm = (id: string) => viewing.personNames[id] ?? 'Unbekannt'
        return (
          <Modal open onClose={() => setViewing(null)} title={viewing.title} size="lg"
            description={<>Abgeschlossen am {formatStamp(viewing.createdAt)}{viewing.createdBy && ` von ${viewing.createdBy}`} · {periodLabel(viewing.period)}{viewing.costPeriod && ` (Kosten: ${periodLabel(viewing.costPeriod)})`}</>}
            footer={<>
              <Button variant="danger-ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => void remove(viewing)}>Löschen</Button>
              <Button icon={<Download className="h-4 w-4" />} onClick={() => exportSnap(viewing)}>Excel-Export</Button>
              <Button variant="primary" onClick={() => setViewing(null)}>Schließen</Button>
            </>}>
            <div className="space-y-4">
              {dev.length > 0 && (
                <Notice level="warning" title="Die aktuellen Daten weichen von dieser Abrechnung ab">
                  <ul className="mt-1 space-y-0.5">{dev.map((d) => <li key={d.label}>{d.label}: {d.before} → jetzt {d.now}</li>)}</ul>
                </Notice>
              )}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[['Gesamtkosten', formatEuro(r.totalCostCents)], ['Kilometer', formatKm(r.totalKm)], ['Kilometerpreis', formatPricePerKm(r.pricePerKm)], ['Verteilt', formatEuro(r.distributedCents)]].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{l}</dt><dd className="tabular font-semibold text-slate-900">{v}</dd></div>
                ))}
              </dl>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-2">Person</th><th className="py-2 text-right">Anteilige km</th><th className="py-2 text-right">Kostenanteil</th><th className="py-2 text-right">Saldo</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {r.persons.map((p) => {
                    const bal = r.balance?.balances.find((b) => b.personId === p.personId)
                    return (
                      <tr key={p.personId}>
                        <td className="py-2 font-medium">{nm(p.personId)}</td>
                        <td className="tabular py-2 text-right">{formatKm(p.km)}</td>
                        <td className="tabular py-2 text-right font-semibold">{formatEuro(p.totalCents)}</td>
                        <td className="tabular py-2 text-right">{bal ? formatEuro(bal.balanceCents) : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {r.balance?.transfers.length > 0 && (
                <div className="text-sm">
                  <div className="mb-1 font-medium">Ausgleich zum Zeitpunkt des Abschlusses</div>
                  <ul className="list-disc pl-5">{r.balance.transfers.map((t) => <li key={`${t.fromPersonId}${t.toPersonId}`}>{nm(t.fromPersonId)} → {nm(t.toPersonId)}: {formatEuro(t.amountCents)}</li>)}</ul>
                </div>
              )}
            </div>
          </Modal>
        )
      })()}
    </Card>
  )
}
