export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'theme'

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* Speicher nicht verfügbar */
  }
  return 'system'
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  // Übergangsanimationen beim Wechsel kurz abschalten – sonst blenden alle Farben einzeln über
  const style = document.createElement('style')
  style.textContent = '*,*::before,*::after{transition:none!important}'
  document.head.appendChild(style)
  document.documentElement.classList.toggle('dark', dark)
  void getComputedStyle(document.body).color
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()))
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#0f766e')
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* ignorieren */
  }
  applyTheme(pref)
}

/** Reagiert auf Wechsel des System-Designs, wenn „System“ gewählt ist. */
export function watchSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const fn = () => getThemePref() === 'system' && applyTheme('system')
  mq.addEventListener('change', fn)
  return () => mq.removeEventListener('change', fn)
}
