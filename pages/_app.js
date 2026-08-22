import "../styles/globals.css";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { UserContext } from "../lib/context";
import { ChakraProvider } from "@chakra-ui/react";
import { Box, Center } from "@chakra-ui/react";

import { auth } from "../lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";

import { system } from "../lib/theme";
import Head from "next/head";
import TestEnvironmentWarning from "../components/TestEnvironmentWarning";

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
    <ChakraProvider value={system}>
      <UserContext.Provider value={{ user, loading }}>
        <Head>
          <title>DataPipe</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {/* Vector favicon first so modern browsers get the new mark at any
              resolution; PNG/ICO fallbacks follow for browsers that don't
              support type="image/svg+xml" icons. */}
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png" />
          <link rel="icon" href="/favicon-16x16.png" sizes="16x16" type="image/png" />
          <link rel="shortcut icon" href="/favicon.ico" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
          <link rel="manifest" href="/site.webmanifest" />
          <meta name="theme-color" content="#1C2A22" />
        </Head>
        {getLayout(<Component {...pageProps} />)}
      </UserContext.Provider>
    </ChakraProvider>
  );
}

export default MyApp;
