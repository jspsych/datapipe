// Three hand-authored 24px stroke icons, one per step in the landing page's
// "Three steps to start collecting data" section.
//
// WHY HAND-AUTHORED RATHER THAN lucide-react. The set has to read as one
// drawing: same 24 grid, same 1.75 stroke, same round caps and joins, same
// optical weight at 24px. Picking three lucide glyphs (`Link2`, `MousePointer
// Click`, `Container`) gets three different densities -- lucide's cursor is a
// four-path glyph and its container is a two-path box -- and the row reads as
// three icons rather than as one family. Three shapes this simple are cheaper
// to draw than to reconcile, and they add nothing to the bundle.
//
// EACH ICON IS DECORATION, NOT INFORMATION. Every step carries a visible text
// label ("1. Connect", "2. Create", "3. Collect") next to its icon, so these
// are `aria-hidden` and WCAG 1.4.11 does not apply to them (they are not
// "graphical objects required to understand the content" -- DESIGN.md §5's
// "status is never icon-alone" rule is satisfied by the label, not by the
// icon). They still render at `brandGreen.fg` -- #81C784, 8.78:1 on the
// steps section's `bg.subtle` ground -- which is well past any floor they
// could be held to. These three glyphs plus the two CTA buttons and the
// prose links are the whole of the page's green (see the GREEN BUDGET note
// at the top of pages/index.js).
//
// The stroke is 1.75: 1.5 goes thin and grey-ish against 16px/600 label text
// at this size, and 2 makes a 24px glyph read as a filled blob once the
// counters close up. `fill="none"` on the root plus `stroke="currentColor"`
// means the caller sets one `color` and everything follows.

const BASE = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
  focusable: "false",
};

// Step 1 -- connect. Two nodes joined: o—o. The literal picture of "connect a
// storage provider to your DataPipe account", and the only one of the three
// that has an unambiguous conventional form.
export function ConnectIcon(props) {
  return (
    <svg {...BASE} {...props}>
      <circle cx="5.25" cy="12" r="3" />
      <circle cx="18.75" cy="12" r="3" />
      <path d="M8.25 12h7.5" />
    </svg>
  );
}

// Step 2 -- create. An arrow cursor with a small plus: click the button, get a
// new experiment.
//
// A sparkle/star was the other candidate and was rejected on register: in 2026
// a sparkle reads "AI generated this", which is exactly the association
// PRODUCT.md's anti-references rule out on a page whose whole job is to be
// trusted with someone's data. A cursor plus a plus sign says "you make a new
// one" with no such freight.
export function CreateIcon(props) {
  return (
    <svg {...BASE} {...props}>
      <path d="M5.5 3.75v13.1l3.3-3.3 2 4.7 2.2-.95-1.95-4.5 4.6-.35z" />
      <path d="M19 4v4" />
      <path d="M17 6h4" />
    </svg>
  );
}

// Step 3 -- collect. A bucket with something dropping into it: each
// participant's data lands in your storage as they finish. The bucket alone
// read as a generic container, so the arrow carries the "as they arrive" half
// of the sentence.
export function CollectIcon(props) {
  return (
    <svg {...BASE} {...props}>
      <path d="M12 2.75v4" />
      <path d="M9.6 4.4 12 6.8l2.4-2.4" />
      <path d="M4.5 9.75h15l-1.35 9.1a1.6 1.6 0 0 1-1.58 1.4H7.43a1.6 1.6 0 0 1-1.58-1.4z" />
    </svg>
  );
}
