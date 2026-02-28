import { VStack, Heading, Text, Button, Alert, Card, Spinner, Center } from "@chakra-ui/react";
import { useSearchParams } from 'next/navigation';
import { useEffect, useContext, useReducer, useRef } from "react";
import { useRouter } from "next/router";
import { UserContext } from "../../lib/context";
import { auth } from "../../lib/firebase";
import { signInWithCustomToken } from "firebase/auth";

const initialState = {
  status: 'processing',
  error: null
};

function callbackReducer(state, action) {
  switch (action.type) {
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

function useOAuthCallback() {
  const { user } = useContext(UserContext);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(callbackReducer, initialState);
  const processingRef = useRef(false);

  useEffect(() => {
    const urlCode = searchParams.get('code');
    const urlError = searchParams.get('error');
    const urlState = searchParams.get('state');

    if (urlError) {
      dispatch({ type: 'ERROR', error: `OAuth error: ${urlError}` });
      return;
    }

    if (!urlCode || !urlState) {
      return;
    }

    const storedState = localStorage.getItem('latestCSRFToken') || '';
    const authFlow = localStorage.getItem('osfAuthFlow') || '';

    if (authFlow === 'linking' && !user?.uid) {
      return;
    }

    if (authFlow === 'osf-entry') {
      // Continue processing
    }

    const processCallback = async () => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        if (urlState !== storedState) {
          throw new Error('Invalid state parameter. Possible CSRF attack.');
        }

        const isSignup = authFlow === 'signup';
        const isSignin = authFlow === 'signin';
        const isLinking = authFlow === 'linking';
        const isOsfEntry = authFlow === 'osf-entry';

        let idToken = null;
        if (isLinking && user) {
          idToken = await user.id;
        }

        const requestBody = {
          code: urlCode,
          state: urlState,
          isSignup: isSignup || isSignin || isOsfEntry,
          ...(isLinking && { uid: user?.uid, idToken }),
          ...(isOsfEntry && {
            osfEntryComponentId: localStorage.getItem('osfEntryComponentId'),
            osfEntryUserId: localStorage.getItem('osfEntryUserId')
          })
        };

        const res = await fetch(process.env.NEXT_PUBLIC_OAUTH_CALLBACK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `Authentication failed (${res.status})`);
        }

        const json = await res.json();

        if (json.success) {
          if (json.customToken) {
            await signInWithCustomToken(auth, json.customToken);
          }

          localStorage.removeItem('latestCSRFToken');

          if (isOsfEntry) {
            localStorage.removeItem('osfAuthFlow');
            const entryParams = new URLSearchParams();
            const entryUserId = localStorage.getItem('osfEntryUserId');
            const entryComponentId = localStorage.getItem('osfEntryComponentId');
            if (entryUserId && entryUserId !== 'null') entryParams.set('userIri', entryUserId);
            if (entryComponentId && entryComponentId !== 'null') entryParams.set('nodeIri', entryComponentId);
            localStorage.removeItem('osfEntryUserId');
            localStorage.removeItem('osfEntryComponentId');
            const entryQuery = entryParams.toString();
            router.push('/osf-entry' + (entryQuery ? '?' + entryQuery : ''));
          } else {
            localStorage.removeItem('osfAuthFlow');
            const redirectPath = json.customToken ? '/admin' : (process.env.NEXT_PUBLIC_OAUTH_FINAL || '/admin');
            router.push(redirectPath);
          }
        } else {
          throw new Error('OAuth authentication failed');
        }
      } catch (error) {
        console.error('OAuth callback error:', error);
        dispatch({ type: 'ERROR', error: error.message });
        processingRef.current = false;
      }
    };

    processCallback();
  }, [searchParams, user?.uid, router]);

  return state;
}

function OAuth2CallbackPage() {
  const router = useRouter();
  const { status, error } = useOAuthCallback();

  const renderContent = () => {
    switch (status) {
      case 'processing':
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="blue.500" borderWidth="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Completing authentication...
            </Heading>
            <Text color="gray.600" textAlign="center">
              Please wait while we sign you in with OSF.
            </Text>
          </VStack>
        );

      case 'error':
        return (
          <VStack gap={6}>
            <Alert.Root status="error" borderRadius="md" bg="red.800" borderColor="red.600" borderWidth={1}>
              <Alert.Indicator color="red.300" />
              <VStack gap={2} align="start">
                <Text fontWeight="medium" color="white">Authentication Failed</Text>
                <Text fontSize="sm" color="gray.100">{error}</Text>
              </VStack>
            </Alert.Root>

            <VStack gap={3} w="full">
              <Button colorPalette="blue" onClick={() => router.push('/signin')} w="full">
                Sign In
              </Button>
            </VStack>
          </VStack>
        );

      default:
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="blue.500" borderWidth="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Completing authentication...
            </Heading>
          </VStack>
        );
    }
  };

  return (
    <Card.Root w={400} mx="auto" variant="unstyled" color="white">
      <Card.Body p={8}>
        <VStack gap={6}>
          <Heading size="lg" textAlign="center">OSF Authentication</Heading>
          {renderContent()}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

export default OAuth2CallbackPage;
