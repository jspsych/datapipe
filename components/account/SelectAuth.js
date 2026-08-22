import {
  HStack,
  VStack,
  Text,
  Link,
  Button,
  Dialog,
  Field,
  Input,
  Spinner,
  Center,
  Alert,
  CloseButton,
} from "@chakra-ui/react"
import { useContext, useState, useRef } from "react";
import { UserContext } from "../../lib/context";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";

import { CircleCheck, TriangleAlert } from "lucide-react";
import OsfRelinkButton from "./OsfRelinkButton";

export default function SelectAuth() {
    const { user } = useContext(UserContext);

    const [data, loading, error] = useDocumentData(
        doc(db, "users", user.uid)
    );

    const [isTokenOpen, setIsTokenOpen] = useState(false);
    const [isSubmittingToken, setIsSubmittingToken] = useState(false);
    const [tokenError, setTokenError] = useState(null);
    const tokenRef = useRef(null);

    const openTokenDialog = () => {
        setTokenError(null);
        setIsTokenOpen(true);
    };

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

    const handleSaveToken = async () => {
        const token = tokenRef.current?.value;
        setIsSubmittingToken(true);
        setTokenError(null);
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
                throw new Error(
                    response.status === 401 || response.status === 403
                        ? "You are not signed in to the right account. Try reloading the page and signing in again."
                        : "Could not save your OSF token. Please try again."
                );
            }
            setIsTokenOpen(false);
        } catch (error) {
            // Dialog stays open (it already did -- this just makes the
            // failure visible instead of leaving the researcher watching the
            // spinner stop with nothing to show for it).
            setTokenError(
                error instanceof TypeError
                    ? "Could not reach DataPipe. Check your connection and try again."
                    : error.message
            );
        } finally {
            setIsSubmittingToken(false);
        }
    }

    if (loading) return <Center py={8}><Spinner size="lg" color="brandGreen.500" /></Center>;
    if (error) return <div>Error: {error.message}</div>;

    const usingPersonalToken = data?.usingPersonalToken;
    const hasOAuthToken = data?.authToken && data?.refreshToken;
    const hasValidPersonalToken = data?.osfTokenValid;

    if (!usingPersonalToken) {
        return (
            <VStack gap={1} w="100%" align="stretch">
                <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
                    <HStack>
                        <Text fontSize="lg">OSF Account</Text>
                        {hasOAuthToken && <CircleCheck color="var(--chakra-colors-green-500)" size={18} />}
                        {!hasOAuthToken && <TriangleAlert color="var(--chakra-colors-orange-500)" size={18} />}
                    </HStack>
                    <OsfRelinkButton>
                        {hasOAuthToken ? "Re-authorize OSF" : "Authorize OSF"}
                    </OsfRelinkButton>
                </HStack>
                <HStack justifyContent="flex-end" w="100%">
                    <Link
                        color="gray.500"
                        fontSize="sm"
                        onClick={handleSwitchToPersonalToken}
                        cursor="pointer"
                    >
                        Use personal access token instead
                    </Link>
                </HStack>
            </VStack>
        );
    }

    return (
        <VStack gap={1} w="100%" align="stretch">
            <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
                <HStack>
                    <Text fontSize="lg">OSF Token</Text>
                    {hasValidPersonalToken && <CircleCheck color="var(--chakra-colors-green-500)" size={18} />}
                    {!hasValidPersonalToken && <TriangleAlert color="var(--chakra-colors-orange-500)" size={18} />}
                </HStack>
                <Button
                    colorPalette="brandGreen"
                    onClick={openTokenDialog}
                    loading={isSubmittingToken}
                >
                    Set OSF Token
                </Button>
            </HStack>
            <HStack justifyContent="flex-end" w="100%">
                <Link
                    color="blue.500"
                    fontSize="sm"
                    onClick={handleSwitchToOAuth}
                    cursor="pointer"
                >
                    Switch to one-click authentication
                </Link>
            </HStack>

            {/* OSF Token Dialog */}
            <Dialog.Root open={isTokenOpen} onOpenChange={(e) => setIsTokenOpen(e.open)}>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content bg="greyBackground" color="white">
                        <Dialog.CloseTrigger asChild>
                            <CloseButton size="sm" aria-label="Close" />
                        </Dialog.CloseTrigger>
                        <Dialog.Header>Set OSF Personal Access Token</Dialog.Header>
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
                                        <Field.Root>
                                            <Field.Label>OSF Token</Field.Label>
                                            <Input ref={tokenRef} type="text" placeholder="Paste your OSF token here" />
                                        </Field.Root>
                                    </VStack>
                                )}

                                {tokenError && (
                                    <Alert.Root status="error" borderRadius="md">
                                        <Alert.Indicator />
                                        <Text fontSize="sm">{tokenError}</Text>
                                    </Alert.Root>
                                )}
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button
                                variant="solid"
                                colorPalette="brandGreen"
                                size="md"
                                onClick={handleSaveToken}
                                loading={isSubmittingToken}
                            >
                                Save Token
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </VStack>
    );
}
