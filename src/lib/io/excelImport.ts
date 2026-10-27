/**
 * Excel-Import für „VW California.xlsx“ und kompatible Dateien.
 *
 * Erkannte Tabellenblätter:
 *  - Fahrtenbuch:      Kopfzeile wird automatisch gesucht (z. B. „Von | Bis | Kilometerstand Anfang |
 *                      Kilometerstand Ende | gefahrene Kilometer | Wer“). Formelspalten werden nicht
 *                      vorausgesetzt – Kilometer werden aus den Kilometerständen nachgerechnet.
 *  - Kosten:           Zeilen „Bezeichnung | Betrag | Anzahl | Gesamt“ (mit oder ohne Kopfzeile).
 *                      Anzahl > 1 wird als monatlich wiederkehrende Ausgabe interpretiert.
 *  - Kostenverteilung: wird nicht importiert (reine Berechnung), liefert aber Personennamen und die
 *                      von Excel berechneten Werte als Gegenprobe.
 *
 * Diese Datei ist frei von Datenbankzugriffen und damit vollständig testbar.
 */
import * as XLSX from 'xlsx'
import { excelSerialToIso, isIsoDate, parseGermanDate, toIso } from '../domain/dates'
import { euroToCents, parseEuroInput, parseNumberInput } from '../domain/money'
import { computeDistribution } from '../domain/settlement'
import { expandExpenses } from '../domain/recurrence'
import type { Category, CostEntry, Expense, Frequency, IsoDate, Person, Trip } from '../domain/types'

export type RowStatus = 'ok' | 'warning' | 'error' | 'duplicate'

export interface ImportTripDraft {
  startDate: IsoDate
  endDate?: IsoDate
  from?: string
  to?: string
  odoStart?: number
  odoEnd?: number
  km: number
  personNames: string[]
  note?: string
}

export interface ImportExpenseDraft {
  title: string
  categoryId: string
  amountCents: number
  /** Leer, wenn die Datei kein Datum enthält – dann muss vor dem Import ein Startdatum gewählt werden. */
  date?: IsoDate
  frequency?: Frequency
  count?: number
  spreadMonths?: number
  /** Name der zahlenden Person (wird beim Import einer Person zugeordnet bzw. angelegt). */
  paidByName?: string
  note?: string
}

export interface ImportRow<T> {
  /** Eindeutige Zeilenkennung, z. B. "Fahrtenbuch!4". */
  rowId: string
  sheet: string
  rowNumber: number
  /** Originalwerte der Zeile zur Anzeige. */
  raw: Record<string, string>
  draft?: T
  status: RowStatus
  messages: string[]
  importKey?: string
  /** Standardauswahl für den Import. */
  selected: boolean
}

export interface ExcelReference {
  totalCostCents?: number
  totalKm?: number
  pricePerKm?: number
  persons: { name: string; amountCents?: number }[]
}

export interface ReferenceCheck {
  /** true = alle von Excel berechneten Personenanteile stimmen mit der App-Berechnung überein. */
  matches: boolean
  rows: { name: string; excelCents?: number; appCents: number }[]
}

export interface ImportPersonPreview {
  name: string
  existingId?: string
  existingInactive?: boolean
  usedInRows: number
}

export interface ImportPreview {
  fileName: string
  sheetNames: string[]
  persons: ImportPersonPreview[]
  trips: ImportRow<ImportTripDraft>[]
  expenses: ImportRow<ImportExpenseDraft>[]
  reference?: ExcelReference
  referenceCheck?: ReferenceCheck
  /** Vorschlag für fehlende Startdaten wiederkehrender Kosten. */
  suggestedStartDate: IsoDate
  issues: string[]
}

export interface ExistingData {
  persons: Person[]
  trips: Trip[]
  expenses: Expense[]
  categories: Category[]
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

export function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
}

export function splitPersonNames(value: string): string[] {
  const parts = value
    .split(/,|;|\/|&|\+|\bund\b|\n/i)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const k = p.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      out.push(p)
    }
  }
  return out
}

type Cell = XLSX.CellObject | undefined

function cellText(c: Cell): string {
  if (!c || c.v == null) return ''
  if (c.w != null) return String(c.w)
  return String(c.v)
}

