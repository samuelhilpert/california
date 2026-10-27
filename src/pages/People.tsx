import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2, UserCheck, UserX, Users } from 'lucide-react'
import { useAppData } from '../lib/store/context'
import { addPerson, deletePerson, renamePerson, restoreRecord, setPersonActive } from '../lib/store/repo'
import { buildSettlement } from '../lib/domain/settlement'
import { todayIso } from '../lib/domain/dates'
import type { Person } from '../lib/domain/types'
import { formatEuro, formatKm } from '../lib/format'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader } from '../components/ui'
import { Loading } from '../components/Loading'
import { errorMessage, useFeedback } from '../components/feedback-context'

export function PeoplePage() {
  const data = useAppData()
  const { toast, confirm } = useFeedback()
  const [name, setName] = useState('')
  const [addError, setAddError] = useState<string>()
  const [renaming, setRenaming] = useState<Person | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string>()
  const today = todayIso()

  const s = useMemo(() => (data ? buildSettlement(data, { period: { kind: 'all' }, today }) : undefined), [data, today])
  if (!data || !s) return <Loading />

  const usage = (id: string) => ({
    trips: data.trips.filter((t) => t.personIds.includes(id)).length,
    expenses: data.expenses.filter((e) => e.directPersonIds?.includes(id) || e.paidBy === id).length,
    payments: data.payments.filter((p) => p.fromPersonId === id || p.toPersonId === id).length,
  })
  const active = data.persons.filter((p) => p.active)
  const inactive = data.persons.filter((p) => !p.active)

  const add = async () => {
    try {
      const p = await addPerson(name)
      setName('')
      setAddError(undefined)
      toast(`„${p.name}“ wurde hinzugefügt.`)
    } catch (e) {
      setAddError(errorMessage(e))
    }
  }
  const saveRename = async () => {
    if (!renaming) return
    try {
      await renamePerson(renaming.id, renameValue)
      toast('Name wurde geändert. Alle Fahrten bleiben zugeordnet.')
      setRenaming(null)
    } catch (e) {
      setRenameError(errorMessage(e))
    }
  }
  const toggleActive = async (p: Person) => {
    if (p.active) {
      const ok = await confirm({
        title: `${p.name} deaktivieren?`,
        message: 'Die Person wird bei neuen Fahrten nicht mehr zur Auswahl angeboten. Bestehende Fahrten und Abrechnungen bleiben vollständig erhalten.',
        confirmLabel: 'Deaktivieren',
      })
      if (!ok) return
    }
    await setPersonActive(p.id, !p.active)
    toast(p.active ? `${p.name} wurde deaktiviert.` : `${p.name} ist wieder aktiv.`)
  }
  const remove = async (p: Person) => {
    const ok = await confirm({ title: `${p.name} löschen?`, message: 'Die Person wird keiner Fahrt zugeordnet und kann daher endgültig gelöscht werden.', confirmLabel: 'Löschen', danger: true })
    if (!ok) return
    try {
      const removed = await deletePerson(p.id)
      toast(`${p.name} wurde gelöscht.`, 'success', { label: 'Rückgängig', onClick: async () => { await restoreRecord('persons', removed); toast(`${p.name} wurde wiederhergestellt.`) } })
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const renderList = (list: Person[]) => (
    <ul className="divide-y divide-slate-100">
      {list.map((p) => {
        const u = usage(p.id)
        const r = s.persons.find((x) => x.personId === p.id)
        const used = u.trips + u.expenses + u.payments > 0
        return (
          <li key={p.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${p.active ? 'bg-brand-50 text-brand-800' : 'bg-slate-100 text-slate-500'}`}>
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-slate-900">{p.name}{!p.active && <Badge>deaktiviert</Badge>}</div>
                <div className="text-xs text-slate-500">
                  {u.trips} Fahrt(en){u.expenses > 0 && ` · ${u.expenses} Ausgabe(n)`}{u.payments > 0 && ` · ${u.payments} Zahlung(en)`}
                  {r && ` · ${formatKm(r.km)} anteilig · ${formatEuro(r.totalCents)} gesamt`}
                </div>
              </div>
            </div>
            <div className="flex gap-1 sm:justify-end">
              <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => { setRenaming(p); setRenameValue(p.name); setRenameError(undefined) }}>Umbenennen</Button>
              <Button size="sm" variant="ghost" icon={p.active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />} onClick={() => void toggleActive(p)}>
                {p.active ? 'Deaktivieren' : 'Aktivieren'}
              </Button>
              {!used && <Button size="sm" variant="danger-ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => void remove(p)} aria-label={`${p.name} löschen`} />}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <>
      <PageHeader title="Personen" description="Fahrer und Mitfahrer. Jede Person hat eine feste ID – Umbenennen oder Deaktivieren verändert keine historischen Daten." />

      <Card className="mb-6">
        <form className="flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <div className="flex-1">
            <Input value={name} onChange={(e) => { setName(e.target.value); setAddError(undefined) }} placeholder="Name der neuen Person" aria-label="Name der neuen Person" invalid={!!addError} maxLength={60} />
            {addError && <p className="mt-1 text-xs text-red-600">{addError}</p>}
          </div>
          <Button type="submit" variant="primary" icon={<Plus className="h-4 w-4" />} disabled={!name.trim()}>Person hinzufügen</Button>
        </form>
      </Card>

      <Card padded={false} className="mb-6">
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">Aktiv ({active.length})</div>
        {active.length === 0 ? <EmptyState icon={<Users className="h-6 w-6" />} title="Keine aktiven Personen">Füge Personen hinzu oder importiere die Excel-Datei.</EmptyState> : renderList(active)}
      </Card>

      {inactive.length > 0 && (
        <Card padded={false}>
          <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">Deaktiviert ({inactive.length})</div>
          {renderList(inactive)}
        </Card>
      )}

      <Modal open={renaming != null} onClose={() => setRenaming(null)} title="Person umbenennen"
        footer={<><Button onClick={() => setRenaming(null)}>Abbrechen</Button><Button variant="primary" onClick={() => void saveRename()}>Speichern</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); void saveRename() }}>
          <Field label="Name" htmlFor="rename" error={renameError} hint="Alle bisherigen Fahrten bleiben dieser Person zugeordnet.">
            <Input id="rename" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} invalid={!!renameError} maxLength={60} />
          </Field>
        </form>
      </Modal>
    </>
  )
}
