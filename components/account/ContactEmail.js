import { useContext, useState } from "react";
import { Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { doc, setDoc } from "firebase/firestore";
import { UserContext } from "../../lib/context";
import { auth, db } from "../../lib/firebase";
import FormErrorAlert from "../ui/FormErrorAlert";
import StatusIndicator from "../ui/StatusIndicator";
import { isValidEmailFormat, buildContactEmailUpdate } from "../../lib/contact-email";

// Human copy for the verification endpoints' `code` field. Never rendered
// verbatim -- functions/src/verify-contact-email.ts and
// send-contact-email-verification.ts return a short machine code
// ("invalid-code", "rate-limited", ...) specifically so this file can map it
// to a sentence instead of parroting server jargon through FormErrorAlert.
// `body.error` (the server's own human sentence) is the fallback for a code
// not listed here, and a generic message is the fallback below that.
const SEND_ERROR_COPY = {
  "no-contact-email": "Add a contact email address before requesting a code.",
  "rate-limited": "Please wait a moment before requesting another code.",
  // Sending is paused -- an exhausted daily quota, an unverified sending
  // domain, a revoked key. Deliberately vague, and deliberately one message for
  // all of them: the cause is operational detail a researcher cannot act on
  // differently, and naming it ("we are out of email quota") would be both
  // meaningless to them and needlessly revealing. What they CAN act on is the
  // only thing said: not now, try later.
  //
  // The code form is NOT opened for this one (see requestCode) -- there is no
  // code out there to enter, and offering the field would be a second, quieter
  // lie on top of the first.
  "mail-unavailable":
    "We can't send verification codes right now. Please try again in a little while.",
};
const VERIFY_ERROR_COPY = {
  "invalid-code": "That code is incorrect. Check it and try again.",
  expired: "That code has expired. Request a new one.",
  "no-code-requested": "Request a new code before entering one.",
  "too-many-attempts": "Too many incorrect attempts. Request a new code.",
  "stale-address":
    "This code was sent to a different address. Request a new code.",
  "no-contact-email": "Add a contact email address before verifying.",
};
const GENERIC_ERROR = "Something went wrong. Please try again.";

function humanError(body, copyMap) {
  return (body && copyMap[body.code]) || (body && body.error) || GENERIC_ERROR;
}

// Display + edit + verify. The verification round trip (send/resend a code,
// confirm it) is P3's -- this is the same section AuthCheck's gate exists to
// get a researcher PAST (components/ContactEmailGate.js); here it renders on
// a settled page, in place, whether the address is set or not -- /admin/account
// is exempt from the gate specifically so this control is never itself stuck
// behind it.
//
// `data` is the users/{uid} doc, passed down from pages/admin/account.js's
// single subscription -- same convention as ProviderConnections,
// OAuthTokenStatus, and SelectAuth on this page. No subscription of its
// own.
//
// Verification NEVER gates on anything (plan §2.2): the moment
// contactEmailVerified flips to true is decided entirely server-side, by
// functions/src/verify-contact-email.ts checking a code hash this component
// never sees. This component only ever reflects that flag back -- it cannot
// set it, and does not try to.
export default function ContactEmail({ data }) {
  const { user } = useContext(UserContext);
  const [isEditing, setIsEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Verification round trip. Independent of the edit-form state above --
  // switching into edit mode does not need to reset this, and code entry
  // does not need to reset that.
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [code, setCode] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [sendError, setSendError] = useState("");
  const [verifyError, setVerifyError] = useState("");

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
      // A saved address is always unverified (buildContactEmailUpdate always
      // writes contactEmailVerified: false) and may not even be the same
      // address a code was just sent to -- any in-flight code entry now
      // refers to a stale address, so close it rather than let a correct
      // code for the OLD address appear to still apply here. The server
      // would refuse it anyway (verify-contact-email.ts's stale-address
      // guard); this just avoids showing a form that can only fail.
      setShowCodeForm(false);
      setCode("");
      setSendError("");
      setVerifyError("");
    } catch (err) {
      setFormError(
        "Could not save your email address. Check your connection and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Shared by the initial "Verify" click and "Resend": ask the server to
  // (re)send a code to whatever address it currently has on file for this
  // account. Never sends the address itself -- the endpoint reads
  // users/{uid}.contactEmail server-side, so there is nothing here for a
  // compromised client to redirect.
  const requestCode = async () => {
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch("/api/sendcontactemailverification", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // A rate-limited resend still means a code is already out there and
      // usable -- keep (or open) the entry form so the researcher can use
      // it, just with the cooldown message alongside it, rather than
      // treating "you already have a valid code" as a dead end.
      if (body.code === "rate-limited") {
        setSendError(humanError(body, SEND_ERROR_COPY));
        setShowCodeForm(true);
        return;
      }
      throw new Error(humanError(body, SEND_ERROR_COPY));
    }
    setSendError("");
    setShowCodeForm(true);
  };

  const handleSendClick = async () => {
    setIsSending(true);
    setSendError("");
    try {
      await requestCode();
    } catch (err) {
      setSendError(err.message || GENERIC_ERROR);
    } finally {
      setIsSending(false);
    }
  };

  const handleResend = async () => {
    setIsSending(true);
    setSendError("");
    setVerifyError("");
    try {
      await requestCode();
      setCode("");
    } catch (err) {
      setSendError(err.message || GENERIC_ERROR);
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifySubmit = async (e) => {
    e.preventDefault();
    const trimmedCode = code.trim();
    setVerifyError("");
    if (!/^\d{6}$/.test(trimmedCode)) {
      setVerifyError("Enter the 6-digit code.");
      return;
    }

    setIsVerifying(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/verifycontactemail", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ code: trimmedCode }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(humanError(body, VERIFY_ERROR_COPY));
      }
      // Success. contactEmailVerified flips to true server-side
      // (verify-contact-email.ts); the account page's users/{uid}
      // subscription picks that up on its own and this component
      // re-renders into the "Confirmed" state -- nothing to set locally
      // beyond closing the code form.
      setShowCodeForm(false);
      setCode("");
    } catch (err) {
      setVerifyError(err.message || GENERIC_ERROR);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCancelCode = () => {
    setShowCodeForm(false);
    setCode("");
    setSendError("");
    setVerifyError("");
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
          <Text fontSize="md" fontWeight="medium">
            {hasEmail ? currentEmail : "No address on file"}
          </Text>
          {hasEmail &&
            (isVerified ? (
              <StatusIndicator status="ok" label="Confirmed" />
            ) : (
              // Unverified is a NEUTRAL state, not an error or a warning:
              // an unconfirmed address still receives notifications (plan
              // §2.2 -- DataPipe never gates on verification), so nothing
              // is actually broken here. The action beside it is "Verify",
              // not framed as fixing a problem.
              <HStack gap={2}>
                <StatusIndicator status="neutral" label="Not confirmed yet" />
                {!showCodeForm && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={handleSendClick}
                    loading={isSending}
                  >
                    Verify
                  </Button>
                )}
              </HStack>
            ))}
        </VStack>
        <Button colorPalette="brandGreen" size="sm" onClick={startEditing}>
          {hasEmail ? "Change" : "Add email address"}
        </Button>
      </HStack>

      {/* A send failure that never got as far as opening the code form --
          e.g. no address on file at all (a stale render mid-save), or a
          500. Once showCodeForm is true, the form's own FormErrorAlert
          below takes over so there is only ever one error surface visible
          at a time. */}
      {hasEmail && !isVerified && !showCodeForm && sendError && (
        <FormErrorAlert>{sendError}</FormErrorAlert>
      )}

      {hasEmail && !isVerified && showCodeForm && (
        <VStack
          as="form"
          onSubmit={handleVerifySubmit}
          align="stretch"
          gap={2}
          maxW="sm"
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          p={3}
        >
          <Text fontSize="sm" color="fg.muted">
            Enter the 6-digit code we sent to {currentEmail}.
          </Text>
          <HStack>
            <Input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                setVerifyError("");
              }}
              placeholder="000000"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="Verification code"
              maxW="8em"
              letterSpacing="0.2em"
              textAlign="center"
            />
            <Button
              type="submit"
              colorPalette="brandGreen"
              size="sm"
              loading={isVerifying}
            >
              Confirm
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResend}
              disabled={isSending || isVerifying}
            >
              Resend
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancelCode}
              disabled={isVerifying}
            >
              Cancel
            </Button>
          </HStack>
          <FormErrorAlert>{verifyError || sendError}</FormErrorAlert>
        </VStack>
      )}
    </VStack>
  );
}
