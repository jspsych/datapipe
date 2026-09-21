import { useContext, useEffect } from "react";
import { Spinner, Center } from "@chakra-ui/react";
import { doc } from "firebase/firestore";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { UserContext } from "../lib/context";
import { db } from "../lib/firebase";
import { hasContactEmail } from "../lib/contact-email";
import ContactEmailGate from "./ContactEmailGate";
import SignInForm from "./SignInForm";
import { useRouter } from "next/router";

// requireContactEmail defaults to true: every admin route is walled off
// until the signed-in researcher has a usable contactEmail EXCEPT
// /admin/account, which passes requireContactEmail={false} so the account
// deletion control is never itself stuck behind the gate it exists to let a
// researcher get past (see components/ContactEmailGate.js).
export default function AuthCheck({
  children,
  fallback,
  fallbackRoute,
  requireContactEmail = true,
}) {
  const router = useRouter();
  const { user, loading } = useContext(UserContext);

  useEffect(() => {
    if (!user && fallbackRoute) {
      router.push(fallbackRoute);
    }
  }, [user, router, fallbackRoute]);

  // Only subscribed when there is a signed-in uid and the route actually
  // requires the gate -- `doc()` is passed `null` otherwise, which is
  // react-firebase-hooks' own "don't subscribe" signal, same pattern as
  // pages/admin/account.js and pages/admin/new.js.
  const shouldWatchContactEmail = requireContactEmail && !!user?.uid;
  const [userDoc, userDocLoading, userDocError] = useDocumentData(
    shouldWatchContactEmail ? doc(db, "users", user.uid) : null
  );

  if (loading || (user && !user.uid)) {
    return <Center py={8}><Spinner size="lg" color="brandGreen.solid" /></Center>;
  }

  if (!(user && user.uid)) {
    return fallback || <SignInForm routeAfterSignIn={router.pathname} />;
  }

  if (shouldWatchContactEmail) {
    // Loading -> the existing spinner treatment, never children. A flash of
    // the dashboard immediately followed by a wall is worse than a beat of
    // spinner.
    if (userDocLoading) {
      return <Center py={8}><Spinner size="lg" color="brandGreen.solid" /></Center>;
    }

    // Read error -> fail open. The gate is a data-quality nudge, not a
    // security boundary; a Firestore blip must not lock a researcher out of
    // a running study.
    if (!userDocError && !hasContactEmail(userDoc)) {
      return <ContactEmailGate userDoc={userDoc} />;
    }
  }

  return children;
}
