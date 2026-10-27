import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, DatabaseBackup, Download, FileSpreadsheet, HardDrive, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useAppData, useSetting } from '../lib/db/hooks'
import { db } from '../lib/db/db'
import { setSetting } from '../lib/db/repo'
import { clearAllData, createBackup, parseBackup, restoreBackup, type BackupFile } from '../lib/io/backup'
import { buildDataWorkbook, downloadWorkbook } from '../lib/io/excelExport'
import { analyzeWorkbook, readWorkbook, type ImportPreview } from '../lib/io/excelImport'
import { todayIso } from '../lib/domain/dates'
import { formatStamp } from '../lib/format'
import { Button, Card, CardTitle, Notice, PageHeader } from '../components/ui'
import { ImportPreviewModal } from '../components/ImportPreview'
import { Loading } from '../components/Loading'
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
  const lastBackup = useSetting<string>('lastBackupAt')
  const { toast, confirm } = useFeedback()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const xlsxInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])

  if (!data) return <Loading />

  const doBackup = async () => {
    try {
      const b = await createBackup(db)
      downloadText(JSON.stringify(b, null, 2), `VW-California-Backup_${todayIso()}.json`, 'application/json')
      await setSetting('lastBackupAt', new Date().toISOString())
      toast('Backup wurde heruntergeladen. Bewahre die Datei sicher auf.')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const onBackupFile = async (file: File) => {
    let backup: BackupFile
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Die Datei ist zu groß für eine Sicherung.')
      backup = parseBackup(await file.text())
    } catch (e) {
      toast(errorMessage(e), 'error')
      return
    }
    const d = backup.data
    const ok = await confirm({
      title: 'Backup wiederherstellen?',
      danger: true,
      confirmLabel: 'Alle Daten ersetzen',
      message: (
        <div className="space-y-3">
          <p>Sicherung vom <strong>{formatStamp(backup.exportedAt)}</strong> mit {d.trips.length} Fahrten, {d.expenses.length} Ausgaben und {d.persons.length} Personen.</p>
          <p className="font-medium text-red-700">Alle aktuell gespeicherten Daten ({data.trips.length} Fahrten, {data.expenses.length} Ausgaben, {data.persons.length} Personen) werden dabei ersetzt.</p>
          <p>Tipp: Lade vorher ein Backup des aktuellen Stands herunter.</p>
        </div>
      ),
    })
    if (!ok) return
    try {
      await restoreBackup(backup, db)
      toast('Backup wurde wiederhergestellt.')
    } catch (e) {
      toast(`Wiederherstellung fehlgeschlagen – es wurde nichts verändert. ${errorMessage(e)}`, 'error')
    }
  }

  const onXlsxFile = async (file: File) => {
    setBusy(true)
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('Die Datei ist zu groß (max. 20 MB).')
      const wb = readWorkbook(new Uint8Array(await file.arrayBuffer()))
      setPreview(analyzeWorkbook(wb, file.name, data, todayIso()))
    } catch (e) {
      toast(`Die Datei konnte nicht gelesen werden: ${errorMessage(e)}`, 'error')
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
      message: <>Alle Fahrten, Kosten, Personen und eigenen Kategorien werden aus diesem Browser gelöscht. Das kann nicht rückgängig gemacht werden. {!lastBackup && <strong className="text-red-700">Du hast noch kein Backup erstellt!</strong>}</>,
    })
    if (!ok) return
    await clearAllData(db)
    toast('Alle Daten wurden gelöscht.')
  }

  const pick = (input: React.RefObject<HTMLInputElement | null>) => {
    if (input.current) {
      input.current.value = ''
      input.current.click()
    }
  }

  return (
    <>
      <PageHeader title="Import & Backup" description="Excel-Import, Datensicherung und Export." />

      <div className="space-y-6">
        <Notice level="info" title="Wo werden die Daten gespeichert?">
          Alle Daten liegen ausschließlich lokal in diesem Browser (IndexedDB) auf diesem Gerät. Es gibt <strong>keine</strong> Cloud-Synchronisierung: Andere Geräte oder Browser sehen diese Daten nicht automatisch. Wird der Browserspeicher gelöscht, sind die Daten weg – nur ein Backup schützt davor. Zum Gerätewechsel ein Backup herunterladen und auf dem neuen Gerät wiederherstellen.
        </Notice>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardTitle sub="Vollständige Sicherung aller Daten als JSON-Datei">
              <span className="flex items-center gap-2"><DatabaseBackup className="h-5 w-5 text-brand-700" />Backup</span>
            </CardTitle>
            <p className="mb-4 text-sm text-slate-600">
              Enthält alle Fahrten, Kosten, Personen, Kategorien und Einstellungen. Damit lässt sich die Anwendung auf jedem Gerät vollständig wiederherstellen.
            </p>
            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              Letztes Backup: <strong>{lastBackup ? formatStamp(lastBackup) : 'noch nie'}</strong>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={() => void doBackup()}>Backup herunterladen</Button>
              <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => pick(backupInput)}>Backup wiederherstellen</Button>
            </div>
            <input ref={backupInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onBackupFile(f) }} />
          </Card>

          <Card>
            <CardTitle sub="z. B. „VW California.xlsx“ mit Fahrtenbuch, Kostenverteilung und Kosten">
              <span className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand-700" />Excel-Import</span>
            </CardTitle>
            <p className="mb-4 text-sm text-slate-600">
              Vor dem Import siehst du eine Vorschau mit allen erkannten Fahrten, Kosten und Personen. Fehlerhafte Zeilen und bereits vorhandene Datensätze werden markiert. Bestehende Daten werden nie überschrieben – der Import kann gefahrlos wiederholt werden.
            </p>
            <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={() => pick(xlsxInput)} disabled={busy}>
              {busy ? 'Datei wird gelesen …' : 'Excel-Datei auswählen'}
            </Button>
            <input ref={xlsxInput} type="file" accept=".xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onXlsxFile(f) }} />
          </Card>

          <Card>
            <CardTitle sub="Fahrtenbuch, Kosten und Personen als Tabellen">
              <span className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand-700" />Excel-Export</span>
            </CardTitle>
            <p className="mb-4 text-sm text-slate-600">Zum Weiterverarbeiten oder Archivieren. Die exportierte Datei kann auch wieder importiert werden. Die Abrechnung exportierst du auf der Seite „Abrechnung“.</p>
            <Button icon={<Download className="h-4 w-4" />} onClick={exportAll}>Daten als Excel exportieren</Button>
          </Card>

          <Card>
            <CardTitle><span className="flex items-center gap-2"><HardDrive className="h-5 w-5 text-brand-700" />Speicher</span></CardTitle>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Fahrten</dt><dd className="tabular text-right font-medium">{data.trips.length}</dd>
              <dt className="text-slate-500">Ausgaben</dt><dd className="tabular text-right font-medium">{data.expenses.length}</dd>
              <dt className="text-slate-500">Personen</dt><dd className="tabular text-right font-medium">{data.persons.length}</dd>
              <dt className="text-slate-500">Kategorien</dt><dd className="tabular text-right font-medium">{data.categories.length}</dd>
              <dt className="text-slate-500">Dauerhafter Speicher</dt>
              <dd className="text-right font-medium">{persisted == null ? 'unbekannt' : persisted ? 'aktiv' : 'nicht garantiert'}</dd>
            </dl>
            {persisted === false && <p className="mt-3 text-xs text-slate-500">Der Browser kann die Daten bei Speichermangel löschen. Regelmäßige Backups sind daher besonders wichtig.</p>}
          </Card>
        </div>

        <Card className="border-red-200">
          <CardTitle sub="Löscht alle Daten aus diesem Browser.">
            <span className="flex items-center gap-2 text-red-700"><AlertTriangle className="h-5 w-5" />Gefahrenbereich</span>
          </CardTitle>
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => void wipe()}>Alle Daten löschen</Button>
        </Card>
      </div>

      {preview && <ImportPreviewModal preview={preview} categories={data.categories} onClose={() => setPreview(null)} />}
    </>
  )
}
