import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App'
import { db } from './lib/db/db'

// Browser bitten, die Daten nicht automatisch zu löschen (z. B. bei Speichermangel).
if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined)

db.open().catch((err) => {
  const root = document.getElementById('root')!
  root.innerHTML = `<div style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:24px;border:1px solid #fecaca;background:#fef2f2;border-radius:12px;color:#7f1d1d">
    <h1 style="font-size:18px;margin:0 0 8px">Datenbank konnte nicht geöffnet werden</h1>
    <p style="margin:0;font-size:14px">Der Browser erlaubt keinen lokalen Speicher (z. B. im privaten Modus) oder die Datenbank ist blockiert. Bitte die Seite in einem normalen Fenster öffnen.</p>
    <p style="margin:12px 0 0;font-size:12px;color:#991b1b">${String(err?.message ?? err)}</p></div>`
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
