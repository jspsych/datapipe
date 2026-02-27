import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
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
        brandOrange: {
          solid: { value: "{colors.brandOrange.500}" },
          contrast: { value: "white" },
          fg: { value: "{colors.brandOrange.500}" },
          muted: { value: "{colors.brandOrange.200}" },
          subtle: { value: "{colors.brandOrange.50}" },
          emphasized: { value: "{colors.brandOrange.600}" },
          focusRing: { value: "{colors.brandOrange.500}" },
        },
        brandTeal: {
          solid: { value: "{colors.brandTeal.500}" },
          contrast: { value: "white" },
          fg: { value: "{colors.brandTeal.500}" },
          muted: { value: "{colors.brandTeal.200}" },
          subtle: { value: "{colors.brandTeal.50}" },
          emphasized: { value: "{colors.brandTeal.600}" },
          focusRing: { value: "{colors.brandTeal.500}" },
        },
        brandLime: {
          solid: { value: "{colors.brandLime.500}" },
          contrast: { value: "white" },
          fg: { value: "{colors.brandLime.500}" },
          muted: { value: "{colors.brandLime.200}" },
          subtle: { value: "{colors.brandLime.50}" },
          emphasized: { value: "{colors.brandLime.600}" },
          focusRing: { value: "{colors.brandLime.500}" },
        },
        brandRed: {
          solid: { value: "{colors.brandRed.500}" },
          contrast: { value: "white" },
          fg: { value: "{colors.brandRed.500}" },
          muted: { value: "{colors.brandRed.200}" },
          subtle: { value: "{colors.brandRed.50}" },
          emphasized: { value: "{colors.brandRed.600}" },
          focusRing: { value: "{colors.brandRed.500}" },
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
