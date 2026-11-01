import { clsx } from 'clsx'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronLeft, Cloud, DatabaseBackup, Download, FileSpreadsheet, GitMerge, Replace, RotateCcw, Trash2 } from 'lucide-react'
import { useAppData, useSession, useSetting } from '../lib/store/context'
import { setSetting } from '../lib/store/repo'
import { clearAllData, createBackup, parseBackup, planMerge, planReplace, restoreBackup, type BackupFile } from '../lib/io/backup'
import { buildDataWorkbook, downloadWorkbook } from '../lib/io/excelExport'
import { todayIso } from '../lib/domain/dates'
import { formatStamp } from '../lib/format'
import { Button, Card, CardTitle, Modal, Notice, PageHeader } from '../components/ui'
import { errorMessage, useFeedback } from '../components/feedback-context'

const MAX_FILE_BYTES = 20 * 1024 * 1024

function downloadText(text: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function DataPage() {
  const data = useAppData()
  const { store, memberEmails } = useSession()
  const lastBackup = useSetting<string>('lastBackupAt')
  const { toast, confirm } = useFeedback()
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null)
  const [busy, setBusy] = useState(false)
  const backupInput = useRef<HTMLInputElement>(null)

  const doBackup = async () => {
    try {
      const b = createBackup(store)
      downloadText(JSON.stringify(b, null, 2), `VW-California-Backup_${todayIso()}.json`, 'application/json')
      await setSetting('lastBackupAt', new Date().toISOString())
      toast('Backup wurde heruntergeladen. Bewahre die Datei sicher auf.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const onBackupFile = async (file: File) => {
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Die Datei ist zu groß für eine Sicherung.')
      setPendingRestore(parseBackup(await file.text()))
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const runRestore = async (mode: 'merge' | 'replace') => {
    if (!pendingRestore) return
    if (mode === 'replace') {
      const ok = await confirm({
        title: 'Gemeinsamen Datenstand ersetzen?',
        danger: true,
        confirmLabel: 'Alles ersetzen',
        message: <>Alle aktuellen Daten werden für <strong>alle Mitglieder</strong> durch die Sicherung ersetzt. Datensätze, die nicht in der Sicherung enthalten sind, werden gelöscht.</>,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const plan = await restoreBackup(pendingRestore, store, mode)
      setPendingRestore(null)
      toast(mode === 'merge'
        ? `Zusammengeführt: ${plan.added} ergänzt, ${plan.updated} aktualisiert, ${plan.unchanged} unverändert.`
        : `Wiederhergestellt: ${plan.added + plan.updated} Datensätze, ${plan.removed} entfernt.`)
    } catch (e) {
      toast(`Wiederherstellung fehlgeschlagen: ${errorMessage(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportAll = () => {
    try {
      downloadWorkbook(buildDataWorkbook(data), `VW-California-Daten_${todayIso()}.xlsx`)
      toast('Excel-Export erstellt.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const wipe = async () => {
    const ok = await confirm({
      title: 'Alle Daten löschen?',
      danger: true,
      confirmLabel: 'Endgültig löschen',
      message: <>Alle Fahrten, Kosten, Zahlungen, Abrechnungen und Personen werden <strong>für alle Mitglieder</strong> gelöscht. Das kann nicht rückgängig gemacht werden. {!lastBackup && <strong className="text-red-700">Es wurde noch nie ein Backup erstellt!</strong>}</>,
    })
    if (!ok) return
    try {
      await clearAllData(store)
      toast('Alle Daten wurden gelöscht.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const pick = (input: React.RefObject<HTMLInputElement | null>) => {
    if (input.current) {
      input.current.value = ''
      input.current.click()
    }
  }

  const mergePlan = pendingRestore ? planMerge(data, pendingRestore) : null
  const replacePlan = pendingRestore ? planReplace(data, pendingRestore) : null
  const counts = (d: BackupFile['data']) => `${d.trips.length} Fahrten, ${d.expenses.length} Ausgaben, ${d.persons.length} Personen, ${d.payments.length} Zahlungen`

  return (
    <>
      <Link to="/einstellungen" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"><ChevronLeft className="h-4 w-4" />Einstellungen</Link>
      <PageHeader title="Backup & Export" description="Datensicherung und Export als Excel-Tabelle." />

      <div className="space-y-6">
        <Notice level="info" title="Gemeinsamer Datenstand in der Cloud">
          Alle Daten liegen in eurem Firebase-Projekt und sind für alle {memberEmails.length} Mitglieder sofort sichtbar. Jedes Gerät hält zusätzlich eine Offline-Kopie.
          Ein Backup schützt vor versehentlichem Löschen oder Überschreiben – am besten regelmäßig herunterladen.
        </Notice>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle sub="Vollständige Sicherung als JSON-Datei">
              <span className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5 text-brand-700" />Backup</span>
            </CardTitle>
            <p className="mb-4 text-sm text-slate-600">
              Enthält alle Fahrten, Kosten, Zahlungen, abgeschlossenen Abrechnungen, Personen und Kategorien.
              Beim Wiederherstellen kannst du die Sicherung mit dem aktuellen Stand <strong>zusammenführen</strong> oder ihn komplett <strong>ersetzen</strong>.
            </p>
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              Letztes Backup (von einem beliebigen Mitglied): <strong>{lastBackup ? formatStamp(lastBackup) : 'noch nie'}</strong>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => void doBackup()}>Backup herunterladen</Button>
              <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => pick(backupInput)}>Backup einspielen</Button>
            </div>
            <input ref={backupInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onBackupFile(f) }} />
          </Card>

          <Card>
            <CardTitle sub="Fahrtenbuch, Kosten und Personen als Tabellen">
              <span className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand-700" />Excel-Export</span>
            </CardTitle>
            <p className="mb-4 text-sm text-slate-600">Zum Anschauen, Weiterrechnen oder Archivieren, z. B. in Excel oder Numbers. Zum Wiederherstellen dient das Backup, nicht der Excel-Export. Die Abrechnung exportierst du auf der Seite „Abrechnung“.</p>
            <Button icon={<Download className="h-4 w-4" />} onClick={exportAll}>Daten als Excel exportieren</Button>
          </Card>

          <Card>
            <CardTitle><span className="flex items-center gap-2"><Cloud className="h-5 w-5 text-brand-700" />Datenbestand</span></CardTitle>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Fahrten</dt><dd className="tabular text-right font-medium">{data.trips.length}</dd>
              <dt className="text-slate-500">Ausgaben</dt><dd className="tabular text-right font-medium">{data.expenses.length}</dd>
              <dt className="text-slate-500">Ausgleichszahlungen</dt><dd className="tabular text-right font-medium">{data.payments.length}</dd>
              <dt className="text-slate-500">Abgeschlossene Abrechnungen</dt><dd className="tabular text-right font-medium">{data.settlements.length}</dd>
              <dt className="text-slate-500">Personen</dt><dd className="tabular text-right font-medium">{data.persons.length}</dd>
              <dt className="text-slate-500">Mitglieder</dt><dd className="tabular text-right font-medium">{memberEmails.length}</dd>
            </dl>
          </Card>
        </div>

        <Card className="border-red-200">
          <CardTitle sub="Löscht alle Daten des gemeinsamen Fahrtenbuchs – für alle Mitglieder.">
            <span className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-5 w-5" />Gefahrenbereich</span>
          </CardTitle>
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => void wipe()}>Alle Daten löschen</Button>
        </Card>
      </div>

      <Modal open={pendingRestore != null} onClose={() => setPendingRestore(null)} title="Backup einspielen" size="lg"
        description={pendingRestore && <>Sicherung vom {formatStamp(pendingRestore.exportedAt)}: {counts(pendingRestore.data)}</>}>
        {pendingRestore && mergePlan && replacePlan && (
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['merge', GitMerge, 'Zusammenführen (empfohlen)', 'Ergänzt fehlende Datensätze und übernimmt neuere Fassungen. Nichts wird gelöscht. Gleichnamige Personen werden zusammengelegt.', `${mergePlan.added} neu · ${mergePlan.updated} aktualisiert · ${mergePlan.unchanged} unverändert`],
              ['replace', Replace, 'Ersetzen', 'Der gemeinsame Datenstand entspricht danach exakt der Sicherung. Alles andere wird gelöscht.', `${replacePlan.added + replacePlan.updated} Datensätze · ${replacePlan.removed} werden gelöscht`],
            ] as const).map(([mode, Icon, title, desc, stats]) => (
              <button key={mode} disabled={busy} onClick={() => void runRestore(mode)}
                className={clsx('flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors hover:bg-slate-50 disabled:opacity-50', mode === 'replace' ? 'border-red-200' : 'border-brand-600 ring-1 ring-brand-600')}>
                <span className="flex items-center gap-2 font-semibold text-slate-900"><Icon className={clsx('h-5 w-5', mode === 'replace' ? 'text-red-600' : 'text-brand-700')} />{title}</span>
                <span className="text-sm text-slate-600">{desc}</span>
                <span className="tabular text-xs font-medium text-slate-500">{stats}</span>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </>
  )
}
