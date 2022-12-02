const theme = {
  colors: {
    brandSand: 
    {
      50: '#fdf3e5',
      100: '#EDD7B7',
      200: '#e5c19c',
      300: '#d9a374',
      400: '#cf7f4d',
      500: '#b65e34',
      600: '#8e4228',
      700: '#652a1c',
      800: '#3d160f',
      900: '#170100',
    },
    brandBlue: {
      50: '#dcf5ff',
      100: '#b4e7fa',
      200: '#89dbf6',
      300: '#5ed2f1',
      400: '#3acced',
      500: '#28bad4',
      600: '#1895a4',
      700: '#096e76',
      800: '#003e48',
      900: '#00141b',
    }
  },
  styles: {
    global: {
      body: {
        bg: 'brandSand.100',
      }
    }
  },
  components: {
    Card: {
      baseStyle: {
        bgColor: 'brandBlue.50',
      }
    }
  }
}

export { theme }