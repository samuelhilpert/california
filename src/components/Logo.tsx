import { BusMark } from './BusMark'

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-50 to-accent-100 shadow-sm ring-1 ring-black/5">
        <BusMark className="w-8" />
      </div>
      <div className="leading-tight">
        <div className="font-display text-[15px] font-bold text-slate-900">California</div>
        <div className="text-xs text-slate-500">Fahrtenbuch & Abrechnung</div>
      </div>
    </div>
  )
}
