import { useState } from "react";
import { Button, Text, VStack } from "@chakra-ui/react";
import { OsfIcon } from "./OsfIcon";
import FormErrorAlert from "./ui/FormErrorAlert";

export default function SignInWithOSF() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOSFSignin = async () => {
    setIsLoading(true);
    setError("");

    let stateRes;
    try {
      stateRes = await fetch(process.env.NEXT_PUBLIC_GENERATE_STATE, {
        method: "POST",
      });
    } catch (err) {
      // fetch() itself threw -- no response at all, which on the web means
      // the request never reached anything (offline, DNS, CORS block).
      setError(
        "Could not reach the sign-in service. Check your connection and try again."
      );
      setIsLoading(false);
      return;
    }

    if (!stateRes.ok) {
      // A response came back, just not a good one -- most likely a
      // misconfigured or missing OSF client setup rather than a dead
      // network, so the researcher shouldn't be told to check their wifi.
      console.error("OSF state generation failed:", stateRes.status);
      setError(
        "Could not start the OSF sign-in. This looks like a site configuration problem -- please report it through the Contact page."
      );
      setIsLoading(false);
      return;
    }

    try {
      const { state } = await stateRes.json();

      localStorage.setItem("latestCSRFToken", state);
      localStorage.setItem("osfAuthFlow", "signin");

      const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
      const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
      const scope = "osf.full_write";
      const base_url = `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`;
      const url = `${base_url}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${state}&scope=${scope}&access_type=offline&approval_prompt=force`;

      window.location.href = url;
    } catch (err) {
      console.error("OSF sign-in redirect failed:", err);
      setError("Could not start the OSF sign-in. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <VStack gap={4} w="full">
      <FormErrorAlert>{error}</FormErrorAlert>

      <Button
        type="button"
        variant="outline"
        loading={isLoading}
        loadingText="Redirecting to OSF…"
        onClick={handleOSFSignin}
        width="full"
        size="sm"
      >
        <OsfIcon /> Sign in with OSF
      </Button>

      <Text fontSize="xs" color="fg.muted" textAlign="center">
        OSF sign-in is being retired. Sign in once more, then add another
        provider from your dashboard to keep your account and experiments.
      </Text>
    </VStack>
  );
}
