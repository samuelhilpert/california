import type { Person } from './domain/types'

/**
 * Feste Farbe je Person (Reihenfolge des Anlegens). Die Farbe hängt an der Person, nicht an ihrer
 * Position in einer Liste – Filtern oder Sortieren färbt nichts um. Palette: farbenblind-geprüft,
 * hell und dunkel getrennt abgestimmt (siehe --color-person-* in index.css).
 */
const SLOTS = 8

export function personSlot(persons: Person[], id: string): number {
  const ordered = [...persons].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1))
  const i = ordered.findIndex((p) => p.id === id)
  return i < 0 ? 0 : (i % SLOTS) + 1
}

export const personColor = (slot: number) => (slot > 0 ? `var(--color-person-${slot})` : 'var(--color-slate-400)')
