import { z } from 'zod'
import { DEFAULT_CATEGORIES, type CaliforniaDB } from '../db/db'
import type { Category, Expense, Person, Setting, Trip } from '../domain/types'
import { isIsoDate } from '../domain/dates'

export const BACKUP_APP_ID = 'vw-california-fahrtenbuch'
export const BACKUP_SCHEMA_VERSION = 1

const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum')

const personSchema = z.object({ id: z.string().min(1), name: z.string().min(1), active: z.boolean(), createdAt: z.string() })
const tripSchema = z.object({
  id: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  odoStart: z.number().finite().optional(),
  odoEnd: z.number().finite().optional(),
  km: z.number().finite().nonnegative(),
  personIds: z.array(z.string()).min(1),
  note: z.string().optional(),
  importKey: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const categorySchema = z.object({ id: z.string().min(1), name: z.string().min(1), builtin: z.boolean(), color: z.string() })
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
  note: z.string().optional(),
  importKey: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
const settingSchema = z.object({ key: z.string(), value: z.unknown() })

const backupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  data: z.object({
    persons: z.array(personSchema),
    trips: z.array(tripSchema),
    expenses: z.array(expenseSchema),
    categories: z.array(categorySchema),
    settings: z.array(settingSchema).default([]),
  }),
})

export interface BackupFile {
  app: typeof BACKUP_APP_ID
  schemaVersion: number
  exportedAt: string
  data: { persons: Person[]; trips: Trip[]; expenses: Expense[]; categories: Category[]; settings: Setting[] }
}

export async function createBackup(database: CaliforniaDB): Promise<BackupFile> {
  const [persons, trips, expenses, categories, settings] = await Promise.all([
    database.persons.toArray(),
    database.trips.toArray(),
    database.expenses.toArray(),
    database.categories.toArray(),
    database.settings.toArray(),
  ])
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: { persons, trips, expenses, categories, settings: settings.filter((s) => s.key !== 'lastBackupAt') },
  }
}

export class BackupError extends Error {}

/** Liest und prüft eine Sicherungsdatei vollständig, bevor irgendetwas überschrieben wird. */
export function parseBackup(text: string): BackupFile {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new BackupError('Die Datei ist keine gültige JSON-Sicherung.')
  }
  if (typeof json === 'object' && json && (json as { app?: unknown }).app !== BACKUP_APP_ID) {
    throw new BackupError('Diese Datei ist keine Sicherung dieser Anwendung.')
  }
  const res = backupSchema.safeParse(json)
  if (!res.success) {
    const first = res.error.issues[0]
    throw new BackupError(`Die Sicherung ist beschädigt oder unvollständig (${first.path.join('.')}: ${first.message}).`)
  }
  const b = res.data as BackupFile
  if (b.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new BackupError('Die Sicherung stammt aus einer neueren Version der Anwendung und kann nicht gelesen werden.')
  }
  // Referenzen prüfen
  const personIds = new Set(b.data.persons.map((p) => p.id))
  const categoryIds = new Set([...b.data.categories.map((c) => c.id)])
  for (const t of b.data.trips) {
    const missing = t.personIds.find((id) => !personIds.has(id))
    if (missing) throw new BackupError(`Fahrt vom ${t.startDate} verweist auf eine unbekannte Person.`)
  }
  for (const e of b.data.expenses) {
    if (!categoryIds.has(e.categoryId)) throw new BackupError(`Ausgabe „${e.title}“ verweist auf eine unbekannte Kategorie.`)
    if (e.directPersonIds?.some((id) => !personIds.has(id))) throw new BackupError(`Ausgabe „${e.title}“ verweist auf eine unbekannte Person.`)
  }
  for (const [name, list] of Object.entries({ persons: b.data.persons, trips: b.data.trips, expenses: b.data.expenses, categories: b.data.categories })) {
    if (new Set(list.map((x) => x.id)).size !== list.length) throw new BackupError(`Die Sicherung enthält doppelte IDs (${name}).`)
  }
  return b
}

/** Ersetzt ALLE Daten durch den Inhalt der Sicherung (atomar). */
export async function restoreBackup(backup: BackupFile, database: CaliforniaDB): Promise<void> {
  await database.transaction('rw', [database.persons, database.trips, database.expenses, database.categories, database.settings], async () => {
    await Promise.all([database.persons.clear(), database.trips.clear(), database.expenses.clear(), database.categories.clear(), database.settings.clear()])
    const cats = [...backup.data.categories]
    for (const d of DEFAULT_CATEGORIES) if (!cats.some((c) => c.id === d.id)) cats.push(d)
    await database.categories.bulkAdd(cats)
    await database.persons.bulkAdd(backup.data.persons)
    await database.trips.bulkAdd(backup.data.trips)
    await database.expenses.bulkAdd(backup.data.expenses)
    if (backup.data.settings.length) await database.settings.bulkAdd(backup.data.settings)
  })
}

export async function clearAllData(database: CaliforniaDB): Promise<void> {
  await database.transaction('rw', [database.persons, database.trips, database.expenses, database.categories, database.settings], async () => {
    await Promise.all([database.persons.clear(), database.trips.clear(), database.expenses.clear(), database.categories.clear(), database.settings.clear()])
    await database.categories.bulkAdd(DEFAULT_CATEGORIES)
  })
}
