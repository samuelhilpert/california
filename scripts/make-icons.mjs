// Erzeugt Favicon und App-Symbole aus der Bildmarke in src/components/BusMark.tsx.
// Aufruf: node scripts/make-icons.mjs   (nutzt das Chromium von Playwright)
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const src = readFileSync(resolve(root, 'src/components/BusMark.tsx'), 'utf8')
const inner = src.match(/BUS_SVG_INNER = `([\s\S]*?)`/)[1].trim()
const [, , vbW, vbH] = src.match(/BUS_VIEWBOX = '([^']+)'/)[1].split(' ').map(Number)

/** Quadratisches Symbol: Sandwick-Verlauf, Bus mittig. `scale` = Anteil der Breite (maskable braucht Rand). */
function iconSvg(size, scale, rounded) {
  const w = size * scale
  const h = (w * vbH) / vbW
  const x = (size - w) / 2
  const y = (size - h) / 2 + size * 0.02
  const r = rounded ? size * 0.22 : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8f1e6"/><stop offset="1" stop-color="#ddc196"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <ellipse cx="${size / 2}" cy="${y + h * 0.97}" rx="${w * 0.42}" ry="${size * 0.025}" fill="#1d1d1f" opacity="0.12"/>
  <svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${vbW} ${vbH}">${inner}</svg>
</svg>`
}

writeFileSync(resolve(root, 'public/favicon.svg'), iconSvg(64, 0.86, true))

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, scale, rounded] of [
  ['public/icons/icon-192.png', 192, 0.78, false],
  ['public/icons/icon-512.png', 512, 0.78, false],
  ['public/icons/maskable-512.png', 512, 0.62, false],
  ['public/icons/apple-touch-icon.png', 180, 0.78, false],
]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0">${iconSvg(size, scale, rounded)}</body>`)
  await page.locator('svg').first().screenshot({ path: resolve(root, file) })
  console.log('✓', file)
}
await browser.close()
