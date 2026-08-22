/**
 * DataPipe logo mark -- the R/base pipe operator `|>` rendered as pure
 * geometry: one vertical bar plus an open chevron, echoed by a second,
 * lighter chevron. Geometry is canonical (104x104 grid) per
 * docs/brand/logo/README.md ("direction 3b / Echo") -- the path data below
 * is the source of truth, do not redraw by eye or otherwise adjust it.
 *
 * Two invariants that must survive any resize or recolor:
 *  1. The chevrons are NEVER filled. Each is drawn as two strokes
 *     (fill="none") -- a solid triangle reads as a play button.
 *  2. The bar overshoots the chevrons top and bottom (y 12->92 vs the
 *     chevrons' y 26->78, ~14 units each end). This matches how `|` sits
 *     taller than `>` in a monospace font -- never align the bar's edges to
 *     the chevrons'.
 *
 * @param {number} [size=104] - Rendered height in px. Width scales 1:1 since
 *   the mark is drawn on a square grid.
 * @param {string} [color="currentColor"] - Color for the bar and the first
 *   chevron. Defaults to currentColor so the mark inherits the surrounding
 *   text color (the mark-mono.svg pattern) -- pass an explicit value where
 *   inheritance is fragile (e.g. across a font/className boundary).
 * @param {string} [echoColor="#8BC34A"] - Color for the second, echoed
 *   chevron. This green is deliberately the SAME value in light and dark
 *   modes per the brand handoff -- it's the only tone that holds contrast
 *   against both #FFFFFF and dark surfaces (#101A14). Do not theme this
 *   value or otherwise vary it by color mode.
 */
export default function LogoMark({
  size = 104,
  color = "currentColor",
  echoColor = "#8BC34A",
  ...props
}) {
  // Decorative (aria-hidden, no role): the visible wordmark beside the mark
  // carries the name, so the SVG is hidden from assistive tech rather than
  // announced twice.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 104 104"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="10" y="12" width="10" height="80" rx="1" fill={color} />
      {/* The dp-logo-chevron-* classes are animation hooks only (see
          globals.css "logo emit"): a wrapping .dp-logo-link animates the
          chevrons out of the bar on hover/focus. Purely additive -- the
          mark renders identically wherever those rules are absent. */}
      <path
        className="dp-logo-chevron-1"
        d="M32 26 L62 52 L32 78"
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
      <path
        className="dp-logo-chevron-2"
        d="M62 26 L92 52 L62 78"
        fill="none"
        stroke={echoColor}
        strokeWidth="10"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
    </svg>
  );
}
