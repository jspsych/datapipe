import { useState } from "react";
import { 
  Button, 
  Text,
  VStack,
  Alert,
  AlertIcon
} from "@chakra-ui/react";
import { OsfIcon } from "./OsfIcon";

export default function SignUpWithOSF() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOSFSignup = () => {
    setIsLoading(true);
    setError("");

    try {
      const state = crypto.randomUUID().substring(0, 6);
      localStorage.setItem('latestCSRFToken', state);
      localStorage.setItem('osfAuthFlow', 'signup'); // Mark this as signup flow
      
      const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
      const scope = "osf.full_write";
      const url = `https://accounts.osf.io/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline&approval_prompt=force`;
      
      window.location.href = url;
    } catch (err) {
      console.error('OSF signup error:', err);
      setError("Failed to initiate OSF signup. Please try again.");
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
        onClick={handleOSFSignup}
        width="full"
        size="lg"
      >
        Sign Up with OSF
      </Button>
    </VStack>
  );
}