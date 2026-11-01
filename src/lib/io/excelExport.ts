import * as XLSX from 'xlsx'
import type { Category, Expense, IsoDate, Person, Trip } from '../domain/types'
import { personRows, type Settlement } from '../domain/settlement'
import { describeRecurrence } from '../domain/recurrence'

const EUR = '#,##0.00 "€"'
const KM = '#,##0.0'
const DATE = 'dd.mm.yyyy'
const PRICE = '#,##0.0000 "€"'

type CellValue = string | number | null | { v: number; z: string } | { date: IsoDate }

/** ISO-Datum → Excel-Seriennummer (1900-System), zeitzonenunabhängig. */
export function isoToExcelSerial(d: IsoDate): number {
  const [y, m, day] = d.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, day) - Date.UTC(1899, 11, 30)) / 86400000)
}

const eur = (cents: number) => ({ v: cents / 100, z: EUR })
const km = (v: number) => ({ v, z: KM })
const date = (d?: IsoDate) => (d ? { date: d } : null)

function sheet(rows: CellValue[][], widths?: number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  let maxC = 0
  rows.forEach((row, r) => {
    maxC = Math.max(maxC, row.length)
    row.forEach((val, c) => {
      if (val == null || val === '') return
      const addr = XLSX.utils.encode_cell({ r, c })
      if (typeof val === 'string') ws[addr] = { t: 's', v: val }
      else if (typeof val === 'number') ws[addr] = { t: 'n', v: val }
      else if ('date' in val) ws[addr] = { t: 'n', v: isoToExcelSerial(val.date), z: DATE }
      else ws[addr] = { t: 'n', v: val.v, z: val.z }
    })
  })
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(maxC - 1, 0) } })
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }))
  return ws
}

const names = (ids: string[], persons: Map<string, Person>) => ids.map((id) => persons.get(id)?.name ?? 'Unbekannt').join(', ')

/** Spalten bewusst kompatibel zum Import (Kopfzeilen wie in der Original-Excel-Datei). */
export function tripsSheet(trips: Trip[], persons: Person[]): XLSX.WorkSheet {
  const pm = new Map(persons.map((p) => [p.id, p]))
  const sorted = [...trips].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0))
  const rows: CellValue[][] = [
    ['Von', 'Bis', 'Startort', 'Zielort', 'Zwischenstationen', 'Kilometerstand Anfang', 'Kilometerstand Ende', 'gefahrene Kilometer', 'Wer', 'Anzahl Personen', 'Notiz'],
    ...sorted.map((t) => [
      date(t.startDate), date(t.endDate), t.from ?? null, t.to ?? null, t.stops?.join(', ') ?? null,
      t.odoStart ?? null, t.odoEnd ?? null, km(t.km), names(t.personIds, pm), t.personIds.length, t.note ?? null,
    ]),
    [],
    ['Summe', null, null, null, null, null, null, km(sorted.reduce((s, t) => s + t.km, 0)), null, null, `${sorted.length} Fahrten`],
  ]
  return sheet(rows, [12, 12, 18, 18, 28, 20, 20, 18, 30, 15, 30])
}

export function expensesSheet(expenses: Expense[], categories: Category[], persons: Person[]): XLSX.WorkSheet {
  const cm = new Map(categories.map((c) => [c.id, c.name]))
  const pm = new Map(persons.map((p) => [p.id, p]))
  const rows: CellValue[][] = [
    ['Bezeichnung', 'Kategorie', 'Betrag', 'Anzahl', 'Datum', 'Wiederholung', 'Verteilt auf Monate', 'Bezahlt von', 'Verteilung', 'Direkt verteilt auf', 'Liter', 'Notiz'],
    ...[...expenses]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((e) => [
        e.title,
        cm.get(e.categoryId) ?? e.categoryId,
        eur(e.amountCents),
        e.recurrence?.count ?? (e.recurrence ? null : 1),
        date(e.date),
        e.recurrence ? (e.recurrence.frequency === 'monthly' ? 'monatlich' : 'jährlich') + (e.recurrence.until ? ` bis ${e.recurrence.until.split('-').reverse().join('.')}` : '') : 'einmalig',
        e.spreadMonths ?? null,
        e.paidBy ? pm.get(e.paidBy)?.name ?? 'Unbekannt' : null,
        e.allocation === 'perKm' ? 'über Kilometerpreis' : 'direkt',
        e.allocation === 'direct' ? names(e.directPersonIds ?? [], pm) : null,
        e.liters ?? null,
        e.note ?? null,
      ]),
  ]
  return sheet(rows, [28, 22, 12, 8, 12, 22, 12, 16, 20, 26, 8, 30])
}

