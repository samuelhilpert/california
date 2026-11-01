import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, expectNoHorizontalOverflow, register, resetEmulators, restoreFixture, setupBook } from './helpers'

/** Ortssuche und Kartenkacheln ohne Internet: feste Antworten statt OpenStreetMap. */
const PLACES: Record<string, { lat: number; lon: number; country: string; code: string }> = {
  'münchen': { lat: 48.14, lon: 11.58, country: 'Deutschland', code: 'de' },
  lyon: { lat: 45.76, lon: 4.84, country: 'Frankreich', code: 'fr' },
  barcelona: { lat: 41.39, lon: 2.17, country: 'Spanien', code: 'es' },
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function stubMaps(page: Page) {
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase()
    const p = PLACES[q]
    route.fulfill({ json: p ? [{ lat: String(p.lat), lon: String(p.lon), address: { country: p.country, country_code: p.code } }] : [] })
  })
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }))
}

test('Pro-Modus: Statistik, Karte mit Ländern, Rückblick, Zusatzfelder @mobile', async ({ page }, info) => {
  await resetEmulators()
  await stubMaps(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await register(page, `pro-${info.project.name}@example.com`, 'Anna')
  await setupBook(page)
  await restoreFixture(page)

  // Ohne Pro-Modus kein Menüpunkt und keine Zusatzfelder
  await expect(page.getByRole('link', { name: /Entdecken|^Pro$/ })).toHaveCount(0)

  await page.goto('/#/einstellungen')
  const sw = page.getByRole('switch', { name: 'Pro-Modus' })
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('link', { name: /Entdecken|^Pro$/ }).first()).toBeVisible()

  // Statistik: alle Jahre
  await page.goto('/#/pro')
  await page.getByRole('combobox', { name: 'Jahr' }).selectOption('all')
  await expect(page.getByRole('heading', { name: 'Kilometer', exact: true })).toBeVisible()
  await expect(page.getByText('500 km').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /Nutzung & Nächte/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page, 'Pro-Statistik')

  // Leasing-Kilometer: Vertrag eintragen → Prognose erscheint
  await page.getByRole('button', { name: 'Vertrag eintragen' }).click()
  await page.getByLabel('Vertragsbeginn (Übergabe)').fill('2025-12-01')
  await page.getByLabel('Laufzeit').fill('24')
  await page.getByLabel('Kilometer pro Jahr').fill('10000')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByText(/Gefahren\s*500 km\s*von 20.000 km/)).toBeVisible()
  await expect(page.getByText(/Prognose Vertragsende|Am Vertragsende/)).toBeVisible()
  await expectAccessible(page, 'Leasing')

  // Erfolge: erste Fahrt erreicht
  await page.goto('/#/pro/erfolge')
  await expect(page.getByRole('heading', { name: 'Erreicht' })).toBeVisible()
  await expect(page.getByText('Los geht’s')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page, 'Erfolge')

  // Fahrt-Details mit Karte
  await page.goto('/#/fahrten')
  await page.getByRole('button', { name: 'Fahrt-Details mit Karte' }).first().click()
  const detail = page.getByRole('dialog')
  await expect(detail.getByRole('heading', { name: 'München → Barcelona' })).toBeVisible()
  await expect(detail.getByRole('region', { name: 'Karte der Strecke' })).toBeVisible()
  await expect(detail.getByText('Frankreich')).toBeVisible()
  await expectAccessible(page, 'Fahrt-Details')
  await page.keyboard.press('Escape')

  // Karte: Zwischenstation Lyon zählt mit → drei Länder
  await page.goto('/#/pro/karte')
  await page.getByRole('combobox', { name: 'Jahr' }).selectOption('all')
  const countries = page.locator('section', { has: page.getByRole('heading', { name: 'Besuchte Länder' }) })
  for (const c of ['Deutschland', 'Frankreich', 'Spanien']) await expect(countries.getByText(c)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Karte der Fahrten' })).toBeVisible()
  // Besuchte Länder werden auf der Karte eingefärbt (Ländergrenzen geladen)
  await expect(page.locator('.trip-map path.leaflet-interactive, .trip-map svg path').first()).toBeAttached()
  // Nur die Fahrten einer Person
  await page.getByRole('combobox', { name: 'Wessen Fahrten?' }).selectOption({ label: 'Anna (du)' })
  await expect(countries.getByText('Spanien')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page, 'Pro-Karte')

  // Rückblick 2025
  await page.goto('/#/pro/rueckblick')
  await page.getByRole('combobox', { name: 'Jahr' }).selectOption('2025')
  await expect(page.getByText('Euer Jahr 2025')).toBeVisible()
  await expect(page.getByText('Spanien')).toBeVisible()
  await expectAccessible(page, 'Pro-Rückblick')

  // Zusatzfelder: Zwischenstationen bei Fahrten, Liter beim Tanken
  await page.goto('/#/fahrten')
  await page.getByRole('button', { name: /Neue Fahrt/ }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: /Weitere Angaben/ }).click()
  await expect(page.getByRole('dialog').getByLabel(/Zwischenstationen/)).toBeVisible()
  await page.keyboard.press('Escape')
  // Tankbuch: getrennt von den Kosten, Verbrauch nach Volltank-Methode
  await page.goto('/#/pro/tanken')
  const add = async (amount: string, l: string, km: string) => {
    await page.getByLabel('Betrag').fill(amount)
    await page.getByLabel('Liter').fill(l)
    await page.getByLabel('Kilometerstand').fill(km)
    await page.getByRole('button', { name: 'Tankfüllung speichern' }).click()
    await expect(page.getByLabel('Betrag')).toHaveValue('')
  }
  await add('90', '50', '10000')
  await add('81', '45', '10500')
  await expect(page.getByRole('cell', { name: '9,0 l/100 km' })).toBeVisible()
  await expectAccessible(page, 'Tankbuch')
  // Die Abrechnung bleibt unverändert (nur die Leasingrate aus dem Beispiel)
  await page.goto('/#/abrechnung')
  await expect(page.getByText('2.553,20 €').first()).toBeVisible()

  expect(errors).toEqual([])
})
