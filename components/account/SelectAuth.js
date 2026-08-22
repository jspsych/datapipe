import {
  HStack,
  VStack,
  Text,
  Link,
  Button,
  Dialog,
  Field,
  Input,
  CloseButton,
} from "@chakra-ui/react"
import { useContext, useState, useRef } from "react";
import { UserContext } from "../../lib/context";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";

import FormErrorAlert from "../ui/FormErrorAlert";
import StatusIndicator from "../ui/StatusIndicator";
import OsfRelinkButton from "./OsfRelinkButton";

// `data` is the users/{uid} document, subscribed to ONCE by
// pages/admin/account.js and passed down -- this was the fourth independent
// subscription to the same document on one page. The setDoc calls below
// still land on that live listener, so the toggle keeps updating in place;
// only the read moved.
export default function SelectAuth({ data }) {
    const { user } = useContext(UserContext);

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

    const usingPersonalToken = data?.usingPersonalToken;
    const hasOAuthToken = data?.authToken && data?.refreshToken;
    const hasValidPersonalToken = data?.osfTokenValid;

    if (!usingPersonalToken) {
        return (
            <VStack gap={2} w="100%" align="stretch">
                <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
                    <HStack>
                        <Text fontSize="lg">OSF account</Text>
                        {/* Same visible-label rule as every other status on
                            the page: a bare check or warning triangle says
                            nothing to a screen reader or a colorblind
                            reader. */}
                        <StatusIndicator
                            status={hasOAuthToken ? "ok" : "warning"}
                            label={hasOAuthToken ? "Authorized" : "Not authorized"}
                        />
                    </HStack>
                    <OsfRelinkButton size="sm">
                        {hasOAuthToken ? "Re-authorize OSF" : "Authorize OSF"}
                    </OsfRelinkButton>
                </HStack>
                <HStack justifyContent="flex-end" w="100%">
                    <Link
                        color="brandGreen.fg"
                        textDecoration="underline"
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
        <VStack gap={2} w="100%" align="stretch">
            <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
                <HStack>
                    <Text fontSize="lg">OSF token</Text>
                    <StatusIndicator
                        status={hasValidPersonalToken ? "ok" : "warning"}
                        label={hasValidPersonalToken ? "Valid" : "No valid token"}
                    />
                </HStack>
                <Button
                    colorPalette="brandGreen"
                    size="sm"
                    onClick={openTokenDialog}
                    loading={isSubmittingToken}
                >
                    Set OSF token
                </Button>
            </HStack>
            <HStack justifyContent="flex-end" w="100%">
                <Link
                    color="brandGreen.fg"
                    textDecoration="underline"
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
                    <Dialog.Content
                        bg="bg.panel"
                        color="fg"
                        borderWidth="1px"
                        borderColor="border"
                    >
                        <Dialog.CloseTrigger asChild>
                            <CloseButton size="sm" aria-label="Close" />
                        </Dialog.CloseTrigger>
                        <Dialog.Header>Set OSF personal access token</Dialog.Header>
                        <Dialog.Body>
                            <VStack gap={4} w="100%">
                                <Text>
                                    To generate an OSF token, go to{" "}
                                    <Link
                                        color="brandGreen.fg"
                                        textDecoration="underline"
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

                                <VStack gap={4} w="100%">
                                    <Field.Root>
                                        <Field.Label>OSF token</Field.Label>
                                        <Input ref={tokenRef} type="text" placeholder="Paste your OSF token here" />
                                    </Field.Root>
                                </VStack>

                                <FormErrorAlert>{tokenError}</FormErrorAlert>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button
                                variant="solid"
                                colorPalette="brandGreen"
                                onClick={handleSaveToken}
                                loading={isSubmittingToken}
                            >
                                Save token
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        </VStack>
    );
}
