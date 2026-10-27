import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow, importFixture, register, resetEmulators, setupBook } from './helpers'

// Läuft in Chromium, Firefox und WebKit (Safari-Engine) sowie auf einem iPhone-Profil.
test('Grundfunktionen in allen Browsern @cross @mobile', async ({ page }, info) => {
  await resetEmulators()
  const errors: string[] = []
  page.on('pageerror', (e) => {
    // Safari/WebKit meldet beim Neuladen abgebrochene Firestore-Langabfragen (WebChannel) als
    // „access control“-Fehler. Das ist ein Browser-Artefakt beim Abbruch, kein Anwendungsfehler.
    if (/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel.*access control checks/.test(e.message)) return
    errors.push(e.message)
  })
  const email = `nutzer-${info.project.name}@example.com`

  await register(page, email)
  await setupBook(page)
  await importFixture(page)

  await page.goto('/#/abrechnung')
  await expect(page.getByText('2.553,20 €').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)

  for (const path of ['/', '/fahrten', '/kosten', '/personen', '/daten', '/einstellungen']) {
    await page.goto(`/#${path}`)
    await expect(page.locator('main h1')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  }
  await page.screenshot({ path: `test-results/dashboard-${info.project.name}.png`, fullPage: true })

  // Daten bleiben nach Neuladen erhalten (Offline-Cache + Anmeldung)
  await page.reload()
  await page.goto('/#/fahrten')
  await expect(page.getByText('500 km').first()).toBeVisible()
  expect(errors).toEqual([])
})
