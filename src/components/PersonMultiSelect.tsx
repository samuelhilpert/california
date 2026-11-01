import { clsx } from 'clsx'
import { Check, Plus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import type { Person } from '../lib/domain/types'
import { addPerson } from '../lib/store/repo'
import { useMyPerson } from '../lib/store/context'
import { Button, Input } from './ui'
import { errorMessage, useFeedback } from './feedback-context'
import { PersonAvatar } from './Person'

/**
 * Mehrfachauswahl als Chips. Zeigt alle aktiven Personen sowie bereits ausgewählte, inzwischen
 * deaktivierte Personen (damit historische Zuordnungen sichtbar bleiben). Neue Personen können
 * direkt hier angelegt werden und sind sofort ausgewählt.
 */
export function PersonMultiSelect({ persons, value, onChange, invalid }: { persons: Person[]; value: string[]; onChange: (ids: string[]) => void; invalid?: boolean }) {
  const { toast } = useFeedback()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()

  const me = useMyPerson()
  // Mitglieder (mit Konto) zuerst, danach weitere Personen wie Gäste
  const visible = persons.filter((p) => p.active || value.includes(p.id)).sort((a, b) => Number(!a.email) - Number(!b.email))
  const unknownIds = value.filter((id) => !persons.some((p) => p.id === id))
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  const allActive = persons.filter((p) => p.active).map((p) => p.id)
  const allSelected = allActive.length > 0 && allActive.every((id) => value.includes(id))

  const create = async () => {
    try {
      const p = await addPerson(name)
      onChange([...value, p.id])
      toast(`„${p.name}“ wurde angelegt und ausgewählt.`)
      setName('')
      setAdding(false)
      setError(undefined)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className={clsx('rounded-lg border p-3', invalid ? 'border-red-400' : 'border-slate-200')}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Beteiligte Personen">
        {visible.map((p) => {
          const on = value.includes(p.id)
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => toggle(p.id)}
              aria-pressed={on}
              className={clsx(
                'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors',
                on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 bg-surface text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <PersonAvatar id={p.id} name={p.name} size="sm" />
              {p.name}
              {p.id === me?.id && <span className="text-xs font-normal text-slate-500">(du)</span>}
              {!p.active && <span className="text-xs font-normal text-slate-500">(inaktiv)</span>}
              {on && <Check className="h-3.5 w-3.5" aria-hidden />}
            </button>
          )
        })}
        {unknownIds.map((id) => (
          <button key={id} type="button" onClick={() => toggle(id)} className="inline-flex h-9 items-center rounded-full border border-red-200 bg-red-50 px-3 text-sm text-red-700">
            Unbekannte Person ✕
          </button>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-slate-300 px-3 text-sm text-slate-500 hover:border-brand-600 hover:text-brand-700"
          >
            <UserPlus className="h-3.5 w-3.5" /> Neue Person
          </button>
        )}
      </div>
      {visible.length === 0 && !adding && <p className="mt-2 text-sm text-slate-500">Noch keine Personen angelegt – lege die erste direkt hier an.</p>}
      {allActive.length > 1 && (
        <button type="button" className="mt-2 text-xs font-medium text-brand-700 hover:underline" onClick={() => onChange(allSelected ? value.filter((id) => !allActive.includes(id)) : [...new Set([...value, ...allActive])])}>
          {allSelected ? 'Auswahl aufheben' : 'Alle aktiven auswählen'}
        </button>
      )}
      {adding && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name der Person"
            invalid={Boolean(error)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void create()
              }
              if (e.key === 'Escape') {
                e.stopPropagation()
                setAdding(false)
              }
            }}
          />
          <div className="flex gap-2">
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => void create()} disabled={!name.trim()}>
              Anlegen
            </Button>
            <Button variant="ghost" onClick={() => { setAdding(false); setError(undefined) }}>Abbrechen</Button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
