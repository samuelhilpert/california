import type { PeriodSpec } from './period'

/** ISO-Datum im Format JJJJ-MM-TT (ohne Uhrzeit, ohne Zeitzone). */
export type IsoDate = string

export interface Person {
  id: string
  name: string
  active: boolean
  /** E-Mail des verknüpften Kontos (Mitglied). Leer = Person ohne Konto, z. B. Gast. */
  email?: string
  createdAt: string
  updatedAt?: string
}

export interface Trip {
  id: string
  startDate: IsoDate
  endDate?: IsoDate
  from?: string
  to?: string
  /** Zwischenstationen in Reihenfolge, z. B. ["Barcelona", "Valencia"] – nur für Karte und Länder. */
  stops?: string[]
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
  /** E-Mail der Person, die zuletzt geändert hat. */
  updatedBy?: string
}

export interface Category {
  id: string
  name: string
  builtin: boolean
  color: string
  updatedAt?: string
}

/**
 * perKm  = fließt in den Kilometerpreis ein und wird über die Fahrten verteilt.
 * direct = wird NICHT über den Kilometerpreis verteilt, sondern zu gleichen Teilen
 *          auf ausdrücklich gewählte Personen (z. B. Stellplatzgebühr nur für zwei Personen).
 */
export type Allocation = 'perKm' | 'direct'

export type Frequency = 'monthly' | 'yearly'

interface Recurrence {
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
  /**
   * Verteilt jede Fälligkeit gleichmäßig auf so viele Monate (z. B. Jahresversicherung auf 12 Monate).
   * Leer oder 1 = der volle Betrag zählt im Fälligkeitsmonat.
   */
  spreadMonths?: number
  /** Person, die die Kosten bezahlt hat (für den Ausgleich). Leer = unbekannt/gemeinsames Konto. */
  paidBy?: string
  note?: string
  importKey?: string
  createdAt: string
  updatedAt: string
  updatedBy?: string
}

/**
 * Tankbuch (Pro-Modus): eine Tankfüllung. Bewusst KEINE Ausgabe – Sprit zahlt jeder selbst,
 * Tankfüllungen fließen nie in Abrechnung oder Ausgleich ein.
 */
export interface FuelFill {
  id: string
  date: IsoDate
  /** Wer getankt (und bezahlt) hat. */
  personId?: string
  amountCents: number
  liters?: number
  /** Kilometerstand beim Tanken. */
  odometer?: number
  /** Bis zum Rand vollgetankt – Grundlage der Verbrauchsberechnung. */
  fullTank: boolean
  note?: string
  createdAt: string
  updatedAt: string
  updatedBy?: string
}

/**
 * Kalender (Pro-Modus): geplante Nutzung des Busses – eine Reservierung, keine Fahrt.
 * Fließt nie in Abrechnung oder Statistik ein.
 */
export interface Plan {
  id: string
  startDate: IsoDate
  endDate?: IsoDate
  personIds: string[]
  /** Ziel oder Anlass, z. B. „Gardasee“. */
  title?: string
  note?: string
  createdAt: string
  updatedAt: string
  updatedBy?: string
}

/** Ausgleichszahlung zwischen zwei Personen. */
export interface Payment {
  id: string
  date: IsoDate
  fromPersonId: string
  toPersonId: string
  amountCents: number
  note?: string
  createdAt: string
  updatedAt: string
  updatedBy?: string
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
  paidBy?: string
  /** Bei auf Monate verteilten Kosten: Teil x von n. */
  spread?: { index: number; of: number }
}

export interface Setting {
  /** Schlüssel der Einstellung, z. B. "lastBackupAt". */
  id: string
  value: unknown
}

/** Festgeschriebene Abrechnung: Ergebnis und Namen zum Zeitpunkt des Abschlusses. */
export interface SettlementSnapshot {
  id: string
  title: string
  period: PeriodSpec
  costPeriod?: PeriodSpec
  /** Namen zum Zeitpunkt des Abschlusses (Personen können später umbenannt werden). */
  personNames: Record<string, string>
  categoryNames: Record<string, string>
  /** Vollständiges Berechnungsergebnis (JSON-serialisiert). */
  result: unknown
  createdAt: string
  createdBy?: string
  updatedAt: string
}
