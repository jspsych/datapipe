import { VStack, Heading, Text, Button, Card, Spinner, Center } from "@chakra-ui/react";
import { useEffect, useContext, useReducer, useRef } from "react";
import { useRouter } from "next/router";
import NextLink from "next/link";
import { UserContext } from "../../lib/context";
import { auth } from "../../lib/firebase";
import FormErrorAlert from "../../components/ui/FormErrorAlert";

// Redirect target for provider (non-OSF) OAuth connect flows -- distinct
// from pages/oauth2/callback.js, which handles the OSF IDENTITY flow
// (signup/sign-in/account linking). This page only ever grants storage
// access to an already-authenticated user (see connect-provider.ts).
// GDRIVE_REDIRECT_URI (and future provider redirect URIs) must point here.

// A researcher declining the provider's consent screen is not a failure --
// it's "cancel", and gets its own calm status rather than living inside
// "error".
const WATCHDOG_MS = 30000;

const initialState = {
  status: "processing",
  error: null,
};

function connectReducer(state, action) {
  switch (action.type) {
    case "ERROR":
      return { ...state, status: "error", error: action.error };
    case "SIGNED_OUT":
      return { ...state, status: "signed-out", error: null };
    case "CANCELLED":
      return { ...state, status: "cancelled", error: null };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

function useProviderConnectCallback() {
  const { user, loading } = useContext(UserContext);
  const router = useRouter();
  const { push, isReady } = router;
  const [state, dispatch] = useReducer(connectReducer, initialState);
  const processingRef = useRef(false);

  const urlCode = router.query.code;
  const urlState = router.query.state;
  const urlError = router.query.error;

  useEffect(() => {
    // Auth state is still resolving -- `user` is `undefined` during this
    // window, indistinguishable from "definitely signed out" unless
    // `loading` is also checked. Painting anything here before `loading`
    // settles is how a signed-in researcher briefly saw "sign-in required".
    if (loading) return;

    if (urlError) {
      if (urlError === "access_denied") {
        dispatch({ type: "CANCELLED" });
      } else {
        console.error("Provider connect OAuth error:", urlError);
        dispatch({
          type: "ERROR",
          error:
            "Could not connect your storage provider. Please try again from your account settings.",
        });
      }
      return;
    }

    // router.query is empty until the router has hydrated; wait for that
    // before concluding the params are really missing.
    if (!isReady) return;

    if (!urlCode || !urlState) {
      dispatch({
        type: "ERROR",
        error:
          "This link is incomplete. Start the connection again from your account settings.",
      });
      return;
    }

    const storedState = localStorage.getItem("latestCSRFToken") || "";
    const provider = localStorage.getItem("providerConnectFlow") || "";

    // CSRF check first, mirroring pages/oauth2/callback.js -- this must
    // reject before we even look at sign-in state.
    if (urlState !== storedState) {
      dispatch({
        type: "ERROR",
        error:
          "That connection link expired or was opened out of order. Start again from your account settings.",
      });
      return;
    }

    if (!user?.uid) {
      dispatch({ type: "SIGNED_OUT" });
      return;
    }

    // Clear any stale status (e.g. a SIGNED_OUT from an earlier pass, before
    // `loading` settled) before a fresh attempt.
    dispatch({ type: "RESET" });

    const watchdogId = setTimeout(() => {
      dispatch({
        type: "ERROR",
        error:
          "This is taking longer than expected. Check your connection and try again.",
      });
    }, WATCHDOG_MS);

    const processCallback = async () => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const idToken = await auth.currentUser.getIdToken();

        const res = await fetch("/api/connectprovider", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            code: urlCode,
            state: urlState,
            uid: user.uid,
            idToken,
          }),
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
          throw new Error(json.error || `Failed to connect account (${res.status})`);
        }

        clearTimeout(watchdogId);
        localStorage.removeItem("latestCSRFToken");
        localStorage.removeItem("providerConnectFlow");

        push("/admin/account");
      } catch (err) {
        clearTimeout(watchdogId);
        console.error("Provider connect callback error:", err);
        dispatch({
          type: "ERROR",
          error:
            "Could not connect your storage provider. Please try again from your account settings.",
        });
        processingRef.current = false;
      }
    };

    processCallback();

    return () => clearTimeout(watchdogId);
    // `push`, NOT the whole `router`. The effect reads nothing else off it --
    // the query parameters are destructured into urlCode/urlState/urlError
    // above and listed here individually -- and depending on the router object
    // means depending on an identity nothing guarantees is stable. Where it is
    // not, this effect re-runs on every render, and since it dispatches, every
    // run schedules the next one: an unbounded loop that performs the OAuth
    // token exchange over and over.
  }, [urlCode, urlState, urlError, user?.uid, loading, isReady, push]);

  return state;
}

function ProviderConnectCallbackPage() {
  const { status, error } = useProviderConnectCallback();

  const renderContent = () => {
    switch (status) {
      case "signed-out":
        return (
          <VStack gap={6} w="full">
            <VStack gap={2} align="start" w="full">
              <Heading as="h2" fontSize="lg" fontWeight="600" color="fg">
                Sign in to continue
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                You need to be signed in to connect a storage provider
                account.
              </Text>
            </VStack>

            <Button asChild colorPalette="brandGreen" w="full">
              <NextLink href="/signin">Sign in</NextLink>
            </Button>
          </VStack>
        );

      case "cancelled":
        return (
          <VStack gap={6} w="full">
            <VStack gap={2} align="start" w="full">
              <Heading as="h2" fontSize="lg" fontWeight="600" color="fg">
                Connection cancelled
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                You cancelled the connection. Nothing changed.
              </Text>
            </VStack>

            <Button asChild variant="outline" colorPalette="gray" w="full">
              <NextLink href="/admin/account">Back to account settings</NextLink>
            </Button>
          </VStack>
        );

      case "error":
        return (
          <VStack gap={6} w="full">
            <FormErrorAlert>{error}</FormErrorAlert>

            <Button asChild variant="outline" colorPalette="gray" w="full">
              <NextLink href="/admin/account">Back to account settings</NextLink>
            </Button>
          </VStack>
        );

      case "processing":
      default:
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="brandGreen.solid" borderWidth="4px" />
            </Center>
            <Heading as="h2" fontSize="lg" fontWeight="600" textAlign="center" color="fg">
              Connecting your account…
            </Heading>
            <Text color="fg.muted" textAlign="center" aria-live="polite">
              Please wait while we finish connecting your storage provider.
            </Text>
          </VStack>
        );
    }
  };

  return (
    <Card.Root
      w="100%"
      maxW="560px"
      mx="auto"
      px={4}
      variant="unstyled"
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      rounded="lg"
    >
      <Card.Body p={8}>
        <VStack gap={6}>
          <Heading as="h1" fontSize="2xl" fontWeight="700" textAlign="center" color="fg">
            Connect a storage provider
          </Heading>
          {renderContent()}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

export default ProviderConnectCallbackPage;
