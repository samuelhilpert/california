import type { Category, Expense, Payment, Person, Setting, SettlementSnapshot, Trip } from '../domain/types'

export interface AppData {
  persons: Person[]
  trips: Trip[]
  expenses: Expense[]
  categories: Category[]
  payments: Payment[]
  settlements: SettlementSnapshot[]
  settings: Setting[]
}

export type TableName = keyof AppData
export const TABLES: TableName[] = ['persons', 'trips', 'expenses', 'categories', 'payments', 'settlements', 'settings']

/** Schreiboperation; bei „put“ ist der Datensatztyp an die Tabelle gebunden. */
export type PutOp = { [T in TableName]: { type: 'put'; table: T; value: AppData[T][number] } }[TableName]
export type WriteOp = PutOp | { type: 'delete'; table: TableName; id: string }

/** Für generischen Code (Backup), der Datensätze ohne konkreten Typ verschiebt. */
export function putOp(table: TableName, value: { id: string }): WriteOp {
  return { type: 'put', table, value } as WriteOp
}

export interface SyncStatus {
  /** Daten wurden mindestens einmal geladen (aus Cache oder Server). */
  loaded: boolean
  /** Browser meldet Netzverbindung. */
  online: boolean
  /** Lokale Änderungen, die noch nicht beim Server angekommen sind. */
  pendingWrites: boolean
  /** Aktuelle Daten stammen aus dem lokalen Cache (noch nicht vom Server bestätigt). */
  fromCache: boolean
}

/**
 * Speicherschnittstelle. Die Anwendung liest ausschließlich über `getData()`/`subscribe()` und schreibt
 * ausschließlich über `commit()`. Mehrere Operationen in einem `commit()` werden – soweit vom Backend
 * unterstützt – atomar ausgeführt.
 */
export interface DataStore {
  getData(): AppData
  subscribe(listener: () => void): () => void
  getStatus(): SyncStatus
  subscribeStatus(listener: () => void): () => void
  onError(listener: (err: unknown) => void): () => void
  commit(ops: WriteOp[]): Promise<void>
  ready: Promise<void>
  dispose(): void
}

export function emptyData(): AppData {
  return { persons: [], trips: [], expenses: [], categories: [], payments: [], settlements: [], settings: [] }
}
