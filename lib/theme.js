import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    slotRecipes: {
      menu: {
        base: {
          item: {
            cursor: "pointer",
          },
        },
      },
    },
    tokens: {
      colors: {
        greyBackground: { value: "#1C1F22" },
        brandOrange: {
          50: { value: "#FFF3E0" },
          100: { value: "#FFE0B2" },
          200: { value: "#FFCC80" },
          300: { value: "#FFB74D" },
          400: { value: "#FFA726" },
          500: { value: "#f78f1e" },
          600: { value: "#D4780A" },
          700: { value: "#A85F08" },
          800: { value: "#7C4606" },
          900: { value: "#3E2303" },
        },
        // The brand green, anchored to the logo (docs/brand/logo/README.md).
        // The mark's light-background green is #2E7D32 and its token sheet
        // names #43A047 as the mid step, which identifies the ramp as
        // Material Green: #2E7D32 is Material Green 800, #43A047 is 600. So
        // the whole 50-900 ramp below is Material Green verbatim, which means
        // every step is a real, hand-tuned tone rather than an interpolation
        // off a single brand hex, and the logo sits on the ramp at 800
        // instead of merely near it.
        brandGreen: {
          50: { value: "#E8F5E9" },
          100: { value: "#C8E6C9" },
          200: { value: "#A5D6A7" },
          300: { value: "#81C784" },
          400: { value: "#66BB6A" },
          500: { value: "#4CAF50" },
          600: { value: "#43A047" },
          700: { value: "#388E3C" },
          800: { value: "#2E7D32" },
          900: { value: "#1B5E20" },
        },
        brandLime: {
          50: { value: "#E0F2E8" },
          100: { value: "#B3DFC8" },
          200: { value: "#80CCA5" },
          300: { value: "#4DB982" },
          400: { value: "#26A069" },
          500: { value: "#006838" },
          600: { value: "#005A30" },
          700: { value: "#004825" },
          800: { value: "#00361B" },
          900: { value: "#001E0F" },
        },
        brandRed: {
          50: { value: "#FDE8E4" },
          100: { value: "#FACABB" },
          200: { value: "#F5A08E" },
          300: { value: "#F17761" },
          400: { value: "#EF5A3E" },
          500: { value: "#ee4523" },
          600: { value: "#D13A1B" },
          700: { value: "#A82E16" },
          800: { value: "#7F2310" },
          900: { value: "#4A1509" },
        },
      },
      // DESIGN.md §5 -- the app's only z-index scale. globals.css previously
      // had one arbitrary value (`z-index: 1000` on `.sticky-alert`); every
      // stacking need in the app maps onto one of these named layers.
      // docked/dropdown/sticky/banner/modal already match Chakra's own
      // defaultConfig z-index tokens (defined here anyway, for a single
      // source of truth the app is allowed to depend on). `toast` and
      // `tooltip` are intentionally lower than Chakra's stock 1700/1800, and
      // `modal.backdrop` (1300) is a DataPipe-specific name for what
      // Chakra's default calls `overlay`.
      zIndex: {
        docked: { value: 10 },
        dropdown: { value: 1000 },
        sticky: { value: 1100 },
        banner: { value: 1200 },
        modalBackdrop: { value: 1300 },
        modal: { value: 1400 },
        toast: { value: 1500 },
        tooltip: { value: 1600 },
      },
    },
    semanticTokens: {
      colors: {
        // DESIGN.md §1 Foreground. All three levels are computed to clear
        // 4.5:1 on every surface a body-text token is allowed to sit on
        // (worst case cited is `bg.muted`).
        fg: {
          // 13.16 light / 12.94 dark (on bg.muted). Dark is gray.50,
          // unchanged from today's forced-dark render.
          DEFAULT: { value: { _light: "#1C1F22", _dark: "{colors.gray.50}" } },
          // 8.30 light / 9.14 dark (on bg.muted). Dark moves off the old
          // gray.400 reading onto gray.300 -- the old value was never
          // computed against a real light/dark pair, just carried over.
          muted: { value: { _light: "{colors.gray.700}", _dark: "{colors.gray.300}" } },
          // 6.15 light / 5.27 dark (on bg.muted). gray.500 is retired as a
          // text color here -- it measured 3.43:1 on #1C1F22 and was the
          // source of the account page's SectionLabel failures.
          subtle: { value: { _light: "{colors.gray.600}", _dark: "{colors.gray.400}" } },
          inverted: { value: { _light: "{colors.black}", _dark: "{colors.black}" } },
        },
        // DESIGN.md §1 Surfaces. `bg` DEFAULT and `bg.panel` dark are
        // unchanged from today's forced #1C1F22 body; light is new.
        bg: {
          DEFAULT: { value: { _light: "#F5F7F8", _dark: "#1C1F22" } },
          // Recessed: code blocks, table headers.
          subtle: { value: { _light: "#EBEFF1", _dark: "#16191B" } },
          // Hover / selected fills. Dark matches the #2A2F34 reading this
          // file's brandGreen comments already measured against in advance
          // of this migration.
          muted: { value: { _light: "#E1E6E9", _dark: "#2A2F34" } },
          emphasized: { value: { _light: "{colors.gray.800}", _dark: "{colors.gray.800}" } },
          inverted: { value: { _light: "{colors.white}", _dark: "{colors.white}" } },
          // Cards, dialogs, menus. Dark stays flat (same as DEFAULT) --
          // delineated by `border`, not elevation. Page<->panel separation
          // is 1.07:1 in both modes by design; panels must carry a border.
          panel: { value: { _light: "#FFFFFF", _dark: "#1C1F22" } },
        },
        border: {
          // gray.500 both modes: 4.50 light / 3.43 dark vs `bg`. Inputs,
          // outline buttons, panel edges, table rules -- anything WCAG
          // 1.4.11 covers. Unchanged from today's dark reading; light is a
          // shared, deliberately identical value.
          DEFAULT: { value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
          // Decorative hairlines *inside* an already-grouped region only --
          // never the sole grouping device. 1.38 light / 1.68 dark vs `bg`.
          subtle: { value: { _light: "{colors.gray.300}", _dark: "#3F4449" } },
        },
        // The code specimen "device" (landing terminal mock, CodeBlock,
        // CodeHints). Deliberately MODE-INVARIANT: no _light/_dark split,
        // on purpose. The dark panel reads as a distinct object against the
        // light page (17.57:1 bg-vs-page), and every fg value below is
        // computed against code.bg #111111 (Chakra gray.950 -- NOT tailwind
        // zinc's #09090b) / code.bg.header #18181b, so one palette serves
        // both modes. Do not "fix" the invariance.
        code: {
          bg: {
            DEFAULT: { value: "{colors.gray.950}" }, // #111111 device surface
            header: { value: "{colors.gray.900}" }, // #18181b chrome strip
            active: { value: "{colors.gray.800}" }, // active tab fill; never the only cue
          },
          border: {
            // The seam where the invariant device meets the mode-aware page.
            // gray.500: 4.50:1 vs #F5F7F8 and 3.43:1 vs #1C1F22 -- one value
            // clears the 3:1 non-text floor in both modes.
            DEFAULT: { value: "{colors.gray.500}" },
            subtle: { value: "{colors.gray.800}" }, // hairline inside the device
          },
          fg: {
            DEFAULT: { value: "{colors.gray.300}" }, // 12.78:1 on code.bg
            strong: { value: "{colors.gray.50}" }, // 16.97:1 on header -- active tab label
            muted: { value: "{colors.gray.400}" }, // 7.37:1 code.bg / 6.91:1 header
          },
          comment: { value: "{colors.gray.400}" }, // 7.37:1 on code.bg
          string: { value: "{colors.brandOrange.300}" }, // 10.91:1 -- string literals only
          fn: { value: "{colors.brandGreen.300}" }, // 9.38:1 -- fn/plugin names, active-tab rule
        },
        // DESIGN.md §1 status aliases -- one green, no blue. Values mirror
        // each palette's fg slot so both modes stay computed: ok 4.77 light
        // / 6.71 dark, warning 6.63 / 7.80, error 5.92 / 4.86 (worst case
        // bg.muted), neutral 8.30 / 9.14. Non-text marks clear 3:1 with room.
        // The |> mark and wordmark (docs/brand/logo/README.md): #2E7D32 on
        // light grounds, the mark's own paper-white #F2F5F1 (15.06:1 on
        // #1C1F22) on dark -- deliberately NOT fg. The echo chevron #8BC34A
        // never gets a token: it is mark-internal and never a UI color.
        logo: {
          mark: { value: { _light: "#2E7D32", _dark: "#F2F5F1" } },
        },
        status: {
          ok: { value: { _light: "{colors.brandGreen.800}", _dark: "{colors.brandGreen.300}" } },
          warning: { value: { _light: "{colors.brandOrange.800}", _dark: "{colors.brandOrange.300}" } },
          error: { value: { _light: "{colors.brandRed.700}", _dark: "{colors.brandRed.300}" } },
          neutral: { value: { _light: "{colors.gray.700}", _dark: "{colors.gray.300}" } },
        },
        // HISTORICAL CONTEXT (the bug this originally fixed, now superseded
        // by the real light/dark split below): before this file had a
        // light/dark mode at all, DataPipe rendered on a permanently dark
        // surface (globals.css hardcoded body to #1C1F22) while Chakra's own
        // condition resolution defaulted to `_light` (no `.dark` class was
        // ever present). The stock GRAY palette is built for a white page,
        // so it was wrong here -- most damagingly gray.fg = gray.800 =
        // #27272a, a 1.09:1 contrast ratio against the body. Any component
        // that does not name a colorPalette falls back to gray, so
        // `variant="outline"` and `variant="ghost"` buttons across the app
        // rendered near-black on near-black and were effectively invisible.
        //
        // Components that DO set an explicit color (components/Footer.js,
        // CopyButton.js, dashboard/Title.js) were never affected and are
        // unchanged by this -- a style prop still overrides the recipe. What
        // this fixes is the default, so a button no longer has to remember to
        // opt out of an invisible one.
        //
        // DESIGN.md §1 now gives this palette a real light column too (every
        // dark value below is unchanged from that original fix -- verified
        // against today's actual dark-forced render):
        //   fg      800 light (13.86) / 200 dark (13.05)
        //   solid/contrast   800/gray.50 light (14.27) / 200/gray.900 dark (13.96)
        //   subtle/muted/emphasized   100/200/300 light, 800/700/600 dark
        //   border  500 both modes (4.50 light / 3.43 dark)
        gray: {
          fg: { value: { _light: "{colors.gray.800}", _dark: "{colors.gray.200}" } },
          subtle: { value: { _light: "{colors.gray.100}", _dark: "{colors.gray.800}" } },
          muted: { value: { _light: "{colors.gray.200}", _dark: "{colors.gray.700}" } },
          emphasized: { value: { _light: "{colors.gray.300}", _dark: "{colors.gray.600}" } },
          // Inverted against the page: a light chip with dark text, so a solid
          // gray button reads as a button instead of a hole.
          solid: { value: { _light: "{colors.gray.800}", _dark: "{colors.gray.200}" } },
          contrast: { value: { _light: "{colors.gray.50}", _dark: "{colors.gray.900}" } },
          // gray.500 (#71717a) rather than the darker gray.600: measured
          // against the #1C1F22 body, 600 gives 2.14:1 and 500 gives 3.43:1,
          // and WCAG 1.4.11 wants 3.0 for non-text UI boundaries like a
          // button outline.
          border: { value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
          focusRing: { value: { _light: "{colors.gray.400}", _dark: "{colors.gray.400}" } },
        },
        // brandOrange -- warning / attention only. DESIGN.md §1 gives fg,
        // subtle and border; `solid`, `focusRing`, `muted` and `emphasized`
        // are not tabled there (DESIGN.md explicitly says brandOrange has NO
        // solid -- every orange dark enough to hold white text has stopped
        // being brand orange). The `solid` slot below is left at its
        // pre-existing value rather than deleted: no component in this
        // migration's ownership list consumes it, and removing it here would
        // risk breaking an orange solid button elsewhere in the app before
        // Phase 2 has audited call sites. Flagged for removal once that
        // audit lands (DESIGN.md §1, brandOrange).
        //
        //   fg      800 #7C4606 light (6.63) / 300 #FFB74D dark (7.80)
        //   subtle  50  #FFF3E0 light (text 800 -> 7.00) /
        //           900 #3E2303 dark (text gray.200 -> 11.44)
        //   border  700 #A85F08 light (4.54) / 400 #FFA726 dark (8.52)
        //
        // The dark-side fg/subtle/border values above are unchanged from
        // this file's pre-existing (until now dormant) `_dark` slots -- this
        // migration is what activates them for the first time. `muted` and
        // `emphasized` follow the same one-step-per-slot pattern as `gray`
        // and `brandGreen` below (subtle, +1 ramp step, +2 ramp steps);
        // `focusRing` mirrors `border`, the same convention brandGreen uses.
        brandOrange: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brandOrange.800}", _dark: "{colors.brandOrange.300}" } },
          subtle: { value: { _light: "{colors.brandOrange.50}", _dark: "{colors.brandOrange.900}" } },
          muted: { value: { _light: "{colors.brandOrange.100}", _dark: "{colors.brandOrange.800}" } },
          emphasized: { value: { _light: "{colors.brandOrange.200}", _dark: "{colors.brandOrange.700}" } },
          solid: { value: { _light: "{colors.brandOrange.600}", _dark: "{colors.brandOrange.600}" } },
          focusRing: { value: { _light: "{colors.brandOrange.700}", _dark: "{colors.brandOrange.400}" } },
          border: { value: { _light: "{colors.brandOrange.700}", _dark: "{colors.brandOrange.400}" } },
        },
        // brandGreen -- the primary action color, replacing brandTeal.
        //
        // DESIGN.md §1 table (this is the real light/dark split; the dark
        // column is the exact reading this file already measured against the
        // permanently-dark body before light mode existed, so the dark render
        // is unchanged pixel for pixel):
        //
        //   fg        800 #2E7D32 light (4.77 on bg; 5.13 on bg.panel)
        //             300 #81C784 dark (6.71 on bg.muted)
        //   solid     800 light (fill 4.77 vs page) / 500 dark (fill 5.96 vs page)
        //   contrast  white light (5.13 on solid) / #1C1F22 dark (5.96 on solid)
        //   subtle    50 #E8F5E9 light (text 900 -> 7.00) /
        //             900 #1B5E20 dark (text 50 -> 7.00)
        //   border      700 #388E3C light (3.83) / 400 #66BB6A dark (7.00)
        //   focusRing   700 #388E3C light (3.27, worst on bg.muted) /
        //               400 #66BB6A dark (5.71, worst on bg.muted)
        //
        //     The dark solid/contrast pair was computed both ways, because
        //     the obvious choice is wrong here. Dark fill + white text (800
        //     #2E7D32 + white) gives fill 3.23:1 and text 5.13:1. Bright fill
        //     + dark text (500 #4CAF50 + #1C1F22) gives fill 5.96:1 and text
        //     5.96:1 -- better on both axes at once. On a dark page a dark
        //     green button is a hole; the bright chip reads as a control.
        //
        //     CAVEAT, and it is the one soft spot on this ramp: Chakra's
        //     `subtle` and `surface` variants paint colorPalette.fg on
        //     colorPalette.subtle, and dark 300 on 900 is 3.91:1 -- under the
        //     4.5:1 body floor. Material Green 900 is a mid-dark green, not
        //     a near-black, and the ramp has nothing darker. So text placed
        //     on brandGreen.subtle must be named explicitly -- 50 #E8F5E9
        //     gives 7.00:1 on the dark subtle fill -- and
        //     `variant="subtle"`/`"surface"` is not approved for brandGreen
        //     body text until a semantic pairing exists. No call site uses
        //     either variant on this palette today; every brandGreen consumer
        //     is a solid button, a checkbox, or a spinner.
        //
        //     `muted`/`emphasized` are not tabled in DESIGN.md; dark keeps
        //     this file's pre-existing 800/700 hover/active steps, and light
        //     follows the same one-step-per-slot pattern as `subtle` (50).
        brandGreen: {
          contrast: { value: { _light: "white", _dark: "{colors.greyBackground}" } },
          fg: { value: { _light: "{colors.brandGreen.800}", _dark: "{colors.brandGreen.300}" } },
          subtle: { value: { _light: "{colors.brandGreen.50}", _dark: "{colors.brandGreen.900}" } },
          muted: { value: { _light: "{colors.brandGreen.100}", _dark: "{colors.brandGreen.800}" } },
          emphasized: { value: { _light: "{colors.brandGreen.200}", _dark: "{colors.brandGreen.700}" } },
          solid: { value: { _light: "{colors.brandGreen.800}", _dark: "{colors.brandGreen.500}" } },
          focusRing: { value: { _light: "{colors.brandGreen.700}", _dark: "{colors.brandGreen.400}" } },
          border: { value: { _light: "{colors.brandGreen.700}", _dark: "{colors.brandGreen.400}" } },
        },
        // brandLime -- legacy, not tabled in DESIGN.md §1 (flagged there for
        // deletion once JsPsychIcon is confirmed as its only consumer).
        // Left untouched: out of this migration's scope.
        brandLime: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brandLime.500}", _dark: "{colors.brandLime.300}" } },
          subtle: { value: { _light: "{colors.brandLime.100}", _dark: "{colors.brandLime.900}" } },
          muted: { value: { _light: "{colors.brandLime.200}", _dark: "{colors.brandLime.800}" } },
          emphasized: { value: { _light: "{colors.brandLime.300}", _dark: "{colors.brandLime.700}" } },
          solid: { value: { _light: "{colors.brandLime.600}", _dark: "{colors.brandLime.600}" } },
          focusRing: { value: { _light: "{colors.brandLime.500}", _dark: "{colors.brandLime.500}" } },
          border: { value: { _light: "{colors.brandLime.500}", _dark: "{colors.brandLime.400}" } },
        },
        // brandRed -- exclusively for irreversible destruction (DESIGN.md
        // §5). DESIGN.md §1 table:
        //
        //   fg        700 #A82E16 light (5.92) / 300 #F17761 dark (4.86 on bg.muted)
        //   solid     700 light (fill 6.37) / 600 dark (fill 3.42)
        //   contrast  white light (6.85) / white dark (4.85)
        //   subtle    50 #FDE8E4 light (text 800 -> 8.30) /
        //             900 #4A1509 dark (text gray.200 -> 11.80)
        //   border    600 #D13A1B light (4.51) / 400 #EF5A3E dark (4.89)
        //
        // Every dark value above is unchanged from this file's pre-existing
        // (until now dormant) `_dark` slots -- this migration activates them.
        // `muted`/`emphasized` follow the brandOrange/brandGreen pattern
        // (dark keeps the old 800/700 steps; light is subtle+1/+2 ramp
        // steps). `focusRing` mirrors `border`.
        brandRed: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brandRed.700}", _dark: "{colors.brandRed.300}" } },
          subtle: { value: { _light: "{colors.brandRed.50}", _dark: "{colors.brandRed.900}" } },
          muted: { value: { _light: "{colors.brandRed.100}", _dark: "{colors.brandRed.800}" } },
          emphasized: { value: { _light: "{colors.brandRed.200}", _dark: "{colors.brandRed.700}" } },
          solid: { value: { _light: "{colors.brandRed.700}", _dark: "{colors.brandRed.600}" } },
          focusRing: { value: { _light: "{colors.brandRed.600}", _dark: "{colors.brandRed.400}" } },
          border: { value: { _light: "{colors.brandRed.600}", _dark: "{colors.brandRed.400}" } },
        },
        // ─────────────────────────────────────────────────────────────────
        // LANDING BANDS -- brand register, pages/index.js only.
        //
        // ADDITIVE. Nothing above this line is modified by this block, and
        // no app surface outside the landing page may consume it: the rest
        // of DataPipe stays product register on `bg` / `bg.subtle` /
        // `bg.panel` (DESIGN.md §1). This exists because the landing page is
        // the one surface where design IS the product, and a page whose
        // sections are separated by whitespace alone reads as mild there.
        //
        // `band.bg` is MODE-INVARIANT, deliberately, on the same argument
        // DESIGN.md §1 makes for the `code.*` device: the brand's own ground
        // should not be a function of the reader's OS theme. It is
        // brandGreen.900 #1B5E20 -- one step down the Material ramp from the
        // logo anchor #2E7D32, so the band is ON the ramp rather than near
        // it, exactly as the logo is. #101A14 (the logo sheet's dark page
        // ground) was computed and rejected: it is 1.07:1 against the
        // `code.bg` #111111 device and 1.00:1 against the device's #18181b
        // chrome strip, i.e. it swallows the code specimen whole, and at
        // 1.08:1 against the dark page it would have re-created the
        // "arbitrary black band" this page already deleted once.
        //
        // GROUND TRANSITIONS (decorative background changes -- WCAG 1.4.11
        // governs UI-component and meaningful-graphic boundaries, not
        // adjacent section grounds, so these are reported, not gated):
        //   band.bg #1B5E20 (L 0.0834) vs light page #F5F7F8 (L 0.9271) 7.33:1
        //   band.bg          vs dark  page #1C1F22 (L 0.0134)  2.10:1
        //   band.bg.soft     vs its own page, both modes        1.32:1
        // The dark-mode 2.10:1 is the weakest seam on the page. It is still
        // ~2x the 1.07:1 page<->panel separation DESIGN.md accepts as
        // deliberate, it carries a large hue/chroma shift (saturated green
        // against neutral slate) on a full-bleed edge, and the band's type
        // palette (white / mint) differs from the page's (gray.50 /
        // gray.300), so the region announces itself three ways. Recorded
        // rather than hidden.
        //
        // TEXT ON band.bg (every pairing computed against L 0.0834):
        //   band.fg        white              7.87:1  headline, h2, links
        //   band.fg.muted  brandGreen.100 #C8E6C9  5.85:1  deck, step body
        //   band.fg.subtle brandGreen.200 #A5D6A7  4.79:1  fine print (sm)
        //   band.accent    brandGreen.200         4.79:1  step numerals
        // brandGreen.300 #81C784 is 3.91:1 here -- the exact pairing
        // DESIGN.md §1 flags as under the body floor -- so it is absent from
        // this block on purpose. The ramp stops at 200 on this ground.
        //
        // CONTROLS ON band.bg:
        //   band.solid       white -- fill 7.87:1 vs band
        //   band.contrast    #1B5E20 on white          7.87:1
        //   band.solid.hover brandGreen.50 #E8F5E9; #1B5E20 on it 7.00:1
        //   band.border      brandGreen.200            4.79:1 (>=3 non-text)
        //   band.focusRing   white                     7.87:1
        // The app default focusRing (brandGreen.700 #388E3C) is 1.91:1 on
        // this ground -- invisible. An invariant ground needs an invariant
        // ring, same as the code device.
        //
        // band.ornament: the cropped |> mark used as ground texture.
        // brandGreen.600 #43A047 is 2.38:1 on the band and the mark's own
        // echo #8BC34A (LogoMark's untouched default, mark-internal per
        // DESIGN.md §1) is 3.75:1. Decorative only, aria-hidden, and no text
        // is ever laid over it -- the mark renders at xl+ only, cropped at
        // the band's right edge, clear of the text column's max width.
        //
        // band.bg.soft: the third ground, so no two adjacent sections share
        // one. A green-tinted neutral rather than another gray -- bolder.md
        // "tinted neutrals that harmonize with your palette". It is NOT
        // bg.subtle: that token is 1.07:1 against the page in both modes,
        // which is a recessed-code-block fill, not a section ground.
        //   fg        11.65 light / 12.03 dark
        //   fg.muted   7.01 light /  8.29 dark
        //   fg.subtle  5.45 light /  4.90 dark
        // GREEN TEXT IS BANNED ON band.bg.soft: brandGreen.fg is 3.61:1
        // light (6.24 dark), so it fails the body floor in one mode. This is
        // the same rule DESIGN.md §1 already states for bg.subtle / bg.muted
        // ("a green label inside a recessed region uses fg, not
        // brandGreen.fg"). Prose links on this ground therefore render `fg`
        // + underline; the underline is what marks a link on this page
        // anyway (see the ProseLink note in pages/index.js). Display-size
        // green (>=24px/700) is legal at 3.61:1 against the 3:1 large-text
        // floor, and is not used.
        band: {
          bg: {
            // Mode-invariant. Do not "fix" the invariance.
            DEFAULT: { value: "{colors.brandGreen.900}" },
            soft: { value: { _light: "#CBDCCC", _dark: "#2C362D" } },
          },
          fg: {
            DEFAULT: { value: "white" },
            muted: { value: "{colors.brandGreen.100}" },
            subtle: { value: "{colors.brandGreen.200}" },
          },
          accent: { value: "{colors.brandGreen.200}" },
          border: { value: "{colors.brandGreen.200}" },
          focusRing: { value: "white" },
          solid: {
            DEFAULT: { value: "white" },
            hover: { value: "{colors.brandGreen.50}" },
          },
          contrast: { value: "{colors.brandGreen.900}" },
          ornament: { value: "{colors.brandGreen.600}" },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);

// NOTE: an `outlineOnDark` helper used to live here, spreading a
// double-specificity `&&` override onto each outline button to beat the recipe.
// It is gone because the gray palette re-pointing above fixes the cause rather
// than each symptom -- a plain `variant="outline"` is now legible by default,
// app-wide, including on buttons nobody has touched.
