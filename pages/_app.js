import '../styles/globals.css'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { UserContext } from '../lib/context'
import { ChakraProvider } from '@chakra-ui/react'
import { Box, Center } from '@chakra-ui/react'

import { auth } from '../lib/firebase'
import { useAuthState } from 'react-firebase-hooks/auth'

import { extendTheme } from '@chakra-ui/react'
import { theme } from '../lib/theme'

const newTheme = extendTheme(theme)

function MyApp({ Component, pageProps }) {

  const [user, loading, error] = useAuthState(auth);

  return (
    <ChakraProvider theme={newTheme}>
      <UserContext.Provider value={{user}} >
        <Box h="100%" display="flex" flexDirection="column" justifyContent="space-between">
          <Navbar />
          <Center h="100%" px={"2"}>
            <Component {...pageProps} />
          </Center>
          <Footer />
        </Box>
      </UserContext.Provider>
    </ChakraProvider>
  )
}

export default MyApp
