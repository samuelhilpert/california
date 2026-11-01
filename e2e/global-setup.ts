import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_CATEGORIES } from '../src/lib/store/defaults'
import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, type BackupFile } from '../src/lib/io/backup'

/**
 * Erzeugt eine Sicherungsdatei mit Beispieldaten für die E2E-Tests:
 * drei Personen, eine gemeinsame Fahrt über 500 km und 7.659,60 € Leasing
 * → je Person 2.553,20 €.
 */
export default async function globalSetup() {
  const at = '2025-12-29T12:00:00.000Z'
  const backup: BackupFile = {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: at,
    data: {
      persons: [
        { id: 'p-clara', name: 'Clara', active: true, createdAt: at },
        { id: 'p-ben', name: 'Ben', active: true, createdAt: at },
        { id: 'p-anna', name: 'Anna', active: true, createdAt: at },
      ],
      trips: [
        { id: 't-1', startDate: '2025-12-29', endDate: '2026-01-02', from: 'München', stops: ['Lyon'], to: 'Barcelona', odoStart: 20, odoEnd: 520, km: 500, personIds: ['p-clara', 'p-ben', 'p-anna'], createdAt: at, updatedAt: at },
      ],
      expenses: [
        { id: 'e-1', title: 'Leasingrate', categoryId: 'leasing', amountCents: 765960, date: '2025-12-29', allocation: 'perKm', createdAt: at, updatedAt: at },
      ],
      categories: DEFAULT_CATEGORIES,
      payments: [],
      settlements: [],
      settings: [],
    },
  }
  const dir = resolve(import.meta.dirname, '.tmp')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'Beispiel-Backup.json'), JSON.stringify(backup, null, 2))
}
