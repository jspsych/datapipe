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
        brandTeal: {
          50: { value: "#E8F9EE" },
          100: { value: "#C6F0D5" },
          200: { value: "#8FE0AC" },
          300: { value: "#58D183" },
          400: { value: "#2CC35E" },
          500: { value: "#13b24b" },
          600: { value: "#0E923D" },
          700: { value: "#0B7230" },
          800: { value: "#085223" },
          900: { value: "#043216" },
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
        brandTeal: {
          contrast: { value: { _light: "white", _dark: "white" } },
          fg: { value: { _light: "{colors.brandTeal.500}", _dark: "{colors.brandTeal.300}" } },
          subtle: { value: { _light: "{colors.brandTeal.100}", _dark: "{colors.brandTeal.900}" } },
          muted: { value: { _light: "{colors.brandTeal.200}", _dark: "{colors.brandTeal.800}" } },
          emphasized: { value: { _light: "{colors.brandTeal.300}", _dark: "{colors.brandTeal.700}" } },
          solid: { value: { _light: "{colors.brandTeal.600}", _dark: "{colors.brandTeal.600}" } },
          focusRing: { value: { _light: "{colors.brandTeal.500}", _dark: "{colors.brandTeal.500}" } },
          border: { value: { _light: "{colors.brandTeal.500}", _dark: "{colors.brandTeal.400}" } },
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
