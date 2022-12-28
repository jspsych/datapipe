import "../styles/globals.css";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { UserContext } from "../lib/context";
import { ChakraProvider } from "@chakra-ui/react";
import { Box, Center } from "@chakra-ui/react";

import { auth } from "../lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";

import { extendTheme } from "@chakra-ui/react";
import { theme } from "../lib/theme";
import Head from "next/head";

const newTheme = extendTheme(theme);

function MyApp({ Component, pageProps }) {
  const [user, loading, error] = useAuthState(auth);

  return (
    <ChakraProvider theme={newTheme}>
      <UserContext.Provider value={{ user }}>
        <Head>
          <title>DataPipe</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <Box
          minH="100vh"
          display="flex"
          flexDirection="column"
          justifyContent="space-between"
        >
          <Navbar />
          <Center
            flexGrow={1}
            flexShrink={0}
            flexBasis="auto"
            justifySelf="flex-start"
          >
            <Component {...pageProps} />
          </Center>
          <Footer />
        </Box>
      </UserContext.Provider>
    </ChakraProvider>
  );
}

export default MyApp;
