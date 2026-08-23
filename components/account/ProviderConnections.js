import { useContext, useState } from "react";
import {
  VStack,
  HStack,
  Text,
  Button,
  Input,
  Field,
  Link as ChakraLink,
} from "@chakra-ui/react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db, auth } from "../../lib/firebase";
import { UserContext } from "../../lib/context";
import { STORAGE_PROVIDERS } from "../../lib/provider-config";
import ConfirmDialog from "../ui/ConfirmDialog";
import FormErrorAlert from "../ui/FormErrorAlert";
import StatusIndicator from "../ui/StatusIndicator";

// Generic fetch-failure copy for handleConnect/handleDisconnect. Unlike
// messageForError below -- which decodes Dataverse's specific rejection
// reasons -- these two hit internal DataPipe endpoints with no researcher-
// actionable detail to translate, so one message covers "the request never
// landed."
const NETWORK_ERROR_MESSAGE =
  "Could not reach DataPipe. Check your connection and try again.";

// `data` is the users/{uid} document, subscribed to ONCE by
// pages/admin/account.js and passed down. This component deliberately does
// not open its own subscription: when it did, it resolved on its own
// schedule and rendered isConnected(undefined) === false on first paint, so
// a connected researcher saw every provider flash "Connect" before settling.
export default function ProviderConnections({ data }) {
  const { user } = useContext(UserContext);

  const [connectingId, setConnectingId] = useState(null);

  // Component-level failure surface for handleConnect, which has no dialog
  // of its own to show an error in (renders the same way LinkedAccounts.js
  // reports its own link/unlink failures). handleDisconnect does NOT use
  // this -- it always runs inside the disconnect ConfirmDialog below, which
  // already surfaces a thrown error in context; see the comment there.
  const [error, setError] = useState("");

  // Static-token providers have no redirect flow: clicking Connect opens an
  // inline form instead of navigating away. Only one can be open at a time.
  const [tokenFormId, setTokenFormId] = useState(null);
  const [serverUrl, setServerUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [formError, setFormError] = useState(null);

  // Disconnect is guarded by a confirmation dialog naming the actual
  // consequence (see countExperiments below), so `confirmProviderId` is which
  // provider's dialog is open rather than an immediate action.
  const [confirmProviderId, setConfirmProviderId] = useState(null);
  const [experimentCount, setExperimentCount] = useState(null); // null = loading
  const [countFailed, setCountFailed] = useState(false);

  const openTokenForm = (providerId) => {
    setTokenFormId(providerId);
    setServerUrl("");
    setApiToken("");
    setFormError(null);
  };

  const closeTokenForm = () => {
    setTokenFormId(null);
    setServerUrl("");
    setApiToken("");
    setFormError(null);
  };

  // The backend rejects any server URL that is not a plain https host: no
  // http, no embedded credentials, no odd ports, no IP literals, no internal
  // hostnames. That gate exists because the server itself makes authenticated
  // requests to whatever is submitted. Translate its opaque replies into
  // something a researcher can act on rather than surfacing them verbatim.
  const messageForError = (status, error) => {
    if (error === "Invalid server URL") {
      return "That does not look like a Dataverse server address. Use the full https:// address of your institution's installation, for example https://dataverse.harvard.edu.";
    }
    if (error === "Invalid API token") {
      return "That server did not accept the token. Check that you copied it fully, that it has not expired, and that it belongs to the server above.";
    }
    if (status === 401 || status === 403) {
      return "You are not signed in to the right account. Try reloading the page and signing in again.";
    }
    return "Could not connect. Please try again.";
  };

  const handleTokenConnect = async (providerId) => {
    setConnectingId(providerId);
    setFormError(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/connectstatictokenprovider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          uid: user.uid,
          idToken,
          token: apiToken.trim(),
          // connectstatictokenprovider ALWAYS requires a serverUrl, but not
          // every static-token provider is federated, so a provider may supply
          // a fixed defaultServerUrl and render no field at all. Dataverse is
          // federated (the researcher types their institution's installation)
          // and is currently the only provider reaching this branch -- Zenodo
          // was the non-federated example until it moved to OAuth2 on
          // 2026-08-21 and stopped coming through here entirely.
          serverUrl: STORAGE_PROVIDERS[providerId]?.needsServerUrl
            ? serverUrl.trim()
            : STORAGE_PROVIDERS[providerId]?.defaultServerUrl,
        }),
      });

      if (!response.ok) {
        let error;
        try {
          ({ error } = await response.json());
        } catch {
          error = null;
        }
        setFormError(messageForError(response.status, error));
        return;
      }

      closeTokenForm();
    } catch (err) {
      console.error("Failed to connect provider:", err);
      setFormError(NETWORK_ERROR_MESSAGE);
    } finally {
      setConnectingId(null);
    }
  };

  const handleConnect = async (providerId) => {
    setConnectingId(providerId);
    setError("");
    try {
      const stateRes = await fetch("/api/generateoauthstate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId }),
      });
      if (!stateRes.ok) throw new Error("Failed to generate state");
      const { state, authorizeUrl } = await stateRes.json();

      localStorage.setItem("latestCSRFToken", state);
      localStorage.setItem("providerConnectFlow", providerId);

      window.location.assign(authorizeUrl);
    } catch (err) {
      console.error("Failed to initiate provider connect:", err);
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setConnectingId(null);
    }
  };

  // Counts experiments this researcher owns that are wired to `providerId`,
  // so the disconnect dialog can name the actual consequence instead of a
  // vague warning. One Firestore query (by owner uid, which is already
  // covered by an index every other experiments query relies on) filtered by
  // provider in JS -- no composite index, no denormalized counter to keep in
  // sync. Fetched fresh each time the dialog opens, not cached and not
  // fetched on page load, because the number is only ever needed right
  // before this one decision.
  const countExperiments = async (providerId) => {
    try {
      const q = query(collection(db, "experiments"), where("owner", "==", user.uid));
      const snapshot = await getDocs(q);
      const count = snapshot.docs.filter(
        (d) => d.data().storageProvider === providerId
      ).length;
      setExperimentCount(count);
    } catch (err) {
      console.error("Failed to count experiments for provider:", err);
      setCountFailed(true);
    }
  };

  const openDisconnectDialog = (providerId) => {
    setConfirmProviderId(providerId);
    setExperimentCount(null);
    setCountFailed(false);
    countExperiments(providerId);
  };

  // Body copy for the disconnect dialog. Consequence before mechanism: say
  // what happens to the researcher's experiments before anything about the
  // connection itself. Falls back to the generic warning if the count
  // couldn't be fetched -- silence would be worse than an imprecise number.
  const disconnectDialogBody = (provider) => {
    if (countFailed) {
      return `Any experiment currently sending data to ${provider.name} will stop receiving new data. Data already written stays there.`;
    }
    if (experimentCount === null) {
      return "Checking which experiments use this connection...";
    }
    if (experimentCount === 0) {
      return "No experiments are currently using this connection. You can reconnect at any time.";
    }
    // "Set up to send", not "currently sending": the count deliberately
    // includes experiments whose collection is paused, because disconnecting
    // breaks those too the moment they are re-enabled. The copy must not
    // claim less than the count covers.
    const noun = experimentCount === 1 ? "experiment is" : "experiments are";
    return `${experimentCount} ${noun} set up to send data to ${provider.name}. Disconnecting stops them from receiving new data. Data already written to ${provider.name} stays there.`;
  };

  const handleDisconnect = async (providerId) => {
    setError("");
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/disconnectprovider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          uid: user.uid,
          idToken,
        }),
      });
      if (!response.ok) {
        throw new Error(NETWORK_ERROR_MESSAGE);
      }
    } catch (err) {
      console.error("Failed to disconnect provider:", err);
      // Rethrow rather than also setting the page-level `error` state below:
      // this always runs inside ConfirmDialog's onConfirm, which already
      // keeps itself open and renders error.message right next to the
      // Disconnect button that failed. Setting both would print the same
      // sentence twice -- once in the dialog, once on the page behind it.
      throw err;
    }
  };

  // The blocked-first-timer state. A new signup cannot create an experiment
  // until something here is connected, and the page said nothing about that
  // -- it just showed three names and three buttons. Stated in the open, not
  // in a tooltip, because this is the reason the product sent them here.
  const noneConnected = !Object.values(STORAGE_PROVIDERS).some((provider) =>
    provider.isConnected(data)
  );

  return (
    <VStack gap={3} w="100%" align="stretch">
      <FormErrorAlert>{error}</FormErrorAlert>

      {noneConnected && (
        <Text fontSize="sm" color="fg.muted">
          No storage connected yet — connect one to create your first
          experiment.{" "}
          <ChakraLink asChild color="brandGreen.fg" textDecoration="underline">
            <Link href="/docs/providers">How to choose a provider</Link>
          </ChakraLink>
        </Text>
      )}

      {Object.values(STORAGE_PROVIDERS).map((provider) => {
        const connected = provider.isConnected(data);
        const isStaticToken = provider.authMethod === "static-token";
        const formOpen = tokenFormId === provider.id;

        return (
          <VStack key={provider.id} w="100%" align="stretch" gap={2}>
          <HStack
            justifyContent="space-between"
            w="100%"
            flexWrap="wrap"
            gap={3}
          >
            <HStack>
              <Text fontSize="lg">{provider.name}</Text>
              {connected && <StatusIndicator status="ok" label="Connected" />}
            </HStack>
            {connected ? (
              // Neutral, not red: disconnecting is reversible (reconnect any
              // time), unlike the Danger Zone's account deletion. Red is
              // reserved for actions that cannot be undone, so it keeps
              // meaning where it actually matters.
              <Button
                variant="outline"
                size="sm"
                aria-label={`Disconnect ${provider.name}`}
                onClick={() => openDisconnectDialog(provider.id)}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                colorPalette="brandGreen"
                size="sm"
                variant={formOpen ? "outline" : "solid"}
                aria-label={`${formOpen ? "Cancel" : "Connect"} ${provider.name}`}
                loading={connectingId === provider.id && !isStaticToken}
                onClick={() =>
                  isStaticToken
                    ? formOpen
                      ? closeTokenForm()
                      : openTokenForm(provider.id)
                    : handleConnect(provider.id)
                }
              >
                {formOpen ? "Cancel" : "Connect"}
              </Button>
            )}
          </HStack>

          {formOpen && !connected && (
            <VStack
              align="stretch"
              gap={3}
              w="100%"
              borderWidth="1px"
              borderRadius="md"
              p={4}
            >
              {provider.needsServerUrl && (
                <Field.Root>
                  <Field.Label>{provider.serverUrlLabel}</Field.Label>
                  <Input
                    type="url"
                    value={serverUrl}
                    placeholder={provider.serverUrlPlaceholder}
                    onChange={(e) => setServerUrl(e.target.value)}
                  />
                </Field.Root>
              )}
              <Field.Root>
                <Field.Label>{provider.tokenLabel}</Field.Label>
                <Input
                  type="password"
                  value={apiToken}
                  autoComplete="off"
                  onChange={(e) => setApiToken(e.target.value)}
                />
                {provider.tokenHelp && (
                  <Field.HelperText>{provider.tokenHelp}</Field.HelperText>
                )}
              </Field.Root>

              <FormErrorAlert>{formError}</FormErrorAlert>

              <HStack justifyContent="flex-end">
                <Button
                  colorPalette="brandGreen"
                  size="sm"
                  aria-label={`Save ${provider.name} connection`}
                  loading={connectingId === provider.id}
                  disabled={
                    apiToken.trim().length === 0 ||
                    (provider.needsServerUrl && serverUrl.trim().length === 0)
                  }
                  onClick={() => handleTokenConnect(provider.id)}
                >
                  Save connection
                </Button>
              </HStack>
            </VStack>
          )}
          </VStack>
        );
      })}

      {confirmProviderId && (
        <ConfirmDialog
          open={!!confirmProviderId}
          onOpenChange={(e) => {
            if (!e.open) setConfirmProviderId(null);
          }}
          title={`Disconnect ${STORAGE_PROVIDERS[confirmProviderId].name}?`}
          confirmLabel="Disconnect"
          onConfirm={() => handleDisconnect(confirmProviderId)}
        >
          <Text>{disconnectDialogBody(STORAGE_PROVIDERS[confirmProviderId])}</Text>
        </ConfirmDialog>
      )}
    </VStack>
  );
}
