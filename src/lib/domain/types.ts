/** ISO-Datum im Format JJJJ-MM-TT (ohne Uhrzeit, ohne Zeitzone). */
export type IsoDate = string

export interface Person {
  id: string
  name: string
  active: boolean
  createdAt: string
}

export interface Trip {
  id: string
  startDate: IsoDate
  endDate?: IsoDate
  from?: string
  to?: string
  odoStart?: number
  odoEnd?: number
  /** Tatsächlich gefahrene Fahrzeugkilometer – genau ein Wert pro Fahrt. */
  km: number
  /** Stabile Personen-IDs (nicht Namen). */
  personIds: string[]
  note?: string
  /** Schlüssel zur Erkennung bereits importierter Datensätze. */
  importKey?: string
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  builtin: boolean
  color: string
}

/**
 * perKm  = fließt in den Kilometerpreis ein und wird über die Fahrten verteilt.
 * direct = wird NICHT über den Kilometerpreis verteilt, sondern zu gleichen Teilen
 *          auf ausdrücklich gewählte Personen (z. B. Stellplatzgebühr nur für zwei Personen).
 */
export type Allocation = 'perKm' | 'direct'

export type Frequency = 'monthly' | 'yearly'

export interface Recurrence {
  frequency: Frequency
  /** Anzahl der Fälligkeiten (z. B. 24 Leasingraten). Leer = unbegrenzt. */
  count?: number
  /** Letztes mögliches Fälligkeitsdatum (inklusive). */
  until?: IsoDate
}

export interface Expense {
  id: string
  title: string
  categoryId: string
  /** Betrag in Cent. Bei wiederkehrenden Kosten: Betrag je Fälligkeit. */
  amountCents: number
  /** Buchungsdatum bzw. erste Fälligkeit. */
  date: IsoDate
  allocation: Allocation
  /** Nur bei allocation = 'direct'. */
  directPersonIds?: string[]
  recurrence?: Recurrence
  note?: string
  importKey?: string
  createdAt: string
  updatedAt: string
}

/** Eine einzelne, konkrete Kostenbuchung (einmalig oder eine Fälligkeit einer wiederkehrenden Ausgabe). */
export interface CostEntry {
  /** Eindeutig und stabil: `<expenseId>` oder `<expenseId>#<Periode>`. */
  id: string
  expenseId: string
  /** Periode der Fälligkeit, z. B. "2026-03" (monatlich) oder "2026" (jährlich); bei Einmalkosten leer. */
  period?: string
  title: string
  categoryId: string
  date: IsoDate
  amountCents: number
  allocation: Allocation
  directPersonIds: string[]
}

export interface Setting {
  key: string
  value: unknown
}
