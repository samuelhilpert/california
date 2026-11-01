import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectAccessible, importFixture, register, resetEmulators, setupBook } from './helpers'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const EVE = 'eve@example.com'

test.describe.configure({ mode: 'serial' })

/** Tippt wie ein Mensch (einzelne Tastenanschläge) – auch während Echtzeit-Updates eintreffen. */
async function type(loc: Locator, value: string) {
  await loc.click()
  await loc.press('ControlOrMeta+a')
  await loc.pressSequentially(value, { delay: 15 })
  await expect(loc).toHaveValue(value)
}

async function addTrip(page: Page, o: { date: string; odoStart?: string; odoEnd?: string; km?: string; persons: string[]; to?: string }) {
  if (!page.url().endsWith('#/fahrten')) await page.goto('/#/fahrten')
  await page.getByRole('button', { name: 'Neue Fahrt' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Startdatum').fill(o.date)
  if (o.to) await type(dlg.getByLabel(/Zielort/), o.to)
  if (o.odoStart) await type(dlg.getByLabel(/Kilometerstand Beginn/), o.odoStart)
  if (o.odoEnd) await type(dlg.getByLabel(/Kilometerstand Ende/), o.odoEnd)
  if (o.km) await type(dlg.getByLabel('Gefahrene Kilometer'), o.km)
  for (const p of o.persons) await dlg.getByRole('button', { name: p, exact: true }).click()
  // Werte müssen auch nach eintreffenden Echtzeit-Updates erhalten bleiben
  await page.waitForTimeout(300)
  await expect(dlg.getByLabel('Startdatum')).toHaveValue(o.date)
  if (o.odoStart) await expect(dlg.getByLabel(/Kilometerstand Beginn/)).toHaveValue(o.odoStart)
  if (o.odoEnd) await expect(dlg.getByLabel(/Kilometerstand Ende/)).toHaveValue(o.odoEnd)
  await dlg.getByRole('button', { name: 'Fahrt speichern' }).click()
}

test('gemeinsames Fahrtenbuch: Einrichtung, Import, Ausgleich, Abschluss, Mitglieder, Echtzeit, Offline', async ({ browser }) => {
  await resetEmulators()
  const annaCtx = await browser.newContext()
  const anna = await annaCtx.newPage()
  const errors: string[] = []
  anna.on('pageerror', (e) => errors.push(e.message))

  // --- Login-Seite barrierefrei
  await anna.goto('/')
  await expect(anna.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await expectAccessible(anna, 'Anmeldung')

  // --- Registrierung, E-Mail-Bestätigung, Einrichtung
  await register(anna, ANNA)
  await setupBook(anna)
  await expect(anna.getByText('Willkommen! Noch keine Daten vorhanden.')).toBeVisible()

  // --- Excel-Import mit Datumskorrektur in der Vorschau
  await importFixture(anna, { fixDate: '2025-12-29' })
  await anna.goto('/#/fahrten')
  await expect(anna.getByRole('cell', { name: '29.12.2025' })).toBeVisible()

  // --- Abrechnung wie in Excel
  await anna.goto('/#/abrechnung')
  const shares = anna.locator('table').first().locator('tbody > tr')
  await expect(shares).toHaveCount(3)
  for (const name of ['Clara', 'Ben', 'Anna']) {
    await expect(shares.filter({ hasText: name })).toContainText('2.553,20 €')
  }

  // --- Leasing wurde von Anna bezahlt → Ausgleich
  await anna.goto('/#/kosten')
  await anna.getByRole('button', { name: 'Ausgabe bearbeiten' }).first().click()
  await anna.getByRole('dialog').getByLabel('Bezahlt von').selectOption({ label: 'Anna' })
  await anna.getByRole('dialog').getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(anna.getByText('bezahlt von Anna')).toBeVisible()

  await anna.goto('/#/abrechnung')
  const transfers = anna.locator('li').filter({ has: anna.getByRole('button', { name: 'Als bezahlt erfassen' }) })
  await expect(transfers).toHaveCount(2)
  await expect(transfers.first()).toContainText('2.553,20 €')
  await transfers.filter({ hasText: 'Clara' }).getByRole('button', { name: 'Als bezahlt erfassen' }).click()
  await anna.getByRole('dialog').getByRole('button', { name: 'Erfassen' }).click()
  await expect(transfers).toHaveCount(1)
  await expect(anna.getByText('Ausgleichszahlungen im Zeitraum')).toBeVisible()

  // --- Abrechnung abschließen
  await anna.getByRole('button', { name: 'Abschließen' }).first().click()
  await anna.getByRole('dialog').getByLabel('Titel').fill('Abrechnung Test')
  await anna.getByRole('dialog').getByRole('button', { name: 'Abschließen' }).click()
  await expect(anna.getByText('Abrechnung Test')).toBeVisible()
  await expect(anna.getByText('Entspricht dem aktuellen Stand')).toBeVisible()
  await expectAccessible(anna, 'Abrechnung')

  // --- Kilometerlücke erkennen und nachtragen
  await addTrip(anna, { date: '2026-01-10', odoStart: '600', odoEnd: '700', persons: ['Anna'], to: 'Gardasee' })
  await expect(anna.getByText(/Lücke von 80 km/)).toBeVisible()
  await anna.getByRole('button', { name: 'Fahrt nachtragen' }).click()
  const dlg = anna.getByRole('dialog')
  await expect(dlg.getByLabel(/Kilometerstand Beginn/)).toHaveValue('520')
  await expect(dlg.getByLabel(/Kilometerstand Ende/)).toHaveValue('600')
  await dlg.getByRole('button', { name: 'Ben', exact: true }).click()
  await dlg.getByRole('button', { name: 'Fahrt speichern' }).click()
  await expect(anna.getByText(/Lücke von/)).toHaveCount(0)

  // --- Abweichung zur abgeschlossenen Abrechnung wird angezeigt
  await anna.goto('/#/abrechnung')
  await expect(anna.getByText(/Aktuelle Daten weichen ab/)).toBeVisible()

  // --- Duplikat-Warnung
  await addTrip(anna, { date: '2026-01-10', odoStart: '600', odoEnd: '700', persons: ['Anna'] })
  await expect(anna.getByRole('heading', { name: 'Ähnliche Fahrt bereits vorhanden' })).toBeVisible()
  await anna.getByRole('button', { name: 'Abbrechen' }).last().click()
  await anna.keyboard.press('Escape')

  // --- Löschen und Rückgängig
  await anna.goto('/#/fahrten')
  const gardaRow = anna.getByRole('row').filter({ hasText: 'Gardasee' })
  await gardaRow.getByRole('button', { name: 'Fahrt löschen' }).click()
  await anna.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click()
  await expect(gardaRow).toHaveCount(0)
  await anna.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(anna.getByRole('row').filter({ hasText: 'Gardasee' })).toHaveCount(1)
  await expectAccessible(anna, 'Fahrtenbuch')

  // --- Mitglied freischalten
  await anna.goto('/#/einstellungen')
  await anna.getByLabel('E-Mail-Adresse des neuen Mitglieds').fill(BEN)
  await anna.getByRole('button', { name: 'Freischalten' }).click()
  await expect(anna.getByText(BEN, { exact: true })).toBeVisible()
  await expectAccessible(anna, 'Einstellungen')

  // --- Ben registriert sich und sieht denselben Datenstand
  const benCtx = await browser.newContext()
  const ben = await benCtx.newPage()
  await register(ben, BEN)
  await expect(ben.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await ben.goto('/#/fahrten')
  await expect(ben.getByRole('row').filter({ hasText: 'Gardasee' })).toHaveCount(1)

  // --- Echtzeit: Ben erfasst eine Fahrt, während Anna gerade tippt.
  // Annas Eingabe und Fokus bleiben erhalten; die neue Fahrt erscheint ohne Neuladen.
  await anna.goto('/#/fahrten')
  await anna.getByRole('button', { name: 'Neue Fahrt' }).first().click()
  await type(anna.getByRole('dialog').getByLabel(/Zielort/), 'Tippe gerade')
  await addTrip(ben, { date: '2026-02-01', odoStart: '700', odoEnd: '750', persons: ['Ben'], to: 'Echtzeit-Test' })
  await expect(anna.getByRole('row').filter({ hasText: 'Echtzeit-Test' })).toHaveCount(1)
  expect(await anna.evaluate(() => document.activeElement?.id)).toBe('t-to')
  await expect(anna.getByRole('dialog').getByLabel(/Zielort/)).toHaveValue('Tippe gerade')
  await anna.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click()

  // --- Offline erfassen, später synchronisieren
  await annaCtx.setOffline(true)
  await expect(anna.getByText('Offline').first()).toBeVisible()
  await addTrip(anna, { date: '2026-02-05', odoStart: '750', odoEnd: '800', persons: ['Anna'], to: 'Offline-Fahrt' })
  await expect(anna.getByRole('row').filter({ hasText: 'Offline-Fahrt' })).toHaveCount(1)
  await expect(ben.getByRole('row').filter({ hasText: 'Offline-Fahrt' })).toHaveCount(0)
  await annaCtx.setOffline(false)
  await expect(ben.getByRole('row').filter({ hasText: 'Offline-Fahrt' })).toHaveCount(1, { timeout: 20_000 })
  await expect(anna.getByText('Synchronisiert').first()).toBeVisible({ timeout: 20_000 })

  // --- Fremde Person ohne Freischaltung hat keinen Zugriff
  const eveCtx = await browser.newContext()
  const eve = await eveCtx.newPage()
  await register(eve, EVE)
  await expect(eve.getByRole('heading', { name: 'Noch kein Zugriff' })).toBeVisible()
  await eve.getByRole('button', { name: 'Fahrtenbuch einrichten' }).click()
  await expect(eve.getByText(/existiert bereits/)).toBeVisible()

  // --- Dunkles Design
  await anna.goto('/#/einstellungen')
  await anna.getByRole('radio', { name: 'Dunkel' }).click()
  await expect(anna.locator('html')).toHaveClass(/dark/)
  await anna.goto('/#/')
  await expectAccessible(anna, 'Dashboard (dunkel)')
  await anna.goto('/#/abrechnung')
  await expectAccessible(anna, 'Abrechnung (dunkel)')
  await anna.screenshot({ path: 'test-results/abrechnung-dunkel.png', fullPage: true })
  await anna.reload()
  await expect(anna.locator('html')).toHaveClass(/dark/)

  expect(errors).toEqual([])
  await Promise.all([annaCtx.close(), benCtx.close(), eveCtx.close()])
})
