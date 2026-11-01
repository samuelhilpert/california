import { clsx } from 'clsx'
import { useAppData } from '../lib/store/context'
import { personColor, personSlot } from '../lib/personColors'

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase()
}

/**
 * Personenkreis. Klein (xs/sm): reiner Farbpunkt – der Name steht daneben. Groß (md/lg): zart
 * eingefärbt mit farbigem Ring und dunklen Initialen (gut lesbar, Farbe bleibt erkennbar).
 */
export function PersonAvatar({ id, name, size = 'md', className }: { id: string; name: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  const color = personColor(personSlot(useAppData().persons, id))
  if (size === 'xs' || size === 'sm') {
    return <span aria-hidden className={clsx('inline-block shrink-0 rounded-full', size === 'xs' ? 'h-2 w-2' : 'h-2.5 w-2.5', className)} style={{ background: color }} />
  }
  return (
    <span
      aria-hidden
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-slate-900', size === 'md' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm', className)}
      style={{ background: `color-mix(in srgb, ${color} 20%, var(--color-surface))`, boxShadow: `inset 0 0 0 2px ${color}` }}
    >
      {initials(name)}
    </span>
  )
}

/** Name mit kleinem Farbkreis – für Listen und Fahrten. */
export function PersonChip({ id, label, className }: { id: string; label?: string; className?: string }) {
  const { persons } = useAppData()
  const name = persons.find((p) => p.id === id)?.name ?? 'Unbekannt'
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-2 pr-2.5 text-xs font-medium text-slate-700', className)}>
      <PersonAvatar id={id} name={name} size="sm" />
      {label ?? name}
    </span>
  )
}