function isEmpty(c: Cell): boolean {
  return !c || c.t === 'z' || c.v == null || (c.t === 's' && String(c.v).trim() === '')
}

interface DateRead { date?: IsoDate; yearHidden?: boolean; error?: string }

function readDate(c: Cell, date1904: boolean): DateRead {
  if (isEmpty(c)) return {}
  if (c!.t === 'e') return { error: 'Excel-Fehlerwert im Datum' }
  if (c!.t === 'n') {
    const iso = excelSerialToIso(Number(c!.v), date1904)
    if (!iso) return { error: `Ungültiges Datum „${cellText(c)}“` }
    const fmt = String(c!.z ?? '')
    return { date: iso, yearHidden: fmt !== '' && fmt !== 'General' && !/y|j/i.test(fmt) }
  }
  if (c!.t === 'd' && c!.v instanceof Date) {
    const d = c!.v as Date
    return { date: toIso(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
  }
  const iso = parseGermanDate(String(c!.v))
  return iso ? { date: iso } : { error: `Datum „${cellText(c)}“ ist nicht lesbar (erwartet TT.MM.JJJJ)` }
}

interface NumRead { value?: number; error?: string; hasFormula?: boolean; missingCachedValue?: boolean }

function readNumber(c: Cell, money = false): NumRead {
  if (!c) return {}
  const hasFormula = Boolean(c.f)
  if (c.v == null || c.t === 'z') return { hasFormula, missingCachedValue: hasFormula }
  if (c.t === 'e') return { error: 'Excel-Fehlerwert', hasFormula }
  if (c.t === 'n') return { value: Number(c.v), hasFormula }
  if (c.t === 's') {
    const s = String(c.v).trim()
    if (s === '') return { hasFormula }
    const v = money ? parseEuroInput(s) : parseNumberInput(s)
    if (v == null) return { error: `„${s}“ ist keine gültige Zahl`, hasFormula }
    return { value: money ? v / 100 : v, hasFormula }
  }
  return { error: `„${cellText(c)}“ ist keine gültige Zahl`, hasFormula }
}

function findSheet(wb: XLSX.WorkBook, ...keywords: string[]): string | undefined {
  return wb.SheetNames.find((n) => keywords.some((k) => normalizeHeader(n).includes(k)))
}

const fmtDe = (d: IsoDate) => d.split('-').reverse().join('.')

// ---------------------------------------------------------------------------
// Fahrtenbuch
// ---------------------------------------------------------------------------

type TripCol = 'startDate' | 'endDate' | 'from' | 'to' | 'odoStart' | 'odoEnd' | 'km' | 'persons' | 'note' | 'ignore'

export function classifyTripHeader(raw: string): TripCol | null {
  const n = normalizeHeader(raw)
  if (!n) return null
  const isOdo = n.includes('kilometerstand') || n.includes('kmstand') || n.includes('tachostand') || n.includes('tacho')
  if (isOdo && /(anfang|beginn|start)/.test(n)) return 'odoStart'
  if (isOdo && /ende?$|ende/.test(n)) return 'odoEnd'
  if (n.includes('kosten')) return 'ignore'
  if (n.includes('gefahren') || ['km', 'kilometer', 'strecke', 'distanz', 'entfernung'].includes(n)) return 'km'
  if (['wer', 'fahrer', 'personen', 'person', 'mitfahrer', 'beteiligte', 'teilnehmer', 'fahrermitfahrer'].includes(n) || n.includes('beteiligt')) return 'persons'
  if (['startort', 'abfahrtsort', 'vonort', 'ausgangsort', 'abfahrt'].includes(n)) return 'from'
  if (['zielort', 'ziel', 'nach', 'ankunftsort', 'nachort'].includes(n)) return 'to'
  if (['von', 'datum', 'startdatum', 'start', 'abfahrtsdatum', 'beginn', 'vondatum', 'datumvon'].includes(n)) return 'startDate'
  if (['bis', 'enddatum', 'ende', 'bisdatum', 'datumbis', 'rueckkehr'].includes(n)) return 'endDate'
  if (['notiz', 'notizen', 'bemerkung', 'bemerkungen', 'anmerkung', 'zweck', 'kommentar'].includes(n)) return 'note'
  return null
}

interface TripSheetResult {
  rows: ImportRow<ImportTripDraft>[]
  issues: string[]
}

function parseTripSheet(ws: XLSX.WorkSheet, sheetName: string, date1904: boolean, today: IsoDate): TripSheetResult {
  const issues: string[] = []
  if (!ws['!ref']) return { rows: [], issues: [`Das Blatt „${sheetName}“ ist leer.`] }
  const range = XLSX.utils.decode_range(ws['!ref'])
  const get = (r: number, c: number): Cell => ws[XLSX.utils.encode_cell({ r, c })]

  // Kopfzeile in den ersten 30 Zeilen suchen
  let headerRow = -1
  let cols: Partial<Record<TripCol, number>> = {}
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    const found: Partial<Record<TripCol, number>> = {}
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = get(r, c)
      if (!cell || cell.t !== 's') continue
      const kind = classifyTripHeader(String(cell.v))
      if (kind && found[kind] == null) found[kind] = c
    }
    const score = Object.keys(found).filter((k) => k !== 'ignore').length
    if (score >= 3 && found.startDate != null && (found.km != null || (found.odoStart != null && found.odoEnd != null))) {
      headerRow = r
      cols = found
      break
    }
  }
  if (headerRow < 0) {
    return { rows: [], issues: [`Im Blatt „${sheetName}“ wurde keine Kopfzeile mit Datum und Kilometern gefunden.`] }
  }
  if (cols.persons == null) issues.push(`Im Blatt „${sheetName}“ fehlt eine Spalte für die beteiligten Personen (z. B. „Wer“).`)

  const headerNames: Partial<Record<TripCol, string>> = {}
  for (const [k, c] of Object.entries(cols)) headerNames[k as TripCol] = cellText(get(headerRow, c!))

  const rows: ImportRow<ImportTripDraft>[] = []
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const at = (k: TripCol): Cell => (cols[k] == null ? undefined : get(r, cols[k]!))
    const relevant: TripCol[] = ['startDate', 'endDate', 'from', 'to', 'odoStart', 'odoEnd', 'km', 'persons', 'note']
    if (relevant.every((k) => isEmpty(at(k)))) continue

    const raw: Record<string, string> = {}
    for (const k of relevant) if (cols[k] != null) raw[headerNames[k] ?? k] = cellText(at(k))

    // Summenzeilen überspringen: Beschriftung „Summe“ oder =SUMME(...) ohne Datum und Personen
    if (['summe', 'gesamt', 'total'].includes(normalizeHeader(cellText(at('startDate'))))) continue
    const onlyKm = isEmpty(at('startDate')) && isEmpty(at('persons')) && isEmpty(at('odoStart')) && isEmpty(at('odoEnd'))
    if (onlyKm) {
      const kmCell = at('km')
      const f = String(kmCell?.f ?? '').toUpperCase()
      if (f.startsWith('SUM') || f.startsWith('SUBTOTAL')) continue
    }

    const messages: string[] = []
    let hasError = false
    let hasWarning = false
    const err = (m: string) => { messages.push(m); hasError = true }
    const warn = (m: string) => { messages.push(m); hasWarning = true }

    const sd = readDate(at('startDate'), date1904)
    const ed = readDate(at('endDate'), date1904)
    if (sd.error) err(sd.error)
    else if (!sd.date) err('Startdatum fehlt.')
    if (ed.error) warn(`${ed.error} – Enddatum wird ignoriert.`)
    if (sd.date && sd.yearHidden) warn(`Das Jahr ist in der Excel-Zelle nicht sichtbar (Format „${at('startDate')?.z}“). Übernommen wird ${fmtDe(sd.date)} – bitte prüfen.`)
    if (sd.date && sd.date > today) warn(`Das Datum ${fmtDe(sd.date)} liegt in der Zukunft.`)
    let endDate = ed.date
    if (endDate && sd.date && endDate < sd.date) {
      warn('Das Enddatum liegt vor dem Startdatum und wird ignoriert.')
      endDate = undefined
    }
    if (endDate && endDate === sd.date) endDate = undefined

    const o1 = readNumber(at('odoStart'))
    const o2 = readNumber(at('odoEnd'))
    const kmRead = readNumber(at('km'))
    if (o1.error) err(`Kilometerstand Anfang: ${o1.error}.`)
    if (o2.error) err(`Kilometerstand Ende: ${o2.error}.`)
    if (kmRead.error) warn(`Gefahrene Kilometer: ${kmRead.error}.`)

    let km: number | undefined
    if (o1.value != null && o2.value != null) {
      if (o2.value < o1.value) err(`Der Kilometerstand am Ende (${o2.value}) ist kleiner als am Anfang (${o1.value}).`)
      km = Math.round((o2.value - o1.value) * 10) / 10
      if (kmRead.value != null && Math.abs(kmRead.value - km) > 0.05) {
        warn(`Die Spalte „gefahrene Kilometer“ (${kmRead.value}) weicht von der Differenz der Kilometerstände (${km}) ab. Übernommen wird die Differenz.`)
      }
    } else if (kmRead.value != null) {
      km = kmRead.value
    } else if (kmRead.missingCachedValue) {
      err('Die Kilometer sind eine Formel ohne gespeicherten Wert und können nicht aus Kilometerständen berechnet werden.')
    } else {
      err('Gefahrene Kilometer fehlen (weder direkt noch über Kilometerstände angegeben).')
    }
    if (km != null && km < 0) err('Die gefahrenen Kilometer sind negativ.')

    const personNames = cols.persons != null ? splitPersonNames(cellText(at('persons'))) : []
    if (personNames.length === 0) err('Keine beteiligten Personen angegeben.')

    const draft: ImportTripDraft | undefined =
      sd.date && km != null
        ? {
            startDate: sd.date,
            endDate,
            from: cellText(at('from')).trim() || undefined,
            to: cellText(at('to')).trim() || undefined,
            odoStart: o1.value,
            odoEnd: o2.value,
            km,
            personNames,
            note: cellText(at('note')).trim() || undefined,
          }
        : undefined

    rows.push({
      rowId: `${sheetName}!${r + 1}`,
      sheet: sheetName,
      rowNumber: r + 1,
      raw,
      draft,
      status: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
      messages,
      importKey: draft && !hasError ? tripImportKey(draft) : undefined,
      selected: !hasError,
    })
  }
  return { rows, issues }
}

