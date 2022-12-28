const theme = {
  colors: {
    greyBackground: "#1C1F22",
    brandOrange: {
      DEFAULT: "#FC9800",
      50: "#FFE1B5",
      100: "#FFD9A0",
      200: "#FFC977",
      300: "#FFB94F",
      400: "#FFA926",
      500: "#FC9800",
      600: "#C47600",
      700: "#8C5400",
      800: "#543200",
      900: "#1C1100",
    },
    brandLime: {
      DEFAULT: "#7EB207",
      50: "#ECFDC5",
      100: "#E5FCB2",
      200: "#D8FA8B",
      300: "#CBF963",
      400: "#BEF73C",
      500: "#B1F615",
      600: "#9AD909",
      700: "#7EB207",
      800: "#587C05",
      900: "#324603",
    },
    brandTeal: {
      DEFAULT: "#008E63",
      50: "#6FFFD4",
      100: "#5BFFCD",
      200: "#32FFC1",
      300: "#09FFB5",
      400: "#00E09C",
      500: "#00B77F",
      600: "#008E63",
      700: "#00563C",
      800: "#001E15",
      900: "#000000",
    },
  },
  semanticTokens: {
    colors: {
      "chakra-body-text": "white",
    },
  },
  styles: {
    global: {
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
  },
  components: {
    Card: {
      baseStyle: {
        bgColor: "brandBlue.50",
      },
    },
    Link: {
      baseStyle: {
        color: "brandOrange.500",
      },
    },
  },
};

export { theme };
