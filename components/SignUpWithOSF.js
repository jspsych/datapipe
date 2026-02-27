import { useState } from "react";
import {
  Button,
  Text,
  VStack,
  Alert,
} from "@chakra-ui/react";
import { OsfIcon } from "./OsfIcon";

export default function SignUpWithOSF() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOSFSignup = async () => {
    setIsLoading(true);
    setError("");

    try {
      const stateRes = await fetch(process.env.NEXT_PUBLIC_GENERATE_STATE, { method: 'POST' });
      if (!stateRes.ok) throw new Error('Failed to generate state');
      const { state } = await stateRes.json();

      localStorage.setItem('latestCSRFToken', state);
      localStorage.setItem('osfAuthFlow', 'signup');

      const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
      const scope = "osf.full_write";
      const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
      const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline&approval_prompt=force`;

      window.location.href = url;
    } catch (err) {
      setError("Failed to initiate OSF signup. Please try again.");
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
        colorPalette="blue"
        loading={isLoading}
        loadingText="Redirecting to OSF..."
        onClick={handleOSFSignup}
        width="full"
        size="lg"
      >
        <OsfIcon /> Sign Up with OSF
      </Button>
    </VStack>
  );
}
