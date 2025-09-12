import { VStack, Heading, Text, Button, Alert, AlertIcon, Card, CardBody, Spinner, Center } from "@chakra-ui/react";
import { useSearchParams } from 'next/navigation';
import { useEffect, useContext, useReducer, useRef } from "react";
import { useRouter } from "next/router";
import { UserContext } from "../../lib/context";
import { auth } from "../../lib/firebase";
import { signInWithCustomToken } from "firebase/auth";

// State management with reducer pattern
const initialState = {
  status: 'processing', // 'processing' | 'error'
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

// Custom hook for OAuth callback logic
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
      dispatch({ type: 'ERROR', error: 'Missing required OAuth parameters' });
      return;
    }

    const storedState = localStorage.getItem('latestCSRFToken') || '';
    const authFlow = localStorage.getItem('osfAuthFlow') || '';

    // For linking flow, wait for user to be loaded
    if (authFlow === 'linking' && !user?.uid) {
      return; // Wait for user context
    }

    // Process OAuth callback directly in useEffect
    const processCallback = async () => {
      // Prevent duplicate processing
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        // Validate CSRF token
        if (urlState !== storedState) {
          throw new Error('Invalid state parameter. Possible CSRF attack.');
        }

        const isSignup = authFlow === 'signup';
        const isSignin = authFlow === 'signin';
        const isLinking = authFlow === 'linking';

        const requestBody = {
          code: urlCode,
          state: urlState,
          isSignup: isSignup || isSignin,
          ...(isLinking && { uid: user?.uid })
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
          
          // Clean up localStorage
          localStorage.removeItem('latestCSRFToken');
          localStorage.removeItem('osfAuthFlow');
          
          // Redirect immediately on success (industry standard)
          const redirectPath = json.customToken ? '/admin' : (process.env.NEXT_PUBLIC_OAUTH_FINAL || '/admin');
          router.push(redirectPath);
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
          <VStack spacing={6}>
            <Center>
              <Spinner size="xl" color="blue.500" thickness="4px" />
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
          <VStack spacing={6}>
            <Alert status="error" borderRadius="md" bg="red.800" borderColor="red.600" borderWidth={1}>
              <AlertIcon color="red.300" />
              <VStack spacing={2} align="start">
                <Text fontWeight="medium" color="white">Authentication Failed</Text>
                <Text fontSize="sm" color="gray.100">{error}</Text>
              </VStack>
            </Alert>
            
            <VStack spacing={3} w="full">
              <Button colorScheme="blue" onClick={() => router.push('/signin')} w="full">
                Sign In
              </Button>
            </VStack>
          </VStack>
        );

      default:
        return (
          <VStack spacing={6}>
            <Center>
              <Spinner size="xl" color="blue.500" thickness="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Completing authentication...
            </Heading>
          </VStack>
        );
    }
  };

  return (
    <Card w={400} mx="auto">
      <CardBody p={8}>
        <VStack spacing={6}>
          <Heading size="lg" textAlign="center">OSF Authentication</Heading>
          {renderContent()}
        </VStack>
      </CardBody>
    </Card>
  );
}

// Disable SSR for this component to avoid Firebase auth issues
OAuth2CallbackPage.getInitialProps = async () => {
  return {};
};

export default OAuth2CallbackPage;