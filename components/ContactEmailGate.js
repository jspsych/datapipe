import { useContext, useState } from "react";
import { Box, VStack, Heading, Text, Field, Input, Button, Center } from "@chakra-ui/react";
import { doc, setDoc } from "firebase/firestore";
import { UserContext } from "../lib/context";
import { db } from "../lib/firebase";
import FormErrorAlert from "./ui/FormErrorAlert";
import {
  isValidEmailFormat,
  isSyntheticOsfEmail,
  buildContactEmailUpdate,
} from "../lib/contact-email";

// The wall §2.3 of the plan decided on: rendered IN PLACE by AuthCheck when
// a signed-in researcher's users/{uid} doc has no usable contactEmail, on
// every admin route except /admin/account (AuthCheck's
// requireContactEmail={false} there -- see pages/admin/account.js). Never a
// modal, never a redirect: a redirect-based gate on four routes means four
// redirect effects, a loop risk against AuthCheck's own fallbackRoute push,
// and a URL the researcher can bookmark into. This renders in the layout,
// with the navbar above it.
//
// No skip control. Sign-out stays reachable because the Navbar is mounted
// OUTSIDE AuthCheck (pages/_app.js) -- this component must not render a
// sign-out control of its own, and must not be a full-screen overlay that
// hides that chrome.
//
// On a successful save this component does NOT navigate or force a
// re-render itself: AuthCheck owns the users/{uid} subscription that
// decided to render this gate in the first place, so the next snapshot
// after the write re-evaluates hasContactEmail() and simply stops
// rendering this component in favor of the page it was blocking.
export default function ContactEmailGate({ userDoc }) {
  const { user } = useContext(UserContext);

  // Prefill computed ONCE, via a lazy initializer, so a later Firestore
  // snapshot of userDoc (e.g. some unrelated field changing while this
  // panel is open) never clobbers what the researcher has already typed.
  const [email, setEmail] = useState(() => initialEmailFor(user, userDoc));
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmed = email.trim();
  const formatValid = isValidEmailFormat(trimmed);

  // The OSF-prefill hint only makes sense when the value on screen actually
  // came from OSF -- i.e. there was no usable Auth email, and users/{uid}.email
  // is a real, non-synthetic address. Recomputed from the same inputs as
  // initialEmailFor rather than stored, so editing the field never leaves a
  // stale hint pointing at a value that is no longer showing.
  const showOsfHint =
    !isValidEmailFormat((user?.email || "").trim()) &&
    isValidEmailFormat((userDoc?.email || "").trim()) &&
    !isSyntheticOsfEmail(userDoc?.email);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    setFormError("");

    if (!formatValid) return;

    setIsSubmitting(true);
    try {
      // buildContactEmailUpdate() is the ONLY place this object is
      // assembled -- it emits exactly the four keys
      // firestore.rules' isContactEmailUpdate() allows
      // (contactEmail, contactEmailVerified, contactEmailUpdatedAt,
      // contactEmailSource), with contactEmailVerified always false so a
      // client write can never self-certify an address.
      await setDoc(
        doc(db, "users", user.uid),
        buildContactEmailUpdate(trimmed),
        { merge: true }
      );
    } catch (err) {
      setFormError(
        "Could not save your email address. Check your connection and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Center py={8} px={4}>
      <Box
        as="form"
        onSubmit={handleSubmit}
        noValidate
        w="100%"
        maxW="560px"
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        p={8}
      >
        <VStack gap={4} align="stretch">
          {/* Copy is verbatim from plan §2.3 -- consequence before
              mechanism (PRODUCT.md principle 2). Do not paraphrase. */}
          <Heading as="h1" size="lg" color="fg">
            Add an email address
          </Heading>

          <Text color="fg.muted">
            DataPipe needs a way to reach you if your data stops arriving.
          </Text>

          <Text color="fg.muted">
            We email you when a data file fails to upload to your storage
            provider, and if the service is disrupted. That is the only
            thing this address is used for — no announcements, no mailing
            list, and it is never shown to participants.
          </Text>

          <Field.Root invalid={touched && !formatValid}>
            <Field.Label>Email address</Field.Label>
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setFormError("");
              }}
              onBlur={() => setTouched(true)}
            />
            <Field.ErrorText>Enter a valid email address.</Field.ErrorText>
          </Field.Root>

          {showOsfHint && (
            <Text fontSize="sm" color="fg.muted">
              This is the address we have from OSF — change it if it is
              wrong.
            </Text>
          )}

          <FormErrorAlert>{formError}</FormErrorAlert>

          <Button
            type="submit"
            colorPalette="brandGreen"
            loading={isSubmitting}
            loadingText="Saving…"
            w="full"
            size="lg"
          >
            Save and continue
          </Button>
        </VStack>
      </Box>
    </Center>
  );
}

// Prefill rules (plan §2.3): auth.currentUser.email wins when present
// (email/password, Google, GitHub with a disclosed address). Otherwise
// users/{uid}.email if it is a real, non-synthetic address -- the
// OSF-API-supplied one the migration population already has on file. An
// ORCID-only signup with no OSF history gets neither and sees an empty
// field: the intended path, not a failure (see the SEEDING RULE in
// lib/contact-email.js -- this prefill only ever reads from Auth or the
// legacy OSF `email` field, and NEVER writes without the researcher
// submitting the form).
function initialEmailFor(user, userDoc) {
  const authEmail = (user?.email || "").trim();
  if (isValidEmailFormat(authEmail)) return authEmail;

  const osfEmail = (userDoc?.email || "").trim();
  if (isValidEmailFormat(osfEmail) && !isSyntheticOsfEmail(osfEmail)) {
    return osfEmail;
  }

  return "";
}