export function tripImportKey(d: ImportTripDraft): string {
  const names = d.personNames.map((n) => n.toLowerCase()).sort().join('+')
  return ['xlsx:trip', d.startDate, d.endDate ?? '', d.odoStart ?? '', d.odoEnd ?? '', d.km, names].join('|')
}

// ---------------------------------------------------------------------------
// Kosten
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ['leasing', /leasing|rate|finanzierung/],
  ['insurance', /versicherung|haftpflicht|kasko|schutzbrief|adac/],
  ['fuel', /tank|kraftstoff|diesel|benzin|sprit|adblue|laden|strom/],
  ['maintenance', /wartung|reparatur|inspektion|werkstatt|reifen|oel|tuev|hu|au|service|waesche|pflege/],
  ['tax', /steuer/],
  ['camping', /camping|stellplatz|campingplatz|gas|maut|vignette|parken|faehre/],
]

export function guessCategory(title: string, categories: Category[]): string {
  const n = normalizeHeader(title)
  const byName = categories.find((c) => normalizeHeader(c.name) === n)
  if (byName) return byName.id
  for (const [id, re] of CATEGORY_KEYWORDS) {
    if (re.test(n) && categories.some((c) => c.id === id)) return id
  }
  return categories.some((c) => c.id === 'other') ? 'other' : categories[0]?.id ?? 'other'
}

