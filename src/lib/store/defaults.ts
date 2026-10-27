import type { Category } from '../domain/types'

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'leasing', name: 'Leasingrate', builtin: true, color: '#0f766e' },
  { id: 'insurance', name: 'Versicherung', builtin: true, color: '#2563eb' },
  { id: 'fuel', name: 'Kraftstoff', builtin: true, color: '#d97706' },
  { id: 'maintenance', name: 'Wartung & Reparaturen', builtin: true, color: '#7c3aed' },
  { id: 'tax', name: 'Steuer', builtin: true, color: '#64748b' },
  { id: 'camping', name: 'Camping & Stellplätze', builtin: true, color: '#16a34a' },
  { id: 'other', name: 'Sonstige Fahrzeugkosten', builtin: true, color: '#db2777' },
]