export function personsSheet(persons: Person[]): XLSX.WorkSheet {
  return sheet(
    [['Name', 'Status', 'ID'], ...persons.map((p) => [p.name, p.active ? 'aktiv' : 'deaktiviert', p.id])],
    [24, 14, 40],
  )
}

export function buildDataWorkbook(data: { trips: Trip[]; expenses: Expense[]; persons: Person[]; categories: Category[] }): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, tripsSheet(data.trips, data.persons), 'Fahrtenbuch')
  XLSX.utils.book_append_sheet(wb, expensesSheet(data.expenses, data.categories, data.persons), 'Kosten')
  XLSX.utils.book_append_sheet(wb, personsSheet(data.persons), 'Personen')
  return wb
}

export function buildTripsWorkbook(trips: Trip[], persons: Person[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, tripsSheet(trips, persons), 'Fahrtenbuch')
  return wb
}

export function buildSettlementWorkbook(s: Settlement, data: { persons: Person[]; categories: Category[]; expenses: Expense[] }, labels: { trips: string; costs: string }): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const pm = new Map(data.persons.map((p) => [p.id, p]))
  const cm = new Map(data.categories.map((c) => [c.id, c.name]))
  const em = new Map(data.expenses.map((e) => [e.id, e]))
  const rows = personRows(s, data.persons)
  const tripMap = new Map(s.includedTrips.map((t) => [t.id, t]))
  const deDate = (d: IsoDate | null) => (d ? d.split('-').reverse().join('.') : '–')

  // Übersicht
  const overview: CellValue[][] = [
    ['Kostenabrechnung VW California'],
    [],
    ['Fahrtenzeitraum', labels.trips],
    ['Kostenzeitraum', labels.costs],
    ['Erstellt am', { date: new Date().toISOString().slice(0, 10) }],
    [],
    ['Gesamtkosten', eur(s.totalCostCents)],
    ['davon über Kilometerpreis verteilt', eur(s.perKmCostCents)],
    ['davon direkt zugeordnet', eur(s.directCostCents)],
    ['Gesamtkilometer', km(s.totalKm)],
    ['Anzahl Fahrten', s.tripCount],
    ['Kilometerpreis', s.pricePerKm != null ? { v: s.pricePerKm, z: PRICE } : 'nicht berechenbar'],
    ['Verteilt', eur(s.distributedCents)],
    ['Nicht verteilt', eur(s.undistributedCents)],
    [],
    ['Person', 'Anteilige Kilometer', 'Kostenanteil'],
    ...rows.map((r) => [r.name, km(r.km), eur(r.totalCents)]),
    ['Summe', km(rows.reduce((a, r) => a + r.km, 0)), eur(s.distributedCents)],
  ]
  if (s.notices.length) {
    overview.push([], ['Hinweise'])
    for (const n of s.notices) overview.push([n.message])
  }
  XLSX.utils.book_append_sheet(wb, sheet(overview, [36, 22, 18]), 'Übersicht')

  // Personenanteile
  const personSheet: CellValue[][] = [
    ['Person', 'Status', 'Fahrten', 'Anteilige Kilometer', 'Anteil Kilometerkosten', 'Anteil Direktkosten', 'Kostenanteil gesamt'],
    ...rows.map((r) => [r.name, r.active ? 'aktiv' : 'deaktiviert', r.tripCount, km(r.km), eur(r.perKmCents), eur(r.directCents), eur(r.totalCents)]),
    ['Summe', null, null, km(rows.reduce((a, r) => a + r.km, 0)), eur(rows.reduce((a, r) => a + r.perKmCents, 0)), eur(rows.reduce((a, r) => a + r.directCents, 0)), eur(s.distributedCents)],
  ]
  XLSX.utils.book_append_sheet(wb, sheet(personSheet, [22, 12, 10, 20, 22, 20, 20]), 'Personenanteile')

  // Ausgleich
  const bal = s.balance
  const balanceRows: CellValue[][] = [
    ['Person', 'Bezahlt', 'Kostenanteil', 'Ausgleich gezahlt', 'Ausgleich erhalten', 'Saldo (+ bekommt / − zahlt)'],
    ...bal.balances.map((b) => [pm.get(b.personId)?.name ?? 'Unbekannt', eur(b.paidCents), eur(b.shareCents), eur(b.sentCents), eur(b.receivedCents), eur(b.balanceCents)]),
    [],
    ['Vorgeschlagene Ausgleichszahlungen'],
    ...(bal.transfers.length ? bal.transfers.map((t) => [`${pm.get(t.fromPersonId)?.name ?? '?'} → ${pm.get(t.toPersonId)?.name ?? '?'}`, eur(t.amountCents)]) : [['Keine – alle Salden sind ausgeglichen.']]),
  ]
  if (bal.unpaidCostCents) balanceRows.push([], ['Kosten ohne angegebenen Zahler', eur(bal.unpaidCostCents)])
  if (s.payments.length) {
    balanceRows.push([], ['Erfasste Ausgleichszahlungen im Zeitraum'], ['Datum', 'Von', 'An', 'Betrag', 'Notiz'])
    for (const p of s.payments) balanceRows.push([date(p.date), pm.get(p.fromPersonId)?.name ?? '?', pm.get(p.toPersonId)?.name ?? '?', eur(p.amountCents), p.note ?? null])
  }
  XLSX.utils.book_append_sheet(wb, sheet(balanceRows, [26, 14, 14, 16, 16, 24]), 'Ausgleich')

  // Fahrten
  const tripRows: CellValue[][] = [['Datum', 'Bis', 'Strecke', 'Kilometer', 'Fahrtkosten', 'Beteiligte', 'Person', 'Anteilige km', 'Anteil']]
  for (const tr of s.trips) {
    const t = tripMap.get(tr.tripId)
    const route = [t?.from, t?.to].filter(Boolean).join(' → ')
    tr.shares.forEach((sh, i) => {
      tripRows.push(
        i === 0
          ? [date(t?.startDate), date(t?.endDate), route || null, km(tr.km), eur(tr.costCents), names(t?.personIds ?? [], pm), pm.get(sh.personId)?.name ?? 'Unbekannt', km(sh.km), eur(sh.cents)]
          : [null, null, null, null, null, null, pm.get(sh.personId)?.name ?? 'Unbekannt', km(sh.km), eur(sh.cents)],
      )
    })
  }
  tripRows.push([], ['Summe', null, null, km(s.totalKm), eur(s.trips.reduce((a, t) => a + t.costCents, 0))])
  if (s.invalidTrips.length) {
    tripRows.push([], ['Nicht berücksichtigte Fahrten'])
    for (const it of s.invalidTrips) {
      const t = tripMap.get(it.tripId)
      tripRows.push([date(t?.startDate), null, null, t ? km(t.km) : null, null, names(t?.personIds ?? [], pm), invalidLabel(it.reason)])
    }
  }
  XLSX.utils.book_append_sheet(wb, sheet(tripRows, [12, 12, 26, 12, 14, 30, 18, 14, 14]), 'Fahrten')

  // Kosten
  const costRows: CellValue[][] = [
    ['Datum', 'Bezeichnung', 'Kategorie', 'Periode', 'Wiederholung', 'Verteilung', 'Betrag', 'Bezahlt von'],
    ...s.costs.map((c) => [
      date(c.date), c.title, cm.get(c.categoryId) ?? c.categoryId, c.period ?? null,
      em.get(c.expenseId) ? describeRecurrence(em.get(c.expenseId)!) : null,
      c.allocation === 'perKm' ? 'über Kilometerpreis' : `direkt: ${names(c.directPersonIds, pm)}`, eur(c.amountCents),
      c.paidBy ? pm.get(c.paidBy)?.name ?? 'Unbekannt' : null,
    ]),
    ['Summe', null, null, null, null, null, eur(s.totalCostCents)],
    [],
    ['Kategorie', 'Über Kilometerpreis', 'Direkt', 'Gesamt'],
    ...s.categories.map((c) => [cm.get(c.categoryId) ?? c.categoryId, eur(c.perKmCents), eur(c.directCents), eur(c.totalCents)]),
  ]
  XLSX.utils.book_append_sheet(wb, sheet(costRows, [12, 28, 22, 10, 20, 26, 14, 16]), 'Kosten')

  // Berechnungsgrundlagen
  const basis: CellValue[][] = [
    ['Berechnungsgrundlagen'],
    [],
    ['Fahrtenzeitraum (Startdatum der Fahrt)', `${deDate(s.tripRange.from)} bis ${deDate(s.tripRange.to)}`],
    ['Kostenzeitraum (Buchungs-/Fälligkeitsdatum)', `${deDate(s.costRange.from)} bis ${deDate(s.costRange.to)}`],
    ['Unterschiedliche Zeiträume', s.separatePeriods ? 'JA – Kosten und Fahrten stammen aus unterschiedlichen Zeiträumen' : 'nein'],
    ['Tatsächliche Fahrten', `${deDate(s.actualTripSpan.from)} bis ${deDate(s.actualTripSpan.to)}`],
    ['Tatsächliche Kostenbuchungen', `${deDate(s.actualCostSpan.from)} bis ${deDate(s.actualCostSpan.to)}`],
    [],
    ['1. Kilometerbezogene Kosten', eur(s.perKmCostCents)],
    ['2. Gesamtkilometer (jede Fahrt einmal)', km(s.totalKm)],
    ['3. Kilometerpreis = (1) / (2)', s.pricePerKm != null ? { v: s.pricePerKm, z: PRICE } : 'nicht berechenbar (0 km)'],
    ['4. Fahrtkosten = km der Fahrt × Kilometerpreis', 'centgenau gerundet (Restbetragsverfahren)'],
    ['5. Anteil je Person = Fahrtkosten / Anzahl Beteiligte', 'centgenau gerundet (Restbetragsverfahren)'],
    ['6. Direkt zugeordnete Kosten', eur(s.directCostCents)],
    ['   werden zu gleichen Teilen auf die gewählten Personen verteilt und fließen nicht in den Kilometerpreis ein.'],
    ['7. Summe aller Personenanteile', eur(s.distributedCents)],
    ['   Nicht verteilt', eur(s.undistributedCents)],
    [],
    ['Wiederkehrende Kosten werden je Fälligkeit (Monat bzw. Jahr) gebucht und genau einmal je Periode berücksichtigt.'],
  ]
  XLSX.utils.book_append_sheet(wb, sheet(basis, [52, 50]), 'Berechnungsgrundlagen')
  return wb
}

export function invalidLabel(reason: string): string {
  switch (reason) {
    case 'invalid-km': return 'Ungültige oder fehlende Kilometer'
    case 'no-persons': return 'Keine beteiligten Personen'
    case 'duplicate-persons': return 'Person doppelt eingetragen'
    case 'odometer': return 'Kilometerstand Ende kleiner als Anfang'
    default: return reason
  }
}

export function workbookToArray(wb: XLSX.WorkBook): Uint8Array {
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array
}

export function downloadWorkbook(wb: XLSX.WorkBook, fileName: string): void {
  XLSX.writeFile(wb, fileName, { compression: true })
}
