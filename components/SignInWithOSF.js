import { useState } from "react";
import {
  Button,
  Text,
  Alert,
  VStack
} from "@chakra-ui/react";
import { OsfIcon } from "./OsfIcon";

export default function SignInWithOSF() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOSFSignin = async () => {
    setIsLoading(true);
    setError("");

    try {
      const stateRes = await fetch(process.env.NEXT_PUBLIC_GENERATE_STATE, { method: 'POST' });
      if (!stateRes.ok) throw new Error('Failed to generate state');
      const { state } = await stateRes.json();

      localStorage.setItem('latestCSRFToken', state);
      localStorage.setItem('osfAuthFlow', 'signin');

      const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
      const scope = "osf.full_write";
      const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
      const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline&approval_prompt=force`;

      window.location.href = url;
    } catch (err) {
      setError("Failed to initiate OSF signin. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <VStack gap={4} w="full">
      {error && (
        <Alert.Root status="error" borderRadius="md">
          <Alert.Indicator />
          <Text fontSize="sm">{error}</Text>
        </Alert.Root>
      )}

      <Button
        variant="outline"
        loading={isLoading}
        loadingText="Redirecting to OSF..."
        onClick={handleOSFSignin}
        width="full"
        size="sm"
      >
        <OsfIcon /> Sign in with OSF
      </Button>

      <Text fontSize="xs" color="gray.400" textAlign="center">
        OSF sign-in is being retired. Sign in once more, then add another
        provider from your dashboard to keep your account and experiments.
      </Text>
    </VStack>
  );
}
