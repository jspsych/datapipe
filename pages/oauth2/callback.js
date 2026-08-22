import { VStack, Heading, Text, Button, Card, Spinner, Center } from "@chakra-ui/react";
import { useSearchParams } from 'next/navigation';
import { useEffect, useContext, useReducer, useRef } from "react";
import { useRouter } from "next/router";
import NextLink from "next/link";
import { UserContext } from "../../lib/context";
import { auth } from "../../lib/firebase";
import { signInWithCustomToken } from "firebase/auth";
import FormErrorAlert from "../../components/ui/FormErrorAlert";

const WATCHDOG_MS = 30000;

const initialState = {
  status: 'processing',
  error: null,
  authFlow: '',
};

function callbackReducer(state, action) {
  switch (action.type) {
    case 'ERROR':
      return { ...state, status: 'error', error: action.error, authFlow: action.authFlow ?? state.authFlow };
    case 'CANCELLED':
      return { ...state, status: 'cancelled', error: null };
    case 'NEEDS_SIGN_IN':
      return { ...state, status: 'needs-sign-in', error: null };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

function useOAuthCallback() {
  const { user, loading } = useContext(UserContext);
  const router = useRouter();
  const { push, isReady } = router;
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(callbackReducer, initialState);
  const processingRef = useRef(false);

  useEffect(() => {
    // Auth state is still resolving. The "linking" branch below needs to
    // know whether there really is no signed-in user, not just that one
    // hasn't loaded yet -- and painting anything before `loading` settles
    // risks the same false negative pages/oauth2/connect.js had.
    if (loading) return;

    const urlCode = searchParams.get('code');
    const urlError = searchParams.get('error');
    const urlState = searchParams.get('state');

    if (urlError) {
      if (urlError === 'access_denied') {
        dispatch({ type: 'CANCELLED' });
      } else {
        console.error('OSF OAuth error:', urlError);
        dispatch({
          type: 'ERROR',
          error: 'Could not complete the OSF sign-in. Please try again.',
        });
      }
      return;
    }

    if (!isReady) return;

    if (!urlCode || !urlState) {
      dispatch({
        type: 'ERROR',
        error:
          'This page is for finishing an OSF sign-in and needs to be opened from that flow. Start again from the sign-in page.',
      });
      return;
    }

    const storedState = localStorage.getItem('latestCSRFToken') || '';
    const authFlow = localStorage.getItem('osfAuthFlow') || '';

    if (urlState !== storedState) {
      dispatch({
        type: 'ERROR',
        error:
          'That sign-in link expired or was opened out of order. Start again from the sign-in page.',
        authFlow,
      });
      return;
    }

    if (authFlow === 'linking' && !user?.uid) {
      // Auth has settled (loading is false) and there is still no user --
      // genuinely signed out, not still resolving. Waiting forever here was
      // the infinite-spinner bug; give the researcher a way out instead.
      dispatch({ type: 'NEEDS_SIGN_IN' });
      return;
    }

    dispatch({ type: 'RESET' });

    const watchdogId = setTimeout(() => {
      dispatch({
        type: 'ERROR',
        error: 'This is taking longer than expected. Check your connection and try again.',
        authFlow,
      });
    }, WATCHDOG_MS);

    const processCallback = async () => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const isSignup = authFlow === 'signup';
        const isSignin = authFlow === 'signin';
        const isLinking = authFlow === 'linking';
        const isOsfEntry = authFlow === 'osf-entry';

        let idToken = null;
        if (isLinking && user) {
          idToken = await user.getIdToken();
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
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || `Authentication failed (${res.status})`);
        }

        const json = await res.json();

        if (!json.success) {
          throw new Error('OAuth authentication failed');
        }

        clearTimeout(watchdogId);

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
          push('/osf-entry' + (entryQuery ? '?' + entryQuery : ''));
        } else {
          localStorage.removeItem('osfAuthFlow');
          const redirectPath = json.customToken ? '/admin' : (process.env.NEXT_PUBLIC_OAUTH_FINAL || '/admin');
          push(redirectPath);
        }
      } catch (error) {
        clearTimeout(watchdogId);
        // `error.message` is developer text (an HTTP status, a raw Firebase
        // reason) by construction -- logged for diagnosis, never rendered.
        console.error('OAuth callback error:', error);
        dispatch({
          type: 'ERROR',
          error: 'Could not complete the OSF sign-in. Please try again.',
          authFlow,
        });
        processingRef.current = false;
      }
    };

    processCallback();

    return () => clearTimeout(watchdogId);
    // `user?.uid` and `push`, deliberately narrower than what this effect
    // closes over, so the disable below is a decision rather than an
    // oversight.
    //
    // The rule wants `user` and `router` in full. Both have identities nothing
    // guarantees is stable -- useAuthState hands back a fresh User object on
    // every token refresh, and useRouter is free to return a new object per
    // render -- while this effect performs a one-time OAuth code exchange and
    // dispatches on completion. Listing either means every render re-runs the
    // exchange and schedules the next render: an unbounded loop. (The sibling
    // flow in connect.js hangs its test suite outright when `router` is
    // listed, which is how this was caught.)
    //
    // The narrow deps are also the semantically right ones: the effect must
    // re-run when WHICH user is signed in changes, which is what `uid`
    // expresses. Later identity churn on the same account is not a reason to
    // redo an OAuth exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, user?.uid, loading, isReady, push]);

  return state;
}

