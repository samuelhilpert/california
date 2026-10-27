import { defineConfig, devices } from '@playwright/test'

/**
 * E2E-Tests gegen die Firebase-Emulatoren (Auth + Firestore) und einen Produktionsbuild.
 * Start: `npm run e2e` (startet Emulatoren, baut, startet Vorschau, führt Tests aus).
 * Optional: PLAYWRIGHT_CHROMIUM_PATH auf ein lokal vorhandenes Chromium setzen.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH
const PORT = 4174

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // alle Tests teilen sich dieselben Emulatoren
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}) },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grep: /@cross/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@cross/ },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npx vite build --mode emulator --outDir dist-e2e && npx vite preview --mode emulator --outDir dist-e2e --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
