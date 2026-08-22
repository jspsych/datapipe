import { useContext, useState } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { UserContext } from "../../lib/context";
import { linkedProviderIds } from "../../lib/auth-providers";
import AuthProviderButtons from "../auth/AuthProviderButtons";

// Shown to researchers whose ONLY way in is the OSF sign-in that is being
// removed, prompting them to attach a durable provider before it goes.
//
// The trigger is `providerData` being empty, which is exact rather than
// heuristic: OSF sign-in works by minting a Firebase custom token
// (functions/src/oauth2-callback.ts), and a custom-token session carries no
// federated provider and no password. So zero linked providers means
// "this account can be reached by the OSF flow and nothing else" -- precisely
// the population that gets locked out at the cutoff. The moment they link
// anything the banner stops appearing, with no flag to write or maintain.
//
// Deliberately NOT dismissible: losing access to an account that still owns a
// researcher's experiments is not a nag, and the banner removes itself as
// soon as it is acted on.
export default function AddSignInMethodBanner() {
  const { user } = useContext(UserContext);

  // The count is DERIVED from the user, not mirrored into state by an effect
  // -- that would be a cascading render for a value already in hand. The one
  // thing it cannot see is a link that just succeeded: linkWithPopup mutates
  // providerData in place without re-emitting an auth state, so the handler
  // records the post-link count here and it takes precedence. Tagged with the
  // uid it describes so it can never bleed onto a different account.
  const [afterLink, setAfterLink] = useState(null);

  if (!user) return null;

  const linkedCount =
    afterLink?.uid === user.uid
      ? afterLink.count
      : linkedProviderIds(user).length;

  if (linkedCount > 0) return null;

  return (
    <Box
      w="100%"
      bg="brandOrange.subtle"
      border="1px solid"
      borderColor="brandOrange.border"
      borderRadius="md"
      px={4}
      py={4}
    >
      <VStack align="stretch" gap={4}>
        <Box>
          <Text fontWeight="semibold" mb={1}>
            Add a way to sign in
          </Text>
          <Text fontSize="sm" color="fg.muted">
            You currently sign in to DataPipe through OSF, which is being
            retired. Link another provider now and you will keep this account,
            your experiments, and your settings exactly as they are.
          </Text>
        </Box>

        <AuthProviderButtons
          mode="link"
          verb="Link"
          onSignedIn={(updated) =>
            setAfterLink({
              uid: updated.uid,
              count: linkedProviderIds(updated).length,
            })
          }
        />
      </VStack>
    </Box>
  );
}
