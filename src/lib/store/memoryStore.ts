import { DEFAULT_CATEGORIES } from './defaults'
import { emptyData, type AppData, type DataStore, type SyncStatus, type TableName, type WriteOp } from './types'

/** In-Memory-Speicher – für Tests. Commits sind atomar. */
export class MemoryStore implements DataStore {
  private data: AppData
  private listeners = new Set<() => void>()
  private errorListeners = new Set<(e: unknown) => void>()
  ready = Promise.resolve()
  /** Für Tests: lässt den nächsten Commit fehlschlagen. */
  failNextCommit: Error | null = null

  constructor(initial?: Partial<AppData>, withDefaults = true) {
    this.data = { ...emptyData(), ...(withDefaults ? { categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })) } : {}), ...initial }
  }

  getData(): AppData {
    return this.data
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  getStatus(): SyncStatus {
    return { loaded: true, online: true, pendingWrites: false, fromCache: false }
  }
  subscribeStatus() {
    return () => undefined
  }
  onError(listener: (e: unknown) => void) {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  async commit(ops: WriteOp[]): Promise<void> {
    if (this.failNextCommit) {
      const e = this.failNextCommit
      this.failNextCommit = null
      throw e
    }
    const next: AppData = { ...this.data }
    const touched = new Set<TableName>()
    const maps = new Map<TableName, Map<string, { id: string }>>()
    const mapFor = (t: TableName) => {
      let m = maps.get(t)
      if (!m) {
        m = new Map((this.data[t] as { id: string }[]).map((x) => [x.id, x]))
        maps.set(t, m)
      }
      return m
    }
    for (const op of ops) {
      touched.add(op.table)
      if (op.type === 'put') mapFor(op.table).set(op.value.id, structuredClone(stripUndefined(op.value as { id: string })))
      else mapFor(op.table).delete(op.id)
    }
    for (const t of touched) (next as Record<TableName, unknown>)[t] = [...mapFor(t).values()]
    this.data = next
    this.listeners.forEach((l) => l())
  }

  dispose() {
    this.listeners.clear()
  }
}

export function stripUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? stripUndefined(v as object) : v
  }
  return out as T
}
