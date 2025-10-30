import { useState } from "react";
import { 
  Button, 
  Text,
  Alert,
  AlertIcon,
  VStack
} from "@chakra-ui/react";
import { OsfIcon } from "./OsfIcon";

export default function SignInWithOSF() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOSFSignin = () => {
    setIsLoading(true);
    setError("");

    try {
      const state = crypto.randomUUID().substring(0, 6);
      localStorage.setItem('latestCSRFToken', state);
      localStorage.setItem('osfAuthFlow', 'signin'); // Mark this as signin flow
      
      const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
      const scope = "osf.full_write";
      const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
      const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline&approval_prompt=force`;

      window.location.href = url;
    } catch (err) {
      console.error('OSF signin error:', err);
      setError("Failed to initiate OSF signin. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <VStack spacing={4} w="full">
      {error && (
        <Alert status="error" borderRadius="md">
          <AlertIcon />
          <Text fontSize="sm">{error}</Text>
        </Alert>
      )}

      <Button
        colorScheme="blue"
        leftIcon={<OsfIcon />}
        isLoading={isLoading}
        loadingText="Redirecting to OSF..."
        onClick={handleOSFSignin}
        width="full"
        size="lg"
      >
        Sign In with OSF
      </Button>
    </VStack>
  );
}