import { clsx } from 'clsx'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from './ui'
import { FeedbackContext, type ConfirmOptions, type ToastTone } from './feedback-context'

interface Toast { id: number; message: string; tone: ToastTone }

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const seq = useRef(0)

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...opts, resolve })), [])
  const close = useCallback((v: boolean) => {
    setConfirmState((s) => {
      s?.resolve(v)
      return null
    })
  }, [])
  const cancel = useCallback(() => close(false), [close])

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <Modal
        open={confirmState != null}
        onClose={cancel}
        title={confirmState?.title ?? ''}
        footer={
          <>
            <Button onClick={cancel}>{confirmState?.cancelLabel ?? 'Abbrechen'}</Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
              {confirmState?.confirmLabel ?? 'Bestätigen'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-slate-600">{confirmState?.message}</div>
      </Modal>
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:px-6" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.tone === 'error' ? AlertCircle : t.tone === 'info' ? Info : CheckCircle2
          return (
            <div
              key={t.id}
              className={clsx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg',
                t.tone === 'error' ? 'border-red-200' : 'border-slate-200',
              )}
              role={t.tone === 'error' ? 'alert' : 'status'}
            >
              <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', t.tone === 'error' ? 'text-red-600' : t.tone === 'info' ? 'text-blue-600' : 'text-emerald-600')} />
              <span className="flex-1 text-slate-800">{t.message}</span>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Meldung schließen">
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </FeedbackContext.Provider>
  )
}
