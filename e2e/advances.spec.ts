import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEFAULT_CATEGORIES } from '../src/lib/store/defaults'
import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, type BackupFile } from '../src/lib/io/backup'
import { expectAccessible, expectNoHorizontalOverflow, register, resetEmulators, setupBook } from './helpers'

/**
 * Konrad zahlt Leasing (500 €, 10×) und Versicherung (1.200 €), Dennis die Steuer (300 €), Samuel einen Stellplatz (45 €, nur Dennis + Samuel).
 * 10.000 km: Konrad 6.500, Dennis 3.200, Samuel nur 300 → 0,65 €/km.
 * Anteile: Konrad 4.225,00 · Dennis 2.102,50 · Samuel 217,50
 */
const FILE = resolve(import.meta.dirname, '.tmp', 'Vorauszahlungen.json')

function writeFixture() {
  const at = '2026-01-01T12:00:00.000Z'
  const K = 'p-konrad', D = 'p-dennis', S = 'p-samuel'
  const trip = (id: string, date: string, km: number, personIds: string[]) => ({ id, startDate: date, endDate: date, km, personIds, createdAt: at, updatedAt: at })
  const backup: BackupFile = {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: at,
    data: {
      persons: [
        { id: K, name: 'Konrad', active: true, createdAt: at },
        { id: D, name: 'Dennis', active: true, createdAt: at },
        { id: S, name: 'Samuel', active: true, createdAt: at },
      ],
      trips: [
        trip('t1', '2026-01-10', 1200, [K]),
        trip('t2', '2026-03-15', 800, [D]),
        trip('t3', '2026-04-01', 2500, [K]),
        trip('t4', '2026-05-09', 400, [D, S]),
        trip('t5', '2026-06-20', 1000, [K, D]),
        trip('t6', '2026-07-15', 2300, [K]),
        trip('t7', '2026-08-02', 1700, [D]),
        trip('t8', '2026-10-03', 100, [S]),
      ],
      expenses: [
        { id: 'e1', title: 'Leasingrate', categoryId: 'leasing', amountCents: 50000, date: '2026-01-06', allocation: 'perKm', recurrence: { frequency: 'monthly', count: 10 }, paidBy: K, createdAt: at, updatedAt: at },
        { id: 'e2', title: 'Versicherung', categoryId: 'insurance', amountCents: 120000, date: '2026-01-06', allocation: 'perKm', paidBy: K, createdAt: at, updatedAt: at },
        { id: 'e3', title: 'Kfz-Steuer', categoryId: 'tax', amountCents: 30000, date: '2026-02-01', allocation: 'perKm', paidBy: D, createdAt: at, updatedAt: at },
        { id: 'e4', title: 'Stellplatz', categoryId: 'other', amountCents: 4500, date: '2026-05-10', allocation: 'direct', directPersonIds: [D, S], paidBy: S, createdAt: at, updatedAt: at },
      ],
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

async function addSeries(page: Page, from: string, euro: string, count: string) {
  await page.getByRole('button', { name: 'Zahlung erfassen' }).click()
  const dlg = page.getByRole('dialog', { name: 'Zahlung erfassen' })
  await expect(dlg.getByLabel('Art')).toHaveValue('advance')
  await dlg.getByLabel('Von (zahlt)').selectOption({ label: from })
  await dlg.getByLabel('An (erhält)').selectOption({ label: 'Konrad' })
  await dlg.getByLabel('Betrag').fill(euro)
  await dlg.getByLabel('Datum').fill('2026-01-06')
  await dlg.getByLabel('Wiederholung').selectOption('monthly')
  await expect(dlg.getByLabel('Betrag je Zahlung')).toBeVisible()
  await expect(dlg.getByLabel('Laufzeit')).toHaveValue('count')
  await dlg.getByLabel('Anzahl Zahlungen').fill(count)
  await expect(dlg).toContainText(`${count} Zahlungen von 06.01.2026 bis`)
  await dlg.getByRole('button', { name: 'Speichern' }).click()
  await expect(dlg).toHaveCount(0)
}

test('Vorauszahlungen: Daueraufträge, Anrechnung im Ausgleich, Bearbeiten, Löschen @mobile', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile-safari'
  writeFixture()
  await resetEmulators()
  await register(page, `abschlag-${info.project.name}@example.com`, 'Konrad')
  await setupBook(page)
  await page.goto('/#/daten')
  await page.locator('input[type=file][accept^=".json"]').setInputFiles(FILE)
  await page.getByRole('button', { name: /Zusammenführen/ }).click()
  await expect(page.getByText(/Zusammengeführt:/)).toBeVisible()

  await page.goto('/#/abrechnung')
  const balance = page.locator('table').filter({ hasText: 'Saldo' })
  const row = (n: string) => balance.locator('tbody tr').filter({ hasText: n })
  const transfers = page.locator('li').filter({ has: page.getByRole('button', { name: 'Als bezahlt erfassen' }) })

  // Ohne Abschläge: Konrad hat alles vorgestreckt
  await expect(row('Konrad')).toContainText('1.975,00')
  await expect(row('Dennis')).toContainText('1.802,50')
  await expect(row('Samuel')).toContainText('172,50')
  await expect(transfers).toHaveCount(2)
  if (!mobile) await expect(balance).not.toContainText('Vorausgezahlt')

  // Daueraufträge: Dennis 200 €, Samuel 100 € je Monat
  await addSeries(page, 'Dennis', '200', '10')
  await addSeries(page, 'Samuel', '100', '10')

  // Konrad: 6.200 − 4.225 − 3.000 = −1.025 · Dennis: 300 − 2.102,50 + 2.000 = +197,50 · Samuel: 45 − 217,50 + 1.000 = +827,50
  await expect(row('Konrad')).toContainText('1.025,00')
  await expect(row('Konrad')).toContainText('zahlt')
  await expect(row('Dennis')).toContainText('197,50')
  await expect(row('Dennis')).toContainText('bekommt')
  await expect(row('Samuel')).toContainText('827,50')
  await expect(row('Samuel')).toContainText('bekommt')
  await expect(row('Dennis')).toContainText(mobile ? 'vorausgezahlt 2.000,00' : 'gezahlt 2.000,00')
  await expect(row('Konrad')).toContainText(mobile ? 'Abschläge erhalten 3.000,00' : 'erhalten 3.000,00')
  await expect(transfers).toHaveCount(2)
  await expect(transfers.filter({ hasText: 'Samuel' })).toContainText('827,50')

  const advList = page.getByText('Vorauszahlungen im Zeitraum').locator('..')
  await expect(advList.getByRole('listitem')).toHaveCount(2)
  const dennisSeries = advList.getByRole('listitem').filter({ hasText: 'Dennis → Konrad' })
  await expect(dennisSeries).toContainText('ab 06.01.2026')
  await expect(dennisSeries).toContainText('monatlich, 10× · im Zeitraum 10×')
  await expect(dennisSeries).toContainText('2.000,00')
  await expect(page.getByText('Ausgleichszahlungen im Zeitraum')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page, 'Ausgleich mit Vorauszahlungen')

  // Monatsansicht: je Dauerauftrag genau ein Abschlag
  await page.getByRole('tab', { name: 'Monat' }).first().click()
  await page.getByLabel('Jahr').first().selectOption('2026')
  await page.getByLabel('Monat').first().selectOption({ label: 'März' })
  await expect(dennisSeries).toContainText('im Zeitraum 1×')
  await expect(dennisSeries).toContainText('200,00')
  await page.getByRole('tab', { name: 'Gesamt' }).first().click()
  await expect(dennisSeries).toContainText('im Zeitraum 10×')

  // Samuel zahlt nur 5 Abschläge → Samuel 45 − 217,50 + 500 = +327,50, Konrad −525
  await advList.getByRole('listitem').filter({ hasText: 'Samuel → Konrad' }).getByRole('button', { name: 'Zahlung bearbeiten' }).click()
  let dlg = page.getByRole('dialog', { name: 'Zahlung bearbeiten' })
  await expect(dlg.getByLabel('Betrag je Zahlung')).toHaveValue('100,00')
  await expect(dlg.getByLabel('Anzahl Zahlungen')).toHaveValue('10')
  await dlg.getByLabel('Anzahl Zahlungen').fill('5')
  await expectAccessible(page, 'Zahlung bearbeiten')
  await dlg.getByRole('button', { name: 'Speichern' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(row('Samuel')).toContainText('327,50')
  await expect(row('Konrad')).toContainText('525,00')
  await expect(row('Dennis')).toContainText('197,50')

  // Validierung und Ausgleichszahlung ohne Wiederholung
  await page.getByRole('button', { name: 'Zahlung erfassen' }).click()
  dlg = page.getByRole('dialog', { name: 'Zahlung erfassen' })
  await dlg.getByLabel('Art').selectOption('settlement')
  await expect(dlg.getByLabel('Wiederholung')).toHaveCount(0)
  await dlg.getByLabel('Von (zahlt)').selectOption({ label: 'Dennis' })
  await dlg.getByLabel('An (erhält)').selectOption({ label: 'Dennis' })
  await dlg.getByLabel('Betrag').fill('10')
  await dlg.getByRole('button', { name: 'Speichern' }).click()
  await expect(dlg.getByText('Zahler und Empfänger müssen verschiedene Personen sein.')).toBeVisible()
  await dlg.getByRole('button', { name: 'Abbrechen' }).click()

  // Ausgleich ausführen → alles ausgeglichen; Ausgleichszahlungen erscheinen getrennt
  for (let i = 0; i < 2; i++) {
    await transfers.first().getByRole('button', { name: 'Als bezahlt erfassen' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Erfassen' }).click()
  }
  await expect(page.getByText('Alle Salden sind ausgeglichen.')).toBeVisible()
  await expect(page.getByText('Ausgleichszahlungen im Zeitraum')).toBeVisible()
  await expect(advList.getByRole('listitem')).toHaveCount(2)

  // Dauerauftrag löschen (mit Rückfrage) und rückgängig machen
  await dennisSeries.getByRole('button', { name: 'Dauerauftrag löschen' }).click()
  const confirm = page.getByRole('dialog', { name: 'Dauerauftrag löschen?' })
  await expect(confirm).toContainText('Dennis → Konrad')
  await confirm.getByRole('button', { name: 'Löschen' }).click()
  await expect(dennisSeries).toHaveCount(0)
  await expect(row('Dennis')).toContainText('2.000,00')
  await expect(row('Dennis')).toContainText('zahlt')
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(dennisSeries).toHaveCount(1)
  await expect(page.getByText('Alle Salden sind ausgeglichen.')).toBeVisible()

  // Nach Neuladen (Firestore) bleibt alles erhalten
  await page.reload()
  await expect(page.getByText('Alle Salden sind ausgeglichen.')).toBeVisible()
  await expect(advList.getByRole('listitem')).toHaveCount(2)
})
