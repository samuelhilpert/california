import { lazy, Suspense, type ReactNode } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { FeedbackProvider } from './components/FeedbackProvider'
import { AuthGate } from './components/AuthGate'
import { Loading } from './components/Loading'
import { DashboardPage } from './pages/Dashboard'
import { NotFound } from './pages/NotFound'

// Seiten mit Excel-Funktionen werden erst bei Bedarf geladen (SheetJS ist groß).
const TripsPage = lazy(() => import('./pages/Trips').then((m) => ({ default: m.TripsPage })))
const ExpensesPage = lazy(() => import('./pages/Expenses').then((m) => ({ default: m.ExpensesPage })))
const SettlementPage = lazy(() => import('./pages/Settlement').then((m) => ({ default: m.SettlementPage })))
const PeoplePage = lazy(() => import('./pages/People').then((m) => ({ default: m.PeoplePage })))
const DataPage = lazy(() => import('./pages/Data').then((m) => ({ default: m.DataPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))

const page = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>

export default function App() {
  return (
    <FeedbackProvider>
      <AuthGate>
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="fahrten" element={page(<TripsPage />)} />
              <Route path="kosten" element={page(<ExpensesPage />)} />
              <Route path="abrechnung" element={page(<SettlementPage />)} />
              <Route path="personen" element={page(<PeoplePage />)} />
              <Route path="daten" element={page(<DataPage />)} />
              <Route path="einstellungen" element={page(<SettingsPage />)} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </HashRouter>
      </AuthGate>
    </FeedbackProvider>
  )
}