type CostCol = 'title' | 'category' | 'amount' | 'count' | 'total' | 'date' | 'frequency' | 'note' | 'paidBy' | 'spread'

function classifyCostHeader(raw: string): CostCol | null {
  const n = normalizeHeader(raw)
  if (['bezeichnung', 'kostenart', 'beschreibung', 'posten', 'art', 'titel', 'name'].includes(n)) return 'title'
  if (n === 'kategorie') return 'category'
  if (['betrag', 'betrageur', 'einzelbetrag', 'rate', 'preis', 'betragjefaelligkeit'].includes(n)) return 'amount'
  if (['anzahl', 'monate', 'menge', 'anzahlraten', 'laufzeit'].includes(n)) return 'count'
  if (['gesamt', 'summe', 'gesamtbetrag', 'gesamtkosten'].includes(n)) return 'total'
  if (['datum', 'buchungsdatum', 'faelligkeit', 'start', 'beginn', 'erstefaelligkeit'].includes(n)) return 'date'
  if (['wiederholung', 'intervall', 'turnus', 'rhythmus'].includes(n)) return 'frequency'
  if (['notiz', 'bemerkung', 'anmerkung', 'kommentar'].includes(n)) return 'note'
  if (['bezahltvon', 'zahler', 'bezahlt', 'gezahltvon'].includes(n)) return 'paidBy'
  if (['verteiltaufmonate', 'monatsverteilung', 'verteilungmonate'].includes(n)) return 'spread'
  return null
}

