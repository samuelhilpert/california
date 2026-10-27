import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectAccessible, importFixture, register, resetEmulators, setupBook } from './helpers'

const SAMUEL = 'samuel@example.com'
const DENNIS = 'dennis@example.com'
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
  const samCtx = await browser.newContext()
  const sam = await samCtx.newPage()
  const errors: string[] = []
  sam.on('pageerror', (e) => errors.push(e.message))

  // --- Login-Seite barrierefrei
  await sam.goto('/')
  await expect(sam.getByRole('heading', { name: 'Anmelden' })).toBeVisible()
  await expectAccessible(sam, 'Anmeldung')

  // --- Registrierung, E-Mail-Bestätigung, Einrichtung
  await register(sam, SAMUEL)
  await setupBook(sam)
  await expect(sam.getByText('Willkommen! Noch keine Daten vorhanden.')).toBeVisible()

  // --- Excel-Import mit Datumskorrektur in der Vorschau
  await importFixture(sam, { fixDate: '2025-12-29' })
  await sam.goto('/#/fahrten')
  await expect(sam.getByRole('cell', { name: '29.12.2025' })).toBeVisible()

  // --- Abrechnung wie in Excel
  await sam.goto('/#/abrechnung')
  const shares = sam.locator('table').first().locator('tbody > tr')
  await expect(shares).toHaveCount(3)
  for (const name of ['Konrad', 'Dennis', 'Samuel']) {
    await expect(shares.filter({ hasText: name })).toContainText('2.553,20 €')
  }

  // --- Leasing wurde von Samuel bezahlt → Ausgleich
  await sam.goto('/#/kosten')
  await sam.getByRole('button', { name: 'Ausgabe bearbeiten' }).first().click()
  await sam.getByRole('dialog').getByLabel('Bezahlt von').selectOption({ label: 'Samuel' })
  await sam.getByRole('dialog').getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(sam.getByText('bezahlt von Samuel')).toBeVisible()

  await sam.goto('/#/abrechnung')
  const transfers = sam.locator('li').filter({ has: sam.getByRole('button', { name: 'Als bezahlt erfassen' }) })
  await expect(transfers).toHaveCount(2)
  await expect(transfers.first()).toContainText('2.553,20 €')
  await transfers.filter({ hasText: 'Konrad' }).getByRole('button', { name: 'Als bezahlt erfassen' }).click()
  await sam.getByRole('dialog').getByRole('button', { name: 'Erfassen' }).click()
  await expect(transfers).toHaveCount(1)
  await expect(sam.getByText('Ausgleichszahlungen im Zeitraum')).toBeVisible()

  // --- Abrechnung abschließen
  await sam.getByRole('button', { name: 'Abschließen' }).first().click()
  await sam.getByRole('dialog').getByLabel('Titel').fill('Abrechnung Test')
  await sam.getByRole('dialog').getByRole('button', { name: 'Abschließen' }).click()
  await expect(sam.getByText('Abrechnung Test')).toBeVisible()
  await expect(sam.getByText('Entspricht dem aktuellen Stand')).toBeVisible()
  await expectAccessible(sam, 'Abrechnung')

  // --- Kilometerlücke erkennen und nachtragen
  await addTrip(sam, { date: '2026-01-10', odoStart: '600', odoEnd: '700', persons: ['Samuel'], to: 'Gardasee' })
  await expect(sam.getByText(/Lücke von 80 km/)).toBeVisible()
  await sam.getByRole('button', { name: 'Fahrt nachtragen' }).click()
  const dlg = sam.getByRole('dialog')
  await expect(dlg.getByLabel(/Kilometerstand Beginn/)).toHaveValue('520')
  await expect(dlg.getByLabel(/Kilometerstand Ende/)).toHaveValue('600')
  await dlg.getByRole('button', { name: 'Dennis', exact: true }).click()
  await dlg.getByRole('button', { name: 'Fahrt speichern' }).click()
  await expect(sam.getByText(/Lücke von/)).toHaveCount(0)

  // --- Abweichung zur abgeschlossenen Abrechnung wird angezeigt
  await sam.goto('/#/abrechnung')
  await expect(sam.getByText(/Aktuelle Daten weichen ab/)).toBeVisible()

  // --- Duplikat-Warnung
  await addTrip(sam, { date: '2026-01-10', odoStart: '600', odoEnd: '700', persons: ['Samuel'] })
  await expect(sam.getByRole('heading', { name: 'Ähnliche Fahrt bereits vorhanden' })).toBeVisible()
  await sam.getByRole('button', { name: 'Abbrechen' }).last().click()
  await sam.keyboard.press('Escape')

  // --- Löschen und Rückgängig
  await sam.goto('/#/fahrten')
  const gardaRow = sam.getByRole('row').filter({ hasText: 'Gardasee' })
  await gardaRow.getByRole('button', { name: 'Fahrt löschen' }).click()
  await sam.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click()
  await expect(gardaRow).toHaveCount(0)
  await sam.getByRole('button', { name: 'Rückgängig' }).click()
  await expect(sam.getByRole('row').filter({ hasText: 'Gardasee' })).toHaveCount(1)
  await expectAccessible(sam, 'Fahrtenbuch')

  // --- Mitglied freischalten
  await sam.goto('/#/einstellungen')
  await sam.getByLabel('E-Mail-Adresse des neuen Mitglieds').fill(DENNIS)
  await sam.getByRole('button', { name: 'Freischalten' }).click()
  await expect(sam.getByText(DENNIS, { exact: true })).toBeVisible()
  await expectAccessible(sam, 'Einstellungen')

  // --- Dennis registriert sich und sieht denselben Datenstand
  const denCtx = await browser.newContext()
  const den = await denCtx.newPage()
  await register(den, DENNIS)
  await expect(den.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await den.goto('/#/fahrten')
  await expect(den.getByRole('row').filter({ hasText: 'Gardasee' })).toHaveCount(1)

  // --- Echtzeit: Dennis erfasst eine Fahrt, während Samuel gerade tippt.
  // Samuels Eingabe und Fokus bleiben erhalten; die neue Fahrt erscheint ohne Neuladen.
  await sam.goto('/#/fahrten')
  await sam.getByRole('button', { name: 'Neue Fahrt' }).first().click()
  await type(sam.getByRole('dialog').getByLabel(/Zielort/), 'Tippe gerade')
  await addTrip(den, { date: '2026-02-01', odoStart: '700', odoEnd: '750', persons: ['Dennis'], to: 'Echtzeit-Test' })
  await expect(sam.getByRole('row').filter({ hasText: 'Echtzeit-Test' })).toHaveCount(1)
  expect(await sam.evaluate(() => document.activeElement?.id)).toBe('t-to')
  await expect(sam.getByRole('dialog').getByLabel(/Zielort/)).toHaveValue('Tippe gerade')
  await sam.getByRole('dialog').getByRole('button', { name: 'Abbrechen' }).click()

  // --- Offline erfassen, später synchronisieren
  await samCtx.setOffline(true)
  await expect(sam.getByText('Offline').first()).toBeVisible()
  await addTrip(sam, { date: '2026-02-05', odoStart: '750', odoEnd: '800', persons: ['Samuel'], to: 'Offline-Fahrt' })
  await expect(sam.getByRole('row').filter({ hasText: 'Offline-Fahrt' })).toHaveCount(1)
  await expect(den.getByRole('row').filter({ hasText: 'Offline-Fahrt' })).toHaveCount(0)
  await samCtx.setOffline(false)
  await expect(den.getByRole('row').filter({ hasText: 'Offline-Fahrt' })).toHaveCount(1, { timeout: 20_000 })
  await expect(sam.getByText('Synchronisiert').first()).toBeVisible({ timeout: 20_000 })

  // --- Fremde Person ohne Freischaltung hat keinen Zugriff
  const eveCtx = await browser.newContext()
  const eve = await eveCtx.newPage()
  await register(eve, EVE)
  await expect(eve.getByRole('heading', { name: 'Noch kein Zugriff' })).toBeVisible()
  await eve.getByRole('button', { name: 'Fahrtenbuch einrichten' }).click()
  await expect(eve.getByText(/existiert bereits/)).toBeVisible()

  // --- Dunkles Design
  await sam.goto('/#/einstellungen')
  await sam.getByRole('radio', { name: 'Dunkel' }).click()
  await expect(sam.locator('html')).toHaveClass(/dark/)
  await sam.goto('/#/')
  await expectAccessible(sam, 'Dashboard (dunkel)')
  await sam.goto('/#/abrechnung')
  await expectAccessible(sam, 'Abrechnung (dunkel)')
  await sam.screenshot({ path: 'test-results/abrechnung-dunkel.png', fullPage: true })
  await sam.reload()
  await expect(sam.locator('html')).toHaveClass(/dark/)

  expect(errors).toEqual([])
  await Promise.all([samCtx.close(), denCtx.close(), eveCtx.close()])
})
