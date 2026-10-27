import { clsx } from 'clsx'
import { useState } from 'react'
import { LayoutDashboard, Route, Receipt, Scale, Users, Database, Settings, MoreHorizontal, Cloud, CloudOff, RefreshCw, X } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useSession, useSyncStatus } from '../lib/store/context'
import { Logo } from './Logo'

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Start', icon: LayoutDashboard, end: true, main: true },
  { to: '/fahrten', label: 'Fahrtenbuch', short: 'Fahrten', icon: Route, main: true },
  { to: '/kosten', label: 'Kosten', short: 'Kosten', icon: Receipt, main: true },
  { to: '/abrechnung', label: 'Abrechnung', short: 'Abrechnung', icon: Scale, main: true },
  { to: '/personen', label: 'Personen', short: 'Personen', icon: Users },
  { to: '/daten', label: 'Import & Backup', short: 'Daten', icon: Database },
  { to: '/einstellungen', label: 'Einstellungen', short: 'Einstellungen', icon: Settings },
]

export function SyncBadge() {
  const s = useSyncStatus()
  if (!s.online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200" title="Änderungen werden lokal gespeichert und automatisch übertragen, sobald wieder eine Verbindung besteht.">
        <CloudOff className="h-3.5 w-3.5" /> Offline{s.pendingWrites ? ' · Änderungen ausstehend' : ''}
      </span>
    )
  }
  if (s.pendingWrites) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Wird synchronisiert …
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-slate-500" title="Alle Änderungen sind gespeichert und für alle Mitglieder sichtbar.">
      <Cloud className="h-3.5 w-3.5" /> Synchronisiert
    </span>
  )
}

export function Layout() {
  const { userEmail } = useSession()
  const [more, setMore] = useState(false)
  const location = useLocation()
  const mainNav = NAV.filter((n) => n.main)
  const moreNav = NAV.filter((n) => !n.main)
  const moreActive = moreNav.some((n) => location.pathname.startsWith(n.to))

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">Zum Inhalt springen</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-surface lg:flex">
        <div className="px-5 py-5"><Logo /></div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
              <n.icon className="h-[18px] w-[18px]" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-slate-100 px-5 py-4">
          <SyncBadge />
          <div className="truncate text-xs text-slate-500" title={userEmail}>{userEmail}</div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <SyncBadge />
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
        <Outlet />
      </main>

      {more && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Weitere Bereiche">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900">Weitere Bereiche</span>
              <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={() => setMore(false)} aria-label="Schließen"><X className="h-5 w-5" /></button>
            </div>
            {moreNav.map((n) => (
              <NavLink key={n.to} to={n.to} onClick={() => setMore(false)} className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50')}>
                <n.icon className="h-5 w-5" /> {n.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Hauptnavigation">
        {mainNav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex flex-col items-center gap-1 py-2 text-[11px] font-medium', isActive ? 'text-brand-700' : 'text-slate-500')}>
            <n.icon className="h-5 w-5" />
            <span className="truncate">{n.short}</span>
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className={clsx('flex flex-col items-center gap-1 py-2 text-[11px] font-medium', moreActive ? 'text-brand-700' : 'text-slate-500')} aria-haspopup="dialog">
          <MoreHorizontal className="h-5 w-5" />
          <span>Mehr</span>
        </button>
      </nav>
    </div>
  )
}