function OAuth2CallbackPage() {
  const { status, error, authFlow } = useOAuthCallback();

  const backHref = authFlow === 'linking' ? '/admin/account' : '/signin';
  const backLabel = authFlow === 'linking' ? 'Back to account settings' : 'Back to sign in';

  const renderContent = () => {
    switch (status) {
      case 'processing':
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="brandGreen.solid" borderWidth="4px" />
            </Center>
            <Heading as="h2" fontSize="lg" fontWeight="600" textAlign="center" color="fg">
              Completing authentication…
            </Heading>
            <Text color="fg.muted" textAlign="center" aria-live="polite">
              Please wait while we sign you in with OSF.
            </Text>
          </VStack>
        );

      case 'needs-sign-in':
        return (
          <VStack gap={6} w="full">
            <VStack gap={2} align="start" w="full">
              <Heading as="h2" fontSize="lg" fontWeight="600" color="fg">
                Sign in to continue
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                You need to be signed in to link an OSF account. Sign in,
                then try connecting it again from your account settings.
              </Text>
            </VStack>
            <Button asChild colorPalette="brandGreen" w="full">
              <NextLink href="/signin">Sign in</NextLink>
            </Button>
          </VStack>
        );

      case 'cancelled':
        return (
          <VStack gap={6} w="full">
            <VStack gap={2} align="start" w="full">
              <Heading as="h2" fontSize="lg" fontWeight="600" color="fg">
                Sign-in cancelled
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                You cancelled the OSF sign-in. Nothing changed.
              </Text>
            </VStack>
            <Button asChild variant="outline" colorPalette="gray" w="full">
              <NextLink href="/signin">Back to sign in</NextLink>
            </Button>
          </VStack>
        );

      case 'error':
        return (
          <VStack gap={6} w="full">
            <FormErrorAlert>{error}</FormErrorAlert>
            <Button asChild variant="outline" colorPalette="gray" w="full">
              <NextLink href={backHref}>{backLabel}</NextLink>
            </Button>
          </VStack>
        );

      default:
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="brandGreen.solid" borderWidth="4px" />
            </Center>
            <Heading as="h2" fontSize="lg" fontWeight="600" textAlign="center" color="fg">
              Completing authentication…
            </Heading>
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
            OSF authentication
          </Heading>
          {renderContent()}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

export default OAuth2CallbackPage;