function parseCostSheet(ws: XLSX.WorkSheet, sheetName: string, date1904: boolean, categories: Category[]): { rows: ImportRow<ImportExpenseDraft>[]; issues: string[] } {
  if (!ws['!ref']) return { rows: [], issues: [`Das Blatt „${sheetName}“ ist leer.`] }
  const range = XLSX.utils.decode_range(ws['!ref'])
  const get = (r: number, c: number): Cell => ws[XLSX.utils.encode_cell({ r, c })]

  // Optionale Kopfzeile suchen
  let headerRow = -1
  let cols: Partial<Record<CostCol, number>> = {}
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 20); r++) {
    const found: Partial<Record<CostCol, number>> = {}
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = get(r, c)
      if (!cell || cell.t !== 's') continue
      const k = classifyCostHeader(String(cell.v))
      if (k && found[k] == null) found[k] = c
    }
    if (found.title != null && (found.amount != null || found.total != null)) {
      headerRow = r
      cols = found
      break
    }
  }
  const positional = headerRow < 0
  if (positional) cols = { title: range.s.c, amount: range.s.c + 1, count: range.s.c + 2, total: range.s.c + 3 }

  const rows: ImportRow<ImportExpenseDraft>[] = []
  for (let r = (positional ? range.s.r : headerRow + 1); r <= range.e.r; r++) {
    const at = (k: CostCol): Cell => (cols[k] == null ? undefined : get(r, cols[k]!))
    const titleCell = at('title')
    const title = cellText(titleCell).trim()
    const amount = readNumber(at('amount'), true)
    const count = readNumber(at('count'))
    const total = readNumber(at('total'), true)
    const hasNumbers = amount.value != null || total.value != null || amount.missingCachedValue || total.missingCachedValue

    if (!title && !hasNumbers) continue
    // Titelzeile ("Kosten") ohne Zahlen
    if (title && !hasNumbers && isEmpty(at('count'))) continue
    // Summenzeile ohne Bezeichnung oder mit „Summe/Gesamt“
    const nt = normalizeHeader(title)
    if (!title || ['summe', 'gesamt', 'gesamtkosten', 'total'].includes(nt)) continue

    const raw: Record<string, string> = { Bezeichnung: title }
    if (cols.category != null) raw.Kategorie = cellText(at('category'))
    raw.Betrag = cellText(at('amount'))
    if (cols.count != null) raw.Anzahl = cellText(at('count'))
    if (cols.total != null) raw.Gesamt = cellText(at('total'))
    if (cols.date != null) raw.Datum = cellText(at('date'))

    const messages: string[] = []
    let hasError = false
    let hasWarning = false
    const err = (m: string) => { messages.push(m); hasError = true }
    const warn = (m: string) => { messages.push(m); hasWarning = true }

    let n = 1
    if (count.value != null) {
      if (!Number.isInteger(count.value) || count.value < 1) err(`Die Anzahl „${cellText(at('count'))}“ ist keine positive ganze Zahl.`)
      else n = count.value
    } else if (count.error) err(`Anzahl: ${count.error}.`)

    let amountCents: number | undefined
    if (amount.value != null) amountCents = euroToCents(amount.value)
    else if (total.value != null) {
      amountCents = euroToCents(total.value / n)
      if (n > 1 && amountCents * n !== euroToCents(total.value)) err('Der Gesamtbetrag lässt sich nicht centgenau auf die Anzahl aufteilen.')
    } else err(amount.error ? `Betrag: ${amount.error}.` : 'Kein Betrag angegeben.')

    if (amountCents != null && total.value != null && amount.value != null) {
      const expected = amountCents * n
      if (Math.abs(expected - euroToCents(total.value)) > 0) {
        warn(`Gesamt in Excel (${total.value.toFixed(2)} €) weicht von Betrag × Anzahl (${(expected / 100).toFixed(2)} €) ab. Übernommen wird Betrag × Anzahl.`)
      }
    }
    if (amountCents === 0) err('Der Betrag ist 0 €.')

    // Wiederholung
    let frequency: Frequency | undefined
    const freqText = normalizeHeader(cellText(at('frequency')))
    if (freqText.startsWith('monat')) frequency = 'monthly'
    else if (freqText.startsWith('jaehr') || freqText.startsWith('jahr')) frequency = 'yearly'
    else if (n > 1) frequency = 'monthly'
    if (n > 1 && !freqText) {
      messages.push(`Anzahl ${n} wird als ${n} monatliche Fälligkeiten zu je ${((amountCents ?? 0) / 100).toFixed(2).replace('.', ',')} € interpretiert.`)
    }

    const dr = readDate(at('date'), date1904)
    if (dr.error) warn(`${dr.error} – bitte Startdatum wählen.`)
    if (!dr.date) {
      warn(frequency ? 'Der Beginn der Laufzeit ist in der Datei nicht angegeben – bitte Startmonat prüfen.' : 'Kein Datum angegeben – bitte Buchungsdatum prüfen.')
    }

    let spreadMonths: number | undefined
    const sp = readNumber(at('spread'))
    if (sp.value != null) {
      if (!Number.isInteger(sp.value) || sp.value < 1 || sp.value > 120) warn(`„Verteilt auf Monate“ (${sp.value}) ist ungültig und wird ignoriert.`)
      else if (sp.value > 1) spreadMonths = sp.value
    }
    const paidByName = cellText(at('paidBy')).trim().replace(/\s+/g, ' ') || undefined

    let categoryId = guessCategory(title, categories)
    const catText = cellText(at('category')).trim()
    if (catText) {
      const match = categories.find((c) => normalizeHeader(c.name) === normalizeHeader(catText))
      if (match) categoryId = match.id
      else warn(`Kategorie „${catText}“ ist unbekannt – zugeordnet zu „${categories.find((c) => c.id === categoryId)?.name ?? categoryId}“.`)
    }

    const draft: ImportExpenseDraft | undefined =
      amountCents != null && !hasError
        ? {
            title,
            categoryId,
            amountCents,
            date: dr.date,
            frequency,
            count: frequency ? (n > 1 ? n : undefined) : undefined,
            spreadMonths,
            paidByName,
            note: cellText(at('note')).trim() || undefined,
          }
        : undefined

    rows.push({
      rowId: `${sheetName}!${r + 1}`,
      sheet: sheetName,
      rowNumber: r + 1,
      raw,
      draft,
      status: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
      messages,
      importKey: draft ? expenseImportKey(draft) : undefined,
      selected: !hasError,
    })
  }
  return { rows, issues: [] }
}

