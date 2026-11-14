import { expect, test, type Locator } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_CATEGORIES } from '../src/lib/store/defaults'
import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, type BackupFile } from '../src/lib/io/backup'
import { expectAccessible, expectNoHorizontalOverflow, register, resetEmulators, setupBook } from './helpers'

/**
 * Einfaches Festpreis-Beispiel: Leasing 6.500 € (bezahlt von Konrad), Konrad 6.000 km, Dennis 3.000 km,
 * Samuel 600 km. Ein Gast fährt 400 km zum Festpreis von 100 € → Konrad und Dennis.
 * 10.000 km → 0,65 €/km; Gastfahrt kostet 260 € → Differenz 160 € tragen Konrad und Dennis je zur Hälfte.
 */
const FILE = resolve(import.meta.dirname, '.tmp', 'Festpreis.json')

function writeFixture() {
  const at = '2026-01-01T12:00:00.000Z'
  const trip = (id: string, date: string, km: number, p: string) => ({ id, startDate: date, endDate: date, km, personIds: [p], createdAt: at, updatedAt: at })
  const backup: BackupFile = {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: at,
    data: {
      persons: ['Konrad', 'Dennis', 'Samuel', 'Gast'].map((name) => ({ id: `p-${name.toLowerCase()}`, name, active: true, createdAt: at })),
      trips: [trip('t1', '2026-02-01', 6000, 'p-konrad'), trip('t2', '2026-03-01', 3000, 'p-dennis'), trip('t3', '2026-04-01', 600, 'p-samuel')],
      expenses: [{ id: 'e1', title: 'Leasingrate', categoryId: 'leasing', amountCents: 650000, date: '2026-01-06', allocation: 'perKm', paidBy: 'p-konrad', createdAt: at, updatedAt: at }],
      categories: DEFAULT_CATEGORIES,
      payments: [],
      settlements: [],
      settings: [],
      fuel: [],
      plans: [],
    },
  }
  mkdirSync(resolve(import.meta.dirname, '.tmp'), { recursive: true })
  writeFileSync(FILE, JSON.stringify(backup, null, 2))
}

const chip = (scope: Locator, name: string) => scope.getByRole('button', { name: new RegExp(`^${name} ?(\\(du\\))?$`) })

async function selectOnly(group: Locator, names: string[]) {
  for (const on of await group.locator('button[aria-pressed="true"]').all()) await on.click()
  for (const n of names) await chip(group, n).click()
}

