'use client';

import { VStack, Heading, Text, Button, Alert, AlertIcon, Card, CardBody, Spinner, Center, Box } from "@chakra-ui/react";
import { useSearchParams } from 'next/navigation';
import { useEffect, useContext, useState, useRef } from "react";
import { UserContext } from "../lib/context";
import { createExperiment, getUserOsfToken } from "../lib/experiment-creation";
import { validateOsfAccess, getOsfComponentInfo, generateOsfComponentName } from "../lib/osf-utils";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc } from "firebase/firestore";
import { db } from "../lib/firebase";

// Custom hook for OSF entry point logic
function useOSFEntry() {
  const { user, loading: userLoading } = useContext(UserContext);
  const searchParams = useSearchParams();
  const [state, setState] = useState({
    status: 'loading', // 'loading' | 'ready' | 'authenticating' | 'creating' | 'success' | 'error'
    error: null,
    projectInfo: null
  });
  const processingRef = useRef(false);

  const osfUserId = searchParams?.get('osf_user_id');
  const osfComponentId = searchParams?.get('osf_component_id');

  // Load full user data from Firestore
  const [userData, userDataLoading] = useDocumentData(
    user?.uid ? doc(db, "users", user.uid) : null
  );

  useEffect(() => {
    if (userLoading || userDataLoading) return;

    // Validate required parameters
    if (!osfUserId || !osfComponentId) {
      setState({
        status: 'error',
        error: 'Missing required parameters. This page must be accessed with valid OSF user and component IDs.',
        projectInfo: null
      });
      return;
    }


    // If user is already authenticated and has the correct OSF linked, proceed to experiment creation
    if (user?.uid && userData?.osfUserId === osfUserId) {
      setState(prev => ({ ...prev, status: 'ready' }));
      return;
    }

    // If user is authenticated but with different OSF account, show authentication option
    if (user?.uid && userData?.osfUserId && userData?.osfUserId !== osfUserId) {
      setState({
        status: 'error',
        error: `You are signed in with OSF account ${userData.osfUserId}, but this link is for ${osfUserId}. Please sign out and try again.`,
        projectInfo: null
      });
      return;
    }

    // User needs to authenticate (no user, or user without OSF linked)
    setState(prev => ({ ...prev, status: 'ready' }));
  }, [user, userLoading, userData, userDataLoading, osfUserId, osfComponentId]);

  const handleAuthenticate = () => {
    if (processingRef.current) return;
    processingRef.current = true;

    setState(prev => ({ ...prev, status: 'authenticating' }));
    
    // Store the OSF entry context for OAuth callback
    localStorage.setItem('osfAuthFlow', 'osf-entry');
    localStorage.setItem('osfEntryComponentId', osfComponentId);
    localStorage.setItem('osfEntryUserId', osfUserId);
    
    // Generate CSRF state
    const state = crypto.randomUUID().substring(0, 6);
    localStorage.setItem('latestCSRFToken', state);
    
    const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
    const redirectUri = "https://pipe.jspsych.org/login";
    const scope = "osf.full_write";
    const url = `https://accounts.osf.io/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline`;
    
    window.location.href = url;
  };

  const handleCreateExperiment = async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    setState(prev => ({ ...prev, status: 'creating' }));

    try {
      // Check if user is properly authenticated
      if (!userData?.uid) {
        throw new Error('You are not signed in to DataPipe. Please sign in first.');
      }

      // Check if user has OSF linked
      if (!userData?.osfUserId) {
        throw new Error('Your OSF account is not linked. Please sign in with OSF first.');
      }

      // Get OSF token for validation
      const osfToken = await getUserOsfToken({ uid: userData.uid });
      if (!osfToken) {
        throw new Error('Your OSF authentication has expired. Please sign out and sign in again with OSF.');
      }

      // Validate access to the OSF component
      await validateOsfAccess(osfToken, osfComponentId);

      // Get component info for experiment title
      const componentInfo = await getOsfComponentInfo(osfToken, osfComponentId);
      
      // Generate experiment title and component name
      const experimentTitle = `${componentInfo.title} - DataPipe Experiment`;
      const dataComponentName = generateOsfComponentName();

      // Create the experiment using frontend utilities
      const result = await createExperiment({
        title: experimentTitle,
        osfRepo: osfComponentId,
        osfComponentName: dataComponentName,
        region: 'us',
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
    isAuthenticated: user?.uid && userData?.osfUserId === osfUserId,
    user: userData
  };
}

function OSFEntryPage() {
  const { state, osfUserId, osfComponentId, handleAuthenticate, handleCreateExperiment, isAuthenticated, user: userData } = useOSFEntry();

  const renderContent = () => {
    switch (state.status) {
      case 'loading':
        return (
          <VStack spacing={6}>
            <Center>
              <Spinner size="xl" color="blue.500" thickness="4px" />
            </Center>
            <Heading size="md" textAlign="center">
              Loading...
            </Heading>
          </VStack>
        );

      case 'ready':
        return (
          <VStack spacing={6}>
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
            
            {userData?.uid && userData?.osfUserId === osfUserId ? (
              <Button 
                colorScheme="brandTeal" 
                onClick={handleCreateExperiment}
                size="lg"
                w="full"
              >
                Create Experiment
              </Button>
            ) : userData?.uid ? (
              <VStack spacing={3}>
                <Text fontSize="sm" color="gray.300" textAlign="center">
                  {userData?.osfUserId ? 
                    `You're signed in with OSF account ${userData.osfUserId}, but this link is for ${osfUserId}.` :
                    "Your DataPipe account isn't linked to OSF yet."
                  }
                </Text>
                <Button 
                  colorScheme="brandTeal" 
                  onClick={handleAuthenticate}
                  size="lg"
                  w="full"
                >
                  {userData?.osfUserId ? 'Switch OSF Account' : 'Link OSF Account'}
                </Button>
              </VStack>
            ) : (
              <VStack spacing={3}>
                <Text fontSize="sm" color="gray.300" textAlign="center">
                  You need to sign in to DataPipe with your OSF account.
                </Text>
                <Button 
                  colorScheme="brandTeal" 
                  onClick={handleAuthenticate}
                  size="lg"
                  w="full"
                >
                  Sign in with OSF
                </Button>
              </VStack>
            )}
          </VStack>
        );

      case 'authenticating':
        return (
          <VStack spacing={6}>
            <Center>
              <Spinner size="xl" color="blue.500" thickness="4px" />
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
          <VStack spacing={6}>
            <Center>
              <Spinner size="xl" color="green.500" thickness="4px" />
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
          <VStack spacing={6}>
            <Alert status="success" borderRadius="md" bg="green.800" borderColor="green.600" borderWidth={1}>
              <AlertIcon color="green.300" />
              <VStack spacing={2} align="start">
                <Text fontWeight="medium" color="white">Experiment Created Successfully!</Text>
                {state.projectInfo && (
                  <Text fontSize="sm" color="gray.100">
                    Experiment &ldquo;{state.projectInfo.title}&rdquo; is ready to collect data.
                  </Text>
                )}
              </VStack>
            </Alert>
            <VStack spacing={3} w="full">
              <Text fontSize="sm" color="gray.300" textAlign="center">
                Your DataPipe experiment is now ready to collect data.
              </Text>
              <VStack spacing={2} w="full">
                <Button 
                  colorScheme="brandTeal"
                  size="md" 
                  w="full"
                  onClick={() => {
                    const baseUrl = process.env.NODE_ENV === 'production' ? 'https://pipe.jspsych.org' : 'http://localhost:5000';
                    const experimentUrl = `${baseUrl}/admin/${state.projectInfo.experimentId}`;
                    // Add small delay to ensure experiment is fully created before opening
                    setTimeout(() => {
                      window.open(experimentUrl, '_blank');
                      window.close();
                    }, 500);
                  }}
                >
                  Open Experiment in DataPipe
                </Button>
                <Button 
                  variant="outline"
                  size="md"
                  w="full"
                  onClick={() => window.close()}
                >
                  Close
                </Button>
              </VStack>
            </VStack>
          </VStack>
        );

      case 'error':
        return (
          <VStack spacing={6}>
            <Alert status="error" borderRadius="md">
              <AlertIcon />
              <VStack spacing={2} align="start">
                <Text fontWeight="medium">Error</Text>
                <Text fontSize="sm">{state.error}</Text>
              </VStack>
            </Alert>
            
            <VStack spacing={3}>
              {state.error.includes('authentication has expired') || state.error.includes('sign out') ? (
                <Button 
                  colorScheme="brandTeal" 
                  onClick={handleAuthenticate}
                  size="sm"
                >
                  Re-authenticate with OSF
                </Button>
              ) : null}
              <Button 
                colorScheme="blue" 
                variant="outline"
                onClick={() => window.close()}
                size="sm"
              >
                Close Window
              </Button>
              <Text fontSize="xs" color="gray.400" textAlign="center">
                You can safely close this window and try again from OSF.
              </Text>
            </VStack>
          </VStack>
        );

      default:
        return (
          <VStack spacing={6}>
            <Heading size="md" textAlign="center">
              Loading...
            </Heading>
          </VStack>
        );
    }
  };

  return (
    <Box minH="100vh" bg="greyBackground" py={8}>
      <Card w={400} mx="auto" mt={8}>
        <CardBody p={8}>
          {renderContent()}
        </CardBody>
      </Card>
    </Box>
  );
}

// Disable SSR for this component to avoid hydration issues
OSFEntryPage.getInitialProps = async () => {
  return {};
};

// Opt out of the default layout (navbar/footer) for popup usage
OSFEntryPage.getLayout = function getLayout(page) {
  return page;
};

export default OSFEntryPage;