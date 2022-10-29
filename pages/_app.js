import '../styles/globals.css'
import Navbar from '../components/Navbar'
import { UserContext } from '../lib/context'
import { ChakraProvider } from '@chakra-ui/react'
import { Box, Center } from '@chakra-ui/react'

import { auth } from '../lib/firebase'
import { useAuthState } from 'react-firebase-hooks/auth'

function MyApp({ Component, pageProps }) {

  const [user, loading, error] = useAuthState(auth);

  return (
    <ChakraProvider>
      <UserContext.Provider value={{user}} >
        <Box>
          <Navbar />
          <Center>
            <Component {...pageProps} />
          </Center>
        </Box>
      </UserContext.Provider>
    </ChakraProvider>
  )
}

export default MyApp
