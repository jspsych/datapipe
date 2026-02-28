import {
  HStack,
  VStack,
  Text,
  Link,
  Button,
  IconButton,
  Dialog,
  Field,
  Input,
} from "@chakra-ui/react"
import { useContext, useState } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";

import { CircleCheck, TriangleAlert, CircleHelp } from "lucide-react";
import { OsfIcon } from "../OsfIcon";

export default function SelectAuth() {
    const { user } = useContext(UserContext);

    const [data, loading, error] = useDocumentData(
        doc(db, "users", user.uid)
    );

    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [isTokenOpen, setIsTokenOpen] = useState(false);
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

    const handleAuthClick = async () => {
        try {
            const stateRes = await fetch(process.env.NEXT_PUBLIC_GENERATE_STATE, { method: 'POST' });
            if (!stateRes.ok) throw new Error('Failed to generate state');
            const { state: redirectState } = await stateRes.json();

            localStorage.setItem('latestCSRFToken', redirectState);
            localStorage.setItem('osfAuthFlow', 'linking');

            const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
            const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
            const scope = "osf.full_write"
            const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
            const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${redirectState}&scope=${scope}&access_type=offline&approval_prompt=force`;
            window.location.href = url;
        } catch (err) {
            console.error('Failed to initiate OSF auth:', err);
        }
    }

    const handleSaveToken = async () => {
        const token = document.querySelector("#osf-token").value;
        setIsSubmittingToken(true);
        try {
            const idToken = await auth.currentUser.getIdToken();
            const response = await fetch("/api/saveosftoken", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                },
                body: JSON.stringify({ token }),
            });
            if (!response.ok) {
                throw new Error("Failed to save token");
            }
            setIsSubmittingToken(false);
            setIsTokenOpen(false);
        } catch (error) {
            setIsSubmittingToken(false);
            console.log(error);
        }
    }

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;

    const usingPersonalToken = data?.usingPersonalToken;
    const hasOAuthToken = data?.authToken && data?.refreshToken;
    const hasPersonalToken = data?.osfToken;
    const hasValidPersonalToken = data?.osfTokenValid;

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
            <VStack gap={4} w="100%" align="stretch">
                <VStack gap={2} w="100%" align="start">
                    <Text fontSize="lg">OSF Authentication</Text>
                    <Text fontSize="sm" color={getStatusColor()}>
                        {getStatusText()}
                    </Text>
                </VStack>

                {!usingPersonalToken && (
                    <VStack gap={3} align="stretch">
                        <Button
                            colorPalette="blue"
                            onClick={handleAuthClick}
                            size="md"
                        >
                            <OsfIcon /> {hasOAuthToken ? "Re-link OSF Account" : "Link OSF Account"}
                        </Button>

                        <HStack justify="center" gap={1}>
                            <Link
                                color="gray.500"
                                fontSize="sm"
                                onClick={handleSwitchToPersonalToken}
                                cursor="pointer"
                            >
                                Use personal access token instead
                            </Link>
                            <IconButton
                                rounded={"full"}
                                size="xs"
                                variant="ghost"
                                colorPalette="gray"
                                onClick={() => setIsHelpOpen(true)}
                                aria-label="Help with authentication methods"
                            >
                                <CircleHelp />
                            </IconButton>
                        </HStack>
                    </VStack>
                )}

                {usingPersonalToken && (
                    <VStack gap={3} align="stretch">
                        <Button
                            colorPalette="brandTeal"
                            onClick={() => setIsTokenOpen(true)}
                            loading={isSubmittingToken}
                        >
                            Set OSF Token
                        </Button>

                        <HStack justify="center" gap={1}>
                            <Link
                                color="blue.500"
                                fontSize="sm"
                                onClick={handleSwitchToOAuth}
                                cursor="pointer"
                            >
                                Switch to one-click authentication
                            </Link>
                            <IconButton
                                rounded={"full"}
                                size="xs"
                                variant="ghost"
                                colorPalette="gray"
                                onClick={() => setIsHelpOpen(true)}
                                aria-label="Help with authentication methods"
                            >
                                <CircleHelp />
                            </IconButton>
                        </HStack>
                    </VStack>
                )}
            </VStack>

            {/* Help Dialog */}
            <Dialog.Root open={isHelpOpen} onOpenChange={(e) => setIsHelpOpen(e.open)} size="lg">
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content bg="blackAlpha.800" color="white">
                        <Dialog.Header>OSF Authentication Methods</Dialog.Header>
                        <Dialog.CloseTrigger />
                        <Dialog.Body>
                            <VStack gap={4} align="start">
                                <VStack gap={2} align="start">
                                    <Text fontWeight="bold" color="blue.600">One-Click Authentication (Recommended)</Text>
                                    <Text fontSize="sm">
                                        Links your DataPipe account directly with your OSF account using OAuth.
                                        This method automatically manages authentication tokens and requires no manual setup.
                                    </Text>
                                    <Text fontSize="sm" fontWeight="medium">Benefits:</Text>
                                    <Text fontSize="sm" ml={4}>
                                        - Easier to use: no need to copy/paste tokens<br/>
                                        - Automatic token renewal handled by DataPipe<br/>
                                        - More secure
                                    </Text>
                                </VStack>

                                <VStack gap={2} align="start">
                                    <Text fontWeight="bold" color="orange.600">Personal Access Token</Text>
                                    <Text fontSize="sm">
                                        Uses a manually created token from your OSF settings. You need to generate
                                        this token yourself on the OSF website and paste it into DataPipe.
                                    </Text>
                                    <Text fontSize="sm" fontWeight="medium">When to use:</Text>
                                    <Text fontSize="sm" ml={4}>
                                        - You prefer manual token management<br/>
                                        - Your organization requires it<br/>
                                        - You want more direct control over permissions
                                    </Text>
                                </VStack>
                            </VStack>
                        </Dialog.Body>

                        <Dialog.Footer>
                            <Button colorPalette="blue" onClick={() => setIsHelpOpen(false)}>
                                Got it
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>

            {/* OSF Token Dialog */}
            <Dialog.Root open={isTokenOpen} onOpenChange={(e) => setIsTokenOpen(e.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content bg="greyBackground" color="white">
                        <Dialog.Header>Set OSF Personal Access Token</Dialog.Header>
                        <Dialog.CloseTrigger />
                        <Dialog.Body>
                            <VStack gap={4} w="100%">
                                <Text>
                                    To generate an OSF token, go to{" "}
                                    <Link
                                        color="brandOrange.100"
                                        href={`https://${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/settings/tokens/`}
                                        target="_blank"
                                        rel="noopener noreferrer"
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
                                    <VStack gap={4} w="100%">
                                        <Field.Root id="osf-token">
                                            <Field.Label>OSF Token</Field.Label>
                                            <Input type="text" placeholder="Paste your OSF token here" />
                                        </Field.Root>
                                    </VStack>
                                )}
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button
                                variant="solid"
                                colorPalette="brandTeal"
                                size="md"
                                mr={4}
                                onClick={handleSaveToken}
                                loading={isSubmittingToken}
                            >
                                Save Token
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </>
    );
}