export function expenseImportKey(d: ImportExpenseDraft): string {
  return ['xlsx:expense', normalizeHeader(d.title), d.amountCents, d.frequency ?? 'once', d.count ?? '', d.date ?? ''].join('|')
}

// ---------------------------------------------------------------------------
// Kostenverteilung (nur Referenz)
// ---------------------------------------------------------------------------

function parseReferenceSheet(ws: XLSX.WorkSheet): ExcelReference {
  const ref: ExcelReference = { persons: [] }
  if (!ws['!ref']) return ref
  const range = XLSX.utils.decode_range(ws['!ref'])
  const get = (r: number, c: number): Cell => ws[XLSX.utils.encode_cell({ r, c })]
  let inPersons = false
  for (let r = range.s.r; r <= range.e.r; r++) {
    const label = cellText(get(r, range.s.c)).trim()
    const valueCell = get(r, range.s.c + 1)
    const value = valueCell && valueCell.t === 'n' ? Number(valueCell.v) : undefined
    const n = normalizeHeader(label)
    if (!label) {
      continue
    }
    if (n.startsWith('kostenverteilung') || n.includes('nachfahrer') || n.includes('properson')) {
      inPersons = true
      continue
    }
    if (n === 'gesamtkosten') { if (value != null) ref.totalCostCents = euroToCents(value); continue }
    if (n === 'gesamtkm' || n === 'gesamtkilometer') { ref.totalKm = value; continue }
    if (n.includes('prokm') || n.includes('kilometerpreis') || n.includes('prokilometer')) { ref.pricePerKm = value; continue }
    if (inPersons) ref.persons.push({ name: label.replace(/\s+/g, ' '), amountCents: value != null ? euroToCents(value) : undefined })
  }
  return ref
}

