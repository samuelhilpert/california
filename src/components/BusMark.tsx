/**
 * Unser Bus als Bildmarke: der neue California (Beach) in Seitenansicht – Candy-Weiß mit
 * Grenadillschwarz oben, schwarze Markisenschiene und Felgen, dazu eine Linie in Sandwick-Gold.
 * Dieselbe Zeichnung erzeugt auch Favicon und App-Symbole (scripts/make-icons.mjs).
 */
export const BUS_SVG_INNER = `
  <defs><clipPath id="bus-body"><path d="M8 14c0-3.3 2.7-6 6-6h56.5c2.6 0 4.9 1.2 6.4 3.3l9.4 13c.9 1.3 2.3 2.1 3.9 2.3l8 1c3.3.4 5.8 3.2 5.8 6.5V40a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z"/></clipPath></defs>
  <path d="M8 14c0-3.3 2.7-6 6-6h56.5c2.6 0 4.9 1.2 6.4 3.3l9.4 13c.9 1.3 2.3 2.1 3.9 2.3l8 1c3.3.4 5.8 3.2 5.8 6.5V40a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#fbfbf9"/>
  <g clip-path="url(#bus-body)">
    <rect x="0" y="0" width="120" height="25.5" fill="#232325"/>
    <rect x="12.5" y="12" width="25" height="10.5" rx="2" fill="#4c4c50"/>
    <rect x="40.5" y="12" width="25.5" height="10.5" rx="2" fill="#4c4c50"/>
    <path d="M69 12h3.2c.9 0 1.8.4 2.3 1.2l6.6 9.3H69z" fill="#606065"/>
    <rect x="0" y="25.2" width="120" height="1.5" fill="#b5843f"/>
    <path d="M39 27.5v14" stroke="#d6d4ce" stroke-width="1"/>
    <rect x="96" y="29.5" width="6.5" height="2.3" rx="1.15" fill="#3a3a3c"/>
  </g>
  <path d="M8 14c0-3.3 2.7-6 6-6h56.5c2.6 0 4.9 1.2 6.4 3.3l9.4 13c.9 1.3 2.3 2.1 3.9 2.3l8 1c3.3.4 5.8 3.2 5.8 6.5V40a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="none" stroke="#1d1d1f" stroke-width="2"/>
  <rect x="12.5" y="5.8" width="54" height="2.6" rx="1.3" fill="#1d1d1f"/>
  <circle cx="26" cy="43" r="7.5" fill="#1d1d1f"/><circle cx="26" cy="43" r="3.2" fill="#c8c7c3"/>
  <circle cx="87" cy="43" r="7.5" fill="#1d1d1f"/><circle cx="87" cy="43" r="3.2" fill="#c8c7c3"/>
`
export const BUS_VIEWBOX = '0 0 112 52'

export function BusMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox={BUS_VIEWBOX} className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}
      dangerouslySetInnerHTML={{ __html: BUS_SVG_INNER }} />
  )
}
