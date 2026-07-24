import { VStack, Heading, Text, Button, Alert, Card, Spinner, Center } from "@chakra-ui/react";
import { useEffect, useContext, useReducer, useRef } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { UserContext } from "../../lib/context";
import { auth } from "../../lib/firebase";

// Redirect target for provider (non-OSF) OAuth connect flows -- distinct
// from pages/oauth2/callback.js, which handles the OSF IDENTITY flow
// (signup/sign-in/account linking). This page only ever grants storage
// access to an already-authenticated user (see connect-provider.ts).
// GDRIVE_REDIRECT_URI (and future provider redirect URIs) must point here.

const initialState = {
  status: "processing",
  error: null,
};

function connectReducer(state, action) {
  switch (action.type) {
    case "ERROR":
      return { ...state, status: "error", error: action.error };
    case "SIGNED_OUT":
      return { ...state, status: "signed-out" };
    default:
      return state;
  }
}

function useProviderConnectCallback() {
  const { user } = useContext(UserContext);
  const router = useRouter();
  const [state, dispatch] = useReducer(connectReducer, initialState);
  const processingRef = useRef(false);

  const urlCode = router.query.code;
  const urlState = router.query.state;
  const urlError = router.query.error;

  useEffect(() => {
    if (urlError) {
      dispatch({ type: "ERROR", error: `OAuth error: ${urlError}` });
      return;
    }

    if (!urlCode || !urlState) {
      return;
    }

    const storedState = localStorage.getItem("latestCSRFToken") || "";
    const provider = localStorage.getItem("providerConnectFlow") || "";

    // CSRF check first, mirroring pages/oauth2/callback.js -- this must
    // reject before we even look at sign-in state.
    if (urlState !== storedState) {
      dispatch({
        type: "ERROR",
        error: "Invalid state parameter. Possible CSRF attack.",
      });
      return;
    }

    if (!user?.uid) {
      dispatch({ type: "SIGNED_OUT" });
      return;
    }

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

        localStorage.removeItem("latestCSRFToken");
        localStorage.removeItem("providerConnectFlow");

        router.push("/admin/account");
      } catch (err) {
        console.error("Provider connect callback error:", err);
        dispatch({ type: "ERROR", error: err.message });
        processingRef.current = false;
      }
    };

    processCallback();
  }, [urlCode, urlState, urlError, user?.uid]);

  return state;
}

function ProviderConnectCallbackPage() {
  const { status, error } = useProviderConnectCallback();

  const renderContent = () => {
    switch (status) {
      case "signed-out":
        return (
          <VStack gap={6}>
            <Alert.Root status="error" borderRadius="md" bg="red.800" borderColor="red.600" borderWidth={1}>
              <Alert.Indicator color="red.300" />
              <VStack gap={2} align="start">
                <Text fontWeight="medium" color="white">Sign-in Required</Text>
                <Text fontSize="sm" color="gray.100">
                  You must be signed in to connect a storage provider account.
                </Text>
              </VStack>
            </Alert.Root>

            <VStack gap={3} w="full">
              <Link href="/signin">
                <Button colorPalette="blue" w="full">Sign In</Button>
              </Link>
            </VStack>
          </VStack>
        );

      case "error":
        return (
          <VStack gap={6}>
            <Alert.Root status="error" borderRadius="md" bg="red.800" borderColor="red.600" borderWidth={1}>
              <Alert.Indicator color="red.300" />
              <VStack gap={2} align="start">
                <Text fontWeight="medium" color="white">Connection Failed</Text>
                <Text fontSize="sm" color="gray.100">{error}</Text>
              </VStack>
            </Alert.Root>

            <VStack gap={3} w="full">
              <Link href="/admin/account">
                <Button colorPalette="blue" w="full">Back to Account</Button>
              </Link>
            </VStack>
          </VStack>
        );

      case "processing":
      default:
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="blue.500" borderWidth="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Connecting your account...
            </Heading>
            <Text color="gray.600" textAlign="center">
              Please wait while we finish connecting your storage provider.
            </Text>
          </VStack>
        );
    }
  };

  return (
    <Card.Root w="100%" maxW={400} mx="auto" px={4} variant="unstyled" color="white">
      <Card.Body p={8}>
        <VStack gap={6}>
          <Heading size="lg" textAlign="center">Storage Provider Connection</Heading>
          {renderContent()}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

export default ProviderConnectCallbackPage;
