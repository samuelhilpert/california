import { z } from 'zod'
import { DEFAULT_CATEGORIES } from '../store/defaults'
import { putOp, TABLES, type AppData, type DataStore, type TableName, type WriteOp } from '../store/types'
import { isIsoDate } from '../domain/dates'

export const BACKUP_APP_ID = 'vw-california-fahrtenbuch'
export const BACKUP_SCHEMA_VERSION = 2

const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum')
const stamp = z.string()

const personSchema = z.object({ id: z.string().min(1), name: z.string().min(1), active: z.boolean(), email: z.string().optional(), createdAt: stamp, updatedAt: stamp.optional() })
const tripSchema = z.object({
  id: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  stops: z.array(z.string()).optional(),
  odoStart: z.number().finite().optional(),
  odoEnd: z.number().finite().optional(),
  km: z.number().finite().nonnegative(),
  personIds: z.array(z.string()).min(1),
  note: z.string().optional(),
  importKey: z.string().optional(),
  createdAt: stamp,
  updatedAt: stamp,
  updatedBy: z.string().optional(),
})
const categorySchema = z.object({ id: z.string().min(1), name: z.string().min(1), builtin: z.boolean(), color: z.string(), updatedAt: stamp.optional() })
const expenseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  categoryId: z.string().min(1),
  amountCents: z.number().int(),
  date: isoDate,
  allocation: z.enum(['perKm', 'direct']),
  directPersonIds: z.array(z.string()).optional(),
  recurrence: z
    .object({ frequency: z.enum(['monthly', 'yearly']), count: z.number().int().positive().optional(), until: isoDate.optional() })
    .optional(),
  spreadMonths: z.number().int().min(1).max(120).optional(),
  paidBy: z.string().optional(),
  note: z.string().optional(),
  importKey: z.string().optional(),
  createdAt: stamp,
  updatedAt: stamp,
  updatedBy: z.string().optional(),
})
const paymentSchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  fromPersonId: z.string().min(1),
  toPersonId: z.string().min(1),
  amountCents: z.number().int().positive(),
  note: z.string().optional(),
  createdAt: stamp,
  updatedAt: stamp,
  updatedBy: z.string().optional(),
})
const periodSchema = z.union([
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('year'), year: z.number().int() }),
  z.object({ kind: z.literal('month'), year: z.number().int(), month: z.number().int().min(1).max(12) }),
  z.object({ kind: z.literal('range'), from: isoDate, to: isoDate }),
])
const settlementSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  period: periodSchema,
  costPeriod: periodSchema.optional(),
  personNames: z.record(z.string(), z.string()),
  categoryNames: z.record(z.string(), z.string()),
  result: z.unknown(),
  createdAt: stamp,
  createdBy: z.string().optional(),
  updatedAt: stamp,
})
const settingSchema = z.object({ id: z.string(), value: z.unknown() })
const fuelSchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  personId: z.string().optional(),
  amountCents: z.number().int().nonnegative(),
  liters: z.number().finite().positive().optional(),
  odometer: z.number().finite().nonnegative().optional(),
  fullTank: z.boolean(),
  note: z.string().optional(),
  createdAt: stamp,
  updatedAt: stamp,
  updatedBy: z.string().optional(),
})

const planSchema = z.object({
  id: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate.optional(),
  personIds: z.array(z.string()),
  title: z.string().optional(),
  note: z.string().optional(),
  createdAt: stamp,
  updatedAt: stamp,
  updatedBy: z.string().optional(),
})

const dataSchema = z.object({
  persons: z.array(personSchema),
  trips: z.array(tripSchema),
  expenses: z.array(expenseSchema),
  categories: z.array(categorySchema),
  payments: z.array(paymentSchema).default([]),
  settlements: z.array(settlementSchema).default([]),
  settings: z.array(settingSchema).default([]),
  fuel: z.array(fuelSchema).default([]),
  plans: z.array(planSchema).default([]),
})

export interface BackupFile {
  app: typeof BACKUP_APP_ID
  schemaVersion: number
  exportedAt: string
  data: AppData
}

const EXCLUDED_SETTINGS = new Set(['lastBackupAt'])

export function createBackup(store: DataStore): BackupFile {
  const d = store.getData()
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: { ...d, settings: d.settings.filter((s) => !EXCLUDED_SETTINGS.has(s.id)) },
  }
}

