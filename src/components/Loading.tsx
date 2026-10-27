export function Loading() {
  return (
    <div className="flex items-center justify-center py-24 text-sm text-slate-500" role="status">
      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      Daten werden geladen …
    </div>
  )
}
