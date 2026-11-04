import { expect, test } from '@playwright/test'
import { expectAccessible, expectNoHorizontalOverflow, register, resetEmulators, restoreFixture, setupBook } from './helpers'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const pad = (n: number) => String(n).padStart(2, '0')

test('Pro-Modus: Kalender mit Fahrten und geplanten Fahrten @mobile', async ({ page }, info) => {
  await resetEmulators()
  await register(page, `kalender-${info.project.name}@example.com`, 'Anna')
  await setupBook(page)
  await restoreFixture(page)
  await page.goto('/#/einstellungen')
  await page.getByRole('switch', { name: 'Pro-Modus' }).click()

  // Vormonat: liegt sicher in der Vergangenheit, damit „Als Fahrt eintragen“ angeboten wird
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const ym = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`
  const prevHeading = `${MONTHS[prev.getMonth()]} ${prev.getFullYear()}`

  await page.goto('/#/pro/kalender')
  await expect(page.getByRole('heading', { name: `${MONTHS[now.getMonth()]} ${now.getFullYear()}`, exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await expectAccessible(page, 'Kalender')

  // Fahrt planen
  await page.getByRole('button', { name: 'Fahrt planen', exact: true }).click()
  let dlg = page.getByRole('dialog')
  await dlg.getByLabel('Von').fill(`${ym}-10`)
  await dlg.getByLabel(/^Bis/).fill(`${ym}-12`)
  await dlg.getByLabel(/Ziel oder Anlass/).fill('Ostsee')
  await dlg.getByRole('button', { name: 'Planen' }).click()
  await expect(dlg).toHaveCount(0)

  await page.getByRole('button', { name: 'Vorheriger Monat' }).click()
  await expect(page.getByRole('heading', { name: prevHeading, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Geplant: .*Ostsee/ }).first()).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Ostsee' })).toContainText('Geplant')
  await expectAccessible(page, 'Kalender mit Plan')

  // Klick auf einen belegten Tag: neuer Plan mit Hinweis auf die Überschneidung
  await page.getByRole('button', { name: `11. ${prevHeading} – Fahrt planen` }).click({ position: { x: 10, y: 10 } })
  dlg = page.getByRole('dialog')
  await expect(dlg.getByLabel('Von')).toHaveValue(`${ym}-11`)
  await expect(dlg.getByText('Überschneidung')).toBeVisible()
  await dlg.getByRole('button', { name: 'Abbrechen' }).click()

  // Aus dem Plan wird eine Fahrt – der Plan verschwindet
  await page.getByRole('button', { name: /^Geplant: .*Ostsee/ }).first().click()
  await page.getByRole('button', { name: 'Als Fahrt eintragen' }).click()
  dlg = page.getByRole('dialog', { name: 'Neue Fahrt' })
  await expect(dlg.getByLabel('Startdatum', { exact: true })).toHaveValue(`${ym}-10`)
  await dlg.getByLabel(/Kilometerstand Beginn/).fill('520')
  await dlg.getByLabel(/Kilometerstand Ende/).fill('900')
  await dlg.getByRole('button', { name: 'Fahrt speichern' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Fahrt: .*Ostsee/ }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /^Geplant: .*Ostsee/ }).first()).toHaveCount(0)


  // Fahrt öffnet die Fahrt-Details
  await page.getByRole('button', { name: /^Fahrt: .*Ostsee/ }).first().click()
  await expect(page.getByRole('dialog', { name: /Ostsee/ })).toBeVisible()
})
