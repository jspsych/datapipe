import { useContext, useState } from "react";
import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { doc, setDoc } from "firebase/firestore";
import { UserContext } from "../../lib/context";
import { db } from "../../lib/firebase";
import FormErrorAlert from "../ui/FormErrorAlert";
import StatusIndicator from "../ui/StatusIndicator";
import { isValidEmailFormat, buildContactEmailUpdate } from "../../lib/contact-email";

// Display + edit ONLY. The verification round trip (send/resend a code,
// confirm it) is P3's -- see the SEAM comment below the StatusIndicator.
// This is the same section AuthCheck's gate exists to get a researcher
// PAST (components/ContactEmailGate.js); here it renders on a settled
// page, in place, whether the address is set or not -- /admin/account is
// exempt from the gate specifically so this control is never itself stuck
// behind it.
//
// `data` is the users/{uid} doc, passed down from pages/admin/account.js's
// single subscription -- same convention as ProviderConnections,
// OAuthTokenStatus, and SelectAuth on this page. No subscription of its
// own.
export default function ContactEmail({ data }) {
  const { user } = useContext(UserContext);
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentEmail = (data?.contactEmail || "").trim();
  const hasEmail = currentEmail.length > 0;
  // contactEmailVerified is server-only in the TRUE direction (see
  // firestore.rules / lib/contact-email.js), so this is trustworthy: a
  // client can never have written `true` itself.
  const isVerified = !!data?.contactEmailVerified;

  const trimmed = email.trim();
  const formatValid = isValidEmailFormat(trimmed);

  const startEditing = () => {
    setEmail(currentEmail);
    setTouched(false);
    setFormError("");
    setIsEditing(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    setFormError("");
    if (!formatValid) return;

    setIsSubmitting(true);
    try {
      // buildContactEmailUpdate() is the ONLY place this object is
      // assembled -- exactly the four keys firestore.rules'
      // isContactEmailUpdate() allows, with contactEmailVerified always
      // false so changing the address always resets confirmation rather
      // than leaving `true` standing against a new, unconfirmed value.
      await setDoc(
        doc(db, "users", user.uid),
        buildContactEmailUpdate(trimmed),
        { merge: true }
      );
      setIsEditing(false);
    } catch (err) {
      setFormError(
        "Could not save your email address. Check your connection and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isEditing) {
    return (
      <VStack as="form" onSubmit={handleSubmit} gap={3} align="stretch" noValidate>
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

        <FormErrorAlert>{formError}</FormErrorAlert>

        <HStack>
          <Button
            type="submit"
            colorPalette="brandGreen"
            size="sm"
            loading={isSubmitting}
          >
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack gap={3} align="stretch">
      <HStack justifyContent="space-between" w="100%" flexWrap="wrap" gap={3}>
        <VStack align="start" gap={1}>
          <Text fontSize="lg">
            {hasEmail ? currentEmail : "No address on file"}
          </Text>
          {hasEmail &&
            (isVerified ? (
              <StatusIndicator status="ok" label="Confirmed" />
            ) : (
              // Unverified is a NEUTRAL state, not an error or a warning:
              // an unconfirmed address still receives notifications (plan
              // §2.2 -- DataPipe never gates on verification), so nothing
              // is actually broken here. The Resend action that would
              // make this actionable is P3's -- see the seam below.
              <StatusIndicator status="neutral" label="Not confirmed yet" />
            ))}
        </VStack>
        <Button colorPalette="brandGreen" size="sm" onClick={startEditing}>
          {hasEmail ? "Change" : "Add email address"}
        </Button>
      </HStack>

      {/* ---------------------------------------------------------------
          SEAM FOR P3 -- do not build here.

          The verification round trip renders in this spot, alongside the
          StatusIndicator above: a "Resend" action next to "Not confirmed
          yet", and the 6-digit code entry form it opens. P3 owns
          functions/src/send-contact-email-verification.ts,
          functions/src/verify-contact-email.ts, and
          __tests__/contact-email-section.test.jsx. P1 (this file) is
          display + edit only.
         --------------------------------------------------------------- */}
    </VStack>
  );
}
