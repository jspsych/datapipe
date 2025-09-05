'use client';

import { VStack, Heading, Text, Button } from "@chakra-ui/react";
import { useSearchParams } from 'next/navigation';
import { useState, useEffect, useContext } from "react";
import { UserContext } from "../../lib/context";

export default function OAuth2CallbackPage({}) {
    const { user } = useContext(UserContext);

    const [redirectState, setRedirectState] = useState("");
    const [code, setCode] = useState("");
    const [error, setError] = useState("");
    const [state, setState] = useState("");
    const searchParams = useSearchParams();

    useEffect(() => {
        setRedirectState(localStorage.getItem('latestCSRFToken') || "");
        setCode(searchParams.get('code') || "");
        setError(searchParams.get('error') || "");
        setState(searchParams.get('state') || "");

        if (user?.uid) {
            const executeNextStep = async () => {
                try {
                    await handleNextStep();
                    window.location.href = process.env.NEXT_PUBLIC_OAUTH_FINAL;
                } catch (error) {
                    console.error('Error occurred while handling next step:', error);
                }
            }

            executeNextStep();
        }
    }, [user?.uid]);

    const handleNextStep = async () => {
        // TODO: also adapt to use local/test/prod environment variables
        const res = await fetch(process.env.NEXT_PUBLIC_OAUTH_CALLBACK, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },  
            body: JSON.stringify({
                code: searchParams.get('code'),
                uid: user?.uid
            })
        });
        console.log('Response from server:', res);
        const json = await res.json();
        console.log('Response JSON:', json);
    }

    return (
        <VStack spacing={8} w="560px">
            <Heading>OAuth2 Callback</Heading>
            <Text>
                Authentication successful! You can now close this window and return to the app.
            </Text>
            <Text>
                code = {code || 'No code provided'}<br />
                state = {state || 'No state provided'}<br />
                error = {error || 'No error provided'}<br />
                stored CSRF Token = {redirectState || 'No CSRF token stored'}<br />
                equality? {state === redirectState ? 'Yes' : 'No'}
            </Text>
            <Button colorScheme="blue" onClick={handleNextStep}>
                Close
            </Button>
        </VStack>
    );
}