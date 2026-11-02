import { createContext, useContext, type ReactNode } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ConfirmOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ToastAction {
  label: string
  onClick: () => void | Promise<void>
}

interface FeedbackApi {
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

export const FeedbackContext = createContext<FeedbackApi | null>(null)

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback muss innerhalb von FeedbackProvider verwendet werden')
  return ctx
}

/** Wandelt beliebige Fehler in eine verständliche Meldung um. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'QuotaExceededError') return 'Der Browser-Speicher ist voll. Bitte ein Backup erstellen und Speicher freigeben.'
    if ((err as { code?: string }).code === 'permission-denied') return 'Keine Berechtigung – bitte neu anmelden oder von einem Mitglied freischalten lassen.'
    return err.message
  }
  return 'Unbekannter Fehler'
}
