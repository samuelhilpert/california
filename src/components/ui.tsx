import { clsx } from 'clsx'
import { X, Search, Info, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'

// ---------------------------------------------------------------- Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost'
type Size = 'sm' | 'md' | 'icon'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={clsx(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
          size === 'md' && 'h-10 px-4 text-sm',
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'icon' && 'h-9 w-9',
          variant === 'primary' && 'bg-brand-700 text-on-brand shadow-sm hover:bg-brand-800',
          variant === 'secondary' && 'border border-slate-200 bg-surface text-slate-700 shadow-sm hover:bg-slate-50',
          variant === 'ghost' && 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          variant === 'danger' && 'bg-red-600 text-white shadow-sm hover:bg-red-700',
          variant === 'danger-ghost' && 'text-slate-500 hover:bg-red-50 hover:text-red-600',
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    )
  },
)

// ---------------------------------------------------------------- Field
export function Field({ label, error, hint, children, className, htmlFor, optional }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; optional?: boolean }) {
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
        {optional && <span className="ml-1 font-normal text-slate-500">(optional)</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}

const inputBase =
  'w-full rounded-lg border bg-surface px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600 disabled:bg-slate-50 disabled:text-slate-500'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; suffix?: string }>(function Input(
  { invalid, className, suffix, ...rest },
  ref,
) {
  const el = <input ref={ref} className={clsx(inputBase, 'h-10', invalid ? 'border-red-400' : 'border-slate-200', suffix && 'pr-10', className)} aria-invalid={invalid || undefined} {...rest} />
  if (!suffix) return el
  return (
    <div className="relative">
      {el}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">{suffix}</span>
    </div>
  )
})

export function Textarea({ invalid, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={clsx(inputBase, 'min-h-20 py-2', invalid ? 'border-red-400' : 'border-slate-200', className)} {...rest} />
}

export function Select({ invalid, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={clsx(inputBase, 'h-10 pr-8', invalid ? 'border-red-400' : 'border-slate-200', className)} {...rest}>
      {children}
    </select>
  )
}

export function SearchInput({ value, onChange, placeholder = 'Suchen …', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={clsx(inputBase, 'h-10 border-slate-200 pl-9')}
      />
    </div>
  )
}

// ---------------------------------------------------------------- Layout-Bausteine
export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={clsx('min-w-0 rounded-xl border border-slate-200 bg-surface shadow-sm', padded && 'p-5', className)}>{children}</section>
}

export function CardTitle({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{children}</h2>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{label}</span>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>
      <div className="tabular text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </Card>
  )
}

export function Badge({ children, tone = 'slate', className }: { children: ReactNode; tone?: 'slate' | 'brand' | 'amber' | 'red' | 'green' | 'blue'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'slate' && 'bg-slate-100 text-slate-700',
        tone === 'brand' && 'bg-brand-50 text-brand-800 ring-1 ring-inset ring-brand-200',
        tone === 'amber' && 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
        tone === 'red' && 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
        tone === 'green' && 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
        tone === 'blue' && 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Notice({ level = 'info', children, title }: { level?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode; title?: string }) {
  const Icon = level === 'error' ? AlertCircle : level === 'warning' ? AlertTriangle : level === 'success' ? CheckCircle2 : Info
  return (
    <div
      className={clsx(
        'flex gap-3 rounded-lg border px-4 py-3 text-sm',
        level === 'info' && 'border-blue-200 bg-blue-50 text-blue-900',
        level === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        level === 'error' && 'border-red-200 bg-red-50 text-red-900',
        level === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
      )}
      role={level === 'error' ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        {title && <div className="font-medium">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  )
}

/** Horizontaler Anteilsbalken. */
export function Bar({ value, max, color = 'var(--color-brand-600)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

// ---------------------------------------------------------------- Modal
/** Offene Dialoge; Escape schließt nur den obersten. */
const modalStack: string[] = []

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  // onClose ist oft eine Inline-Funktion. Über eine Ref wird verhindert, dass der Effekt bei jedem
  // Neu-Rendern (z. B. durch Echtzeit-Änderungen anderer Mitglieder) erneut läuft und den Fokus stiehlt.
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    modalStack.push(titleId)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack.at(-1) === titleId) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button:not([data-close])')
      first?.focus()
    }, 10)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      const i = modalStack.lastIndexOf(titleId)
      if (i >= 0) modalStack.splice(i, 1)
      if (modalStack.length === 0) document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, titleId])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Schließen" data-close>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
