export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-on-brand shadow-sm">
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden>
          <path d="M5 21v-7a3 3 0 0 1 3-3h11l4.5 4.5H25a2 2 0 0 1 2 2V21" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="10" cy="22" r="2.4" fill="currentColor" />
          <circle cx="22" cy="22" r="2.4" fill="currentColor" />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-900">VW California</div>
        <div className="text-xs text-slate-500">Fahrtenbuch & Abrechnung</div>
      </div>
    </div>
  )
}