export class BackupError extends Error {}

/** Version-1-Sicherungen (lokale Version) in das aktuelle Format überführen. */
function migrate(json: Record<string, unknown>): Record<string, unknown> {
  if (json.schemaVersion === 1 && json.data && typeof json.data === 'object') {
    const data = { ...(json.data as Record<string, unknown>) }
    if (Array.isArray(data.settings)) data.settings = (data.settings as { key?: string; id?: string; value: unknown }[]).map((s) => ({ id: s.id ?? s.key, value: s.value }))
    return { ...json, schemaVersion: 2, data }
  }
  return json
}

/** Liest und prüft eine Sicherungsdatei vollständig, bevor irgendetwas verändert wird. */
export function parseBackup(text: string): BackupFile {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new BackupError('Die Datei ist keine gültige JSON-Sicherung.')
  }
  if (typeof json !== 'object' || !json || (json as { app?: unknown }).app !== BACKUP_APP_ID) {
    throw new BackupError('Diese Datei ist keine Sicherung dieser Anwendung.')
  }
  const raw = json as Record<string, unknown>
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupError('Die Sicherung stammt aus einer neueren Version der Anwendung und kann nicht gelesen werden.')
  }
  const migrated = migrate(raw)
  const res = z.object({ app: z.literal(BACKUP_APP_ID), schemaVersion: z.number().int(), exportedAt: z.string(), data: dataSchema }).safeParse(migrated)
  if (!res.success) {
    const first = res.error.issues[0]
    throw new BackupError(`Die Sicherung ist beschädigt oder unvollständig (${first.path.join('.')}: ${first.message}).`)
  }
  const b = res.data as BackupFile
  checkReferences(b.data)
  return b
}

function checkReferences(d: AppData) {
  const personIds = new Set(d.persons.map((p) => p.id))
  const categoryIds = new Set([...d.categories.map((c) => c.id), ...DEFAULT_CATEGORIES.map((c) => c.id)])
  for (const t of d.trips) {
    if (t.personIds.some((id) => !personIds.has(id))) throw new BackupError(`Fahrt vom ${t.startDate} verweist auf eine unbekannte Person.`)
  }
  for (const e of d.expenses) {
    if (!categoryIds.has(e.categoryId)) throw new BackupError(`Ausgabe „${e.title}“ verweist auf eine unbekannte Kategorie.`)
    if (e.directPersonIds?.some((id) => !personIds.has(id)) || (e.paidBy && !personIds.has(e.paidBy))) throw new BackupError(`Ausgabe „${e.title}“ verweist auf eine unbekannte Person.`)
  }
  for (const p of d.payments) {
    if (!personIds.has(p.fromPersonId) || !personIds.has(p.toPersonId)) throw new BackupError(`Zahlung vom ${p.date} verweist auf eine unbekannte Person.`)
  }
  for (const f of d.fuel) {
    if (f.personId && !personIds.has(f.personId)) throw new BackupError(`Tankfüllung vom ${f.date} verweist auf eine unbekannte Person.`)
  }
  for (const p of d.plans) {
    if (p.personIds.some((id) => !personIds.has(id))) throw new BackupError(`Kalendereintrag vom ${p.startDate} verweist auf eine unbekannte Person.`)
  }
  for (const table of TABLES) {
    const list = d[table] as { id: string }[]
    if (new Set(list.map((x) => x.id)).size !== list.length) throw new BackupError(`Die Sicherung enthält doppelte IDs (${table}).`)
  }
}

interface RestorePlan {
  ops: WriteOp[]
  added: number
  updated: number
  removed: number
  unchanged: number
}

const updatedAtOf = (x: unknown) => (x as { updatedAt?: string; createdAt?: string }).updatedAt ?? (x as { createdAt?: string }).createdAt ?? ''

/**
 * Ersetzen: Der gemeinsame Datenstand entspricht danach exakt der Sicherung.
 */
