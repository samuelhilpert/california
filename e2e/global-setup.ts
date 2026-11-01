import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'

/** Erzeugt eine Excel-Datei mit der Struktur der Original-„VW California.xlsx“ (Beispieldaten). */
export default async function globalSetup() {
  const fb: XLSX.WorkSheet = {
    A1: { t: 's', v: 'Fahrtenbuch und Kostenabrechnung VW California' },
    A3: { t: 's', v: 'Von ' }, B3: { t: 's', v: 'Bis' }, C3: { t: 's', v: 'Kilometerstand Anfang' }, D3: { t: 's', v: 'Kilometerstand Ende' },
    E3: { t: 's', v: 'gefahrene Kilometer' }, F3: { t: 's', v: 'Wer' }, G3: { t: 's', v: 'Kosten für Fahrt' },
    A4: { t: 'n', v: 46385, z: 'd-mmm' }, B4: { t: 'n', v: 46385, z: 'd-mmm' }, C4: { t: 'n', v: 20 }, D4: { t: 'n', v: 520 },
    E4: { t: 'n', v: 500, f: 'D4-C4' }, F4: { t: 's', v: 'Clara, Ben, Anna' },
    E6: { t: 'n', v: 500, f: 'SUM(E4:E5)' },
    '!ref': 'A1:G6',
  }
  const kv: XLSX.WorkSheet = {
    A3: { t: 's', v: 'Gesamtkosten' }, B3: { t: 'n', v: 7659.6, f: 'Kosten!D5' },
    A5: { t: 's', v: 'Gesamt KM' }, B5: { t: 'n', v: 500, f: 'Fahrtenbuch!E6' },
    A7: { t: 's', v: 'Kosten pro KM' }, B7: { t: 'n', v: 15.3192, f: 'B3/B5' },
    A10: { t: 's', v: 'Kostenverteilung nach Fahrer' },
    A11: { t: 's', v: 'Clara' }, B11: { t: 'n', v: 2553.2 },
    A12: { t: 's', v: 'Ben' }, B12: { t: 'n', v: 2553.2 },
    A13: { t: 's', v: 'Anna' }, B13: { t: 'n', v: 2553.2 },
    '!ref': 'A3:B13',
  }
  const kosten: XLSX.WorkSheet = {
    A1: { t: 's', v: 'Kosten' },
    A3: { t: 's', v: 'Leasingrate' }, B3: { t: 'n', v: 319.15 }, C3: { t: 'n', v: 24 }, D3: { t: 'n', v: 7659.6, f: 'B3*C3' },
    D5: { t: 'n', v: 7659.6, f: 'SUM(D3:D4)' },
    '!ref': 'A1:D5',
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, fb, 'Fahrtenbuch')
  XLSX.utils.book_append_sheet(wb, kv, 'Kostenverteilung')
  XLSX.utils.book_append_sheet(wb, kosten, 'Kosten')
  const dir = resolve(import.meta.dirname, '.tmp')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'VW California (Beispiel).xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}
