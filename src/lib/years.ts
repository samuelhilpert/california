import { todayIso } from './domain/dates'

/** Alle Jahre, in denen Fahrten oder Kosten vorkommen, plus das aktuelle Jahr. */
export function collectYears(dates: string[]): number[] {
  const set = new Set<number>([Number(todayIso().slice(0, 4))])
  for (const d of dates) if (d) set.add(Number(d.slice(0, 4)))
  return [...set].sort((a, b) => a - b)
}
