import { clsx } from 'clsx'
import { LayoutDashboard, Route, Receipt, Scale, Users, Database } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Start', icon: LayoutDashboard, end: true },
  { to: '/fahrten', label: 'Fahrtenbuch', short: 'Fahrten', icon: Route },
  { to: '/kosten', label: 'Kosten', short: 'Kosten', icon: Receipt },
  { to: '/abrechnung', label: 'Abrechnung', short: 'Abrechnung', icon: Scale },
  { to: '/personen', label: 'Personen', short: 'Personen', icon: Users },
  { to: '/daten', label: 'Import & Backup', short: 'Daten', icon: Database },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white shadow-sm">
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

export function Layout() {
  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop-Seitenleiste */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="px-5 py-5"><Logo /></div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              <n.icon className="h-[18px] w-[18px]" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-5 py-4 text-xs leading-relaxed text-slate-500">
          Daten werden nur lokal in diesem Browser gespeichert. Regelmäßig ein Backup erstellen.
        </div>
      </aside>

      {/* Mobile Kopfzeile */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
        <Outlet />
      </main>

      {/* Mobile Navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Hauptnavigation">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => clsx('flex flex-col items-center gap-1 py-2 text-[10px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}
          >
            <n.icon className="h-5 w-5" />
            <span className="truncate">{n.short}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
