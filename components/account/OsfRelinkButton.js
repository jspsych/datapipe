import { useState } from "react";
import { Button } from "@chakra-ui/react";
import { OsfIcon } from "../OsfIcon";
import { outlineOnDark } from "../../lib/theme";

// Re-runs the OSF authorization to restore WRITE access for an experiment
// that is still collecting. This is the storage grant, not sign-in: it takes
// the `linking` branch of functions/src/oauth2-callback.ts, which attaches
// fresh OSF tokens to the already-signed-in user and never mints a session.
//
// It has to survive the removal of OSF sign-in. OSF refresh tokens expire,
// and the advice this replaces ("sign out and sign back in with OSF") stops
// working the moment that flow is gone -- which would silently kill any
// in-flight study whose token lapsed during the wind-down.
export default function OsfRelinkButton({ children, ...buttonProps }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const stateRes = await fetch(process.env.NEXT_PUBLIC_GENERATE_STATE, {
        method: "POST",
      });
      if (!stateRes.ok) throw new Error("Failed to generate state");
      const { state } = await stateRes.json();

      localStorage.setItem("latestCSRFToken", state);
      localStorage.setItem("osfAuthFlow", "linking");

      const url = new URL(
        `https://accounts.${process.env.NEXT_PUBLIC_OSF_ENV}osf.io/oauth2/authorize`
      );
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", process.env.NEXT_PUBLIC_CLIENT_ID);
      url.searchParams.set("redirect_uri", process.env.NEXT_PUBLIC_REDIRECT_URI);
      url.searchParams.set("state", state);
      url.searchParams.set("scope", "osf.full_write");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("approval_prompt", "force");

      window.location.href = url.toString();
    } catch (err) {
      console.error("Failed to initiate OSF authorization:", err);
      setIsLoading(false);
    }
  };

  return (
    <Button
      {...outlineOnDark}
      size="md"
      loading={isLoading}
      onClick={handleClick}
      {...buttonProps}
    >
      <OsfIcon /> {children}
    </Button>
  );
}
