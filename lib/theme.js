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
        // DEPRECATED ALIAS -- brandTeal is retired as a color.
        //
        // The old primary #13b24b measured 1.83:1 against the logo green
        // #2E7D32 (close enough to read as a mistake rather than a pairing)
        // and 2.80:1 on white (it could never be light-mode text). The green
        // fixes both: #2E7D32 is 5.13:1 on white and 4.77:1 on the planned
        // #F5F7F8 light page.
        //
        // Every step here now resolves to the brandGreen step of the same
        // index, so `brandTeal.400` and `brandGreen.400` paint the identical
        // pixel. This exists purely so the rename can land file by file
        // without a single broken reference in between -- components/Navbar.js
        // and three in-progress pages (index, getting-started, api-docs) are
        // owned by other work right now and still say brandTeal. Delete this
        // block, and the semantic brandTeal block below, once those are
        // renamed; nothing should be added to it.
        brandTeal: {
          50: { value: "{colors.brandGreen.50}" },
          100: { value: "{colors.brandGreen.100}" },
          200: { value: "{colors.brandGreen.200}" },
          300: { value: "{colors.brandGreen.300}" },
          400: { value: "{colors.brandGreen.400}" },
          500: { value: "{colors.brandGreen.500}" },
          600: { value: "{colors.brandGreen.600}" },
          700: { value: "{colors.brandGreen.700}" },
          800: { value: "{colors.brandGreen.800}" },
          900: { value: "{colors.brandGreen.900}" },
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
    },
    semanticTokens: {
      colors: {
        fg: {
          DEFAULT: { value: { _light: "{colors.gray.50}", _dark: "{colors.gray.50}" } },
          muted: { value: { _light: "{colors.gray.400}", _dark: "{colors.gray.400}" } },
          subtle: { value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
          inverted: { value: { _light: "{colors.black}", _dark: "{colors.black}" } },
        },
        bg: {
          DEFAULT: { value: { _light: "#1C1F22", _dark: "#1C1F22" } },
          subtle: { value: { _light: "#1C1F22", _dark: "#1C1F22" } },
          muted: { value: { _light: "{colors.gray.700}", _dark: "{colors.gray.700}" } },
          emphasized: { value: { _light: "{colors.gray.800}", _dark: "{colors.gray.800}" } },
          inverted: { value: { _light: "{colors.white}", _dark: "{colors.white}" } },
          panel: { value: { _light: "#1C1F22", _dark: "#1C1F22" } },
        },
        border: {
          DEFAULT: { value: { _light: "{colors.gray.400}", _dark: "{colors.gray.400}" } },
        },
        // DataPipe renders on a permanently dark surface (see globalCss below:
        // body is greyBackground #1C1F22), but Chakra's mode is light, so every
        // palette resolves its _light values. For the GRAY palette those are
        // built for a white page and are wrong here -- most damagingly
        // gray.fg = gray.800 = #27272a, a 1.09:1 contrast ratio against the
        // body. Any component that does not name a colorPalette falls back to
        // gray, so `variant="outline"` and `variant="ghost"` buttons across the
        // app rendered near-black on near-black and were effectively invisible.
        //
        // Components that DO set an explicit color (components/Footer.js,
        // CopyButton.js, dashboard/Title.js) were never affected and are
        // unchanged by this -- a style prop still overrides the recipe. What
        // this fixes is the default, so a button no longer has to remember to
        // opt out of an invisible one.
        //
        // Measured against the body: gray.800 gave 1.11:1, gray.200 gives
        // 13.05:1.
        //
        // These re-point the whole gray palette to a dark-surface reading. The
        // whole palette, not just fg: variants read different tokens, and
        // lightening fg alone would leave `subtle` painting light text on the
        // near-white gray.subtle background.
        gray: {
          fg: { value: { _light: "{colors.gray.200}", _dark: "{colors.gray.200}" } },
          subtle: { value: { _light: "{colors.gray.800}", _dark: "{colors.gray.800}" } },
          muted: { value: { _light: "{colors.gray.700}", _dark: "{colors.gray.700}" } },
          emphasized: { value: { _light: "{colors.gray.600}", _dark: "{colors.gray.600}" } },
          // Inverted against the page: a light chip with dark text, so a solid
          // gray button reads as a button instead of a hole.
          solid: { value: { _light: "{colors.gray.200}", _dark: "{colors.gray.200}" } },
          contrast: { value: { _light: "{colors.gray.900}", _dark: "{colors.gray.900}" } },
          // gray.500 (#71717a) rather than the darker gray.600: measured
          // against the #1C1F22 body, 600 gives 2.14:1 and 500 gives 3.43:1,
          // and WCAG 1.4.11 wants 3.0 for non-text UI boundaries like a
          // button outline.
          border: { value: { _light: "{colors.gray.500}", _dark: "{colors.gray.500}" } },
          focusRing: { value: { _light: "{colors.gray.400}", _dark: "{colors.gray.400}" } },
        },
        brandOrange: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brandOrange.500}", _dark: "{colors.brandOrange.300}" } },
          subtle: { value: { _light: "{colors.brandOrange.100}", _dark: "{colors.brandOrange.900}" } },
          muted: { value: { _light: "{colors.brandOrange.200}", _dark: "{colors.brandOrange.800}" } },
          emphasized: { value: { _light: "{colors.brandOrange.300}", _dark: "{colors.brandOrange.700}" } },
          solid: { value: { _light: "{colors.brandOrange.600}", _dark: "{colors.brandOrange.600}" } },
          focusRing: { value: { _light: "{colors.brandOrange.500}", _dark: "{colors.brandOrange.500}" } },
          border: { value: { _light: "{colors.brandOrange.500}", _dark: "{colors.brandOrange.400}" } },
        },
        // brandGreen -- the primary action color, replacing brandTeal.
        //
        // Same rule as the gray palette above: the app renders on a
        // permanently dark surface (#1C1F22) while Chakra's mode is light, so
        // every _light value here carries the DARK-surface reading and both
        // sides are set identically. A palette whose _light column were tuned
        // for a white page would be measurably wrong on the page we actually
        // ship. When the light/dark migration lands, the _light column
        // diverges to the values in DESIGN.md section 1; until then, one
        // reading, correctly measured, in both slots.
        //
        // All ratios below are WCAG 2.1 against the body #1C1F22 unless the
        // surface is named. bg.muted is gray.700 #3f3f46 today.
        //
        //   fg      300 #81C784  8.23:1 on the body, 6.71:1 on the migration's
        //                        #2A2F34 bg.muted, 5.19:1 on today's gray.700
        //                        bg.muted. Clears the 4.5:1 body-text floor on
        //                        every surface a palette fg is allowed to sit
        //                        on. (400 #66BB6A would also clear at 7.00,
        //                        but 300 keeps a step of headroom for the
        //                        hover/active darkening Chakra applies.)
        //   solid   500 #4CAF50  fill 5.96:1 vs the body.
        //   contrast #1C1F22     5.96:1 against that fill -- the body color
        //                        used as button TEXT.
        //
        //     The solid/contrast pair was computed both ways, because the
        //     obvious choice is wrong here. Dark fill + white text (800
        //     #2E7D32 + white) gives fill 3.23:1 and text 5.13:1. Bright fill
        //     + dark text (500 #4CAF50 + #1C1F22) gives fill 5.96:1 and text
        //     5.96:1 -- better on both axes at once. On a dark page a dark
        //     green button is a hole; the bright chip reads as a control. This
        //     is the same flip DESIGN.md prescribes for dark-mode teal, and it
        //     is what retires the old solid: brandTeal.600 + white, which was
        //     4.04:1 -- a live AA failure.
        //
        //   border  400 #66BB6A  7.00:1 vs the body, 5.71:1 on #2A2F34,
        //                        4.42:1 on today's gray.700. WCAG 1.4.11 wants
        //                        3.0 for a non-text boundary; this clears it
        //                        on every surface.
        //   focusRing 400        same value, same 4.42:1 worst case. A focus
        //                        ring is a non-text boundary too, and it must
        //                        stay visible where a control sits on a hover
        //                        fill, not just on the page.
        //   subtle  900 #1B5E20  tinted fill, 2.10:1 vs the body -- visible as
        //                        a region without competing with content.
        //   muted   800 / emphasized 700   hover and active steps above it.
        //
        //     CAVEAT, and it is the one soft spot on this ramp: Chakra's
        //     `subtle` and `surface` variants paint colorPalette.fg on
        //     colorPalette.subtle, and 300 on 900 is 3.91:1 -- under the
        //     4.5:1 body floor. Material Green 900 is a mid-dark green, not
        //     the near-black that the old hand-tuned teal 900 (#043216) was,
        //     and the ramp has nothing darker. So text placed on
        //     brandGreen.subtle must be named explicitly -- 50 #E8F5E9 gives
        //     7.00:1 -- and `variant="subtle"`/`"surface"` is not approved for
        //     brandGreen body text until a semantic pairing exists. No call
        //     site uses either variant on this palette today; every brandGreen
        //     consumer is a solid button, a checkbox, or a spinner.
        brandGreen: {
          contrast: { value: { _light: "{colors.greyBackground}", _dark: "{colors.greyBackground}" } },
          fg: { value: { _light: "{colors.brandGreen.300}", _dark: "{colors.brandGreen.300}" } },
          subtle: { value: { _light: "{colors.brandGreen.900}", _dark: "{colors.brandGreen.900}" } },
          muted: { value: { _light: "{colors.brandGreen.800}", _dark: "{colors.brandGreen.800}" } },
          emphasized: { value: { _light: "{colors.brandGreen.700}", _dark: "{colors.brandGreen.700}" } },
          solid: { value: { _light: "{colors.brandGreen.500}", _dark: "{colors.brandGreen.500}" } },
          focusRing: { value: { _light: "{colors.brandGreen.400}", _dark: "{colors.brandGreen.400}" } },
          border: { value: { _light: "{colors.brandGreen.400}", _dark: "{colors.brandGreen.400}" } },
        },
        // DEPRECATED ALIAS -- see the brandTeal ramp above. Every slot mirrors
        // brandGreen exactly, so `colorPalette="brandTeal"` renders as
        // `colorPalette="brandGreen"` down to the pixel. Transitional only:
        // it exists so components/Navbar.js and the three in-progress pages
        // can keep saying brandTeal while they are owned elsewhere, and it
        // dies with them once every reference is renamed.
        brandTeal: {
          contrast: { value: { _light: "{colors.greyBackground}", _dark: "{colors.greyBackground}" } },
          fg: { value: { _light: "{colors.brandGreen.300}", _dark: "{colors.brandGreen.300}" } },
          subtle: { value: { _light: "{colors.brandGreen.900}", _dark: "{colors.brandGreen.900}" } },
          muted: { value: { _light: "{colors.brandGreen.800}", _dark: "{colors.brandGreen.800}" } },
          emphasized: { value: { _light: "{colors.brandGreen.700}", _dark: "{colors.brandGreen.700}" } },
          solid: { value: { _light: "{colors.brandGreen.500}", _dark: "{colors.brandGreen.500}" } },
          focusRing: { value: { _light: "{colors.brandGreen.400}", _dark: "{colors.brandGreen.400}" } },
          border: { value: { _light: "{colors.brandGreen.400}", _dark: "{colors.brandGreen.400}" } },
        },
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
        brandRed: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brandRed.500}", _dark: "{colors.brandRed.300}" } },
          subtle: { value: { _light: "{colors.brandRed.100}", _dark: "{colors.brandRed.900}" } },
          muted: { value: { _light: "{colors.brandRed.200}", _dark: "{colors.brandRed.800}" } },
          emphasized: { value: { _light: "{colors.brandRed.300}", _dark: "{colors.brandRed.700}" } },
          solid: { value: { _light: "{colors.brandRed.600}", _dark: "{colors.brandRed.600}" } },
          focusRing: { value: { _light: "{colors.brandRed.500}", _dark: "{colors.brandRed.500}" } },
          border: { value: { _light: "{colors.brandRed.500}", _dark: "{colors.brandRed.400}" } },
        },
      },
    },
  },
  globalCss: {
    body: {
      bg: "greyBackground",
      color: "white",
    },
    label: {
      color: "white",
    },
    input: {
      color: "white",
    },
  },
});

export const system = createSystem(defaultConfig, config);

// NOTE: an `outlineOnDark` helper used to live here, spreading a
// double-specificity `&&` override onto each outline button to beat the recipe.
// It is gone because the gray palette re-pointing above fixes the cause rather
// than each symptom -- a plain `variant="outline"` is now legible by default,
// app-wide, including on buttons nobody has touched.
