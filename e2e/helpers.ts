import { expect, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'

export const PROJECT = 'demo-california'
const AUTH = 'http://127.0.0.1:9099'
const FS = 'http://127.0.0.1:8080'
export const FIXTURE = resolve(import.meta.dirname, '.tmp', 'VW California (Beispiel).xlsx')
export const PASSWORD = 'geheim-1234'

export async function resetEmulators() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
}

/** Klickt den Bestätigungslink aus der (simulierten) E-Mail des Auth-Emulators. */
export async function verifyEmailViaEmulator(email: string) {
  const res = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`)
  const { oobCodes } = (await res.json()) as { oobCodes: { email: string; requestType: string; oobLink: string }[] }
  const code = oobCodes.filter((c) => c.email === email && c.requestType === 'VERIFY_EMAIL').at(-1)
  if (!code) throw new Error(`Keine Bestätigungs-E-Mail für ${email}`)
  const r = await fetch(code.oobLink)
  if (!r.ok) throw new Error(`Bestätigung fehlgeschlagen: ${r.status}`)
}

export async function register(page: Page, email: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Konto erstellen' }).click()
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Passwort wiederholen').fill(PASSWORD)
  await page.getByRole('button', { name: 'Konto erstellen' }).click()
  await expect(page.getByRole('heading', { name: 'E-Mail-Adresse bestätigen' })).toBeVisible()
  await verifyEmailViaEmulator(email)
  await page.getByRole('button', { name: 'Ich habe bestätigt' }).click()
}

export async function login(page: Page, email: string) {
  await page.goto('/')
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
}

export async function setupBook(page: Page) {
  await expect(page.getByRole('heading', { name: 'Noch kein Zugriff' })).toBeVisible()
  await page.getByRole('button', { name: 'Fahrtenbuch einrichten' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

export async function importFixture(page: Page, opts: { fixDate?: string } = {}) {
  await page.goto('/#/daten')
  await page.locator('input[type=file][accept^=".xlsx"]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'Import-Vorschau' })).toBeVisible()
  if (opts.fixDate) await page.getByLabel('Datum Zeile 4').fill(opts.fixDate)
  await page.getByRole('button', { name: 'Auswahl importieren' }).click()
  await expect(page.getByText(/Import abgeschlossen/)).toBeVisible()
}

/** Prüft die Seite auf schwerwiegende Barrierefreiheitsprobleme (WCAG 2.1 AA). */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const summary = serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×) → ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} [${(n.any[0]?.message ?? '').slice(0, 140)}]`).join(' | ')}`)
  expect(summary, `Barrierefreiheit ${label}`).toEqual([])
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}
