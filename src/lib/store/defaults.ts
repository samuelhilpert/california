import type { Category } from '../domain/types'

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'leasing', name: 'Leasingrate', builtin: true, color: '#48484a' },
  { id: 'insurance', name: 'Versicherung', builtin: true, color: '#2563eb' },
  { id: 'fuel', name: 'Kraftstoff', builtin: true, color: '#d97706' },
  { id: 'maintenance', name: 'Wartung & Reparaturen', builtin: true, color: '#7c3aed' },
  { id: 'tax', name: 'Steuer', builtin: true, color: '#64748b' },
  { id: 'other', name: 'Sonstige Fahrzeugkosten', builtin: true, color: '#db2777' },
]

/** Frühere Standardfarben, die nicht mehr zum Design passen → aktuelle Farbe (nur Anzeige). */
const RETIRED_COLORS: Record<string, string> = { '#0f766e': '#48484a' }

/** Frühere Standardkategorien – gelten als eigene Kategorie und lassen sich löschen, sobald unbenutzt. */
const RETIRED_BUILTINS = new Set(['camping'])

/** Passt gespeicherte Kategorien an den aktuellen Stand an (nur Anzeige, ohne zu schreiben). */
export function normalizeCategory(c: Category): Category {
  if (!c.builtin) return c
  if (RETIRED_BUILTINS.has(c.id)) return { ...c, builtin: false }
  const next = RETIRED_COLORS[c.color.toLowerCase()]
  return next ? { ...c, color: next } : c
}
