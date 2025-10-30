import { 
  HStack, 
  VStack, 
  Text, 
  Link, 
  Button, 
  IconButton,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Input,
  useDisclosure
} from "@chakra-ui/react"
import { useContext, useState, useEffect } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { CheckCircleIcon, WarningIcon, QuestionIcon } from "@chakra-ui/icons";
import { OsfIcon } from "../OsfIcon";

export default function SelectAuth() {
    const { user } = useContext(UserContext);

    const [data, loading, error] = useDocumentData(
        doc(db, "users", user.uid)
    );

    const { isOpen: isHelpOpen, onOpen: onHelpOpen, onClose: onHelpClose } = useDisclosure();
    const { isOpen: isTokenOpen, onOpen: onTokenOpen, onClose: onTokenClose } = useDisclosure();
    const [isSubmittingToken, setIsSubmittingToken] = useState(false);

    const handleSwitchToPersonalToken = () => {
        setDoc(doc(db, "users", user.uid), {
            usingPersonalToken: true,
        }, { merge: true });
    }

    const handleSwitchToOAuth = () => {
        setDoc(doc(db, "users", user.uid), {
            usingPersonalToken: false,
        }, { merge: true });
    }

    const handleAuthClick = () => {
        const redirectState = crypto.randomUUID().substring(0, 6);
        localStorage.setItem('latestCSRFToken', redirectState);
        localStorage.setItem('osfAuthFlow', 'linking');
        
        const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
        const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
        const scope = "osf.full_write"
        const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
        const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${redirectState}&scope=${scope}&access_type=offline&approval_prompt=force`;
        window.location.href = url;
    }

    const handleSaveToken = async () => {
        const token = document.querySelector("#osf-token").value;
        setIsSubmittingToken(true);
        try {
            const isTokenValid = await checkOSFToken(token);
            const userDoc = doc(db, "users", user.uid);
            await setDoc(
                userDoc,
                { osfToken: token, osfTokenValid: isTokenValid },
                { merge: true }
            );
            setIsSubmittingToken(false);
            onTokenClose();
        } catch (error) {
            setIsSubmittingToken(false);
            console.log(error);
        }
    }

    const checkOSFToken = async (token) => {
        const response = await fetch(`https://api.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/v2/`, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        return response.status === 200;
    }

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;

    const usingPersonalToken = data?.usingPersonalToken;
    const hasOAuthToken = data?.authToken && data?.refreshToken;
    const hasPersonalToken = data?.osfToken;
    const hasValidPersonalToken = data?.osfTokenValid;

    // Show status text
    const getStatusText = () => {
        if (usingPersonalToken) {
            return hasPersonalToken 
                ? hasValidPersonalToken
                    ? "Connected to OSF via personal access token"
                    : "Personal access token invalid - please update"
                : "Not connected - personal access token required";
        } else {
            return hasOAuthToken 
                ? "Connected to OSF via one-click authentication"
                : "Not connected - click below to link your OSF account";
        }
    };

    const getStatusColor = () => {
        const isConnected = usingPersonalToken ? hasValidPersonalToken : hasOAuthToken;
        return isConnected ? "green.600" : "orange.600";
    };

    return (
        <>
            <VStack spacing={4} w="100%" align="stretch">
                <VStack spacing={2} w="100%" align="start">
                    <Text fontSize="lg">OSF Authentication</Text>
                    <Text fontSize="sm" color={getStatusColor()}>
                        {getStatusText()}
                    </Text>
                </VStack>
                
                {!usingPersonalToken && (
                    <VStack spacing={3} align="stretch">
                        <Button 
                            colorScheme="blue" 
                            leftIcon={<OsfIcon />} 
                            onClick={handleAuthClick}
                            size="md"
                        >
                            {hasOAuthToken ? "Re-link OSF Account" : "Link OSF Account"}
                        </Button>
                        
                        <HStack justify="center" spacing={1}>
                            <Link 
                                color="gray.500" 
                                fontSize="sm" 
                                onClick={handleSwitchToPersonalToken}
                                cursor="pointer"
                            >
                                Use personal access token instead
                            </Link>
                            <IconButton
                                icon={<QuestionIcon />}
                                isRound={true}
                                size="xs"
                                variant="ghost"
                                colorScheme="gray"
                                onClick={onHelpOpen}
                                aria-label="Help with authentication methods"
                                _hover={{
                                    bg: "gray",
                                }}
                            />
                        </HStack>
                    </VStack>
                )}

                {usingPersonalToken && (
                    <VStack spacing={3} align="stretch">
                        <Button 
                            colorScheme="brandTeal" 
                            onClick={onTokenOpen}
                            isLoading={isSubmittingToken}
                        >
                            Set OSF Token
                        </Button>
                        
                        <HStack justify="center" spacing={1}>
                            <Link 
                                color="blue.500" 
                                fontSize="sm" 
                                onClick={handleSwitchToOAuth}
                                cursor="pointer"
                            >
                                Switch to one-click authentication
                            </Link>
                            <IconButton
                                icon={<QuestionIcon />}
                                isRound={true}
                                size="xs"
                                variant="ghost"
                                colorScheme="gray"
                                onClick={onHelpOpen}
                                aria-label="Help with authentication methods"
                                _hover={{
                                    bg: "gray",
                                }}
                            />
                        </HStack>
                    </VStack>
                )}
            </VStack>

            {/* Help Modal */}
            <Modal isOpen={isHelpOpen} onClose={onHelpClose} size="lg">
                <ModalOverlay />
                <ModalContent bg="blackAlpha.800">
                    <ModalHeader>OSF Authentication Methods</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <VStack spacing={4} align="start">
                            <VStack spacing={2} align="start">
                                <Text fontWeight="bold" color="blue.600">🔗 One-Click Authentication (Recommended)</Text>
                                <Text fontSize="sm">
                                    Links your DataPipe account directly with your OSF account using OAuth. 
                                    This method automatically manages authentication tokens and requires no manual setup.
                                </Text>
                                <Text fontSize="sm" fontWeight="medium">Benefits:</Text>
                                <Text fontSize="sm" ml={4}>
                                    • Easier to use: no need to copy/paste tokens<br/>
                                    • Automatic token renewal handled by DataPipe<br/>
                                    • More secure
                                </Text>
                            </VStack>
                            
                            <VStack spacing={2} align="start">
                                <Text fontWeight="bold" color="orange.600">🔑 Personal Access Token</Text>
                                <Text fontSize="sm">
                                    Uses a manually created token from your OSF settings. You need to generate 
                                    this token yourself on the OSF website and paste it into DataPipe.
                                </Text>
                                <Text fontSize="sm" fontWeight="medium">When to use:</Text>
                                <Text fontSize="sm" ml={4}>
                                    • You prefer manual token management<br/>
                                    • Your organization requires it<br/>
                                    • You want more direct control over permissions
                                </Text>
                            </VStack>
                        </VStack>
                    </ModalBody>

                    <ModalFooter>
                        <Button colorScheme="blue" onClick={onHelpClose}>
                            Got it
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {/* OSF Token Modal */}
            <Modal isOpen={isTokenOpen} onClose={onTokenClose}>
                <ModalOverlay />
                <ModalContent bg="greyBackground">
                    <ModalHeader>Set OSF Personal Access Token</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        <VStack spacing={4} w="100%">
                            <Text>
                                To generate an OSF token, go to{" "}
                                <Link
                                    color="brandOrange.100"
                                    href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/settings/tokens/`}
                                    isExternal
                                >
                                    https://osf.io/settings/tokens/
                                </Link>{" "}
                                and click &quot;Create Token&quot;.
                            </Text>
                            <Text>
                                Select osf.full_write under scopes and click &quot;Create
                                token&quot;. Copy the token and paste it below.
                            </Text>

                            {data && (
                                <VStack spacing={4} w="100%">
                                    <FormControl id="osf-token">
                                        <FormLabel>OSF Token</FormLabel>
                                        <Input type="text" defaultValue={data.osfToken} />
                                    </FormControl>
                                </VStack>
                            )}
                        </VStack>
                    </ModalBody>
                    <ModalFooter>
                        <Button
                            variant="solid"
                            colorScheme="brandTeal"
                            size="md"
                            mr={4}
                            onClick={handleSaveToken}
                            isLoading={isSubmittingToken}
                        >
                            Save Token
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
}