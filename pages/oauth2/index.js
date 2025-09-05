'use client';

import { VStack, Heading, Text, Button } from "@chakra-ui/react";

export default function OAuth2Page({}) {

    function handleOAuth2Authentication() {
        const state = crypto.randomUUID().substring(0, 6);
        localStorage.setItem('latestCSRFToken', state);
        const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
        const redirectUri = "https://pipe.jspsych.org/login";
        const scope = "osf.full_write"
        const url = `https://accounts.osf.io/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline`;
        window.location.href = url;
    }

    return (
        <VStack spacing={8} w="560px">
            <Heading>OAuth2 Authentication</Heading>
            <Text>
                This page is used to authenticate with OAuth2 providers. Please follow
                the instructions provided by your OAuth2 provider to complete the
                authentication process.
            </Text>
            <Button colorScheme="blue" onClick={handleOAuth2Authentication}>
                Authenticate with OAuth2
            </Button>
        </VStack>
    );
}