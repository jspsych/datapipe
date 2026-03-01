import { VStack, Heading, Text, Button, Alert, Card, Spinner, Center, Box, Input, Field } from "@chakra-ui/react";
import { useSearchParams } from 'next/navigation';
import { useEffect, useContext, useState, useRef } from "react";
import { UserContext } from "../lib/context";
import { createExperiment, getUserOsfToken } from "../lib/experiment-creation";
import { validateOsfAccess, getOsfComponentInfo, generateOsfComponentName, cleanOsfUrl } from "../lib/osf-utils";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db, auth } from "../lib/firebase";

function useOSFEntry() {
  const { user, loading: userLoading } = useContext(UserContext);
  const searchParams = useSearchParams();
  const [state, setState] = useState({
    status: 'loading',
    error: null,
    projectInfo: null
  });
  const processingRef = useRef(false);
  const titleRef = useRef(null);

  const osfUserId = cleanOsfUrl(searchParams?.get('userIri'));
  const osfComponentId = cleanOsfUrl(searchParams?.get('nodeIri'));

  const [userData, userDataLoading] = useDocumentData(
    user?.uid ? doc(db, "users", user.uid) : null
  );

  useEffect(() => {
    if (userLoading || userDataLoading) return;

    // Don't override active or terminal states
    if (['creating', 'success', 'authenticating'].includes(state.status)) return;

    if (!osfUserId) {
      setState({
        status: 'error',
        error: 'Missing required parameters. This page must be accessed with a valid OSF user.',
        projectInfo: null
      });
      return;
    }

    if (!osfComponentId) {
      if (user?.uid && userData?.osfUserId === osfUserId) {
        setState(prev => ({ ...prev, status: 'link-already-done' }));
        return;
      }

      if (user?.uid && userData?.osfUserId && userData?.osfUserId !== osfUserId) {
        setState({
          status: 'link-error',
          error: `You are signed in with OSF account ${userData.osfUserId}, but this link is for ${osfUserId}. Please sign out and try again.`,
          projectInfo: null
        });
        return;
      }

      setState(prev => ({ ...prev, status: 'link-ready' }));
      return;
    }

    if (!user?.uid) {
      setState(prev => ({ ...prev, status: 'needs-auth' }));
      return;
    }

    if (userData?.osfUserId === osfUserId) {
      setState(prev => ({ ...prev, status: 'ready' }));
      return;
    }

    if (userData?.osfUserId && userData?.osfUserId !== osfUserId) {
      setState({
        status: 'error',
        error: `You are signed in with OSF account ${userData.osfUserId}, but this link is for ${osfUserId}. Please sign out and try again.`,
        projectInfo: null
      });
      return;
    }

    setState(prev => ({ ...prev, status: 'needs-auth' }));
  }, [user, userLoading, userData, userDataLoading, osfUserId, osfComponentId, state.status]);

  const handleAuthenticate = async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    setState(prev => ({ ...prev, status: 'authenticating' }));

    try {
      const stateRes = await fetch(process.env.NEXT_PUBLIC_GENERATE_STATE, { method: 'POST' });
      if (!stateRes.ok) throw new Error('Failed to generate state');
      const { state } = await stateRes.json();

      localStorage.setItem('osfAuthFlow', 'osf-entry');
      localStorage.setItem('osfEntryComponentId', osfComponentId);
      localStorage.setItem('osfEntryUserId', osfUserId);
      localStorage.setItem('latestCSRFToken', state);

      const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
      const scope = "osf.full_write";
      const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
      const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline`;

      window.location.href = url;
    } catch (err) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'Failed to initiate authentication. Please try again.'
      }));
      processingRef.current = false;
    }
  };

  const handleCreateExperiment = async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    const experimentTitle = titleRef.current?.value || 'DataPipe Data';

    setState(prev => ({ ...prev, status: 'creating' }));

    try {
      if (!userData?.uid) {
        throw new Error('You are not signed in to DataPipe. Please sign in first.');
      }

      if (!userData?.osfUserId) {
        throw new Error('Your OSF account is not linked. Please sign in with OSF first.');
      }

      const osfToken = await getUserOsfToken(auth.currentUser);
      if (!osfToken) {
        throw new Error('Your OSF authentication has expired. Please sign out and sign in again with OSF.');
      }

      await validateOsfAccess(osfToken, osfComponentId);

      const componentInfo = await getOsfComponentInfo(osfToken, osfComponentId);

      const dataComponentName = generateOsfComponentName(experimentTitle);

      const result = await createExperiment({
        title: experimentTitle,
        osfRepo: osfComponentId,
        osfComponentName: dataComponentName,
        region: componentInfo.region,
        uid: userData.uid,
        nConditions: 1,
        useValidation: true,
        allowJSON: true,
        allowCSV: true,
        useSessionLimit: false,
        maxSessions: 1
      });

      setState(prev => ({
        ...prev,
        status: 'success',
        projectInfo: {
          experimentId: result.experimentId,
          title: result.title,
          osfComponent: result.osfComponent,
          osfProject: result.osfProject
        }
      }));
    } catch (error) {
      console.error('Experiment creation error:', error);
      setState(prev => ({
        ...prev,
        status: 'error',
        error: error.message || 'Failed to create experiment'
      }));

    } finally {
      processingRef.current = false;
    }
  };

  return {
    state,
    osfUserId,
    osfComponentId,
    handleAuthenticate,
    handleCreateExperiment,
    titleRef,
    isAuthenticated: user?.uid && userData?.osfUserId === osfUserId,
    user: userData
  };
}

function OSFEntryPage() {
  const { state, osfUserId, osfComponentId, handleAuthenticate, handleCreateExperiment, titleRef, isAuthenticated, user: userData } = useOSFEntry();

  const renderContent = () => {
    switch (state.status) {
      case 'loading':
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="blue.500" borderWidth="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Loading...
            </Heading>
          </VStack>
        );

      case 'needs-auth':
        return (
          <VStack gap={6}>
            <Heading size="lg" textAlign="center">
              Create DataPipe Experiment
            </Heading>
            <Text textAlign="center" color="gray.300">
              Sign in with your OSF account to create a DataPipe experiment linked to your OSF project.
            </Text>
            <Box bg="greyBackground" p={4} borderRadius="md" w="full" border="1px solid" borderColor="gray.600">
              <Text fontSize="sm" color="white" mb={2}>
                <strong>OSF Component:</strong> {osfComponentId}
              </Text>
              <Text fontSize="sm" color="white">
                <strong>OSF User:</strong> {osfUserId}
              </Text>
            </Box>
            <Button
              colorPalette="brandTeal"
              onClick={handleAuthenticate}
              size="lg"
              w="full"
            >
              Sign in with OSF
            </Button>
          </VStack>
        );

      case 'ready':
        return (
          <VStack gap={6}>
            <Heading size="lg" textAlign="center">
              Create DataPipe Experiment
            </Heading>
            <Text textAlign="center" color="gray.300">
              Create a new DataPipe experiment linked to your OSF project.
            </Text>
            <Box bg="greyBackground" p={4} borderRadius="md" w="full" border="1px solid" borderColor="gray.600">
              <Text fontSize="sm" color="white" mb={2}>
                <strong>OSF Component:</strong> {osfComponentId}
              </Text>
              <Text fontSize="sm" color="white">
                <strong>OSF User:</strong> {osfUserId}
              </Text>
            </Box>
            <Box w="full">
              <Field.Root>
                <Field.Label mb={1}>Experiment Name</Field.Label>
                <Input
                  ref={titleRef}
                  placeholder="DataPipe Data"
                  size="md"
                  w="full"
                />
              </Field.Root>
            </Box>
            <Button
              colorPalette="brandTeal"
              onClick={handleCreateExperiment}
              size="lg"
              w="full"
            >
              Create Experiment
            </Button>
          </VStack>
        );

      case 'authenticating':
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="blue.500" borderWidth="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Redirecting to OSF...
            </Heading>
            <Text color="gray.300" textAlign="center">
              Please complete authentication with OSF.
            </Text>
          </VStack>
        );

      case 'creating':
        return (
          <VStack gap={6}>
            <Center>
              <Spinner size="xl" color="green.500" borderWidth="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Creating Experiment...
            </Heading>
            <Text color="gray.300" textAlign="center">
              Setting up your DataPipe experiment and OSF integration.
            </Text>
          </VStack>
        );

      case 'success':
        return (
          <VStack gap={6}>
            <Alert.Root status="success" borderRadius="md" bg="green.800" borderColor="green.600" borderWidth={1}>
              <Alert.Indicator color="green.300" />
              <VStack gap={2} align="start">
                <Text fontWeight="medium" color="white">Experiment Created Successfully!</Text>
                {state.projectInfo && (
                  <Text fontSize="sm" color="gray.100">
                    Experiment &ldquo;{state.projectInfo.title}&rdquo; is ready to collect data.
                  </Text>
                )}
              </VStack>
            </Alert.Root>
            <VStack gap={3} w="full">
              <Text fontSize="sm" color="gray.300" textAlign="center">
                Your DataPipe experiment is now ready to collect data.
              </Text>
              <VStack gap={2} w="full">
                <Button
                  colorPalette="brandTeal"
                  size="md"
                  w="full"
                  onClick={() => {
                    const baseUrl = process.env.NODE_ENV === 'production' ? 'https://pipe.jspsych.org' : 'http://localhost:5000';
                    const experimentUrl = `${baseUrl}/admin/${state.projectInfo.experimentId}`;
                    window.location.href = experimentUrl;
                  }}
                >
                  Open Experiment in DataPipe
                </Button>
              </VStack>
            </VStack>
          </VStack>
        );

      case 'error':
        return (
          <VStack gap={6}>
            <Alert.Root status="error" borderRadius="md" bg="red.800" borderColor="red.600" borderWidth={1}>
              <Alert.Indicator color="red.300" />
              <VStack gap={2} align="start">
                <Text fontWeight="medium" color="white">Error</Text>
                <Text fontSize="sm" color="gray.100">{state.error}</Text>
              </VStack>
            </Alert.Root>

            <VStack gap={3}>
              {state.error.includes('authentication has expired') || state.error.includes('sign out') ? (
                <Button
                  colorPalette="brandTeal"
                  onClick={handleAuthenticate}
                  size="sm"
                >
                  Re-authenticate with OSF
                </Button>
              ) : null}
              <Text fontSize="xs" color="gray.400" textAlign="center">
                You can safely close this tab and try again from OSF.
              </Text>
            </VStack>
          </VStack>
        );

      case 'link-ready':
        return (
          <VStack gap={6}>
            <Heading size="lg" textAlign="center">
              Link Your OSF Account
            </Heading>
            <Text textAlign="center" color="gray.300">
              To proceed, please link your OSF account to DataPipe.
            </Text>
            <Button
              colorPalette="brandTeal"
              onClick={handleAuthenticate}
              size="lg"
              w="full"
            >
              Sign in with OSF
            </Button>
          </VStack>
        );

      case 'link-already-done':
        return (
          <VStack gap={6}>
            <Alert.Root status="success" borderRadius="md" bg="green.800" borderColor="green.600" borderWidth={1}>
              <Alert.Indicator color="green.300" />
              <VStack gap={2} align="start">
                <Text fontWeight="medium" color="white">Your OSF account is linked!</Text>
                <Text fontSize="sm" color="gray.100">
                  You can now close this window and return to the OSF.
                </Text>
              </VStack>
            </Alert.Root>
            <Text fontSize="sm" color="gray.400" textAlign="center">
              You can safely close this tab and return to OSF.
            </Text>
          </VStack>
        );

      case 'link-error':
        return (
          <VStack gap={6}>
            <Alert.Root status="error" borderRadius="md" bg="red.800" borderColor="red.600" borderWidth={1}>
              <Alert.Indicator color="red.300" />
              <VStack gap={2} align="start">
                <Text fontWeight="medium" color="white">Linking Error</Text>
                <Text fontSize="sm" color="gray.100">{state.error}</Text>
              </VStack>
            </Alert.Root>
            <Text fontSize="sm" color="gray.400" textAlign="center">
              You can safely close this tab and try again from OSF.
            </Text>
          </VStack>
        );

      default:
        return (
          <VStack gap={6}>
            <Heading size="md" textAlign="center">
              Loading...
            </Heading>
          </VStack>
        );
    }
  };

  return (
    <Box minH="100vh" bg="greyBackground" py={8}>
      <Card.Root w={400} mx="auto" mt={8} variant="unstyled" color="white">
        <Card.Body p={8}>
          {renderContent()}
        </Card.Body>
      </Card.Root>
    </Box>
  );
}

OSFEntryPage.getLayout = function getLayout(page) {
  return page;
};

export default OSFEntryPage;