// ---------------------------------------------------------------------------
// Gesamtanalyse
// ---------------------------------------------------------------------------

export function readWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(data, { type: 'array', cellFormula: true, cellNF: true, cellDates: false })
}

export function analyzeWorkbook(wb: XLSX.WorkBook, fileName: string, existing: ExistingData, today: IsoDate): ImportPreview {
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904)
  const issues: string[] = []

  const tripSheet = findSheet(wb, 'fahrtenbuch', 'fahrten')
  const costSheet = wb.SheetNames.find((n) => normalizeHeader(n) === 'kosten') ?? findSheet(wb, 'ausgaben')
  const refSheet = findSheet(wb, 'kostenverteilung', 'abrechnung')

  let trips: ImportRow<ImportTripDraft>[] = []
  let expenses: ImportRow<ImportExpenseDraft>[] = []
  if (tripSheet) {
    const res = parseTripSheet(wb.Sheets[tripSheet], tripSheet, date1904, today)
    trips = res.rows
    issues.push(...res.issues)
  } else issues.push('Kein Tabellenblatt „Fahrtenbuch“ gefunden.')
  if (costSheet) {
    const res = parseCostSheet(wb.Sheets[costSheet], costSheet, date1904, existing.categories)
    expenses = res.rows
    issues.push(...res.issues)
  } else issues.push('Kein Tabellenblatt „Kosten“ gefunden.')
  const reference = refSheet ? parseReferenceSheet(wb.Sheets[refSheet]) : undefined

  // --- Personen ---
  const personMap = new Map<string, ImportPersonPreview>()
  const addName = (name: string, count: number) => {
    const key = name.toLowerCase()
    let p = personMap.get(key)
    if (!p) {
      const ex = existing.persons.find((e) => e.name.toLowerCase() === key)
      p = { name, existingId: ex?.id, existingInactive: ex ? !ex.active : undefined, usedInRows: 0 }
      personMap.set(key, p)
    }
    p.usedInRows += count
  }
  for (const r of trips) for (const n of r.draft?.personNames ?? []) addName(n, 1)
  for (const p of reference?.persons ?? []) addName(p.name, 0)
  for (const r of expenses) if (r.draft?.paidByName) addName(r.draft.paidByName, 0)

  // --- Duplikate: Fahrten ---
  const nameById = new Map(existing.persons.map((p) => [p.id, p.name.toLowerCase()]))
  const existingTripKeys = new Set(existing.trips.map((t) => t.importKey).filter(Boolean))
  const existingTripContent = new Set(
    existing.trips.map((t) => contentKeyTrip(t.startDate, t.km, t.personIds.map((id) => nameById.get(id) ?? id))),
  )
  const seenTrip = new Set<string>()
  for (const r of trips) {
    if (!r.draft || r.status === 'error') continue
    const ck = contentKeyTrip(r.draft.startDate, r.draft.km, r.draft.personNames.map((n) => n.toLowerCase()))
    if (r.importKey && existingTripKeys.has(r.importKey)) markDuplicate(r, 'Diese Fahrt wurde bereits importiert.')
    else if (existingTripContent.has(ck)) markDuplicate(r, 'Eine Fahrt mit gleichem Datum, gleichen Kilometern und gleichen Personen ist bereits vorhanden.')
    else if (seenTrip.has(ck)) markDuplicate(r, 'Diese Fahrt kommt in der Datei mehrfach vor.')
    seenTrip.add(ck)
  }

  // --- Duplikate: Kosten ---
  const existingExpenseKeys = new Set(existing.expenses.map((e) => e.importKey).filter(Boolean))
  const existingExpenseContent = new Set(existing.expenses.map((e) => contentKeyExpense(e.title, e.amountCents, e.recurrence?.count)))
  const seenExp = new Set<string>()
  for (const r of expenses) {
    if (!r.draft || r.status === 'error') continue
    const ck = contentKeyExpense(r.draft.title, r.draft.amountCents, r.draft.count)
    // Der Importschlüssel enthält das Datum nur, wenn es in der Datei steht – fehlt es, zählt der Inhalt.
    if (r.importKey && existingExpenseKeys.has(r.importKey)) markDuplicate(r, 'Diese Ausgabe wurde bereits importiert.')
    else if (existingExpenseContent.has(ck)) markDuplicate(r, 'Eine Ausgabe mit gleicher Bezeichnung und gleichem Betrag ist bereits vorhanden.')
    else if (seenExp.has(ck)) markDuplicate(r, 'Diese Ausgabe kommt in der Datei mehrfach vor.')
    seenExp.add(ck)
  }

  // --- Vorschlag Startdatum ---
  const tripDates = trips.map((t) => t.draft?.startDate).filter((d): d is string => Boolean(d)).sort()
  const suggestedStartDate = tripDates[0] ? `${tripDates[0].slice(0, 7)}-01` : `${today.slice(0, 7)}-01`

  // --- Gegenprobe mit den Excel-Werten ---
  const referenceCheck = reference && reference.persons.some((p) => p.amountCents != null)
    ? checkAgainstReference(trips, expenses, reference, suggestedStartDate, today)
    : undefined

  return {
    fileName,
    sheetNames: wb.SheetNames,
    persons: [...personMap.values()],
    trips,
    expenses,
    reference,
    referenceCheck,
    suggestedStartDate,
    issues,
  }
}

