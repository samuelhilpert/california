import { collection, doc, onSnapshot, writeBatch, type Firestore } from 'firebase/firestore'
import { stripUndefined } from './memoryStore'
import { withCurrentColor } from './defaults'
import type { Category } from '../domain/types'
import { emptyData, TABLES, type AppData, type DataStore, type SyncStatus, type TableName, type WriteOp } from './types'

/** Firestore erlaubt max. 500 Operationen je Batch. */
const BATCH_LIMIT = 450
/** Wie lange online auf die Server-Bestätigung gewartet wird, bevor die UI weitermacht. */

/**
 * Gemeinsamer Datenstand in Firestore unter `books/<bookId>/<tabelle>/<id>`.
 *
 * - Lesen: Echtzeit-Listener je Tabelle; Änderungen anderer Personen erscheinen sofort.
 * - Offline: Firestore hält einen lokalen Cache (IndexedDB). Änderungen werden sofort lokal sichtbar
 *   und automatisch synchronisiert, sobald wieder eine Verbindung besteht.
 * - Konflikte: Pro Datensatz gewinnt die zuletzt gespeicherte Änderung.
 */
export class FirestoreStore implements DataStore {
  private data: AppData = emptyData()
  private listeners = new Set<() => void>()
  private statusListeners = new Set<() => void>()
  private errorListeners = new Set<(e: unknown) => void>()
  private unsubs: (() => void)[] = []
  private loadedTables = new Set<TableName>()
  private pendingTables = new Set<TableName>()
  private cacheTables = new Set<TableName>()
  /** Wartende Speichervorgänge je Tabelle – aufgelöst beim nächsten Snapshot (= lokal gesichert). */
  private localWaiters = new Map<TableName, (() => void)[]>()
  private status: SyncStatus = { loaded: false, online: navigator.onLine, pendingWrites: false, fromCache: true }
  ready: Promise<void>
  private resolveReady!: () => void
  private rejectReady!: (e: unknown) => void

  constructor(private db: Firestore, private bookId: string) {
    this.ready = new Promise((res, rej) => {
      this.resolveReady = res
      this.rejectReady = rej
    })
    for (const table of TABLES) {
      const unsub = onSnapshot(
        collection(db, 'books', bookId, table),
        { includeMetadataChanges: true },
        (snap) => {
          let docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }))
          // Alte Standardfarben von Kategorien an das aktuelle Design anpassen (ohne zu schreiben)
          if (table === 'categories') docs = docs.map((c) => withCurrentColor(c as Category))
          this.data = { ...this.data, [table]: docs }
          this.loadedTables.add(table)
          if (snap.metadata.hasPendingWrites) this.pendingTables.add(table)
          else this.pendingTables.delete(table)
          if (snap.metadata.fromCache) this.cacheTables.add(table)
          else this.cacheTables.delete(table)
          if (this.loadedTables.size === TABLES.length) this.resolveReady()
          const waiting = this.localWaiters.get(table)
          if (waiting) {
            this.localWaiters.delete(table)
            waiting.forEach((w) => w())
          }
          this.updateStatus()
          this.listeners.forEach((l) => l())
        },
        (err) => {
          this.rejectReady(err)
          this.errorListeners.forEach((l) => l(err))
        },
      )
      this.unsubs.push(unsub)
    }
    const onNet = () => this.updateStatus()
    window.addEventListener('online', onNet)
    window.addEventListener('offline', onNet)
    this.unsubs.push(() => {
      window.removeEventListener('online', onNet)
      window.removeEventListener('offline', onNet)
    })
  }

  private updateStatus() {
    const next: SyncStatus = {
      loaded: this.loadedTables.size === TABLES.length,
      online: navigator.onLine,
      pendingWrites: this.pendingTables.size > 0,
      fromCache: this.cacheTables.size > 0,
    }
    const s = this.status
    if (s.loaded !== next.loaded || s.online !== next.online || s.pendingWrites !== next.pendingWrites || s.fromCache !== next.fromCache) {
      this.status = next
      this.statusListeners.forEach((l) => l())
    }
  }

  getData() {
    return this.data
  }
  subscribe(l: () => void) {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getStatus() {
    return this.status
  }
  subscribeStatus(l: () => void) {
    this.statusListeners.add(l)
    return () => this.statusListeners.delete(l)
  }
  onError(l: (e: unknown) => void) {
    this.errorListeners.add(l)
    return () => this.errorListeners.delete(l)
  }

  async commit(ops: WriteOp[]): Promise<void> {
    if (ops.length === 0) return
    // Vor dem Schreiben anmelden, damit kein Snapshot verpasst wird
    const tables = [...new Set(ops.map((o) => o.table))]
    const savedLocally = Promise.all(tables.map((t) => new Promise<void>((res) => this.localWaiters.set(t, [...(this.localWaiters.get(t) ?? []), res]))))
    const commits: Promise<void>[] = []
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      const batch = writeBatch(this.db)
      for (const op of ops.slice(i, i + BATCH_LIMIT)) {
        if (op.type === 'put') batch.set(doc(this.db, 'books', this.bookId, op.table, op.value.id), stripUndefined(op.value as { id: string }))
        else batch.delete(doc(this.db, 'books', this.bookId, op.table, op.id))
      }
      commits.push(batch.commit())
    }
    // Auf den Server wird nicht gewartet – so schließen sich Formulare sofort, auch offline oder
    // bei langsamer Verbindung. Fehler (z. B. fehlende Berechtigung) meldet onError als Hinweis;
    // den Übertragungsstand zeigt die Statusanzeige („Wird synchronisiert …“).
    Promise.all(commits).catch((e) => this.errorListeners.forEach((l) => l(e)))
    // Gewartet wird nur, bis die Änderung auf dem Gerät gesichert ist: Firestore schreibt sie in
    // den lokalen Speicher und meldet erst danach einen Snapshot. Wer die App direkt nach dem
    // Speichern schließt oder neu lädt, verliert so nichts. Sicherheitsnetz: höchstens 2 Sekunden.
    // Große Mengen (z. B. Backup) kommen in mehreren Paketen – dann auf alle warten (max. 15 s)
    if (commits.length > 1) await Promise.race([Promise.all(commits).catch(() => undefined), new Promise<void>((res) => setTimeout(res, 15_000))])
    else await Promise.race([savedLocally, new Promise<void>((res) => setTimeout(res, 2000))])
  }

  dispose() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.listeners.clear()
    this.statusListeners.clear()
  }
}
