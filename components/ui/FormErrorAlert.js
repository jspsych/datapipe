import { Alert, Text } from "@chakra-ui/react";

/**
 * FormErrorAlert
 *
 * The one error surface for the app. Extracted verbatim from the pattern
 * `components/account/LinkedAccounts.js` already uses correctly:
 *
 *   <Alert.Root status="error" borderRadius="md" role="alert">
 *     <Alert.Indicator />
 *     <Text fontSize="sm">{error}</Text>
 *   </Alert.Root>
 *
 * `.impeccable/critique/2026-08-22T13-53-28Z__pages-admin-account-js.md`
 * (P0 "Two of the three network paths fail silently") documents that this
 * exact pattern exists in exactly one of the account page's several error
 * paths: `LinkedAccounts` renders it, `DeleteAccount` renders a near-copy
 * inline, `ProviderConnections`'s OAuth paths drop the error to
 * `console.error` with nothing rendered, and `ChangePassword` closes its
 * own dialog before showing a bare "Failed" with no message. PRODUCT.md's
 * Design Principle 5 ("practice what you preach... honest errors, no
 * silent failures") and the critique's fix both call for ONE
 * error-surfacing pattern reused everywhere instead of three ad hoc ones.
 * This component is that pattern, pulled out so every call site gets it
 * for free instead of re-typing (and, per the critique, sometimes
 * skipping) it.
 *
 * Renders NOTHING when `children` is falsy or an empty string, so a call
 * site can write `<FormErrorAlert>{error}</FormErrorAlert>` unconditionally
 * without an `{error && ...}` guard of its own.
 *
 * `Alert.Root status="error"` supplies Chakra's own error coloring and
 * icon; no literal color values are chosen here, so there is nothing in
 * this file for the light/dark mode migration to revisit.
 *
 * @param {React.ReactNode} children - The error message. Nothing renders
 *   if this is falsy (null, undefined, "").
 */
export default function FormErrorAlert({ children }) {
  if (!children) return null;

  return (
    <Alert.Root status="error" borderRadius="md" role="alert">
      <Alert.Indicator />
      <Text fontSize="sm">{children}</Text>
    </Alert.Root>
  );
}
