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
import TestEnvironmentWarning from "../components/TestEnvironmentWarning";

const newTheme = extendTheme(theme);

function MyApp({ Component, pageProps }) {
  const [user, loading, error] = useAuthState(auth);

  // Use the layout defined at the page level, if available
  const getLayout = Component.getLayout || ((page) => (
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
        {page}
      </Center>
      <Footer />
      {
        process.env.NEXT_PUBLIC_OSF_ENV !== "" && <TestEnvironmentWarning />
      }
    </Box>
  ));

  return (
    <ChakraProvider theme={newTheme}>
      <UserContext.Provider value={{ user, loading }}>
        <Head>
          <title>DataPipe</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        {getLayout(<Component {...pageProps} />)}
      </UserContext.Provider>
    </ChakraProvider>
  );
}

export default MyApp;
