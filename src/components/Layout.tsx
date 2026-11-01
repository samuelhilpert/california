import { clsx } from 'clsx'
import { LayoutDashboard, Route, Receipt, Scale, Settings, Sparkles, Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useProMode, useSession, useSyncStatus } from '../lib/store/context'
import { Logo } from './Logo'

/** Vier Hauptbereiche plus Einstellungen. Personen und Backup & Export sind Unterseiten der Einstellungen. */
interface NavItem { to: string; label: string; short: string; icon: typeof Settings; end?: boolean; also?: string[] }

const NAV: NavItem[] = [
  { to: '/', label: 'Übersicht', short: 'Start', icon: LayoutDashboard, end: true },
  { to: '/fahrten', label: 'Fahrtenbuch', short: 'Fahrten', icon: Route },
  { to: '/kosten', label: 'Kosten', short: 'Kosten', icon: Receipt },
  { to: '/abrechnung', label: 'Abrechnung', short: 'Abrechnung', icon: Scale },
  { to: '/einstellungen', label: 'Einstellungen', short: 'Mehr', icon: Settings, also: ['/personen', '/daten'] },
]
/** Nur im Pro-Modus: Statistik, Karte, Rückblick. */
const PRO_ITEM: NavItem = { to: '/pro', label: 'Entdecken', short: 'Pro', icon: Sparkles, also: ['/pro/'] }

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
  const location = useLocation()
  const [pro] = useProMode()
  const nav = pro ? [...NAV.slice(0, 4), PRO_ITEM, NAV[4]] : NAV
  // Unterseiten (z. B. Personen) markieren ihren übergeordneten Menüpunkt mit.
  const subActive = (n: NavItem) => !!n.also?.some((p) => location.pathname.startsWith(p))

  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">Zum Inhalt springen</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-surface lg:flex">
        <div className="px-5 py-5"><Logo /></div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Hauptnavigation">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive || subActive(n) ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
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

      <nav className={clsx('fixed inset-x-0 bottom-0 z-30 grid border-t', pro ? 'grid-cols-6' : 'grid-cols-5', 'border-slate-200 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden')} aria-label="Hauptnavigation">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx('flex flex-col items-center gap-1 py-2 text-[11px] font-medium', isActive || subActive(n) ? 'text-brand-700' : 'text-slate-500')}>
            <n.icon className="h-5 w-5" />
            <span className="truncate">{n.short}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
