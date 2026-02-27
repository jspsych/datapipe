import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        greyBackground: { value: "#1C1F22" },
        brandOrange: {
          50: { value: "#FFE1B5" },
          100: { value: "#FFD9A0" },
          200: { value: "#FFC977" },
          300: { value: "#FFB94F" },
          400: { value: "#FFA926" },
          500: { value: "#FC9800" },
          600: { value: "#C47600" },
          700: { value: "#8C5400" },
          800: { value: "#543200" },
          900: { value: "#1C1100" },
        },
        brandLime: {
          50: { value: "#ECFDC5" },
          100: { value: "#E5FCB2" },
          200: { value: "#D8FA8B" },
          300: { value: "#CBF963" },
          400: { value: "#BEF73C" },
          500: { value: "#B1F615" },
          600: { value: "#9AD909" },
          700: { value: "#7EB207" },
          800: { value: "#587C05" },
          900: { value: "#324603" },
        },
        brandTeal: {
          50: { value: "#6FFFD4" },
          100: { value: "#5BFFCD" },
          200: { value: "#32FFC1" },
          300: { value: "#09FFB5" },
          400: { value: "#00E09C" },
          500: { value: "#00B77F" },
          600: { value: "#008E63" },
          700: { value: "#00563C" },
          800: { value: "#001E15" },
          900: { value: "#000000" },
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