export function planReplace(current: AppData, backup: BackupFile): RestorePlan {
  const plan: RestorePlan = { ops: [], added: 0, updated: 0, removed: 0, unchanged: 0 }
  const target: AppData = { ...backup.data, categories: [...backup.data.categories] }
  for (const d of DEFAULT_CATEGORIES) if (!target.categories.some((c) => c.id === d.id)) target.categories.push(d)
  for (const table of TABLES) {
    const keep = new Set((target[table] as { id: string }[]).map((x) => x.id))
    const existing = new Set((current[table] as { id: string }[]).map((x) => x.id))
    for (const x of current[table] as { id: string }[]) {
      if (table === 'settings' && EXCLUDED_SETTINGS.has(x.id)) continue
      if (!keep.has(x.id)) {
        plan.ops.push({ type: 'delete', table, id: x.id })
        plan.removed++
      }
    }
    for (const x of target[table] as { id: string }[]) {
      plan.ops.push(putOp(table, x))
      if (existing.has(x.id)) plan.updated++
      else plan.added++
    }
  }
  return plan
}

/**
 * Zusammenführen: Datensätze aus der Sicherung, die es noch nicht gibt, werden ergänzt.
 * Gibt es denselben Datensatz (gleiche ID) bereits, gewinnt die neuere Fassung (updatedAt).
 * Es wird nichts gelöscht. Personen gleichen Namens werden zusammengelegt.
 */
export function planMerge(current: AppData, backup: BackupFile): RestorePlan {
  const plan: RestorePlan = { ops: [], added: 0, updated: 0, removed: 0, unchanged: 0 }
  // Personen mit gleichem Namen, aber anderer ID (auf zwei Geräten getrennt angelegt) zusammenlegen
  const personIdMap = new Map<string, string>()
  const currentByName = new Map(current.persons.map((p) => [p.name.toLowerCase(), p.id]))
  const currentIds = new Set(current.persons.map((p) => p.id))
  for (const p of backup.data.persons) {
    const sameName = currentByName.get(p.name.toLowerCase())
    if (!currentIds.has(p.id) && sameName) personIdMap.set(p.id, sameName)
  }
  const mapP = (id: string) => personIdMap.get(id) ?? id
  const data: AppData = {
    ...backup.data,
    persons: backup.data.persons.filter((p) => !personIdMap.has(p.id)),
    trips: backup.data.trips.map((t) => ({ ...t, personIds: [...new Set(t.personIds.map(mapP))] })),
    expenses: backup.data.expenses.map((e) => ({
      ...e,
      ...(e.directPersonIds ? { directPersonIds: [...new Set(e.directPersonIds.map(mapP))] } : {}),
      ...(e.paidBy ? { paidBy: mapP(e.paidBy) } : {}),
    })),
    payments: backup.data.payments.map((p) => ({ ...p, fromPersonId: mapP(p.fromPersonId), toPersonId: mapP(p.toPersonId) })),
    fuel: backup.data.fuel.map((f) => (f.personId ? { ...f, personId: mapP(f.personId) } : f)),
    plans: backup.data.plans.map((p) => ({ ...p, personIds: [...new Set(p.personIds.map(mapP))] })),
  }
  for (const table of TABLES) {
    const cur = new Map((current[table] as { id: string }[]).map((x) => [x.id, x]))
    for (const x of data[table] as { id: string }[]) {
      if (table === 'settings' && EXCLUDED_SETTINGS.has(x.id)) continue
      const ex = cur.get(x.id)
      if (!ex) {
        plan.ops.push(putOp(table, x))
        plan.added++
      } else if (updatedAtOf(x) > updatedAtOf(ex)) {
        plan.ops.push(putOp(table, x))
        plan.updated++
      } else plan.unchanged++
    }
  }
  return plan
}

export async function restoreBackup(backup: BackupFile, store: DataStore, mode: 'replace' | 'merge' = 'replace'): Promise<RestorePlan> {
  const plan = mode === 'replace' ? planReplace(store.getData(), backup) : planMerge(store.getData(), backup)
  await store.commit(plan.ops)
  return plan
}

/** Löscht alle Daten des Fahrtenbuchs (Standardkategorien bleiben). */
export async function clearAllData(store: DataStore): Promise<void> {
  const d = store.getData()
  const ops: WriteOp[] = []
  for (const table of TABLES) for (const x of d[table] as { id: string }[]) ops.push({ type: 'delete', table: table as TableName, id: x.id })
  for (const c of DEFAULT_CATEGORIES) ops.push({ type: 'put', table: 'categories', value: c })
  await store.commit(ops)
}