function contentKeyTrip(date: string, km: number, names: string[]): string {
  return `${date}|${km}|${[...names].sort().join('+')}`
}

function contentKeyExpense(title: string, cents: number, count?: number): string {
  return `${normalizeHeader(title)}|${cents}|${count ?? 1}`
}

function markDuplicate<T>(r: ImportRow<T>, msg: string) {
  r.status = 'duplicate'
  r.selected = false
  r.messages.unshift(msg)
}

/** Rechnet die Datei selbst mit der App-Logik nach und vergleicht mit den von Excel berechneten Anteilen. */
function checkAgainstReference(
  trips: ImportRow<ImportTripDraft>[],
  expenses: ImportRow<ImportExpenseDraft>[],
  reference: ExcelReference,
  startDate: IsoDate,
  today: IsoDate,
): ReferenceCheck {
  const calcTrips = trips
    .filter((t) => t.draft && t.status !== 'error')
    .map((t) => ({ id: t.rowId, startDate: t.draft!.startDate, km: t.draft!.km, personIds: t.draft!.personNames.map((n) => n.toLowerCase()) }))
  const calcExpenses: Expense[] = expenses
    .filter((e) => e.draft && e.status !== 'error')
    .map((e) => draftToExpense(e.draft!, e.rowId, e.draft!.date ?? startDate))
  const costs: CostEntry[] = expandExpenses(calcExpenses, today)
  const dist = computeDistribution(calcTrips, costs)
  const rows = reference.persons.map((p) => ({
    name: p.name,
    excelCents: p.amountCents,
    appCents: dist.persons.find((x) => x.personId === p.name.toLowerCase())?.totalCents ?? 0,
  }))
  return { matches: rows.every((r) => r.excelCents == null || Math.abs(r.excelCents - r.appCents) <= 1), rows }
}

export function draftToExpense(d: ImportExpenseDraft, id: string, date: IsoDate): Expense {
  const now = new Date().toISOString()
  return {
    id,
    title: d.title,
    categoryId: d.categoryId,
    amountCents: d.amountCents,
    date,
    allocation: 'perKm',
    recurrence: d.frequency ? { frequency: d.frequency, count: d.count } : undefined,
    spreadMonths: d.spreadMonths,
    note: d.note,
    importKey: expenseImportKey(d),
    createdAt: now,
    updatedAt: now,
  }
}

export function isValidStartDate(d: string | undefined): d is IsoDate {
  return Boolean(d && isIsoDate(d))
}