test('Festpreis: Gastfahrt mit Festpreis, Anrechnung an Empfänger, nur ohne Mitglieder @mobile', async ({ page }, info) => {
  writeFixture()
  await resetEmulators()
  // Konrad ist registriert (Konto), Dennis, Samuel und Gast sind Personen ohne Konto
  await register(page, `festpreis-${info.project.name}@example.com`, 'Konrad')
  await setupBook(page)
  await page.goto('/#/daten')
  await page.locator('input[type=file][accept^=".json"]').setInputFiles(FILE)
  await page.getByRole('button', { name: /Zusammenführen/ }).click()
  await expect(page.getByText(/Zusammengeführt:/)).toBeVisible()

  // --- Gastfahrt anlegen
  await page.goto('/#/fahrten')
  await page.getByRole('button', { name: 'Neue Fahrt' }).first().click()
  let dlg = page.getByRole('dialog', { name: 'Neue Fahrt' })
  await dlg.getByLabel('Startdatum', { exact: true }).fill('2026-05-01')
  await dlg.getByRole('button', { name: /Nur gefahrene Kilometer/ }).click()
  await dlg.getByLabel('Gefahrene Kilometer').fill('400')
  const fixedBox = dlg.getByRole('checkbox', { name: /Festpreis statt Abrechnung nach km/ })
  // Konrad (registriert) ist vorausgewählt → kein Festpreis möglich
  await expect(fixedBox).toBeDisabled()
  await expect(dlg).toContainText('Nur möglich, wenn kein registriertes Mitglied gefahren ist')
  await selectOnly(dlg.getByRole('group', { name: 'Beteiligte Personen' }), ['Gast'])
  await expect(fixedBox).toBeEnabled()
  await fixedBox.check()
  await dlg.getByLabel('Festpreis', { exact: true }).fill('100')
  const recipients = dlg.getByRole('group', { name: 'Empfänger des Festpreises' })
  await expect(chip(recipients, 'Gast')).toHaveCount(0) // wer fährt, kann nicht Empfänger sein
  await selectOnly(recipients, ['Konrad', 'Dennis'])
  await expect(dlg).toContainText(/Je ausgewählte Person 50,00\s€ vom Festpreis/)
  await expectAccessible(page, 'Fahrt mit Festpreis')
  await dlg.getByRole('button', { name: 'Fahrt speichern' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByText(/Festpreis 100,00/).filter({ visible: true }).first()).toBeVisible()

  // --- Abrechnung: 0,65 €/km, Gast trägt genau 100 €
  await page.goto('/#/abrechnung')
  await expect(page.getByText(/0,65\s€\/km/).first()).toBeVisible()
  await expect(page.getByText(/Festpreis 100,00\s€ · Differenz 160,00\s€ tragen Konrad, Dennis/).first()).toBeVisible()
  const region = page.getByRole('region', { name: 'Salden je Person' })
  const balance = region.locator('table').first()
  const row = (n: string) => balance.locator(':scope > tbody > tr').filter({ has: page.getByRole('button', { name: new RegExp(`^${n}: Rechenweg`) }) })
  // Konrad: 6.500 − (3.900 + 80) = +2.520 · Dennis: −(1.950 + 80) = −2.030 · Samuel −390 · Gast −100
  await expect(row('Konrad')).toContainText('2.520,00')
  await expect(row('Dennis')).toContainText('2.030,00')
  await expect(row('Samuel')).toContainText('390,00')
  await expect(row('Gast')).toContainText('100,00')
  await expect(row('Gast')).toContainText('zahlt')

  // Rechenweg Gast und Dennis
  const way = region.locator('table table')
  await row('Gast').click()
  await expect(way).toContainText('Festpreis-Fahrt 01.05.2026')
  await expect(way).toContainText(/nach km wären es 260,00\s€ gewesen/)
  await expect(way.locator('tfoot')).toContainText('−100,00')
  await row('Gast').click()
  await row('Dennis').click()
  // Dennis ist nur seine eigenen 3.000 km gefahren – die Gastfahrt erscheint als Differenz
  await expect(way).toContainText(/3\.000 km × 0,65\s€\/km/)
  await expect(way).toContainText('−1.950,00')
  await expect(way).toContainText('Gastfahrt Gast · 01.05.2026')
  await expect(way).toContainText(/400 km nach km 260,00\s€ − Festpreis 100,00\s€ = 160,00\s€ Differenz, geteilt durch 2/)
  await expect(way).toContainText('−80,00')
  await expect(way.locator('tfoot')).toContainText('−2.030,00')
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page, 'Abrechnung mit Festpreis')

  // --- Nachträglich ein Mitglied dazunehmen → Festpreis wird abgelehnt
  await page.goto('/#/fahrten')
  await page.getByRole('button', { name: 'Fahrt bearbeiten' }).first().click()
  dlg = page.getByRole('dialog', { name: 'Fahrt bearbeiten' })
  await expect(dlg.getByRole('checkbox', { name: /Festpreis/ })).toBeChecked()
  await expect(dlg.getByLabel('Festpreis', { exact: true })).toHaveValue('100,00')
  await chip(dlg.getByRole('group', { name: 'Beteiligte Personen' }), 'Konrad').click()
  await dlg.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(dlg.getByText('Ein Festpreis ist nur möglich, wenn kein registriertes Mitglied gefahren ist.')).toBeVisible()
  // Haken entfernen → Fahrt wird ganz normal nach km abgerechnet (auch das geht bei Gästen)
  await chip(dlg.getByRole('group', { name: 'Beteiligte Personen' }), 'Konrad').click()
  await dlg.getByRole('checkbox', { name: /Festpreis/ }).uncheck()
  await dlg.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(dlg).toHaveCount(0)
  await page.goto('/#/abrechnung')
  await expect(row('Gast')).toContainText('260,00') // 400 km × 0,65 €
})
