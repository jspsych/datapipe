import "../styles/globals.css";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { UserContext } from "../lib/context";
import { ChakraProvider } from "@chakra-ui/react";
import { Box, Flex } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";

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
      {/* This was a <Center>, which is `align-items: center` in BOTH axes:
          the navbar-to-content gap was never specified, it was whatever
          flexbox had left over -- zero on any page taller than the viewport
          (the owner's "very tight" report) and a floating, vertically
          centered column on any page shorter than it. The gap is now
          declared once, here, for every page that uses the default layout,
          rather than each page growing its own top margin.

          DESIGN.md §4 ladder: pt 8/12 opens the page under the nav; the
          larger pb 12/16 makes the hand-off into the footer band deliberate
          and asymmetric -- more air before a change of surface than after a
          change of chrome. */}
      <Flex
        as="main"
        direction="column"
        alignItems="center"
        w="100%"
        flexGrow={1}
        flexShrink={0}
        flexBasis="auto"
        px={4}
        pt={{ base: 8, md: 12 }}
        pb={{ base: 12, md: 16 }}
      >
        {page}
      </Flex>
      <Footer />
      {
        /* A `!== ""` guard renders whenever the var is UNDEFINED
           (`undefined !== ""` is true), so an unset var in a deploy would
           have shipped this banner to production. Truthiness check instead --
           TestEnvironmentWarning itself repeats the check as a second guard. */
        !!process.env.NEXT_PUBLIC_OSF_ENV && <TestEnvironmentWarning />
      }
    </Box>
  ));

  // Dark is DataPipe's only mode (DESIGN.md §2). forcedTheme, not just
  // defaultTheme: visitors who picked Light/System while the toggle existed
  // still have that choice in localStorage, and it must not resurrect a
  // retired mode.
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      forcedTheme="dark"
      disableTransitionOnChange
    >
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
    </ThemeProvider>
  );
}

export default MyApp;
