# Handoff: DataPipe logo (pipe.jspsych.org)

## Overview
Identity for **DataPipe**, the data-collection service at pipe.jspsych.org. The mark is the R/base pipe
operator `|>` rendered as pure geometry: one vertical bar plus an open chevron, with an echoed second
chevron in a lighter green. It exists as a horizontal lockup (mark + wordmark), a square icon tile, and
favicon-optimised reductions.

The selected direction is **3b (Echo)**. Earlier explorations (turns 1–3) remain in the design file for
context but are **not** part of this handoff — implement 3b only.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing intended look and
behaviour, not production code to copy directly. The task is to **recreate the mark in the target
environment** (mkdocs theme, React site, README, etc.) using its established patterns. The SVGs in
`assets/` ARE production-ready and can ship as-is; the `.dc.html` file is a presentation board only.

## Fidelity
**High-fidelity.** Colours, geometry and proportions are final. All SVG path data below is the source of
truth — do not re-draw by eye.

## The mark

### Geometry (canonical 104 × 104 grid)
Every element is a stroke or rect at a **single shared weight of 10 units**. Never mix weights.

| Element | Path / rect | Notes |
| --- | --- | --- |
| Bar (`\`|\``) | `<rect x="10" y="12" width="10" height="80" rx="1">` | Spans y 12→92 |
| Chevron 1 (`>`) | `M32 26 L62 52 L32 78` | Spans y 26→78 |
| Chevron 2 (echo) | `M62 26 L92 52 L62 78` | Starts exactly where chevron 1 apex lands |

Stroke attributes on both chevrons: `stroke-width="10"`, `stroke-linecap="square"`,
`stroke-linejoin="round"`, `fill="none"`.

**Two rules that must survive any resize:**
1. **The chevron is never filled.** A solid triangle reads as a play button. It is two strokes, always.
2. **The bar overshoots the chevrons** top and bottom (y 12→92 vs 26→78, ≈ 14 units each end). This
   matches how `|` sits taller than `>` in a monospace font. Do not align them.

### Colour
| Role | Light bg | Dark bg |
| --- | --- | --- |
| Bar + chevron 1 | `#2E7D32` | `#F2F5F1` |
| Chevron 2 (echo) | `#8BC34A` | `#8BC34A` |
| Inside a green tile | `#FFFFFF` bar/chevron 1, `#A5D66A` echo | — |

The echo green `#8BC34A` is deliberately the **same value in both modes** — it is the only tone that holds
contrast against both `#FFFFFF` and `#101A14`. Do not darken it for light mode.

## Lockup
Horizontal only. Mark on the left, two-line text block on the right, `gap: 24px`, vertically centred.

- Line 1 — wordmark: `DataPipe`, Space Grotesk 600, `font-size: 34px`, `letter-spacing: -0.03em`,
  `line-height: 1`, colour `#16211B` (light) / `#F2F5F1` (dark).
- Line 2 — URL: `pipe.jspsych.org`, IBM Plex Mono 400, `font-size: 12px`, `letter-spacing: 0.04em`,
  colour `#6B7A70` (light) / `#8FA294` (dark).
- Gap between the two lines: `3px`.
- Mark height = 104px at this wordmark size; scale the pair together.

Clear space: **one bar-width (10 units at 104 grid ≈ 10% of mark height)** on all sides.

## Icon tile (96 × 96 grid)
`rx="14"` (`rx="12"` at 32px, `rx="8"` at 16px). Bar `x=14 y=16 w=11 h=64`; chevron 1
`M36 24 L60 48 L36 72`; chevron 2 `M60 24 L84 48 L60 72`; stroke-width 11.

Variants shipped: `icon-tile-light` (green fill), `icon-tile-dark` (`#1C2A22` fill),
`icon-tile-outline` (`#3A4C41` 5px frame, no fill).

## Reductions — IMPORTANT
The mark is **not** uniformly scaled for favicons. Optical corrections:

- **32px** (`favicon-32.svg`): stroke 12, chevrons widened to `M37 23 L61 48 L37 73` and
  `M61 23 L85 48 L61 73`. The notch must stay ≥ 2× stroke width or it fills in.
- **16px** (`favicon-16.svg`): **chevron 1 is dropped entirely.** Bar `x=18 y=14 w=14 h=68` plus a single
  green chevron `M44 20 L74 48 L44 76` at stroke 14. Two chevrons mush at this size.

Ship the 16px asset for `≤ 20px` and the 32px asset for `21–48px`; above that, use the full tile.

## Optional animation (site header only)
An earlier direction (3c) pulses an orange `#FB8C00` dot clearing the chevron apex, 2.2s ease-in-out,
opacity 0.25 → 1 → 0.25. **Not part of 3b** — implement only if asked. If any animation is added, respect
`prefers-reduced-motion: reduce` and fall back to the static mark.

## Design tokens
```
--dp-green:        #2E7D32   /* primary — matches jsPsych docs Material green */
--dp-green-mid:    #43A047   /* used in earlier explorations, not in 3b */
--dp-green-light:  #8BC34A   /* the echo chevron; identical in light + dark */
--dp-green-tile:   #A5D66A   /* echo when knocked out of a solid green tile */
--dp-ink:          #16211B   /* wordmark on light */
--dp-ink-deep:     #101A14   /* dark-mode page background */
--dp-tile-dark:    #1C2A22   /* dark-mode icon tile fill */
--dp-paper:        #F2F5F1   /* mark + wordmark on dark */
--dp-muted:        #6B7A70   /* URL line on light */
--dp-muted-dark:   #8FA294   /* URL line on dark */
--dp-rule-dark:    #3A4C41   /* outline-tile stroke */
--dp-accent:       #FB8C00   /* animation dot only */

stroke-weight:  10 / 104 grid  (11 / 96 tile, 12 @32px, 14 @16px)
radius:         14 / 96 tile   (12 @32px, 8 @16px)
```

Typography: **Space Grotesk** 600 (wordmark), **IBM Plex Mono** 400/500 (URL, code voice). Both Google Fonts.

## Assets
`assets/` — eight standalone SVGs, no external deps, no embedded fonts (the wordmark is live text, not
outlines, so set it in HTML/CSS rather than baking it into the SVG). `mark-mono.svg` uses
`currentColor` for single-colour contexts (paper figures, laser-cut stickers, favicons in mask mode).

## Files
- `assets/*.svg` — production assets, ship these.
- `DataPipe Logo.dc.html` — the full exploration board (turns 1–3). Reference only; open in a browser.
