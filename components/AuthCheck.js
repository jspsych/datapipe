import { useContext, useEffect } from "react";
import { Spinner, Center } from "@chakra-ui/react";
import { UserContext } from "../lib/context";
import SignInForm from "./SignInForm";
import { useRouter } from "next/router";

export default function AuthCheck({ children, fallback, fallbackRoute }) {
  const router = useRouter();
  const { user, loading } = useContext(UserContext);

  useEffect(() => {
    if (!user && fallbackRoute) {
      router.push(fallbackRoute);
    }
  }, [user, router, fallbackRoute]);

  if (loading || (user && !user.uid)) {
    return <Center py={8}><Spinner size="lg" color="brandGreen.solid" /></Center>;
  }

  return (user && user.uid)
    ? children
    : fallback || <SignInForm routeAfterSignIn={router.pathname} />;
}
